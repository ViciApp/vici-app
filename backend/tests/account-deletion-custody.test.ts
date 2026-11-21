// Custody funds and account deletion: a book balance, a live ic ledger
// balance at the custodial principal, collateral or a positive cash balance
// in clearing's Settlement domain, or a withdrawal in flight refuses the delete before anything changes; the sweep
// leaves an expired account that still holds funds soft-deleted, and a late
// recovery restores it instead of purging it.

import { isNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { fakeEngineActorProvider, fundFakeAccount } from '../e2e/fake-engine';
import {
	ACCOUNT_RECOVERY_WINDOW_MS,
	deleteMyAccount,
	recoverMyAccount,
	sweepExpiredDeletions,
	type DeleteMyAccountResult
} from '../src/account/lifecycle';
import { createSession } from '../src/auth/sessions';
import { ensureInternalAccount, ensureUserAccount } from '../src/custody/accounts';
import { getAssetBySymbol, type Asset } from '../src/custody/assets';
import { postLedgerEvent } from '../src/custody/ledger';
import { requestWithdrawal, transitionWithdrawal } from '../src/custody/withdrawals';
import { query } from '../src/db/client';
import type { ClearingDid, ClearingService } from '../src/declarations';
import { setEngineActorProvider } from '../src/engine/actors';
import { app } from '../src/index';
import { createLeague } from '../src/leagues/leagues';
import { joinLeagueByInvite } from '../src/leagues/members';
import { ZERO } from '../src/lib/constants';
import { userIcPrincipalText } from '../src/lib/keys';
import { logger } from '../src/lib/logger';
import { ensureMigrated } from './helpers/auth';
import { createTestProfile } from './helpers/profiles';
import { dbAvailable } from './helpers/setup';

const REFUSED: DeleteMyAccountResult = { ok: false, reason: 'holds_custody_funds' };

/** A clearing account state holding `balances` as raw collateral and `cash`
 * as its cash balances. */
const accountStateHolding = ({
	balances = [],
	cash = []
}: {
	balances?: [ClearingDid.BalanceDomain, [string, bigint][]][];
	cash?: [ClearingDid.BalanceDomain, bigint][];
}): ClearingDid.GetAccountStateResult => ({
	Ok: {
		assets: [],
		state: {
			user: Principal.anonymous(),
			reserved_margins_usd: [],
			cash_balances_usd: cash,
			balances
		},
		total_equity_usd: ZERO,
		available_margin_usd: ZERO
	}
});

const assetOf = async ({ chain, symbol }: Pick<Asset, 'chain' | 'symbol'>): Promise<Asset> => {
	const asset = await getAssetBySymbol({ chain, symbol });

	if (isNullish(asset)) {
		throw new Error(`asset ${chain}:${symbol} not seeded`);
	}

	return asset;
};

const deletedAtMs = async (userId: string): Promise<string | undefined> => {
	const rows = await query<{ deleted_at_ms: string | null }>(
		`select deleted_at_ms::text from profiles where user_id = $1`,
		[userId]
	);

	return rows[0]?.deleted_at_ms ?? undefined;
};

const hasProfile = async (userId: string): Promise<boolean> => {
	const rows = await query<{ user_id: string }>(`select user_id from profiles where user_id = $1`, [
		userId
	]);

	return rows.length > 0;
};

const hardDeletedAt = async (userId: string): Promise<string | undefined> => {
	const rows = await query<{ hard_deleted_at: string | null }>(
		`select hard_deleted_at::text from users where id = $1`,
		[userId]
	);

	return rows[0]?.hard_deleted_at ?? undefined;
};

describe.if(dbAvailable)('account deletion with custody funds', () => {
	let restoreEngine: () => void = () => undefined;
	// The deposit watcher suite pages every account of a chain, so the custody
	// rows this suite leaves would land in its passes.
	const fundedUserIds: string[] = [];

	beforeAll(async () => {
		await ensureMigrated();
		restoreEngine = setEngineActorProvider(fakeEngineActorProvider);
	});

	afterAll(async () => {
		restoreEngine();
		await query(`delete from withdrawals where user_id = any($1::uuid[])`, [fundedUserIds]);
		await query(
			`delete from ledger_entries where event_key in (
				select e.event_key from ledger_entries e
				join custody_accounts c on c.id = e.account_id
				where c.user_id = any($1::uuid[]))`,
			[fundedUserIds]
		);
		await query(`delete from custody_accounts where user_id = any($1::uuid[])`, [fundedUserIds]);
	});

	/** Credits `amount` of `asset` to the user's book, the way a deposit lands. */
	const fundBook = async ({
		userId,
		asset,
		amount
	}: {
		userId: string;
		asset: Asset;
		amount: bigint;
	}): Promise<void> => {
		fundedUserIds.push(userId);

		const account = await ensureUserAccount({ userId, chain: asset.chain, address: `p-${userId}` });
		const external = await ensureInternalAccount({
			kind: 'external',
			chain: asset.chain,
			address: 'external'
		});

		await postLedgerEvent({
			eventKey: `test:deletion-custody-fund:${userId}:${asset.id}`,
			kind: 'deposit',
			legs: [
				{ accountId: account.id, assetId: asset.id, delta: amount.toString() },
				{ accountId: external.id, assetId: asset.id, delta: (-amount).toString() }
			]
		});
	};

	/** Runs `run` with clearing answering every account-state read with
	 * `getAccountState`, then puts the suite's fake engine back. */
	const withClearing = async (
		getAccountState: () => Promise<ClearingDid.GetAccountStateResult>,
		run: () => Promise<void>
	): Promise<void> => {
		setEngineActorProvider({
			...fakeEngineActorProvider,
			clearing: () =>
				Promise.resolve({ get_account_state: getAccountState } as unknown as ClearingService)
		});

		try {
			await run();
		} finally {
			restoreEngine = setEngineActorProvider(fakeEngineActorProvider);
		}
	};

	const expireDeletion = async (userId: string): Promise<void> => {
		await deleteMyAccount({ userId, reason: 'other', note: '' });
		await query(`update profiles set deleted_at_ms = $2 where user_id = $1`, [
			userId,
			Date.now() - ACCOUNT_RECOVERY_WINDOW_MS - 1000
		]);
	};

	test('a book balance refuses the delete before any league resolution applies', async () => {
		const { userId: owner } = await createTestProfile();
		const { userId: member } = await createTestProfile();
		const league = await createLeague({
			id: `lg-${crypto.randomUUID().slice(0, 12)}`,
			name: 'Funded League',
			ownerUserId: owner
		});

		await joinLeagueByInvite({ inviteCode: league.inviteCode, userId: member });
		await fundBook({
			userId: owner,
			asset: await assetOf({ chain: 'sol', symbol: 'SOL' }),
			amount: BigInt(5_000)
		});

		const result = await deleteMyAccount({
			userId: owner,
			reason: 'other',
			note: '',
			leagueResolutions: [{ leagueId: league.id, action: 'delete' }]
		});

		expect(result).toEqual(REFUSED);
		expect(await deletedAtMs(owner)).toBeUndefined();

		const leagues = await query<{ id: string }>(`select id from leagues where id = $1`, [
			league.id
		]);

		expect(leagues).toHaveLength(1);
	});

	test('a withdrawal in flight refuses the delete; once it settles the delete goes through', async () => {
		const { userId } = await createTestProfile();
		const asset = await assetOf({ chain: 'btc', symbol: 'BTC' });
		const amount = BigInt(7_000);

		await fundBook({ userId, asset, amount });

		const withdrawal = await requestWithdrawal({
			userId,
			asset,
			amount,
			fee: ZERO,
			destination: `dest-${userId}`,
			selfCustody: false,
			userAddress: `p-${userId}`
		});

		// The hold took the whole balance: only the withdrawal itself is left.
		expect(await deleteMyAccount({ userId, reason: 'other', note: '' })).toEqual(REFUSED);

		await query(`update withdrawals set state = 'submitted' where id = $1`, [withdrawal.id]);
		await transitionWithdrawal({ id: withdrawal.id, from: 'submitted', to: 'confirmed' });

		expect(await deleteMyAccount({ userId, reason: 'other', note: '' })).toEqual({
			ok: true,
			softDeleted: true
		});
	});

	test('a live ckUSDC balance at the custodial principal refuses the delete; VXP does not', async () => {
		const ckUsdc = await assetOf({ chain: 'ic', symbol: 'ckUSDC' });
		const { userId: vxpHolder } = await createTestProfile();
		const { userId: holder } = await createTestProfile();

		fundFakeAccount({
			owner: Principal.fromText(userIcPrincipalText(vxpHolder)),
			amount: BigInt(1_000_000)
		});
		// Never opened the wallet, so no custody account: the funds still count.
		fundFakeAccount({
			owner: Principal.fromText(userIcPrincipalText(holder)),
			amount: BigInt(250_000),
			ledger: ckUsdc.ledger_ref ?? ''
		});

		expect(await deleteMyAccount({ userId: vxpHolder, reason: 'other', note: '' })).toEqual({
			ok: true,
			softDeleted: true
		});
		expect(await deleteMyAccount({ userId: holder, reason: 'other', note: '' })).toEqual(REFUSED);
		expect(await deletedAtMs(holder)).toBeUndefined();
	});

	test('the delete route answers the refusal code the app maps to its message', async () => {
		const { userId } = await createTestProfile();

		await fundBook({
			userId,
			asset: await assetOf({ chain: 'sol', symbol: 'SOL' }),
			amount: BigInt(1)
		});

		const res = await app.handle(
			new Request('http://localhost/api/v1/account/delete', {
				method: 'POST',
				headers: {
					cookie: `vici_session=${await createSession(userId)}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify({ reason: 'other' })
			})
		);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual(REFUSED);
	});

	/** Deletes a fresh account while clearing answers `state`. */
	const deleteWhileClearingHolds = async (
		state: ClearingDid.GetAccountStateResult
	): Promise<DeleteMyAccountResult> => {
		const { userId } = await createTestProfile();
		let result: DeleteMyAccountResult = { ok: false };

		await withClearing(
			() => Promise.resolve(state),
			async () => {
				result = await deleteMyAccount({ userId, reason: 'other', note: '' });
			}
		);

		return result;
	};

	test('collateral in the Settlement domain refuses the delete; VXP and Playground collateral do not', async () => {
		expect(
			await deleteWhileClearingHolds(
				accountStateHolding({
					balances: [
						[{ ViciXp: null }, [['VXP', BigInt(9_000)]]],
						[{ Playground: null }, [['TESTICP', BigInt(5_000)]]]
					]
				})
			)
		).toEqual({ ok: true, softDeleted: true });

		expect(
			await deleteWhileClearingHolds(
				accountStateHolding({ balances: [[{ Settlement: null }, [['ckUSDC', BigInt(1)]]]] })
			)
		).toEqual(REFUSED);
	});

	test('a positive Settlement cash balance refuses the delete; a debt or Playground cash does not', async () => {
		expect(
			await deleteWhileClearingHolds(
				accountStateHolding({
					cash: [
						[{ Settlement: null }, BigInt(-40)],
						[{ Playground: null }, BigInt(700)]
					]
				})
			)
		).toEqual({ ok: true, softDeleted: true });

		expect(
			await deleteWhileClearingHolds(
				accountStateHolding({ cash: [[{ Settlement: null }, BigInt(1)]] })
			)
		).toEqual(REFUSED);
	});

	test('collateral clearing cannot report refuses the delete', async () => {
		const { userId } = await createTestProfile();
		const errors = spyOn(logger, 'error').mockImplementation(() => undefined);

		try {
			await withClearing(
				() => Promise.reject(new Error('clearing unreachable')),
				async () => {
					expect(await deleteMyAccount({ userId, reason: 'other', note: '' })).toEqual(REFUSED);
				}
			);
		} finally {
			errors.mockRestore();
		}

		expect(await deletedAtMs(userId)).toBeUndefined();
	});

	test('the sweep leaves an expired account that still holds funds in place', async () => {
		const { userId: holder } = await createTestProfile();
		const { userId: empty } = await createTestProfile();

		for (const userId of [holder, empty]) {
			await expireDeletion(userId);
		}

		// Funds that landed during the recovery window, after the delete passed.
		await fundBook({
			userId: holder,
			asset: await assetOf({ chain: 'sol', symbol: 'SOL' }),
			amount: BigInt(3)
		});

		const warnings = spyOn(logger, 'warn').mockImplementation(() => undefined);

		try {
			await sweepExpiredDeletions();

			expect(warnings.mock.calls.some(([line]) => String(line).includes(holder))).toBeTrue();
		} finally {
			warnings.mockRestore();
		}

		expect(await hasProfile(holder)).toBeTrue();
		expect(await hardDeletedAt(holder)).toBeUndefined();
		expect(await hasProfile(empty)).toBeFalse();
		expect(await hardDeletedAt(empty)).toBeDefined();
	});

	test('a late recovery restores an account that still holds funds and purges one that does not', async () => {
		const { userId: holder } = await createTestProfile();
		const { userId: empty } = await createTestProfile();

		for (const userId of [holder, empty]) {
			await expireDeletion(userId);
		}

		await fundBook({
			userId: holder,
			asset: await assetOf({ chain: 'sol', symbol: 'SOL' }),
			amount: BigInt(4)
		});

		expect(await recoverMyAccount(holder)).toEqual({ ok: true, recovered: true });
		expect(await deletedAtMs(holder)).toBeUndefined();
		expect(await hardDeletedAt(holder)).toBeUndefined();

		expect(await recoverMyAccount(empty)).toEqual({ ok: false, reason: 'expired' });
		expect(await hasProfile(empty)).toBeFalse();
		expect(await hardDeletedAt(empty)).toBeDefined();
	});
});
