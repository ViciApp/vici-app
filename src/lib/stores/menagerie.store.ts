import type { PrincipalText } from '@junobuild/schema';
import { writable } from 'svelte/store';

/**
 * The signed-in viewer's referral count — the live signal behind the Parrot
 * trophy. The profile doc doesn't carry it, so it's fetched once and cached
 * here rather than re-counted independently by every surface that renders the
 * Menagerie. `undefined` falls back to a zero baseline in the stats derive.
 *
 * Hydrated by `loadMyMenagerieSignals` (see `menagerie.services`).
 */
export const myReferralCountStore = writable<number | undefined>(undefined);

/**
 * The signed-in viewer's global rank over the FULL ranking — the live signal
 * behind the Goat trophy. Fetched from the satellite's self-rank query
 * (`getUserRankAndCount`) rather than derived from the cached top-50
 * leaderboard window, so Goat resolves for every ranked user on every surface
 * (the always-mounted celebration host included), not just while the
 * leaderboard cache happens to contain the viewer. `rank` is absent for an
 * unranked profile; `totalRanked` is the ranked-population size behind the
 * percentile.
 *
 * Hydrated by `loadMyMenagerieSignals` (see `menagerie.services`).
 */
export interface MyGlobalRank {
	rank?: number;
	totalRanked: number;
}

export const myGlobalRankStore = writable<MyGlobalRank | undefined>(undefined);

/**
 * `true` once `loadMyMenagerieSignals` has finished its first hydration attempt
 * (success OR failure). The trophy rail reads this — not the individual data
 * stores — as its load gate, so a failed standings / referral fetch resolves to
 * the real (possibly locked) tiers rather than stranding the rail in a
 * perpetual skeleton. Sticks `true` across navigation once set.
 */
export const myMenagerieSignalsLoaded = writable<boolean>(false);

/**
 * The owner whose signals the last finished `loadMyMenagerieSignals` attempt
 * covered (success OR failure), or `null` before any owner-scoped attempt has
 * settled. Unlike {@link myMenagerieSignalsLoaded}, a signed-out load never
 * sets it, so it answers "has THIS owner's rank been asked for yet". The
 * celebration host waits on it before seeding the trophy ledger: a seed taken
 * before the rank lands leaves Goat out, and Goat then celebrates as a fresh
 * crossing on whichever later load the rank does land.
 */
export const myMenagerieSignalsOwner = writable<PrincipalText | null>(null);

/**
 * Drop the previous principal's Menagerie signal caches on an auth transition
 * (sign-out, user switch, bootstrap). Without this the referral count would
 * briefly back the next principal's Parrot tier, and the `signalsLoaded` gate —
 * which sticks `true` — would skip the skeleton state so the new identity sees
 * the old one's trophies flash before its own signals load. Called from
 * `Authn` alongside the other user-scoped store resets.
 */
export const clearMyMenagerieSignals = (): void => {
	myReferralCountStore.set(undefined);
	myGlobalRankStore.set(undefined);
	myMenagerieSignalsLoaded.set(false);
	myMenagerieSignalsOwner.set(null);
};
