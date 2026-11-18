import {
	listFriendRecommendedLeagues,
	listLeagueBattles,
	listLeagueMembers,
	listMyLeagues,
	type FriendRecommendedLeague,
	type LeagueWithRole
} from '#lib/services/leagues.services.ts';
import { loadProfilesByPrincipals } from '#lib/services/profile.services.ts';
import type { BattleDoc } from '#lib/types/battle.ts';
import type { LeagueMemberDoc } from '#lib/types/league-member.ts';
import { writable } from 'svelte/store';

/**
 * Reactive cache of the viewer's leagues.
 *
 * Single source of truth shared by the Arena leagues list
 * (`LeaguesPage`) and the league detail surface (`LeagueDetailPage`).
 * Mirrors the stale-while-revalidate contract of
 * [`friends.store`](./friends.store.ts): the first successful refresh
 * flips `leaguesLoadedStore` to `true`, and it stays `true` until
 * `clearLeagues()` runs (principal change / sign-out). Consumers show
 * a skeleton only on the cold load and render cached data on every
 * subsequent visit while a background refresh runs.
 *
 * A single refresh fans out: it lists the caller's memberships, then
 * the full roster + battle list for each league in parallel, so the
 * detail page is already warm when the user taps into a league they've
 * seen in the list.
 */

/** The caller's memberships, sorted newest-join first per the satellite. */
export const myLeaguesStore = writable<LeagueWithRole[]>([]);

/** Per-league full roster, keyed by league id. */
export const leagueMembersStore = writable<Map<string, LeagueMemberDoc[]>>(new Map());

/** Per-league battle list, keyed by league id. */
export const leagueBattlesStore = writable<Map<string, BattleDoc[]>>(new Map());

/**
 * Public leagues the caller's confirmed friends are in but the caller is
 * not: the "Friends are in" recommendations row at the foot of the
 * Leagues list. Refreshed alongside the caller's own leagues; an empty
 * array means there's nothing to recommend (no friends, or no friend is
 * in a public league the caller hasn't joined).
 */
export const friendRecommendedLeaguesStore = writable<FriendRecommendedLeague[]>([]);

/**
 * Flips to `true` the first time `refreshMyLeagues` completes for the
 * current principal, and stays `true` until `clearLeagues` runs (i.e.
 * the principal changes). Lets consumers show a skeleton only on the
 * cold load and switch to stale-while-revalidate on every subsequent
 * visit.
 */
export const leaguesLoadedStore = writable<boolean>(false);

/**
 * `true` when the most recent refresh failed. Consumers render the
 * error state only on a *cold* failure (`!loaded`); once a cache
 * exists a failed background refresh keeps the stale data on screen.
 */
export const leaguesErrorStore = writable<boolean>(false);

const runRefresh = async (): Promise<void> => {
	// Recommendations refresh in parallel with the caller's own leagues;
	// a flaky recommendation fetch falls back to an empty row rather than
	// tanking the whole list.
	const [memberships, recommendations] = await Promise.all([
		listMyLeagues(),
		listFriendRecommendedLeagues().catch((err) => {
			console.warn('leagues.store: friend-recommendations fetch failed', err);

			return [];
		})
	]);

	// Fan out the per-league roster + battle fetches. A single flaky
	// league falls back to an empty roster / no battles so it can't tank
	// the whole list: matches the prior per-row hydration in LeaguesPage.
	const hydrated = await Promise.all(
		memberships.map(async (m) => {
			try {
				const [members, battleList] = await Promise.all([
					listLeagueMembers({ leagueId: m.league.id }),
					listLeagueBattles({ leagueId: m.league.id })
				]);

				return { leagueId: m.league.id, members, battles: battleList };
			} catch (err) {
				console.warn('leagues.store: hydrate failed for league', m.league.id, err);

				return { leagueId: m.league.id, members: [], battles: [] };
			}
		})
	);

	const membersMap = new Map<string, LeagueMemberDoc[]>();
	const battlesMap = new Map<string, BattleDoc[]>();

	for (const { leagueId, members, battles } of hydrated) {
		membersMap.set(leagueId, members);
		battlesMap.set(leagueId, battles);
	}

	myLeaguesStore.set(memberships);
	leagueMembersStore.set(membersMap);
	leagueBattlesStore.set(battlesMap);
	friendRecommendedLeaguesStore.set(recommendations);
	leaguesErrorStore.set(false);
	leaguesLoadedStore.set(true);

	// Hydrate the shared `profilesStore` for every member we can name in
	// the friend-overlap row / leaderboard, plus the friend members behind
	// each recommendation card's avatar cluster. Lazy import avoids a
	// circular reference between profile.services → leagues.store.
	// Fire-and-forget so the refresh resolves as soon as the league data
	// is in the stores.
	const allMembers = new Set<string>();

	for (const { members } of hydrated) {
		for (const m of members) {
			allMembers.add(m.member);
		}
	}

	for (const rec of recommendations) {
		// LeagueListCard renders only the first 3 overlapping friend avatars,
		// so hydrate just those profiles: loading the rest is unused work.
		for (const friend of rec.friendMembers.slice(0, 3)) {
			allMembers.add(friend);
		}
	}

	if (allMembers.size > 0) {
		void loadProfilesByPrincipals({ principals: [...allMembers] });
	}
};

let inFlight: Promise<void> | undefined;
let queued = false;

const schedule = (): Promise<void> => {
	const current = runRefresh()
		.catch((err) => {
			console.error('leagues.store: refresh failed', err);
			leaguesErrorStore.set(true);
		})
		.finally(() => {
			inFlight = undefined;

			if (queued) {
				queued = false;
				schedule();
			}
		});
	inFlight = current;

	return current;
};

/**
 * Refetches the caller's leagues + per-league rosters and battles.
 *
 * Concurrency contract (mirrors `refreshFriendRelations`):
 * - Same-tick concurrent callers (e.g. the list page + detail page
 *   mounting together) share the in-flight promise.
 * - A call that arrives **while** a refresh is in flight (typically a
 *   post-mutation refresh after create / join / leave / transfer)
 *   guarantees one additional fetch after the current one finishes, so
 *   the caller observes state that reflects its mutation.
 */
export const refreshMyLeagues = async (): Promise<void> => {
	if (inFlight) {
		queued = true;
		await inFlight;

		if (inFlight) {
			await inFlight;
		}

		return;
	}

	await schedule();
};

export const clearLeagues = (): void => {
	myLeaguesStore.set([]);
	leagueMembersStore.set(new Map());
	leagueBattlesStore.set(new Map());
	friendRecommendedLeaguesStore.set([]);
	leaguesLoadedStore.set(false);
	leaguesErrorStore.set(false);
};
