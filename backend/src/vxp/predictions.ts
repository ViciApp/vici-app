// The economy's prediction count: the caller's executed fills as the engine
// records them. Trade activities are client posts, so they only signal that a
// count may have moved; the number itself comes from the engine, where a web2
// account's custodial principal can only trade through the API's session-gated
// order routes.

import type { ClearingDid } from '../declarations';
import { getTradeHistory } from '../engine/clearing';
import { ZERO } from '../lib/constants';
import { dayKeyFromMs, nsToMs } from '../lib/time';

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
