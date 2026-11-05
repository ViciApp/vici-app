import type { ClearingDid } from '#declarations';
import {
	cancelLimitOrder as cancelLimitOrderApi,
	getOrders as getOrdersApi,
	listOrders as listOrdersApi,
	submitLimitOrder,
	submitMarketOrder
} from '#lib/api/clearing.api.ts';
import { MarketClosedError } from '#lib/canisters/clearing.errors.ts';
import { PRICE_DECIMALS, ZERO } from '#lib/constants/app.constants.ts';
import { ActivityType } from '#lib/enums/social.ts';
import { logActivity } from '#lib/services/activity.services.ts';
import { track } from '#lib/services/analytics.services.ts';
import {
	getIdentity,
	getIdentityOrAnonymous,
	safeGetIdentityOnce
} from '#lib/services/identity.services.ts';
import { recordActivity } from '#lib/services/profile.services.ts';
import { loadWithCertification } from '#lib/services/query-update.services.ts';
import type { MarketId, Outcome } from '#lib/types/market.ts';
import type { OrderSide, OrderType } from '#lib/types/order.ts';
import { filterByPlaygroundExpandedDomain } from '#lib/utils/balance-domain.utils.ts';
import { parseLimitOrderPriceValue } from '#lib/utils/parse.utils.ts';
import { refreshAllBalances, refreshOrders, refreshPositions } from '#lib/utils/refresh.utils.ts';
import { isWeb2Backend } from '#lib/web2/backend-mode.ts';
import {
	cancelEngineOrder as cancelEngineOrderWeb2,
	listEngineOrders as listEngineOrdersWeb2,
	submitEngineLimitOrder as submitEngineLimitOrderWeb2,
	submitEngineMarketOrder as submitEngineMarketOrderWeb2,
	Web2ApiError
} from '#lib/web2/client.ts';
import { getWeb2User } from '#lib/web2/session.ts';
import { fromNullable, isNullish, nonNullish, toNullable, type Nullable } from '@dfinity/utils';
import { AnonymousIdentity, type Identity } from '@icp-sdk/core/agent';
import { getIdentityOnce } from '@junobuild/core';
import { nanoid } from 'nanoid';

/**
 * Core order-book fetch: threads identity + certified so it composes with
 * {@link loadOrderBook} / `queryAndUpdate`.
 */
const fetchOrderBook = async ({
	identity,
	certified,
	marketId,
	domain
}: {
	identity: Identity;
	certified: boolean;
	marketId: MarketId;
	domain?: ClearingDid.BalanceDomain;
}): Promise<ClearingDid.LimitOrder[]> => {
	const orders = await listOrdersApi({
		identity,
		certified,
		params: { series_id: toNullable(marketId) }
	});

	if (isNullish(domain)) {
		return orders;
	}

	return orders.filter((o) => {
		const [orderDomain] = Object.keys(o.balance_domain);
		const [targetDomain] = Object.keys(domain);

		return orderDomain === targetDomain;
	});
};

/**
 * Lists open limit orders for a market, optionally filtered to a balance domain.
 *
 * Performs a single certified update. Prefer {@link loadOrderBook} for UI flows
 * that should render fast then upgrade to a certified result.
 */
export const getOrderBook = async ({
	marketId,
	domain,
	identity: identityOverride,
	certified = true
}: {
	marketId: MarketId;
	domain?: ClearingDid.BalanceDomain;
	identity?: Identity;
	certified?: boolean;
}): Promise<ClearingDid.LimitOrder[]> => {
	const identity = identityOverride ?? (await getIdentityOrAnonymous());

	return fetchOrderBook({ identity, certified, marketId, domain });
};

/**
 * Callback-based variant of {@link getOrderBook} that fires `onLoad` up to
 * twice — once for the uncertified query, once for the certified update.
 */
export const loadOrderBook = ({
	marketId,
	domain,
	onLoad,
	onUpdateError
}: {
	marketId: MarketId;
	domain?: ClearingDid.BalanceDomain;
	onLoad: (options: { certified: boolean; response: ClearingDid.LimitOrder[] }) => void;
	onUpdateError?: (error: unknown) => void;
}): Promise<void> =>
	loadWithCertification<ClearingDid.LimitOrder[]>({
		request: ({ certified, identity }) => fetchOrderBook({ identity, certified, marketId, domain }),
		onLoad,
		onUpdateError
	});

/**
 * Submits a limit order or matches a market order against the book; refreshes UI state and logs activity.
 */

