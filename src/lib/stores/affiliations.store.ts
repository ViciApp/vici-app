import { listMyAffiliations } from '#lib/services/worlds.services.ts';
import type { AffiliationDoc } from '#lib/types/affiliation.ts';
import { writable } from 'svelte/store';

/**
 * Reactive cache of the viewer's Worlds affiliations (`{ university?,
 * country? }`).
 *
 * Single source of truth shared by every surface that renders the
 * caller's own school / country — the Profile dashboard, the Arena
 * overview strip, the Worlds leaderboard, and the battles inbox. Mirrors
 * the stale-while-revalidate contract of
 * [`leagues.store`](./leagues.store.ts) / [`friends.store`](./friends.store.ts):
 * the first successful refresh flips `affiliationsLoadedStore` to
 * `true`, and it stays `true` until `clearAffiliations()` runs (principal
 * change / sign-out). Consumers render the cache on re-entry and refresh
 * in the background instead of re-fetching (and flashing an empty slot)
 * on every mount.
 */

export interface MyAffiliations {
	university?: AffiliationDoc;
	country?: AffiliationDoc;
}

/** The caller's current university + country affiliations. */
export const myAffiliationsStore = writable<MyAffiliations>({});

/**
 * Flips to `true` the first time `refreshMyAffiliations` completes for
 * the current principal, and stays `true` until `clearAffiliations`
 * runs. Lets consumers gate a cold-load skeleton and switch to
 * stale-while-revalidate on every subsequent visit.
 */
export const affiliationsLoadedStore = writable<boolean>(false);

const runRefresh = async (): Promise<void> => {
	const { university, country } = await listMyAffiliations();

	myAffiliationsStore.set({ university, country });
	affiliationsLoadedStore.set(true);
};

let inFlight: Promise<void> | undefined;
let queued = false;

const schedule = (): Promise<void> => {
	const current = runRefresh()
		.catch((err) => {
			// Keep `affiliationsLoadedStore` as-is on failure: a cold
			// failure leaves it `false` so the next mount retries; a failed
			// background refresh keeps the cached affiliations on screen.
			console.error('affiliations.store: refresh failed', err);
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
 * Refetches the caller's `{ university?, country? }` affiliations.
 *
 * Concurrency contract (mirrors `refreshFriendRelations` /
 * `refreshMyLeagues`):
 * - Same-tick concurrent callers (e.g. the Profile dashboard + Arena
 *   strip mounting together) share the in-flight promise.
 * - A call that arrives **while** a refresh is in flight (typically a
 *   post-mutation refresh after join / switch / leave) guarantees one
 *   additional fetch after the current one finishes, so the caller
 *   observes state that reflects its mutation.
 */
export const refreshMyAffiliations = async (): Promise<void> => {
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

export const clearAffiliations = (): void => {
	myAffiliationsStore.set({});
	affiliationsLoadedStore.set(false);
};
