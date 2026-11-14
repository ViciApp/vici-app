// The economy's prediction count: the caller's executed fills as the engine
// records them. Trade activities are client posts, so they only signal that a
// count may have moved; the number itself comes from the engine, where a web2
// account's custodial principal can only trade through the API's session-gated
// order routes.

import { getTradeHistory } from '../engine/clearing';
import { ZERO } from '../lib/constants';

/** Distinct executed trades the user took part in, on either side. Keyed by
 * event id so a self-matched trade (two rows, one event) counts once. */
export const countExecutedPredictions = async ({ userId }: { userId: string }): Promise<number> => {
	const events = await getTradeHistory({ userId });
	const executed = new Set<bigint>();

	for (const { event_type, event_id, qty } of events) {
		if ('Executed' in event_type && qty !== ZERO) {
			executed.add(event_id);
		}
	}

	return executed.size;
};