/** Map a web2 session miss onto the exact error text the web3 path throws
 * from safeGetIdentityOnce, so the UI's auth-failure handling stays one
 * message regardless of backend. */
const rethrowWeb2Unauthenticated = (err: unknown): never => {
	if (err instanceof Web2ApiError && err.status === 401) {
		throw new Error('Not authenticated');
	}

	throw err;
};

export const placeOrder = async ({
	marketId,
	marketTitle,
	side,
	type,
	price,
	qty,
	outcome,
	expiryDate
}: {
	marketId: MarketId;
	marketTitle: string;
	side: OrderSide;
	type: OrderType;
	price: number;
	qty: bigint;
	outcome: Outcome;
	expiryDate: bigint;
}): Promise<void> => {
	// Stopgap expiry gate. The deck/catalog is filtered `only_unexpired` at
	// fetch time, but the clearing engine has no expiry check (its `TradeError`
	// has no `Expired` variant — it only rejects settled series), so a deck
	// opened just before kickoff could submit after it. Reject at/after the
	// market's expiry until icdc-core enforces this server-side.
	if (BigInt(Date.now()) >= expiryDate) {
		throw new MarketClosedError();
	}

	// Sizing rounds the stake down to whole contracts (`amountUsd / priceUsd`),
	// so a stake smaller than one contract's price arrives here as zero —
	// reject it before any state changes or activity logging.
	if (qty <= ZERO) {
		throw new Error('Stake is too small for this price — the order quantity rounds to zero');
	}

	// In web2 mode there is no local signing identity: the API signs engine
	// calls with the caller's derived custodial identity (the session cookie is
	// the auth), so reaching for the Juno identity would throw for every trade.
	const identity = isWeb2Backend() ? undefined : await safeGetIdentityOnce();

	const isBinary = outcome === 'YES' || outcome === 'NO';
	const normalizedSide: OrderSide = isBinary
		? outcome === 'NO'
			? side === 'BUY'
				? 'SELL'
				: 'BUY'
			: side
		: side;
	const normalizedPrice = isBinary && outcome === 'NO' ? 1 - price : price;
	const outcomeId: Nullable<string> = isBinary ? toNullable() : toNullable(outcome);

	// What the activity log reports: the full size for a resting limit order,
	// the actually executed size for a market order (the book may be smaller
	// than the request).
	let filledQty = qty;

	if (type === 'LIMIT') {
		const orderId = `ORD_${nanoid(8)}`;

		if (isNullish(identity)) {
			try {
				await submitEngineLimitOrderWeb2({
					orderId,
					seriesId: marketId,
					side: normalizedSide === 'BUY' ? 'buy' : 'sell',
					outcomeId: fromNullable(outcomeId),
					priceValue: parseLimitOrderPriceValue(normalizedPrice),
					priceDecimals: PRICE_DECIMALS,
					qty
				});
			} catch (err: unknown) {
				rethrowWeb2Unauthenticated(err);
			}
		} else {
			await submitLimitOrder({
				identity,
				params: {
					order_id: orderId,
					series_id: marketId,
					side: normalizedSide === 'BUY' ? { Buy: null } : { Sell: null },
					outcome_id: outcomeId,
					price: {
						decimal: {
							value: parseLimitOrderPriceValue(normalizedPrice),
							decimals: PRICE_DECIMALS
						},
						timestamp: toNullable(),
						oracle_id: toNullable()
					},
					qty
				}
			});
		}
	} else {
		const counterSide = normalizedSide === 'BUY' ? 'Sell' : 'Buy';

		const targetOutcomeId = outcome === 'YES' || outcome === 'NO' ? undefined : outcome;

		const callerText = identity?.getPrincipal().toText();

		const fetchMatchingOrders = async (): Promise<ClearingDid.LimitOrder[]> => {
			// The book itself is a public on-chain query in both modes. In web2
			// mode the caller's engine principal lives server-side, so their own
			// resting orders are excluded by id (from the session-gated own-orders
			// read) instead of by creator.
			const [orders, ownOrderIds] = await Promise.all([
				listOrdersApi({
					identity: identity ?? new AnonymousIdentity(),
					params: { series_id: toNullable(marketId) }
				}),
				isNullish(identity)
					? listEngineOrdersWeb2().then((own) => new Set(own.map((o) => o.order_id)))
					: Promise.resolve(undefined)
			]);

			return orders
				.filter((o: ClearingDid.LimitOrder) => {
					const isCorrectSide = counterSide in o.side;
					const isCorrectOutcome = o.outcome_id[0] === targetOutcomeId;
					// The engine rejects self-trades; the caller's own resting
					// orders are not liquidity for this market order.
					const isSelf = nonNullish(ownOrderIds)
						? ownOrderIds.has(o.order_id)
						: o.creator.toText() === callerText;

					return isCorrectSide && isCorrectOutcome && !isSelf;
				})
				.sort((a: ClearingDid.LimitOrder, b: ClearingDid.LimitOrder) => {
					const priceA = Number(a.price.decimal.value);
					const priceB = Number(b.price.decimal.value);

					return normalizedSide === 'BUY' ? priceA - priceB : priceB - priceA;
				});
		};

		let matchingOrders = await fetchMatchingOrders();

		if (matchingOrders.length === 0) {
			throw new Error('No matching liquidity found for market order');
		}

		// Walk the book best-price-first, taking `min(remaining, level)` per
		// trade, so the execution honors the caller's stake-derived `qty`
		// rather than whatever size the best resting order happens to carry.
		// The book is re-read between takes: a level shrunk by a concurrent
		// taker would otherwise overstate the fill (the engine executes
		// `min(take, current level)`) and stop the walk early. A book smaller
		// than the request fills what exists. The pass cap is a defensive
		// bound — each pass either reduces `remaining` or exits, so a healthy
		// walk never reaches it.
		const MAX_BOOK_PASSES = 10;
		let remaining = qty;

		try {
			for (let pass = 0; pass < MAX_BOOK_PASSES && remaining > ZERO; pass++) {
				if (pass > 0) {
					matchingOrders = await fetchMatchingOrders();
				}

				const [best] = matchingOrders;

				if (isNullish(best)) {
					break;
				}

				const take = remaining < best.qty ? remaining : best.qty;

				if (isNullish(identity)) {
					try {
						await submitEngineMarketOrderWeb2({
							tradeId: `TRD_${nanoid(8)}`,
							matchingOrderId: best.order_id,
							qty: take
						});
					} catch (err: unknown) {
						rethrowWeb2Unauthenticated(err);
					}
				} else {
					await submitMarketOrder({
						identity,
						params: {
							trade_id: `TRD_${nanoid(8)}`,
							matching_order_id: best.order_id,
							qty: toNullable(take)
						}
					});
				}

				remaining -= take;
			}
		} catch (e: unknown) {
			// Nothing executed — surface the failure. After a partial fill the
			// user holds a real position, so finish with what filled instead
			// of reporting a failure that would read as "nothing happened".
			if (remaining === qty) {
				throw e;
			}

			console.warn('Market order partially filled before an error; keeping the filled amount', e);
		}

		filledQty = qty - remaining;
	}

	refreshPositions();
	refreshOrders();

	refreshAllBalances();

	// Behavioural telemetry for the cockpit — every REAL trade goes through here
	// (the flow deck's guest picks emit separately). `value` is the VXP at stake
	// (contracts × price of the chosen outcome); a resting limit order reports its
	// full placed size, a market order the actually-executed fill.
	if (filledQty > ZERO || type === 'LIMIT') {
		track({
			name:
				type === 'LIMIT' ? 'order_placed' : side === 'BUY' ? 'position_taken' : 'position_closed',
			marketId,
			label: outcome,
			count: Number(filledQty),
			value: Number(filledQty) * normalizedPrice
		});
	}

	try {
		// In web2 mode the activity owner is the session account id (the same
		// `owner` string the swapped profile services key on); `logActivity`
		// routes the write to the HTTP feed, whose trade trigger fires the same
		// onboarding-milestone / referral awards the satellite hook does. The
		// daily-streak bump in `recordActivity` rides the swapped profile writes.
		const userText = isNullish(identity) ? getWeb2User()?.id : identity.getPrincipal().toText();

		if (isNullish(userText)) {
			return;
		}

		await logActivity({
			type: ActivityType.TRADE,
			user: userText,
			marketId,
			// "Sold" only when the trade executed on the spot; an open limit sell is merely placed.
			// `normalizedPrice` is the price of the chosen outcome — the raw `price` arg arrives
			// YES-framed for binary NO and would display the complement.
			title: `${side === 'BUY' ? 'Predicted' : type === 'MARKET' ? 'Sold' : 'Placed'} ${filledQty} on ${outcome} @ ${Math.round(normalizedPrice * 100)}%`,
			details: marketTitle
		});

		await recordActivity(userText);
	} catch (e: unknown) {
		console.error('Failed to log trade activity', e);
	}
};

