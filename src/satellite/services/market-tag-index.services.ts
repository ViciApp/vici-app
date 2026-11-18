import { Collection } from '#lib/constants/collections.constants.ts';
import {
	classificationMacros,
	classificationMicros,
	MACRO_IDS,
	MICRO_IDS
} from '#lib/constants/market-taxonomy.constants.ts';
import type { MarketMetadata, MarketTagIndex } from '#lib/types/market-metadata.ts';
import { controllerCaller, isAdmin } from '#satellite/services/authz.services.ts';
import { logError } from '#satellite/utils/logger.utils.ts';
import { timeMs } from '#satellite/utils/time.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import { msgCaller } from '@junobuild/functions/ic-cdk';
import {
	decodeDocData,
	encodeDocData,
	getDocStore,
	listDocsStore,
	setDocStore
} from '@junobuild/functions/sdk';

/**
 * Server-side reverse index `bucket key → seriesId[]`, one doc per bucket keyed
 * by the bucket id. A market's stored `tags` classify it under the 3-layer
 * taxonomy, and it is indexed into a bucket for each of its micro ids AND each
 * derived macro id (see {@link indexKeysForTags}), so a macro bucket like
 * `sports` aggregates every market of any of its micros, while a micro bucket
 * like `soccer` holds just that subcategory. Layer-3 free tags are not indexed.
 *
 * The index exists so battle scoping ({@link seriesIdsForTag}) reads a single
 * bucket instead of scanning the whole `market_metadata` collection on every
 * resolve / live-standings read. Buckets are created on demand per key and are
 * maintained inline by `upsertMarketMetadata` (Juno hooks don't fire on
 * serverless `setDocStore`, so the upsert endpoint diffs a market's old vs new
 * bucket keys and updates the affected buckets itself); they can be rebuilt
 * from scratch by the admin {@link rebuildMarketTagIndexFn}.
 */

/** Every bucket key the index can hold: one per micro id and one per macro id. */
const ALL_INDEX_KEYS: readonly string[] = [...MICRO_IDS, ...MACRO_IDS];

/**
 * The bucket keys a market belongs to, derived from its stored tags: its micro
 * ids plus the macro ids those micros roll up to. De-duplicated (a macro can be
 * derived once even from several of its micros). Layer-3 free tags contribute
 * no bucket.
 */
const indexKeysForTags = (tags: readonly string[]): string[] => [
	...new Set<string>([...classificationMicros(tags), ...classificationMacros(tags)])
];

/**
 * A satellite controller principal, used as the `caller` for writes to the
 * controllers-scoped `market_tag_index` collection: the market creator is not
 * a controller, so the index is moved as an admin (the `*DocStore` APIs enforce
 * the collection rule against the caller they're given).
 */
const adminCaller = (): Uint8Array => controllerCaller('market-tag index');

const decodeSeriesIds = (doc: ReturnType<typeof getDocStore>): string[] => {
	if (isNullish(doc)) {
		return [];
	}

	try {
		const { seriesIds } = decodeDocData<MarketTagIndex>(doc.data);

		// A bucket that decodes but carries a non-array (or non-string entries)
		// `seriesIds` is treated as empty rather than passed through; otherwise a
		// malformed value could make scoping count every market or trap when the
		// ids are candid-encoded for the clearing call.
		return Array.isArray(seriesIds) ? seriesIds.filter((id) => typeof id === 'string') : [];
	} catch {
		// A malformed bucket can't contribute series: treat as empty.
		return [];
	}
};

/**
 * The series carrying `tag`, read straight from its index bucket. `tag` is any
 * bucket key: a micro id (`soccer`), a macro id (`sports`), or a legacy tag;
 * buckets are created on demand, so an unknown key simply reads empty. Returns
 * an empty array when no bucket exists yet (no market has the key, or the index
 * hasn't been rebuilt), which correctly scores a battle on that scope as a
 * void face-off rather than silently counting every market.
 */
export const seriesIdsForTag = ({ tag, caller }: { tag: string; caller: Uint8Array }): string[] => {
	const doc = getDocStore({
		collection: Collection.MARKET_TAG_INDEX,
		key: tag,
		caller
	});

	return decodeSeriesIds(doc);
};

/**
 * Admin-gated read of every populated bucket for the cockpit: `bucket → seriesIds`
 * over the closed micro+macro taxonomy. One keyed `getDocStore` per possible key
 * (O(log n) reads, never a collection scan); missing/malformed buckets read as
 * empty and are dropped from the result. The cockpit uses it to classify markets
 * (e.g. sport vs non-sport via the `sports` macro bucket) for the campaign
 * hypothesis register, so the taxonomy stays owned here and no key is hardcoded
 * warehouse-side.
 */
export const getMarketTagsFn = (): {
	buckets: { tag: string; seriesIds: string[] }[];
} => {
	const caller = msgCaller();

	if (!isAdmin({ caller })) {
		throw new Error('Only an admin can read the market-tag index.');
	}

	const admin = adminCaller();

	return {
		buckets: ALL_INDEX_KEYS.map((tag) => ({
			tag,
			seriesIds: seriesIdsForTag({ tag, caller: admin })
		})).filter(({ seriesIds }) => seriesIds.length > 0)
	};
};

/**
 * Add or remove `seriesId` from a single bucket. Version-locked
 * read-modify-write as admin; best-effort: a rare version race under
 * concurrent metadata writes to markets sharing a bucket is logged and swallowed
 * (the admin {@link rebuildMarketTagIndexFn} re-derives the exact buckets).
 */
