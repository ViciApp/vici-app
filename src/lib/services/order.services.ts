import type { ClearingDid } from '#declarations';
import { listOrders as listOrdersApi } from '#lib/api/clearing.api.ts';
import { MarketClosedError } from '#lib/canisters/clearing.errors.ts';
import { PRICE_DECIMALS, USD_DECIMALS, ZERO } from '#lib/constants/app.constants.ts';
import { ActivityType } from '#lib/enums/social.ts';
import { logActivity } from '#lib/services/activity.services.ts';
import { track } from '#lib/services/analytics.services.ts';
import { recordActivity } from '#lib/services/profile.services.ts';
import type { MarketId, Outcome } from '#lib/types/market.ts';
import type { CallSource, OrderSide, OrderType } from '#lib/types/order.ts';
import { filterByPlaygroundExpandedDomain } from '#lib/utils/balance-domain.utils.ts';
import { decimalFixedValueToNumber } from '#lib/utils/format.utils.ts';
import { walkMarketOrder } from '#lib/utils/market-order.utils.ts';
import { parseLimitOrderPriceValue } from '#lib/utils/parse.utils.ts';
import { refreshAllBalances, refreshOrders, refreshPositions } from '#lib/utils/refresh.utils.ts';
import {
	cancelEngineOrder as cancelEngineOrderWeb2,
	listEngineOrders as listEngineOrdersWeb2,
	submitEngineLimitOrder as submitEngineLimitOrderWeb2,
	submitEngineMarketOrder as submitEngineMarketOrderWeb2,
	Web2ApiError
} from '#lib/web2/client.ts';
import { getWeb2User } from '#lib/web2/session.ts';
import { fromNullable, isNullish, toNullable, type Nullable } from '@dfinity/utils';
import { AnonymousIdentity, type Identity } from '@icp-sdk/core/agent';
import { nanoid } from 'nanoid';

/**
 * Core order-book fetch: threads identity + certified so a caller can pick
 * the query or the update pass.
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
 * Certified by default; pass `certified: false` for the fast query pass.
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
	const identity = identityOverride ?? new AnonymousIdentity();

	return await fetchOrderBook({ identity, certified, marketId, domain });
};

/**
 * Submits a limit order or matches a market order against the book; refreshes UI state and logs activity.
 */