export const cancelLimitOrder = async (orderId: string): Promise<void> => {
	if (isWeb2Backend()) {
		// The API signs the cancel with the caller's derived custodial identity;
		// there is no local identity to fetch in this mode.
		try {
			await cancelEngineOrderWeb2({ orderId });
		} catch (err: unknown) {
			rethrowWeb2Unauthenticated(err);
		}
	} else {
		const identity = await safeGetIdentityOnce();

		await cancelLimitOrderApi({
			identity,
			params: {
				order_id: orderId
			}
		});
	}

	track({ name: 'order_cancelled' });

	refreshPositions();

	refreshOrders();

	refreshAllBalances();
};

/**
 * Fetches the signed-in user's open orders, filtered to the active balance domain.
 * Threads identity + certified for `queryAndUpdate` compatibility.
 */
const fetchUserOrders = async ({
	identity,
	certified,
	domain
}: {
	identity: Identity;
	certified: boolean;
	domain: ClearingDid.BalanceDomain;
}): Promise<ClearingDid.LimitOrder[]> => {
	const orders = await getOrdersApi({ identity, certified });

	return filterByPlaygroundExpandedDomain({ items: orders, targetDomain: domain });
};

export const getUserOrdersForMarket = async ({
	marketId,
	domain
}: {
	marketId: MarketId;
	domain: ClearingDid.BalanceDomain;
}): Promise<ClearingDid.LimitOrder[]> => {
	const orders = await getUserOrders(domain);

	return orders.filter((o) => o.series_id === marketId);
};

