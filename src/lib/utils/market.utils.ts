import type { ClearingDid, RegistryDid } from '#declarations';
import { MILLISECOND_IN_NANOSECONDS, ZERO } from '#lib/constants/app.constants.ts';
import type { Market, MarketStatus, Outcome, TradingAccessUI } from '#lib/types/market.ts';
import type { OrderBookLevel, OrderType } from '#lib/types/order.ts';
import { decimalFixedValueToNumber } from '#lib/utils/format.utils.ts';
import { resolveMarketDisplayToken } from '#lib/utils/market-token.utils.ts';
import { parseMarketId } from '#lib/validation/market.validation.ts';
import { fromNullable, isNullish, nonNullish } from '@dfinity/utils';

/**
 * Builds a `Market` view model from registry series and optional book/probability fields.
 */
export const mapMarketData = ({
	series,
	yesProbability,
	noProbability,
	priceLoaded = false,
	bestBid = undefined,
	bestAsk = undefined,
	bestBidQty = undefined,
	bestAskQty = undefined,
	status = 'Open',
	outcome = undefined,
	resolvedAt = undefined,
	categoricalProbabilities = undefined
}: {
	series: RegistryDid.Series;
	yesProbability?: number;
	noProbability?: number;
	priceLoaded?: boolean;
	bestBid?: number;
	bestAsk?: number;
	bestBidQty?: bigint;
	bestAskQty?: bigint;
	status?: MarketStatus;
	outcome?: Outcome;
	resolvedAt?: bigint;
	categoricalProbabilities?: Record<string, number>;
}): Market | undefined => {
	const {
		series_id: id,
		expiry_ns: expiryDate,
		start_ns: startNsOpt,
		creator,
		title,
		description: { plain: description },
		resolution: { clause: resolution },
		payout_unit: payoutUnit,
		payoff_type: payoffType,
		outcomes,
		balance_domain: balanceDomain,
		trading_access: rawTradingAccess,
		forked_from: forkedFromOpt,
		engine_id: engineIdOpt
	} = series;

	const token = resolveMarketDisplayToken({ balanceDomain, payoutUnit });

	if (isNullish(token)) {
		return;
	}

	const payoffTypeMapped: Market['payoffType'] =
		'Categorical' in payoffType
			? 'Categorical'
			: 'Call' in payoffType
				? 'Call'
				: 'Put' in payoffType
					? 'Put'
					: 'Binary';

	const tradingAccess: TradingAccessUI[] = mapTradingAccess(rawTradingAccess);
	const isInviteOnly = tradingAccess.length > 0 && !tradingAccess.some((a) => a.type === 'Open');

	const startNs = fromNullable(startNsOpt);

	return {
		id: parseMarketId(id),
		title,
		description,
		resolution,
		creator: creator.toText(),
		expiryDate: expiryDate / MILLISECOND_IN_NANOSECONDS,
		startDate: nonNullish(startNs) ? startNs / MILLISECOND_IN_NANOSECONDS : undefined,
		createdAt: series.created_at_ns / MILLISECOND_IN_NANOSECONDS,
		status,
		outcome,
		resolvedAt,
		outcomes: outcomes?.[0]?.map((o) => ({
			id: o.id,
			title: o.title,
			probability: payoffTypeMapped === 'Categorical' ? categoricalProbabilities?.[o.id] : undefined
		})),
		payoffType: payoffTypeMapped,
		isInviteOnly,
		inviteList: [],
		tradingAccess,
		totalVolume: ZERO,
		yesVolume: ZERO,
		noVolume: ZERO,
		yesProbability,
		noProbability,
		priceLoaded,
		bestBid,
		bestAsk,
		bestBidQty,
		bestAskQty,
		token,
		pricePrecision: Number(series.price_precision),
		balanceDomain,
		engineId: engineIdOpt?.[0],
		forkedFrom: nonNullish(forkedFromOpt?.[0]) ? parseMarketId(forkedFromOpt[0]) : undefined
	};
};

