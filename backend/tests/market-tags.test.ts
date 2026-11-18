// The market tag reverse index: buckets derived from micros plus their
// macros, transactional maintenance on metadata writes, the populated-bucket
// dump, and the admin rebuild corrective.

import { beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import type { AuthedUser } from '../src/auth/guard';
import { query } from '../src/db/client';
import { upsertMarketMetadata } from '../src/markets/metadata';
import { getMarketTags, rebuildMarketTagIndex, seriesIdsForTag } from '../src/markets/tag-index';
import { ALL_INDEX_KEYS } from '../src/markets/taxonomy';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

const uniqueSeriesId = (): string => `srs_${randomBytes(6).toString('hex')}`;

describe.if(dbAvailable)('market tag index', () => {
	let admin: AuthedUser;

	beforeAll(async () => {
		await ensureMigrated();
		admin = { id: await createTestUser('admin'), role: 'admin' };
	});

	test('a metadata write indexes micros plus derived macros, never free tags', async () => {
		const seriesId = uniqueSeriesId();

		await upsertMarketMetadata({
			user: admin,
			seriesId,
			body: { tags: ['soccer', 'nba', 'custom-free-tag'] }
		});

		expect(await seriesIdsForTag('soccer')).toContain(seriesId);
		expect(await seriesIdsForTag('nba')).toContain(seriesId);
		// Both micros roll up to the same macro exactly once.
		expect((await seriesIdsForTag('sports')).filter((id) => id === seriesId)).toHaveLength(1);
		expect(await seriesIdsForTag('custom-free-tag')).toEqual([]);
	});

	test('a tag change drops stale buckets and adds new ones', async () => {
		const seriesId = uniqueSeriesId();

		await upsertMarketMetadata({ user: admin, seriesId, body: { tags: ['soccer'] } });
		await upsertMarketMetadata({ user: admin, seriesId, body: { tags: ['bitcoin'] } });

		expect(await seriesIdsForTag('soccer')).not.toContain(seriesId);
		expect(await seriesIdsForTag('sports')).not.toContain(seriesId);
		expect(await seriesIdsForTag('bitcoin')).toContain(seriesId);
		expect(await seriesIdsForTag('crypto')).toContain(seriesId);
	});

	test('an unknown bucket reads empty', async () => {
		expect(await seriesIdsForTag(`missing-${randomBytes(4).toString('hex')}`)).toEqual([]);
	});

	test('getMarketTags returns only populated buckets in canonical key order', async () => {
		const seriesId = uniqueSeriesId();

		await upsertMarketMetadata({ user: admin, seriesId, body: { tags: ['tennis'] } });

		const { buckets } = await getMarketTags();
		const tags = buckets.map(({ tag }) => tag);

		expect(tags).toContain('tennis');
		expect(tags).toContain('sports');
		expect(buckets.every(({ seriesIds }) => seriesIds.length > 0)).toBe(true);

		// Canonical order: the result is a subsequence of ALL_INDEX_KEYS.
		const canonical = tags.map((tag) => ALL_INDEX_KEYS.indexOf(tag));

		expect([...canonical].sort((a, b) => a - b)).toEqual(canonical);

		const tennisBucket = buckets.find(({ tag }) => tag === 'tennis');

		expect(tennisBucket?.seriesIds).toContain(seriesId);
	});

	test('rebuild re-derives exact buckets and heals drift', async () => {
		const seriesId = uniqueSeriesId();

		await upsertMarketMetadata({ user: admin, seriesId, body: { tags: ['f1'] } });

		// Drift the index away from the metadata: a stale bogus membership and
		// a dropped real one.
		await query(`insert into market_tag_index (tag, series_id) values ('bitcoin', $1)`, [seriesId]);
		await query(`delete from market_tag_index where tag = 'f1' and series_id = $1`, [seriesId]);

		const { buckets, series } = await rebuildMarketTagIndex();

		expect(buckets).toBe(ALL_INDEX_KEYS.length);
		expect(series).toBeGreaterThanOrEqual(1);

		expect(await seriesIdsForTag('f1')).toContain(seriesId);
		expect(await seriesIdsForTag('bitcoin')).not.toContain(seriesId);
	});
});
