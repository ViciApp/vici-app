// The economy's prediction count: the caller's executed fills as the engine
// records them. Trade activities are client posts, so they only signal that a
// count may have moved; the number itself comes from the engine, where a web2
// account's custodial principal can only trade through the API's session-gated
// order routes.

import { isNullish } from '@dfinity/utils';
import type { ClearingDid } from '../declarations';
import { getTradeHistory } from '../engine/clearing';
import { ZERO } from '../lib/constants';
import { dayKeyFromMs, nsToMs } from '../lib/time';
import type { CallSide } from './calibration';

const isExecutedFill = ({ event_type, qty }: ClearingDid.Event): boolean =>
	'Executed' in event_type && qty !== ZERO;

/** Distinct executed trades in a trade history, on either side. Keyed by
 * event id so a self-matched trade (two rows, one event) counts once. */
export const executedPredictionCount = (events: readonly ClearingDid.Event[]): number =>
	new Set(events.filter(isExecutedFill).map(({ event_id }) => event_id)).size;

/** The UTC days, by the engine's fill timestamp, on which the history holds
 * an executed fill. */
export const executedFillDays = (events: readonly ClearingDid.Event[]): string[] => [
	...new Set(events.filter(isExecutedFill).map(({ timestamp }) => dayKeyFromMs(nsToMs(timestamp))))
];

export const countExecutedPredictions = async ({ userId }: { userId: string }): Promise<number> =>
	executedPredictionCount(await getTradeHistory({ userId }));

/** The binary side a history holds on a series, the price paid per
 * contract of that side, and the engine time (ns) of the fill that opened
 * the held run: the first fill on this side since the position was last flat
 * or flipped. */
export interface HeldBinaryPosition {
	side: CallSide;
	entryPrice: number;
	openedAtNs: bigint;
}

const fillSide = ({ qty }: ClearingDid.Event): CallSide => (qty > ZERO ? 'YES' : 'NO');

// The complement is taken in the fill's own fixed decimals, so a NO taken at
// 30% reads exactly 0.3 rather than 1 - 0.7 in floating point.
const fillSidePrice = (fill: ClearingDid.Event): number => {
	const { value, decimals } = fill.price.decimal;
	const scale = BigInt(10) ** BigInt(decimals);

	return Number(fillSide(fill) === 'YES' ? value : scale - value) / Number(scale);
};

/**
 * The position a history holds on a binary series, from its executed fills: a
 * buy (positive qty) takes YES at the fill price, a sell (negative qty) takes
 * NO at one minus it. The entry price is the average cost of the contracts
 * still held: a fill that adds to the position folds in at its volume, one
 * that reduces it leaves the average as it is, and one that flips the side
 * starts it again at its own price. Adding to the position keeps the time it
 * was opened; a flip opens it again. `undefined` when the fills net to flat.
 */
export const heldBinaryPosition = ({
	events,
	seriesId
}: {
	events: readonly ClearingDid.Event[];
	seriesId: string;
}): HeldBinaryPosition | undefined => {
	const fills = events.filter((event) => isExecutedFill(event) && event.series_id === seriesId);

	// A self-matched trade (both rows of one event id) moves no position but
	// prints at whatever price the caller chose, so it could drag the average
	// anywhere at no cost.
	const rowsPerEvent = new Map<bigint, number>();

	for (const { event_id } of fills) {
		rowsPerEvent.set(event_id, (rowsPerEvent.get(event_id) ?? 0) + 1);
	}

	const ordered = fills
		.filter(({ event_id }) => rowsPerEvent.get(event_id) === 1)
		.sort((a, b) => Number(a.timestamp - b.timestamp) || Number(a.event_id - b.event_id));

	let held: (HeldBinaryPosition & { qty: number }) | undefined;

	for (const fill of ordered) {
		const side = fillSide(fill);
		const qty = Math.abs(Number(fill.qty));
		const price = fillSidePrice(fill);

		if (isNullish(held) || held.side === side) {
			const heldQty = held?.qty ?? 0;
			const heldCost = (held?.entryPrice ?? 0) * heldQty;

			held = {
				side,
				qty: heldQty + qty,
				entryPrice: (heldCost + price * qty) / (heldQty + qty),
				openedAtNs: held?.openedAtNs ?? fill.timestamp
			};
		} else if (qty > held.qty) {
			held = { side, qty: qty - held.qty, entryPrice: price, openedAtNs: fill.timestamp };
		} else if (qty === held.qty) {
			held = undefined;
		} else {
			held = { ...held, qty: held.qty - qty };
		}
	}

	if (isNullish(held)) {
		return;
	}

	return { side: held.side, entryPrice: held.entryPrice, openedAtNs: held.openedAtNs };
};