/**
 * Mid-price estimate (0..1) from bid/ask levels: best bid/ask mid when both
 * sides exist, the single side when one-sided, and **`undefined` when the book
 * is empty**: there is no price to show. Callers must treat `undefined` as
 * "unknown" (skeleton / no-liquidity), never substitute a 0.5 placeholder.
 */
export const calculateProbability = ({
	bids,
	asks
}: {
	bids: OrderBookLevel[];
	asks: OrderBookLevel[];
}): number | undefined => {
	if (bids.length === 0 && asks.length === 0) {
		return;
	}

	if (bids.length > 0 && asks.length > 0) {
		const bestBid = bids[0].price;
		const bestAsk = asks[0].price;

		return (bestBid + bestAsk) / 2;
	}

	if (bids.length > 0) {
		return bids[0].price;
	}

	return asks[0].price;
};

export interface ConsensusLean {
	/** The crowd leans YES; an even 50/50 split counts as YES. */
	isYes: boolean;
	/** Needle rotation in degrees from straight up: -90 (all YES), 0 (50/50), 90 (all NO). */
	angle: number;
	/** The leading side's percentage (50..100), the figure a consensus dial shows. */
	leadingPct: number;
}

/**
 * Which way a binary market's consensus dial leans, from its YES percentage
 * (0..100, clamped). The needle turns linearly with the distance from 50/50, so
 * a balanced market points straight up and a one-sided one lies flat toward
 * its side (left for YES, right for NO).
 */
export const consensusLean = (yesPct: number): ConsensusLean => {
	const pct = Math.max(0, Math.min(100, yesPct));
	const isYes = pct >= 50;
	const confidence = Math.abs(pct - 50) / 50;

	return {
		isYes,
		angle: isYes ? -confidence * 90 : confidence * 90,
		leadingPct: Math.max(pct, 100 - pct)
	};
};

/**
 * Resting book liquidity for a market, expressed in payout-token base units
 * (so it formats with the same `token.decimals` / symbol as volume).
 *
 * It's the value resting at the top of the book: `bestBidQty · bestBid +
 * bestAskQty · bestAsk`, i.e. how much a counter-trade can hit at the best
 * price before walking the book. The market maker quotes a single thin level
 * per side, so the best level is effectively the whole book today; deeper
 * levels aren't carried on the `Market` view model. It sums whichever sides
 * have a resting level and returns {@link ZERO} only when neither does (the
 * cold-start "be first" state).
 *
 * Quantities stay `bigint` and only the 0..1 price is taken through a float:
 * scaled to base units first, then multiplied by the (exact) quantity, so a
 * large resting size is never rounded through `Number`'s safe-integer range, as
 * `Number(qty) * price` would.
 */
export const marketBookLiquidity = (
	market: Pick<Market, 'bestBid' | 'bestAsk' | 'bestBidQty' | 'bestAskQty' | 'token'>
): bigint => {
	const { bestBid, bestAsk, bestBidQty, bestAskQty, token } = market;

	const levelValue = ({
		qty,
		price
	}: {
		qty: bigint | undefined;
		price: number | undefined;
	}): bigint => {
		if (isNullish(qty) || isNullish(price) || price <= 0) {
			return ZERO;
		}

		// Per-contract value in token base units: a 0..1 price scaled to the
		// token's precision. The large `qty · value` product then stays exact in
		// bigint.
		const valueBaseUnits = BigInt(Math.round(price * 10 ** token.decimals));

		return qty * valueBaseUnits;
	};

	return (
		levelValue({ qty: bestBidQty, price: bestBid }) +
		levelValue({ qty: bestAskQty, price: bestAsk })
	);
};

/**
 * Execution price (0..1) of *buying* `action` now. A buy lifts the book, so it
 * pays the ask (best ask for YES, `1 − bestBid` for NO), not the consensus
 * mid (used only when that side is empty; LIMIT uses `limitPrice`; floored at
 * 0.01). Single source of truth: both order sizing and the payout preview call
 * this, so the previewed "+X VXP" can't drift from the order placed.
 */
