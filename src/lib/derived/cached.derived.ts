import { isNullish } from '@dfinity/utils';
import { derived, type Readable } from 'svelte/store';

/**
 * Default-to-empty-array view of a cached store.
 *
 * Use for stores shaped as `Writable<T[] | undefined>` so consumers can read a
 * stable array without having to nullish-check on every render. Pair with
 * {@link cachedNotInitialized} when the page also needs a "still loading"
 * signal.
 */
export const cachedListOrEmpty = <T>(store: Readable<T[] | undefined>): Readable<T[]> =>
	derived(store, ($store) => $store ?? []);

/**
 * Returns `true` while the store's value is still `undefined` (i.e. the
 * initial fetch hasn't completed yet). Once any value, including an empty
 * list: has been written, it flips to `false` and stays there, so consumers
 * can show a spinner on first visit and skip it on every subsequent
 * navigation back to the page (the cached value sticks around in the store).
 */
export const cachedNotInitialized = <T>(store: Readable<T | undefined>): Readable<boolean> =>
	derived(store, ($store) => isNullish($store));