const mutateBucket = ({
	tag,
	seriesId,
	op,
	admin
}: {
	tag: string;
	seriesId: string;
	op: 'add' | 'remove';
	admin: Uint8Array;
}): void => {
	try {
		const existing = getDocStore({
			collection: Collection.MARKET_TAG_INDEX,
			key: tag,
			caller: admin
		});

		const current = decodeSeriesIds(existing);
		const set = new Set(current);

		if (op === 'add') {
			set.add(seriesId);
		} else {
			set.delete(seriesId);
		}

		// Nothing changed: skip the write (and its version bump) entirely.
		if (set.size === current.length && current.every((id) => set.has(id))) {
			return;
		}

		const next: MarketTagIndex = {
			tag,
			seriesIds: [...set],
			updatedAtMs: timeMs()
		};

		setDocStore({
			collection: Collection.MARKET_TAG_INDEX,
			key: tag,
			caller: admin,
			doc: {
				data: encodeDocData(next),
				version: existing?.version
			}
		});
	} catch (err: unknown) {
		logError({
			message: 'market_tag_index_bucket_failed',
			detail: { tag, seriesId, op, error: err instanceof Error ? err.message : `${err}` }
		});
	}
};

/**
 * Reconcile the index for a single market after its metadata is (re-)written:
 * drop the series from every bucket it no longer belongs to and add it to every
 * bucket it newly belongs to. Buckets it still belongs to are left untouched (the
 * series is already in them). Bucket keys, its micros plus derived macros, are
 * re-derived from the tags here (see {@link indexKeysForTags}), so a since-removed
 * micro drops the series and, if it was that micro's macro's last market, the
 * macro bucket too.
 */
export const updateMarketTagIndex = ({
	seriesId,
	oldTags,
	newTags
}: {
	seriesId: string;
	oldTags: readonly string[];
	newTags: readonly string[];
}): void => {
	const previous = indexKeysForTags(oldTags);
	const current = indexKeysForTags(newTags);

	const removed = previous.filter((tag) => !current.includes(tag));
	const added = current.filter((tag) => !previous.includes(tag));

	if (removed.length === 0 && added.length === 0) {
		return;
	}

	// Index maintenance is best-effort: it must never trap the primary metadata
	// write (a trap would roll the whole upsert back). A missing controller is
	// logged and swallowed; the admin `rebuildMarketTagIndex` re-derives buckets.
	try {
		const admin = adminCaller();

		for (const tag of removed) {
			mutateBucket({ tag, seriesId, op: 'remove', admin });
		}

		for (const tag of added) {
			mutateBucket({ tag, seriesId, op: 'add', admin });
		}
	} catch (err: unknown) {
		logError({
			message: 'market_tag_index_update_failed',
			detail: { seriesId, error: err instanceof Error ? err.message : `${err}` }
		});
	}
};

/**
 * Admin-only corrective: re-derive every bucket from a single scan of
 * `market_metadata` and overwrite the index. Backfills the index for markets
 * that predate it and heals any drift from a concurrent-write version race.
 * Admin-gated (mirrors `recomputeActivityReactionCounts`).
 *
 * One pass over `market_metadata`: fine at current volume; this is the only
 * O(all-markets) read in the index's life, run on demand rather than per
 * resolve.
 */
export const rebuildMarketTagIndexFn = (): { buckets: number; series: number } => {
	const caller = msgCaller();

	if (!isAdmin({ caller })) {
		throw new Error('Only an admin can rebuild the market-tag index.');
	}

	const admin = adminCaller();

	const { items } = listDocsStore({
		collection: Collection.MARKET_METADATA,
		caller: admin,
		params: {}
	});

	const buckets = new Map<string, string[]>(ALL_INDEX_KEYS.map((tag) => [tag, []]));
	let series = 0;

	for (const [, item] of items) {
		let metadata: MarketMetadata | undefined;

		try {
			metadata = decodeDocData<MarketMetadata>(item.data);
		} catch {
			// Skip an undecodable metadata row.
			metadata = undefined;
		}

		if (nonNullish(metadata)) {
			series += 1;

			// `tags` / `seriesId` are persisted well-formed, but a legacy or
			// partially-malformed row could decode with a non-array `tags` or a
			// non-string `seriesId`. Skip such a row rather than let it throw and
			// abort the whole rebuild; this is the index's backfill/repair path.
			const { seriesId, tags } = metadata;

			if (typeof seriesId === 'string' && Array.isArray(tags)) {
				// Bucket keys come from the taxonomy (micros + derived macros), so a
				// stray free tag can never create a bucket outside it.
				for (const tag of indexKeysForTags(tags)) {
					buckets.get(tag)?.push(seriesId);
				}
			}
		}
	}

	const now = timeMs();

	// Reconcile every possible bucket, including ones that now resolve to empty,
	// so a stale membership is cleared rather than left behind.
	for (const tag of ALL_INDEX_KEYS) {
		// De-duplicate before persisting: the bucket's documented invariant is a
		// set, and a series defensively can't appear twice in one bucket's list.
		const seriesIds = [...new Set(buckets.get(tag) ?? [])];

		const existing = getDocStore({
			collection: Collection.MARKET_TAG_INDEX,
			key: tag,
			caller: admin
		});

		const next: MarketTagIndex = { tag, seriesIds, updatedAtMs: now };

		setDocStore({
			collection: Collection.MARKET_TAG_INDEX,
			key: tag,
			caller: admin,
			doc: {
				data: encodeDocData(next),
				version: existing?.version
			}
		});
	}

	return { buckets: ALL_INDEX_KEYS.length, series };
};