export const resolveOutcomeExecutionPrice = ({
	market,
	action,
	orderType = 'MARKET',
	limitPrice
}: {
	market: Market;
	action: Outcome;
	orderType?: OrderType;
	limitPrice?: number;
}): number => {
	const executionPrice = (): number => {
		if (orderType === 'LIMIT' && nonNullish(limitPrice)) {
			return limitPrice;
		}

		// Execution price is internal trade math (not the displayed odds), and the
		// caller floors it at 0.01 below: so when neither a book side nor a known
		// probability exists we fall back to the neutral mid here to stay a finite
		// number. The trade surface gates on liquidity separately; this only keeps
		// sizing/preview from going NaN on an unpriced market.
		if (action === 'YES') {
			return market.bestAsk ?? market.yesProbability ?? 0.5;
		}

		if (action === 'NO') {
			return nonNullish(market.bestBid) ? 1 - market.bestBid : (market.noProbability ?? 0.5);
		}

		const outcome = market.outcomes?.find((o) => o.id === action);

		return outcome?.probability ?? 0.5;
	};

	return Math.max(executionPrice(), 0.01);
};

/**
 * Aggregates clearing limit orders into sorted bid/ask ladders and mid-price for an outcome.
 */
export const calculateMarketStats = ({
	orders,
	outcome = 'YES'
}: {
	orders: ClearingDid.LimitOrder[];
	outcome?: string;
}) => {
	const isBinarySide = outcome === 'YES' || outcome === 'NO';

	const normalizedOrders = orders
		.map((o) => {
			const side = 'Buy' in o.side ? 'BUY' : 'SELL';
			const oOutcomeId = o.outcome_id[0] ?? 'YES';
			const rawPrice = decimalFixedValueToNumber({
				value: o.price.decimal.value,
				decimals: o.price.decimal.decimals
			});

			if (oOutcomeId === outcome) {
				return { displaySide: side, displayPrice: rawPrice, qty: o.qty };
			}

			const isOrderBinarySide = oOutcomeId === 'YES' || oOutcomeId === 'NO';

			if (isBinarySide && isOrderBinarySide) {
				return {
					displaySide: side === 'BUY' ? ('SELL' as const) : ('BUY' as const),
					displayPrice: 1 - rawPrice,
					qty: o.qty
				};
			}
		})
		.filter(nonNullish);

	const aggregateByPrice = (entries: typeof normalizedOrders): OrderBookLevel[] =>
		Array.from(
			entries
				.reduce<Map<number, OrderBookLevel>>((acc, { displayPrice, qty }) => {
					const key = Math.round(displayPrice * 1e6) / 1e6;
					const existing = acc.get(key);

					acc.set(key, {
						price: key,
						totalQty: (existing?.totalQty ?? ZERO) + qty,
						orderCount: (existing?.orderCount ?? 0) + 1
					});

					return acc;
				}, new Map())
				.values()
		);

	const bids = aggregateByPrice(normalizedOrders.filter((o) => o.displaySide === 'BUY')).sort(
		(a, b) => b.price - a.price
	);
	const asks = aggregateByPrice(normalizedOrders.filter((o) => o.displaySide === 'SELL')).sort(
		(a, b) => a.price - b.price
	);

	return {
		bids,
		asks,
		midPrice: calculateProbability({ bids, asks })
	};
};

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const MS_PER_HOUR = 1000 * 60 * 60;
const MS_PER_MINUTE = 1000 * 60;

export const getTimeRemaining = (expiry: bigint): string => {
	const now = BigInt(Date.now());
	const diff = Number(expiry - now);

	if (diff <= 0) {
		return 'Expired';
	}

	const days = Math.floor(diff / MS_PER_DAY);
	const hours = Math.floor((diff % MS_PER_DAY) / MS_PER_HOUR);
	const minutes = Math.floor((diff % MS_PER_HOUR) / MS_PER_MINUTE);

	if (days > 0) {
		return `${days}d ${hours}h`;
	}

	if (hours > 0) {
		return `${hours}h ${minutes}m`;
	}

	return `${minutes}m remaining`;
};

