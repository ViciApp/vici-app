import { listMyReferrals } from '#lib/services/referral.services.ts';
import type { ReferralListItem } from '#lib/types/referral.ts';
import { writable } from 'svelte/store';

/**
 * Reactive cache of the viewer's referral redemptions (rows where the caller
 * is the referrer), newest-first.
 *
 * Single source of truth shared by the Dash stack-sheet breakdown and the
 * Arena invite hero so the "friends joined / VXP earned" figures can never
 * disagree, and so navigating between the two surfaces reuses the already
 * fetched list instead of re-querying on every mount. Mirrors the
 * stale-while-revalidate contract of `friends.store`: the cached value stays
 * put across navigation and is refreshed in the background on each visit.
 */
export const myReferralsStore = writable<ReferralListItem[]>([]);

/**
 * Flips to `true` the first time `refreshMyReferrals` completes for the
 * current principal and stays `true` until `clearMyReferrals` runs (i.e. the
 * principal changes). Lets consumers show a skeleton only on the cold load and
 * keep showing the cached figure while a background refresh is in flight.
 */
export const myReferralsLoadedStore = writable<boolean>(false);

let inFlight: Promise<void> | undefined;

// Bumped by every `clearMyReferrals()` (i.e. each auth transition). A refresh
// captures the epoch when it starts and only commits its result if the epoch
// is unchanged on resolution — so a fetch that was in flight across a
// sign-out/sign-in can't repopulate the cache (or flip `loaded`) for the wrong
// principal.
let epoch = 0;

const runRefresh = async (): Promise<void> => {
	const startedAt = epoch;

	const items = await listMyReferrals();

	if (epoch !== startedAt) {
		return;
	}

	myReferralsStore.set(items);
	myReferralsLoadedStore.set(true);
};

/**
 * Refetches the viewer's referral rows into the shared store. Same-tick
 * concurrent callers (e.g. Dash and Arena mounting together) share the
 * in-flight promise so we don't issue duplicate query calls.
 *
 * Fails open: a rejected fetch is caught and logged here (never propagated to
 * callers, mirroring `affiliations.store` / `leagues.store`), leaving the
 * previous cache and the `loaded` flag untouched — so a cold failure keeps
 * showing the skeleton and a background failure keeps the cached figure.
 */
export const refreshMyReferrals = async (): Promise<void> => {
	if (inFlight) {
		await inFlight;

		return;
	}

	const current = runRefresh()
		.catch((err) => {
			console.error('referrals.store: refresh failed', err);
		})
		.finally(() => {
			inFlight = undefined;
		});
	inFlight = current;

	await current;
};

export const clearMyReferrals = (): void => {
	// Invalidate any in-flight refresh so its result is dropped instead of
	// repopulating the cleared cache for the previous principal.
	epoch += 1;
	myReferralsStore.set([]);
	myReferralsLoadedStore.set(false);
};
