// Reverse index `bucket key -> seriesId[]` over the closed taxonomy: one row
// per (bucket, series) in market_tag_index. A market is indexed under each of
// its micro ids AND each derived macro id, so a macro bucket like `sports`
// aggregates every market of any of its micros while a micro bucket like
// `soccer` holds just that subcategory. Layer-3 free tags are not indexed.
//
// The index exists so battle scoping (seriesIdsForTag) reads a single bucket
// instead of scanning every market's metadata on each resolve or live
// standings read. It is maintained in the same transaction as each metadata
// write and can be rebuilt from scratch by the admin corrective.

import { isNullish } from '@dfinity/utils';
import { query, tx, type TxQuery } from '../db/client';
import { ALL_INDEX_KEYS, indexKeysForTags } from './taxonomy';

/**
 * The series carrying `tag`, read straight from its index rows. `tag` is any
 * bucket key: a micro id (`soccer`), a macro id (`sports`), or a legacy tag.
 * An unknown or empty bucket simply reads empty, which correctly scores a
 * battle on that scope as a void face-off rather than counting every market.
 */
export const seriesIdsForTag = async (tag: string): Promise<string[]> => {
	const rows = await query<{ series_id: string }>(
		`select series_id from market_tag_index where tag = $1 order by series_id`,
		[tag]
	);

	return rows.map(({ series_id }) => series_id);
};

/**
 * Every populated bucket, `bucket -> seriesIds`, over the closed micro+macro
 * taxonomy in canonical key order. Empty buckets are dropped from the result.
 * Admin-gated at the route.
 */
export const getMarketTags = async (): Promise<{
	buckets: { tag: string; seriesIds: string[] }[];
}> => {
	const rows = await query<{ tag: string; series_id: string }>(
		`select tag, series_id from market_tag_index order by tag, series_id`
	);

	const byTag = new Map<string, string[]>();

	for (const { tag, series_id } of rows) {
		const bucket = byTag.get(tag);

		if (isNullish(bucket)) {
			byTag.set(tag, [series_id]);
		} else {
			bucket.push(series_id);
		}
	}

	return {
		buckets: ALL_INDEX_KEYS.filter((tag) => (byTag.get(tag)?.length ?? 0) > 0).map((tag) => ({
			tag,
			seriesIds: byTag.get(tag) ?? []
		}))
	};
};

/**
 * Reconcile the index for a single market after its metadata is (re-)written:
 * drop the series from every bucket it no longer belongs to and add it to
 * every bucket it newly belongs to. Bucket keys (micros plus derived macros)
 * are re-derived from the tags here, so a since-removed micro drops the
 * series and, if it was that micro's macro's last market, empties the macro
 * bucket too. Runs on the caller's transaction so the index can never drift
 * from the metadata write it mirrors.
 */
export const updateMarketTagIndex = async ({
	q,
	seriesId,
	oldTags,
	newTags
}: {
	q: TxQuery;
	seriesId: string;
	oldTags: readonly string[];
	newTags: readonly string[];
}): Promise<void> => {
	const previous = indexKeysForTags(oldTags);
	const current = indexKeysForTags(newTags);

	const removed = previous.filter((tag) => !current.includes(tag));
	const added = current.filter((tag) => !previous.includes(tag));

	if (removed.length > 0) {
		await q(`delete from market_tag_index where series_id = $1 and tag = any($2)`, [
			seriesId,
			removed
		]);
	}

	if (added.length > 0) {
		await q(
			`insert into market_tag_index (tag, series_id)
			 select t, $1 from unnest($2::text[]) as t
			 on conflict do nothing`,
			[seriesId, added]
		);
	}
};

/**
 * Admin-only corrective: re-derive every bucket from a single scan of
 * market_metadata and overwrite the index atomically. Backfills the index for
 * markets that predate it and heals any drift. Returns the taxonomy bucket
 * count and the number of series scanned, matching the legacy contract.
 */
export const rebuildMarketTagIndex = async (): Promise<{ buckets: number; series: number }> =>
	await tx(async (q) => {
		const rows = await q<{ series_id: string; tags: unknown }>(
			`select series_id, tags from market_metadata`
		);

		await q(`delete from market_tag_index`);

		let series = 0;

		for (const { series_id, tags } of rows) {
			series += 1;

			// tags is persisted well-formed, but a legacy or partially-malformed
			// row could carry a non-array value or non-string entries; skip those
			// rather than abort the whole rebuild (this is the repair path).
			const list = Array.isArray(tags)
				? tags.filter((t): t is string => typeof t === 'string')
				: [];
			const keys = indexKeysForTags(list);

			if (keys.length > 0) {
				await q(
					`insert into market_tag_index (tag, series_id)
					 select t, $1 from unnest($2::text[]) as t
					 on conflict do nothing`,
					[series_id, keys]
				);
			}
		}

		return { buckets: ALL_INDEX_KEYS.length, series };
	});
