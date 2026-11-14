import type { StandingsResult, StandingsWindow } from '#lib/types/standings.ts';
import { writable } from 'svelte/store';

/**
 * Cache of per-window global standings (`week` / `month` / `all`), sourced
 * from the clearing canister's `list_leaderboard` query. Keyed by window so a
 * tab switch on the Leaderboard surface renders the previously-loaded slice
 * instantly while a refresh runs, and the dashboard rank tiles can read the
 * same cached slice without a second round-trip.
 *
 * A missing key (`undefined` value) means "not yet loaded": distinct from a
 * loaded-but-empty window, which is a `StandingsResult` with no entries.
 */
export const globalStandingsStore = writable<Map<StandingsWindow, StandingsResult | undefined>>(
	new Map()
);

/**
 * Merge one window's resolved global standings into the cache.
 */
export const setGlobalStandings = (result: StandingsResult): void => {
	globalStandingsStore.update((current) => {
		const next = new Map(current);
		next.set(result.window, result);

		return next;
	});
};