/**
 * All open orders for the current user in the active balance domain.
 * In playground mode (ViciXp), Social-domain orders are included.
 *
 * Performs a single certified update. Returns `[]` when the user is not signed in.
 * Prefer {@link loadUserOrders} for UI flows that benefit from the fast-then-certified
 * render pattern.
 */
export const getUserOrders = async (
	domain: ClearingDid.BalanceDomain
): Promise<ClearingDid.LimitOrder[]> => {
	// web2 reads the session-gated own-orders route; the cookie is the auth, so
	// the Juno identity gate below never runs in that mode.
	if (isWeb2Backend()) {
		if (isNullish(getWeb2User())) {
			return [];
		}

		const orders = await listEngineOrdersWeb2();

		return filterByPlaygroundExpandedDomain({ items: orders, targetDomain: domain });
	}

	const identity = await getIdentityOnce();

	if (isNullish(identity)) {
		return [];
	}

	return fetchUserOrders({ identity, certified: true, domain });
};

/**
 * Callback-based variant of {@link getUserOrders}. No-op when the user is not
 * signed in (mirrors `getUserOrders` returning `[]`).
 */
export const loadUserOrders = async ({
	domain,
	onLoad,
	onUpdateError
}: {
	domain: ClearingDid.BalanceDomain;
	onLoad: (options: { certified: boolean; response: ClearingDid.LimitOrder[] }) => void;
	onUpdateError?: (error: unknown) => void;
}): Promise<void> => {
	// web2 reads the own-orders route once: no query/update pair exists on that
	// transport, so the single response is the final (`certified: true`) pass.
	if (isWeb2Backend()) {
		if (isNullish(getWeb2User())) {
			return;
		}

		try {
			const orders = await listEngineOrdersWeb2();

			onLoad({
				certified: true,
				response: filterByPlaygroundExpandedDomain({ items: orders, targetDomain: domain })
			});
		} catch (err: unknown) {
			onUpdateError?.(err);
		}

		return;
	}

	const identity = await getIdentity();

	if (isNullish(identity)) {
		return;
	}

	return loadWithCertification<ClearingDid.LimitOrder[]>({
		identity,
		request: ({ certified, identity: reqIdentity }) =>
			fetchUserOrders({ identity: reqIdentity, certified, domain }),
		onLoad,
		onUpdateError
	});
};

/**
 * Callback-based variant of {@link getUserOrdersForMarket}. No-op when the user
 * is not signed in.
 */
export const loadUserOrdersForMarket = ({
	marketId,
	domain,
	onLoad,
	onUpdateError
}: {
	marketId: MarketId;
	domain: ClearingDid.BalanceDomain;
	onLoad: (options: { certified: boolean; response: ClearingDid.LimitOrder[] }) => void;
	onUpdateError?: (error: unknown) => void;
}): Promise<void> =>
	loadUserOrders({
		domain,
		onLoad: ({ certified, response }) =>
			onLoad({ certified, response: response.filter((o) => o.series_id === marketId) }),
		onUpdateError
	});
