// Curator write gate: an admin may edit any series, the series creator may
// edit their own (matched through the derived custodial principal or a linked
// legacy principal), and everyone else is refused. The registry is mocked at
// the actor boundary.

import { isNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { query } from '../src/db/client';
import type { ClearingService, RegistryService } from '../src/declarations';
import { setEngineActorProvider } from '../src/engine/actors';
import { clearCache } from '../src/engine/cache';
import { userIcPrincipalText } from '../src/lib/keys';
import {
	CuratorForbiddenError,
	isCreatorOrAdmin,
	MarketValidationError
} from '../src/markets/curator';
import { upsertMarketMetadata } from '../src/markets/metadata';
import { upsertMarketTranslation } from '../src/markets/translations';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

let restore: (() => void) | undefined;

afterEach(() => {
	restore?.();
	restore = undefined;
	clearCache();
});

/** Mock the registry so get_series answers with the given creator (or unknown). */
const mockSeriesCreator = (creator?: string): void => {
	restore = setEngineActorProvider({
		clearing: () => Promise.resolve({} as unknown as ClearingService),
		registry: () =>
			Promise.resolve({
				get_series: () =>
					Promise.resolve(isNullish(creator) ? [] : [{ creator: Principal.fromText(creator) }])
			} as unknown as RegistryService)
	});
};

const uniqueSeriesId = (): string => `srs_${randomBytes(6).toString('hex')}`;

/** A principal text that is nobody's derived identity. */
const strangerPrincipal = (): string => Principal.fromUint8Array(randomBytes(29)).toText();

describe.if(dbAvailable)('curator gate', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('an admin passes without a registry lookup', async () => {
		const adminId = await createTestUser('admin');

		// No mock installed: an admin short-circuit must never reach the actor.
		expect(
			await isCreatorOrAdmin({ user: { id: adminId, role: 'admin' }, seriesId: uniqueSeriesId() })
		).toBe(true);
	});

	test('the creator passes via the derived custodial principal', async () => {
		const userId = await createTestUser();

		mockSeriesCreator(userIcPrincipalText(userId));

		expect(
			await isCreatorOrAdmin({ user: { id: userId, role: 'user' }, seriesId: uniqueSeriesId() })
		).toBe(true);
	});

	test('the creator passes via a linked legacy principal', async () => {
		const userId = await createTestUser();
		const legacy = strangerPrincipal();

		await query(
			`insert into legacy_principals (principal, user_id, matched_via) values ($1, $2, 'openid_email')`,
			[legacy, userId]
		);

		mockSeriesCreator(legacy);

		expect(
			await isCreatorOrAdmin({ user: { id: userId, role: 'user' }, seriesId: uniqueSeriesId() })
		).toBe(true);
	});

	test('a non-creator non-admin is refused, as is an unknown series', async () => {
		const userId = await createTestUser();

		mockSeriesCreator(strangerPrincipal());

		expect(
			await isCreatorOrAdmin({ user: { id: userId, role: 'user' }, seriesId: uniqueSeriesId() })
		).toBe(false);

		clearCache();
		restore?.();
		mockSeriesCreator(undefined);

		expect(
			await isCreatorOrAdmin({ user: { id: userId, role: 'user' }, seriesId: uniqueSeriesId() })
		).toBe(false);
	});

	test('metadata and translation writes throw for a refused caller', async () => {
		const userId = await createTestUser();

		mockSeriesCreator(strangerPrincipal());

		expect(
			upsertMarketMetadata({
				user: { id: userId, role: 'user' },
				seriesId: uniqueSeriesId(),
				body: { tags: ['soccer'] }
			})
		).rejects.toThrow(CuratorForbiddenError);

		expect(
			upsertMarketTranslation({
				user: { id: userId, role: 'user' },
				seriesId: uniqueSeriesId(),
				locale: 'it',
				body: { title: 't', description: 'd', resolution: 'r' }
			})
		).rejects.toThrow(CuratorForbiddenError);
	});
});

describe.if(dbAvailable)('metadata upsert semantics', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('caps events at two', async () => {
		const adminId = await createTestUser('admin');
		const event = { day: 1, label: 'kickoff', dir: 'up' };

		expect(
			upsertMarketMetadata({
				user: { id: adminId, role: 'admin' },
				seriesId: uniqueSeriesId(),
				body: { events: [event, event, event] }
			})
		).rejects.toThrow('at most two events');
	});

	test('normalizes tags: trim, drop blanks, de-duplicate preserving order', async () => {
		const adminId = await createTestUser('admin');

		const metadata = await upsertMarketMetadata({
			user: { id: adminId, role: 'admin' },
			seriesId: uniqueSeriesId(),
			body: { tags: [' soccer ', 'soccer', '', 'world-cup', 'free-tag'] }
		});

		expect(metadata.tags).toEqual(['soccer', 'world-cup', 'free-tag']);
	});

	test('suggested is admin-only: a creator write keeps the stored value', async () => {
		const adminId = await createTestUser('admin');
		const creatorId = await createTestUser();
		const seriesId = uniqueSeriesId();

		await upsertMarketMetadata({
			user: { id: adminId, role: 'admin' },
			seriesId,
			body: { suggested: true, tags: ['nba'] }
		});

		mockSeriesCreator(userIcPrincipalText(creatorId));

		const afterCreatorWrite = await upsertMarketMetadata({
			user: { id: creatorId, role: 'user' },
			seriesId,
			body: { suggested: false, tags: ['nba'] }
		});

		expect(afterCreatorWrite.suggested).toBe(true);

		const afterAdminWrite = await upsertMarketMetadata({
			user: { id: adminId, role: 'admin' },
			seriesId,
			body: { suggested: false, tags: ['nba'] }
		});

		expect(afterAdminWrite.suggested).toBe(false);
	});

	test('rejects malformed whyNow and events', async () => {
		const adminId = await createTestUser('admin');

		expect(
			upsertMarketMetadata({
				user: { id: adminId, role: 'admin' },
				seriesId: uniqueSeriesId(),
				body: { whyNow: { kind: 'bogus', text: 'x' } }
			})
		).rejects.toThrow(MarketValidationError);

		expect(
			upsertMarketMetadata({
				user: { id: adminId, role: 'admin' },
				seriesId: uniqueSeriesId(),
				body: { events: [{ day: 'one', label: 'x', dir: 'up' }] }
			})
		).rejects.toThrow(MarketValidationError);
	});
});
