// Market translation overlays: locale validation, upsert-in-place, the
// per-series listing, and the bounded bulk read the markets surfaces drive.

import { beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import type { AuthedUser } from '../src/auth/guard';
import {
	getMarketTranslation,
	listMarketTranslations,
	listMarketTranslationsForLocales,
	upsertMarketTranslation
} from '../src/markets/translations';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

const uniqueSeriesId = (): string => `srs_${randomBytes(6).toString('hex')}`;

describe.if(dbAvailable)('market translations', () => {
	let admin: AuthedUser;

	beforeAll(async () => {
		await ensureMigrated();
		admin = { id: await createTestUser('admin'), role: 'admin' };
	});

	test('upsert persists and overwrites in place', async () => {
		const seriesId = uniqueSeriesId();

		const first = await upsertMarketTranslation({
			user: admin,
			seriesId,
			locale: 'it',
			body: {
				title: 'Titolo',
				description: 'Descrizione',
				resolution: 'Risoluzione',
				outcomes: [{ id: 'yes', title: 'Si' }]
			}
		});

		expect(first.locale).toBe('it');
		expect(first.outcomes).toEqual([{ id: 'yes', title: 'Si' }]);

		const second = await upsertMarketTranslation({
			user: admin,
			seriesId,
			locale: 'it',
			body: { title: 'Titolo 2', description: 'D2', resolution: 'R2' }
		});

		expect(second.title).toBe('Titolo 2');
		expect(second.outcomes).toEqual([]);

		const read = await getMarketTranslation({ seriesId, locale: 'it' });

		expect(read?.title).toBe('Titolo 2');
	});

	test('rejects an unregistered locale on read and write', async () => {
		const seriesId = uniqueSeriesId();

		await expect(
			upsertMarketTranslation({
				user: admin,
				seriesId,
				locale: 'xx',
				body: { title: 't', description: 'd', resolution: 'r' }
			})
		).rejects.toThrow('Unsupported locale');

		await expect(getMarketTranslation({ seriesId, locale: 'xx' })).rejects.toThrow(
			'Unsupported locale'
		);
	});

	test('rejects non-string body fields and malformed outcomes', async () => {
		const seriesId = uniqueSeriesId();

		await expect(
			upsertMarketTranslation({
				user: admin,
				seriesId,
				locale: 'de',
				body: { title: 1, description: 'd', resolution: 'r' }
			})
		).rejects.toThrow('must be strings');

		await expect(
			upsertMarketTranslation({
				user: admin,
				seriesId,
				locale: 'de',
				body: { title: 't', description: 'd', resolution: 'r', outcomes: [{ id: 1 }] }
			})
		).rejects.toThrow('outcomes entries');
	});

	test('per-series listing returns every stored locale', async () => {
		const seriesId = uniqueSeriesId();

		for (const locale of ['it', 'de', 'pt-BR']) {
			await upsertMarketTranslation({
				user: admin,
				seriesId,
				locale,
				body: { title: `t-${locale}`, description: 'd', resolution: 'r' }
			});
		}

		const items = await listMarketTranslations({ seriesId });

		expect(items.map(({ locale }) => locale).sort()).toEqual(['de', 'it', 'pt-BR']);
	});

	test('bulk read filters to the requested cartesian product and drops bad locales', async () => {
		const a = uniqueSeriesId();
		const b = uniqueSeriesId();

		await upsertMarketTranslation({
			user: admin,
			seriesId: a,
			locale: 'it',
			body: { title: 'a-it', description: 'd', resolution: 'r' }
		});
		await upsertMarketTranslation({
			user: admin,
			seriesId: a,
			locale: 'fr',
			body: { title: 'a-fr', description: 'd', resolution: 'r' }
		});
		await upsertMarketTranslation({
			user: admin,
			seriesId: b,
			locale: 'it',
			body: { title: 'b-it', description: 'd', resolution: 'r' }
		});

		const items = await listMarketTranslationsForLocales({
			seriesIds: [a, b],
			locales: ['it', 'xx']
		});

		expect(items.map(({ title }) => title).sort()).toEqual(['a-it', 'b-it']);
	});

	test('bulk read caps the series fan-out at 200 ids', async () => {
		const translated = uniqueSeriesId();

		await upsertMarketTranslation({
			user: admin,
			seriesId: translated,
			locale: 'es',
			body: { title: 'capped', description: 'd', resolution: 'r' }
		});

		// The translated id sits past the cap, so the truncated read misses it.
		const padding = Array.from({ length: 200 }, () => uniqueSeriesId());
		const items = await listMarketTranslationsForLocales({
			seriesIds: [...padding, translated],
			locales: ['es']
		});

		expect(items).toEqual([]);
	});
});
