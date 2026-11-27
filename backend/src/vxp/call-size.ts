// The call-size bounds on a ViciXp order, checked before the engine sees it:
// the engine bounds an order by margin only, so without this a client could
// size a call outside the range the app offers. An order's notional is the
// VXP it commits: its quantity times what one share costs the caller (the
// price on a buy, its complement on a sell), at the order's exact fixed-point
// price, so the comparison is integer arithmetic with no rounding.

import { isNullish, nonNullish } from '@dfinity/utils';
import type { ClearingDid } from '../declarations';
import * as clearing from '../engine/clearing';
import * as registry from '../engine/registry';
import { VXP_CALL_SIZE_STEP, VXP_MAX_CALL_SIZE, VXP_MIN_CALL_SIZE } from './constants';

/** A whole multiple of the step inside the range, the app's `isVxpCallSize`. */
export const isVxpCallSize = (value: number): boolean =>
	Number.isInteger(value) &&
	value % VXP_CALL_SIZE_STEP === 0 &&
	value >= VXP_MIN_CALL_SIZE &&
	value <= VXP_MAX_CALL_SIZE;

interface Notional {
	/** Quantity times the share cost, in units of `1 / scale` VXP. */
	notional: bigint;
	/** What one share costs the caller, in the same units. */
	shareCost: bigint;
	/** `10^decimals` of the price: one whole VXP in these units. */
	scale: bigint;
}

const notionalOf = ({
	qty,
	price: { value, decimals },
	buys
}: {
	qty: bigint;
	price: ClearingDid.DecimalValue;
	buys: boolean;
}): Notional => {
	const scale = BigInt(10) ** BigInt(decimals);
	const shareCost = buys ? value : scale - value;

	return { notional: qty * shareCost, shareCost, scale };
};

const isViciXpSeries = async (seriesId: string): Promise<boolean> => {
	const series = await registry.getSeries(seriesId);

	return nonNullish(series) && 'ViciXp' in series.balance_domain;
};

/**
 * Whether a limit order is refused for its size. Only a ViciXp series is
 * checked. With a declared `callSize` the order must be sized on it: never
 * above it, and below it by less than one share, since sizing rounds down to
 * whole contracts. Without one (a client from before the field), the notional
 * must stay within the maximum call size.
 */
export const limitOrderCallSizeRefused = async ({
	seriesId,
	buys,
	qty,
	price,
	callSize
}: {
	seriesId: string;
	buys: boolean;
	qty: bigint;
	price: ClearingDid.DecimalValue;
	callSize?: number;
}): Promise<boolean> => {
	if (!(await isViciXpSeries(seriesId))) {
		return false;
	}

	const { notional, shareCost, scale } = notionalOf({ qty, price, buys });

	if (isNullish(callSize)) {
		return notional > BigInt(VXP_MAX_CALL_SIZE) * scale;
	}

	if (!isVxpCallSize(callSize)) {
		return true;
	}

	const declared = BigInt(callSize) * scale;

	return notional > declared || declared - notional >= shareCost;
};

/**
 * The resting order a market leg takes from. The cached book of the named
 * series holds any order placed before it was read; one placed since needs a
 * fresh read, and `fresh` skips the cache altogether. An order still missing
 * is looked up across every series, so a leg naming the wrong series is
 * checked against the book it really takes from. Nothing found means the
 * order no longer exists, which the engine answers itself.
 */
const findRestingOrder = async ({
	seriesId,
	orderId,
	fresh = false
}: {
	seriesId?: string;
	orderId: string;
	fresh?: boolean;
}): Promise<ClearingDid.LimitOrder | undefined> => {
	const byId = (orders: ClearingDid.LimitOrder[]): ClearingDid.LimitOrder | undefined =>
		orders.find(({ order_id }) => order_id === orderId);

	const found =
		(fresh ? undefined : byId(await clearing.listSeriesOrders({ seriesId }))) ??
		byId(await clearing.listSeriesOrders({ seriesId, fresh: true }));

	if (nonNullish(found) || isNullish(seriesId)) {
		return found;
	}

	return byId(await clearing.listSeriesOrders({ fresh: true }));
};

const takeExceeds = ({
	level,
	qty,
	callSize
}: {
	level: ClearingDid.LimitOrder;
	qty?: bigint;
	callSize?: number;
}): boolean => {
	const take = isNullish(qty) || qty > level.qty ? level.qty : qty;
	// Taking from a resting sell buys the outcome; taking from a resting buy sells it.
	const { notional, scale } = notionalOf({
		qty: take,
		price: level.price.decimal,
		buys: 'Sell' in level.side
	});

	return notional > BigInt(callSize ?? VXP_MAX_CALL_SIZE) * scale;
};

/**
 * Whether one leg of a market order is refused for its size: on a ViciXp
 * series, what the take costs must stay within the declared `callSize`, or
 * within the maximum call size when none is declared. The engine executes
 * `min(take, resting quantity)`, and without a `qty` the whole resting order.
 */
export const marketLegCallSizeRefused = async ({
	seriesId,
	matchingOrderId,
	qty,
	callSize
}: {
	seriesId?: string;
	matchingOrderId: string;
	qty?: bigint;
	callSize?: number;
}): Promise<boolean> => {
	const level = await findRestingOrder({ seriesId, orderId: matchingOrderId });
	// The resting order's own series when one is found, else the named one, so
	// a declared size off the set is refused even on an order no book holds.
	const takenSeriesId = level?.series_id ?? seriesId;

	if (isNullish(takenSeriesId) || !(await isViciXpSeries(takenSeriesId))) {
		return false;
	}

	if (nonNullish(callSize) && !isVxpCallSize(callSize)) {
		return true;
	}

	if (isNullish(level)) {
		return false;
	}

	if (!takeExceeds({ level, qty, callSize })) {
		return false;
	}

	// A resting order only shrinks as it fills, so a cached quantity can
	// overstate the take but never understate it: a pass on the cache stands,
	// a refusal stands only on the order's current quantity.
	const current = await findRestingOrder({
		seriesId: level.series_id,
		orderId: matchingOrderId,
		fresh: true
	});

	return nonNullish(current) && takeExceeds({ level: current, qty, callSize });
};
