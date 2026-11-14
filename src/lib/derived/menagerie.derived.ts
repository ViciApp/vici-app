import {
	myGlobalRankStore,
	myMenagerieSignalsLoaded,
	myReferralCountStore
} from '#lib/stores/menagerie.store.ts';
import { userStore } from '#lib/stores/user.store.ts';
import {
	menagerieRows,
	menagerieStatsFromProfile,
	type MenagerieRow,
	type MenagerieStats
} from '#lib/utils/menagerie.utils.ts';
import { derived, type Readable } from 'svelte/store';

/**
 * The signed-in viewer's live Menagerie metric snapshot; the SINGLE source of
 * truth for the trophy layer. Both the profile rail (`ProfileDashboard`) and
 * the album route (`AlbumPage`) read from here, so the same animal can never
 * resolve to a different tier across the two surfaces.
 *
 * Goat's global-rank signal comes from `myGlobalRankStore`: the satellite's
 * full-ranking self-rank query: so it resolves for every ranked viewer on
 * every surface, the always-mounted celebration host included. The previous
 * source (the viewer's index in the cached top-50 points leaderboard) only
 * resolved while that window happened to contain them, which is why Goat could
 * read earned on one screen and locked elsewhere. Parrot's referral count
 * comes from the shared `myReferralCountStore`. Both extra signals are
 * hydrated by `loadMyMenagerieSignals` (see `menagerie.services`).
 */
export const myMenagerieStats: Readable<MenagerieStats> = derived(
	[userStore, myGlobalRankStore, myReferralCountStore],
	([{ profile }, $globalRank, $referrals]) =>
		menagerieStatsFromProfile({
			profile,
			signals: {
				referrals: $referrals ?? 0,
				rank: $globalRank?.rank,
				totalRanked: $globalRank?.totalRanked
			}
		})
);

/**
 * The full catalogue decorated with each animal's live tier + progress, sorted
 * earned-first: the identical ordering the profile rail and the album grid
 * both render.
 */
export const myMenagerieRows: Readable<MenagerieRow[]> = derived(myMenagerieStats, ($stats) =>
	menagerieRows($stats)
);

/**
 * `true` while the rank / referral signals are still resolving. Both surfaces
 * render skeleton tiles until this settles, so a not-yet-loaded rank never
 * flashes as a grey "locked" trophy. It clears once `loadMyMenagerieSignals`
 * has finished its first hydration attempt (the rank + referral legs settle
 * inside it): a failed fetch still clears the gate (degrading the affected
 * trophy to its baseline) rather than stranding the rail in skeleton.
 */
export const myMenagerieLoading: Readable<boolean> = derived(
	myMenagerieSignalsLoaded,
	($signalsLoaded) => !$signalsLoaded
);