/**
 * Normalized implied probabilities per categorical outcome from order book top of book.
 */
export const calculateCategoricalProbabilities = ({
	outcomes,
	orders
}: {
	outcomes: { id: string; title: string }[];
	orders: ClearingDid.LimitOrder[];
}): Record<string, number> => {
	const orderPrice = (order: ClearingDid.LimitOrder): number =>
		decimalFixedValueToNumber({
			value: order.price.decimal.value,
			decimals: order.price.decimal.decimals
		});

	const outcomeBook = outcomes.reduce<Record<string, { bestBid?: number; bestAsk?: number }>>(
		(acc, o) => {
			const outcomeOrders = orders.filter((order) => order.outcome_id[0] === o.id);
			const [bestBid] = outcomeOrders
				.filter((order) => 'Buy' in order.side)
				.map(orderPrice)
				.sort((a, b) => b - a);
			const [bestAsk] = outcomeOrders
				.filter((order) => 'Sell' in order.side)
				.map(orderPrice)
				.sort((a, b) => a - b);

			acc[o.id] = { bestBid, bestAsk };

			return acc;
		},
		{}
	);

	const rawProbs = outcomes.reduce<Record<string, number>>((acc, o) => {
		const { bestBid, bestAsk } = outcomeBook[o.id];

		acc[o.id] =
			nonNullish(bestBid) && nonNullish(bestAsk)
				? (bestBid + bestAsk) / 2
				: nonNullish(bestBid)
					? bestBid
					: nonNullish(bestAsk)
						? bestAsk
						: 1 / outcomes.length;

		return acc;
	}, {});

	const totalWeight = Object.values(rawProbs).reduce((sum, p) => sum + p, 0);

	if (totalWeight <= 0) {
		return rawProbs;
	}

	return Object.fromEntries(Object.entries(rawProbs).map(([id, p]) => [id, p / totalWeight]));
};

const mapTradingAccess = (
	raw: RegistryDid.Series['trading_access'] | undefined
): TradingAccessUI[] => {
	if (!raw || raw.length === 0) {
		return [{ type: 'Open' }];
	}

	return raw.map((policy) => {
		if ('Open' in policy) {
			return { type: 'Open' as const };
		}

		if ('Restricted' in policy) {
			return {
				type: 'Restricted' as const,
				groupIds: policy.Restricted.groups.map((g) => g)
			};
		}

		return { type: 'Open' as const };
	});
};

/**
 * Badge/variant hint for market or resolution outcome labels.
 *
 * Outcome ids for cancellation are normalized as `CANCELED` across the app
 * (see `OutcomeId` in `#lib/types/market.ts`), so the check must match that
 * casing rather than `Canceled`.
 */
export const getOutcomeVariant = (
	outcome: string | undefined
): 'default' | 'success' | 'warning' | 'danger' | 'info' => {
	if (outcome === 'YES' || outcome === 'Open' || outcome === 'Resolved') {
		return 'success';
	}

	if (outcome === 'NO' || outcome === 'CANCELED') {
		return 'danger';
	}

	if (outcome === 'Expired') {
		return 'warning';
	}

	return 'default';
};

/**
 * Parses the settlement `outcome` out of an activity's stringified JSON details
 * (`{ outcome, price }`). Fail-soft: malformed/missing JSON yields `undefined`
 * (logged, never thrown) so the market still renders as resolved without an
 * outcome label.
 */
export const parseSettlementOutcome = (details?: string): Outcome | undefined => {
	try {
		const parsed = JSON.parse(details ?? '{}');

		return typeof parsed?.outcome === 'string' && parsed.outcome.length > 0
			? parsed.outcome
			: undefined;
	} catch (e: unknown) {
		// Malformed JSON should not block rendering; log and fall through so the
		// market still appears resolved, just without an outcome label.
		console.error('Failed to parse settlement details', e);
	}
};
