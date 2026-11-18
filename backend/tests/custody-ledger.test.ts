// Double-entry invariants: balanced legs only, idempotent replay by event
// key, and the balances view agreeing with the raw entries.

import { isNullish } from '@dfinity/utils';
import { beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { ensureInternalAccount, ensureUserAccount } from '../src/custody/accounts';
import { getAssetBySymbol, type Asset } from '../src/custody/assets';
import { postLedgerEvent } from '../src/custody/ledger';
import { query } from '../src/db/client';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

const eventKey = (): string => `test:${randomBytes(8).toString('hex')}`;

describe.if(dbAvailable)('custody ledger', () => {
	let asset: Asset;
	let userAccountId: string;
	let externalId: string;

	beforeAll(async () => {
		await ensureMigrated();

		const vxp = await getAssetBySymbol({ chain: 'ic', symbol: 'VXP' });

		if (isNullish(vxp)) {
			throw new Error('VXP asset missing from seed');
		}

		asset = vxp;

		const userId = await createTestUser();
		const account = await ensureUserAccount({ userId, chain: 'ic', address: `p-${userId}` });
		const external = await ensureInternalAccount({
			kind: 'external',
			chain: 'ic',
			address: 'external'
		});

		userAccountId = account.id;
		externalId = external.id;
	});

	test('rejects an event with fewer than two legs', () => {
		expect(
			postLedgerEvent({
				eventKey: eventKey(),
				kind: 'deposit',
				legs: [{ accountId: userAccountId, assetId: asset.id, delta: '100' }]
			})
		).rejects.toThrow('at least two legs');
	});

	test('rejects legs that do not sum to zero per asset', () => {
		expect(
			postLedgerEvent({
				eventKey: eventKey(),
				kind: 'deposit',
				legs: [
					{ accountId: userAccountId, assetId: asset.id, delta: '100' },
					{ accountId: externalId, assetId: asset.id, delta: '-99' }
				]
			})
		).rejects.toThrow('sum to zero');
	});

	test('rejects non-integer deltas', () => {
		expect(
			postLedgerEvent({
				eventKey: eventKey(),
				kind: 'deposit',
				legs: [
					{ accountId: userAccountId, assetId: asset.id, delta: '1.5' },
					{ accountId: externalId, assetId: asset.id, delta: '-1.5' }
				]
			})
		).rejects.toThrow('integer base-unit');
	});

	test('posts a balanced event once and replays as a no-op', async () => {
		const key = eventKey();
		const legs = [
			{ accountId: userAccountId, assetId: asset.id, delta: '250' },
			{ accountId: externalId, assetId: asset.id, delta: '-250' }
		];

		expect(await postLedgerEvent({ eventKey: key, kind: 'deposit', legs })).toBe(true);
		expect(await postLedgerEvent({ eventKey: key, kind: 'deposit', legs })).toBe(false);

		const rows = await query<{ count: string }>(
			`select count(*)::text as count from ledger_entries where event_key = $1`,
			[key]
		);

		expect(rows[0]?.count).toBe('2');
	});

	test('the balances view sums entries per account and asset', async () => {
		const before = await query<{ balance: string }>(
			`select coalesce(balance, 0)::text as balance from custody_balances
			 where account_id = $1 and asset_id = $2`,
			[userAccountId, asset.id]
		);
		const baseline = BigInt(before[0]?.balance ?? '0');

		await postLedgerEvent({
			eventKey: eventKey(),
			kind: 'deposit',
			legs: [
				{ accountId: userAccountId, assetId: asset.id, delta: '40' },
				{ accountId: externalId, assetId: asset.id, delta: '-40' }
			]
		});

		const after = await query<{ balance: string }>(
			`select balance::text as balance from custody_balances
			 where account_id = $1 and asset_id = $2`,
			[userAccountId, asset.id]
		);

		expect(BigInt(after[0]?.balance ?? '0')).toBe(baseline + BigInt(40));
	});

	test('every event in the table nets to zero per asset (global invariant)', async () => {
		const rows = await query<{ event_key: string; total: string }>(
			`select event_key, sum(delta)::text as total
			 from ledger_entries group by event_key, asset_id having sum(delta) <> 0`
		);

		expect(rows).toHaveLength(0);
	});
});