/** Map a session miss onto one stable error text, so the UI's auth-failure
 * handling reads a single message. */
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
	maxSpendUsd,
	callSize,
	outcome,
	expiryDate,
	source
}: {
	marketId: MarketId;
	marketTitle: string;
	side: OrderSide;
	type: OrderType;
	/** The engine price: YES-framed for a binary NO, which the book takes as a YES sell. */
	price: number;
	qty: bigint;
	/** The call size in clearing USD base units: a market order never spends more. */
	maxSpendUsd: bigint;
	/** The ViciXp call size in whole VXP, declared to the web2 API so it can check the order against it. */
	callSize?: number;
	outcome: Outcome;
	expiryDate: bigint;
	source: CallSource;
}): Promise<void> => {
	// Stopgap expiry gate. The deck/catalog is filtered `only_unexpired` at
	// fetch time, but the clearing engine has no expiry check (its `TradeError`
	// has no `Expired` variant; it only rejects settled series), so a deck
	// opened just before kickoff could submit after it. Reject at/after the
	// market's expiry until icdc-core enforces this server-side.
	if (BigInt(Date.now()) >= expiryDate) {
		throw new MarketClosedError();
	}

	// Sizing rounds the amount down to whole contracts (`amountUsd / priceUsd`),
	// so an amount smaller than one contract's price arrives here as zero;
	// reject it before any state changes or activity logging.
	if (qty <= ZERO) {
		throw new Error('Call size is too small for this price: the order quantity rounds to zero');
	}

	// There is no local signing identity: the API signs engine calls with the
	// caller's derived custodial identity (the session cookie is the auth).
	const isBinary = outcome === 'YES' || outcome === 'NO';
	const normalizedSide: OrderSide = isBinary
		? outcome === 'NO'
			? side === 'BUY'
				? 'SELL'
				: 'BUY'
			: side
		: side;
	// The chosen outcome's own price, what one share costs the caller. The engine is sent `price`:
	// a binary NO limit order rests as a YES sell at the complement, so it costs the call size.
	const normalizedPrice = isBinary && outcome === 'NO' ? 1 - price : price;
	const outcomeId: Nullable<string> = isBinary ? toNullable() : toNullable(outcome);

	// What the activity log reports: the full size for a resting limit order,
	// the actually executed size for a market order (the book may be smaller
	// than the request).
	let filledQty = qty;
	// The VXP committed: a resting limit order's full placed size at its price,
	// a market order's real cost across the levels it filled.
	let committedValue = Number(qty) * normalizedPrice;

	if (type === 'LIMIT') {
		const orderId = `ORD_${nanoid(8)}`;

		try {
			await submitEngineLimitOrderWeb2({
				orderId,
				seriesId: marketId,
				side: normalizedSide === 'BUY' ? 'buy' : 'sell',
				outcomeId: fromNullable(outcomeId),
				priceValue: parseLimitOrderPriceValue(price),
				priceDecimals: PRICE_DECIMALS,
				qty,
				callSize
			});
		} catch (err: unknown) {
			rethrowWeb2Unauthenticated(err);
		}
	} else {
		const counterSide = normalizedSide === 'BUY' ? 'Sell' : 'Buy';

		const targetOutcomeId = outcome === 'YES' || outcome === 'NO' ? undefined : outcome;

		const fetchMatchingOrders = async (): Promise<ClearingDid.LimitOrder[]> => {
			// The book itself is a public on-chain query. The caller's engine
			// principal lives server-side, so their own resting orders are
			// excluded by id (from the session-gated own-orders read) instead of
			// by creator.
			const [orders, ownOrderIds] = await Promise.all([
				listOrdersApi({
					identity: new AnonymousIdentity(),
					params: { series_id: toNullable(marketId) }
				}),
				listEngineOrdersWeb2().then((own) => new Set(own.map((o) => o.order_id)))
			]);

			return orders
				.filter((o: ClearingDid.LimitOrder) => {
					const isCorrectSide = counterSide in o.side;
					const isCorrectOutcome = o.outcome_id[0] === targetOutcomeId;
					// The engine rejects self-trades; the caller's own resting
					// orders are not liquidity for this market order.
					const isSelf = ownOrderIds.has(o.order_id);

					return isCorrectSide && isCorrectOutcome && !isSelf;
				})
				.sort((a: ClearingDid.LimitOrder, b: ClearingDid.LimitOrder) => {
					const priceA = Number(a.price.decimal.value);
					const priceB = Number(b.price.decimal.value);

					return normalizedSide === 'BUY' ? priceA - priceB : priceB - priceA;
				});
		};

		const fill = await walkMarketOrder({
			qty,
			maxSpendUsd,
			takerSide: normalizedSide,
			readBook: fetchMatchingOrders,
			takeLevel: async ({ level, qty: take }) => {
				try {
					await submitEngineMarketOrderWeb2({
						tradeId: `TRD_${nanoid(8)}`,
						seriesId: marketId,
						matchingOrderId: level.order_id,
						qty: take,
						callSize
					});
				} catch (err: unknown) {
					rethrowWeb2Unauthenticated(err);
				}
			}
		});

		({ filledQty } = fill);
		committedValue = decimalFixedValueToNumber({ value: fill.spentUsd, decimals: USD_DECIMALS });
	}

	refreshPositions();
	refreshOrders();

	refreshAllBalances();

	// Behavioural telemetry for the cockpit: every REAL trade goes through here
	// (the flow deck's guest picks emit separately). `value` is the VXP committed;
	// a resting limit order reports its full placed size, a market order the
	// actually-executed fill.
	if (filledQty > ZERO || type === 'LIMIT') {
		track({
			name:
				type === 'LIMIT' ? 'order_placed' : side === 'BUY' ? 'position_taken' : 'position_closed',
			source,
			marketId,
			label: outcome,
			count: Number(filledQty),
			value: committedValue
		});
	}

	try {
		// The activity owner is the session account id; the HTTP feed's trade
		// trigger fires the onboarding-milestone and referral awards, and the
		// daily-streak bump rides `recordActivity`'s profile write.
		const userText = getWeb2User()?.id;

		if (isNullish(userText)) {
			return;
		}

		await logActivity({
			type: ActivityType.TRADE,
			user: userText,
			marketId,
			// "Sold" only when the trade executed on the spot; an open limit sell is merely placed.
			// `normalizedPrice` is the price of the chosen outcome; the raw `price` arg arrives
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
	// The API signs the cancel with the caller's derived custodial identity.
	try {
		await cancelEngineOrderWeb2({ orderId });
	} catch (err: unknown) {
		rethrowWeb2Unauthenticated(err);
	}

	track({ name: 'order_cancelled' });

	refreshPositions();

	refreshOrders();

	refreshAllBalances();
};

/**
 * All open orders for the current user in the active balance domain, read
 * from the session-gated own-orders route. In playground mode (ViciXp),
 * Social-domain orders are included. Returns `[]` when nobody is signed in.
 */
export const getUserOrders = async (
	domain: ClearingDid.BalanceDomain
): Promise<ClearingDid.LimitOrder[]> => {
	if (isNullish(getWeb2User())) {
		return [];
	}

	const orders = await listEngineOrdersWeb2();

	return filterByPlaygroundExpandedDomain({ items: orders, targetDomain: domain });
};

/**
 * Callback-based variant of {@link getUserOrders}. No-op when nobody is
 * signed in. The route answers once, so the single response is the final
 * (`certified: true`) pass.
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
};
