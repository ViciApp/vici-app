// Typed wrappers over the registry canister, mirroring the catalog reads the
// app consumes: they sign with the engine reader identity behind the shared
// TTL cache.

import { fromNullable, isNullish, jsonReplacer, nonNullish, toNullable } from '@dfinity/utils';
import type { RegistryDid } from '../declarations';
import { readerRegistry } from './actors';
import { cached, PUBLIC_READ_TTL_MS } from './cache';

/** The engine id the app is registered under on the registry: only markets
 * created by it are Vici markets. */
export const VICI_ENGINE_ID = 'eng_0';

// Public catalog reads (engine reader identity, cached)

export const getSeries = (seriesId: string): Promise<RegistryDid.Series | undefined> =>
	cached({
		key: `registry:series:${seriesId}`,
		ttlMs: PUBLIC_READ_TTL_MS,
		load: async () => {
			const actor = await readerRegistry();

			return fromNullable(await actor.get_series(seriesId));
		}
	});

/** Drains the registry's pagination cursor to completion, exactly like the
 * app's canister wrapper: filtered reads go through `list_series_with`, the
 * unfiltered legacy read through `list_series`. */
export const listSeries = (params?: RegistryDid.ListSeriesParams): Promise<RegistryDid.Series[]> =>
	cached({
		key: `registry:series-list:${JSON.stringify(params ?? {}, jsonReplacer)}`,
		ttlMs: PUBLIC_READ_TTL_MS,
		load: async () => {
			const actor = await readerRegistry();
			const pageSize = fromNullable(params?.pagination ?? [])?.limit ?? toNullable();
			const items: RegistryDid.Series[] = [];
			let cursor = fromNullable(params?.pagination ?? [])?.cursor ?? toNullable();

			for (;;) {
				const page = nonNullish(params)
					? await actor.list_series_with({
							...params,
							pagination: toNullable({ cursor, limit: pageSize })
						})
					: await actor.list_series({ cursor, limit: pageSize });

				items.push(...page.items);

				const next = fromNullable(page.next_cursor);

				if (isNullish(next)) {
					return items;
				}

				cursor = toNullable(next);
			}
		}
	});
