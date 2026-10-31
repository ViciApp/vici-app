// Tiny in-memory TTL cache for the anonymous public engine reads: the same
// market list / price history is asked for by every visitor, and a short TTL
// keeps the canister query volume flat without a cache dependency.

import { isNullish, nonNullish } from '@dfinity/utils';

interface Entry {
	value: unknown;
	expiresAt: number;
}

const store = new Map<string, Entry>();

/** Reads a burst of callers are already waiting on: a cold page load asks for
 * the same key in parallel, and each caller loading for itself is what turns
 * one slow canister read into several in the same process. An entry leaves
 * when its load settles, so a rejection reaches only the callers already
 * waiting and the next read retries. */
const inFlight = new Map<string, Promise<unknown>>();

/** Values the engine can never change again, held apart from `store` so the
 * TTL and the entry bound cannot evict them. Only retain what engine state
 * bounds, never what request input can grow. */
const retained = new Map<string, unknown>();

/** Soft bound; the sweep on insert keeps an abandoned key set from growing
 * without limit. */
const MAX_ENTRIES = 500;

export const cached = async <T>({
	key,
	ttlMs,
	load
}: {
	key: string;
	ttlMs: number;
	load: () => Promise<T>;
}): Promise<T> => {
	const now = Date.now();
	const hit = store.get(key);

	if (nonNullish(hit) && hit.expiresAt > now) {
		return hit.value as T;
	}

	const pending = inFlight.get(key);

	if (nonNullish(pending)) {
		return (await pending) as T;
	}

	const loading = (async (): Promise<T> => {
		const value = await load();

		if (store.size >= MAX_ENTRIES) {
			for (const [entryKey, entry] of store) {
				if (entry.expiresAt <= now) {
					store.delete(entryKey);
				}
			}

			// Still over the bound after sweeping: drop oldest-inserted entries.
			while (store.size >= MAX_ENTRIES) {
				const oldest = store.keys().next().value;

				if (isNullish(oldest)) {
					break;
				}

				store.delete(oldest);
			}
		}

		store.set(key, { value, expiresAt: now + ttlMs });

		return value;
	})().finally(() => inFlight.delete(key));

	inFlight.set(key, loading);

	return await loading;
};

export const getRetained = <T>(key: string): T | undefined => retained.get(key) as T | undefined;

export const retain = ({ key, value }: { key: string; value: unknown }): void => {
	retained.set(key, value);
};

export const clearCache = (): void => {
	store.clear();
	inFlight.clear();
	retained.clear();
};
