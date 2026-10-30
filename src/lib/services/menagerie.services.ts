import { functions } from '$declarations/satellite/satellite.api';
import { listMyReferrals } from '$lib/services/referral.services';
import { loadGlobalStandings } from '$lib/services/standings.services';
import {
	myGlobalRankStore,
	myMenagerieSignalsGeneration,
	myMenagerieSignalsLoaded,
	myMenagerieSignalsOwner,
	myReferralCountStore
} from '$lib/stores/menagerie.store';
import { userStore } from '$lib/stores/user.store';
import { isNullish, nonNullish } from '@dfinity/utils';
import type { PrincipalText } from '@junobuild/schema';
import { get } from 'svelte/store';

/**
 * Hydrates the live signals the Menagerie trophy layer needs beyond the
 * profile doc: the viewer's global rank + ranked-population size (Goat, via
 * the satellite's full-ranking self-rank query) and the viewer's referral
 * count (Parrot). The global `'all'` standings window is refreshed alongside
 * them — the profile dashboard's credibility line still reads it.
 *
 * Both the profile rail (`ProfileDashboard`) and the album route (`AlbumPage`)
 * call this on mount — it is the single hydration entry point so the two
 * surfaces read identical signals and a trophy can never show as earned in one
 * place and locked in the other (the bug this consolidates away). Best-effort:
 * the legs settle independently, so a failed referral fetch still leaves the
 * rank (and vice versa) populated rather than blocking the rail.
 */
// Shared in-flight load so the surfaces that hydrate on mount (profile rail,
// album grid, the always-mounted celebration host) coalesce into a single
// fetch instead of firing it once each. Keyed on the owner it was started for:
// the host fires a signed-out load at mount and again once the owner lands, and
// coalescing the second into the first would skip the rank leg for the whole
// session. Cleared on settle so a later navigation still refreshes the signals.
let inFlight: {
	owner: PrincipalText | undefined;
	generation: number;
	load: Promise<void>;
} | null = null;

export const loadMyMenagerieSignals = async (): Promise<void> => {
	const owner = get(userStore).profile?.owner;
	const generation = get(myMenagerieSignalsGeneration);

	if (nonNullish(inFlight) && inFlight.owner === owner && inFlight.generation === generation) {
		return inFlight.load;
	}

	// Loads can overlap and settle out of order, so every user-scoped write is
	// dropped once the caches were cleared for an auth transition or the
	// signed-in owner is no longer the one this load was started for.
	const isCurrent = (): boolean =>
		generation === get(myMenagerieSignalsGeneration) && get(userStore).profile?.owner === owner;

	const load = (async () => {
		try {
			await Promise.allSettled([
				loadGlobalStandings({ window: 'all' }),
				(async () => {
					const referrals = await listMyReferrals();

					if (isCurrent()) {
						myReferralCountStore.set(referrals.length);
					}
				})(),
				(async () => {
					// The self-rank query covers the FULL ranking, so Goat resolves
					// for every ranked viewer on every surface — not only while the
					// cached top-50 leaderboard window happens to contain them.
					if (isNullish(owner)) {
						return;
					}

					const { rank, count } = await functions.getUserRankAndCount({
						principalStr: owner
					});

					if (isCurrent()) {
						myGlobalRankStore.set({ rank, totalRanked: count });
					}
				})()
			]);
		} finally {
			// Mark the attempt done either way — a failed leg degrades the affected
			// trophy to its baseline (locked) rather than holding the whole rail in
			// its skeleton state forever.
			if (isCurrent()) {
				myMenagerieSignalsLoaded.set(true);

				if (nonNullish(owner)) {
					myMenagerieSignalsOwner.set(owner);
				}
			}
		}
	})();

	inFlight = { owner, generation, load };

	try {
		await load;
	} finally {
		if (inFlight?.load === load) {
			inFlight = null;
		}
	}
};
