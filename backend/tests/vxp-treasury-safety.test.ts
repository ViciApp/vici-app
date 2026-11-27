// Treasury switch-on safety: once record-only mode is off, a live award is
// paid exactly once (grant, reconcile sweeps and a crash replay included),
// an award imported from the legacy app is never paid whatever status it
// arrived with, a dry treasury defers instead of failing for good, and the
// origin backfill of migration 0012 tells imported rows from live ones.

import { nonNullish } from '@dfinity/utils';
import { IcrcTransferError } from '@icp-sdk/canisters/ledger/icrc';
import { afterEach, beforeAll, describe, expect, setSystemTime, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSession } from '../src/auth/sessions';
import { encodeTransferMemo, MAX_TRANSFER_MEMO_BYTES } from '../src/chains/ic/icrc';
import { query } from '../src/db/client';
import { app } from '../src/index';
import { treasuryIcPrincipalText, userIcPrincipalText } from '../src/lib/keys';
import {
	getAward,
	getTreasuryBacklog,
	grantAward,
	MAX_TRANSFER_ATTEMPTS,
	PROCESSING_STALE_MS,
	reconcileUnpaidAwards,
	setVxpTreasuryDisabled,
	type GrantAwardOutcome
} from '../src/vxp/awards';
import { parseVxp } from '../src/vxp/constants';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';
import { readAwardRow, stubVxpLedger, type LedgerStub } from './helpers/vxp';

let stub: LedgerStub | undefined;
let restoreMode: (() => void) | undefined;

afterEach(() => {
	stub?.restore();
	stub = undefined;
	restoreMode?.();
	restoreMode = undefined;
});

/** An award row as the legacy import left it: origin 'etl', which this
 * backend never pays. */
const seedImportedAward = async ({
	userId,
	awardType,
	awardKey,
	amount,
	status = 'pending',
	paidAtMs,
	blockIndex
}: {
	userId: string;
	awardType: string;
	awardKey: string;
	amount: number;
	status?: 'pending' | 'paid';
	paidAtMs?: number;
	blockIndex?: string;
}): Promise<void> => {
	await query(
		`insert into vxp_awards (user_id, award_type, award_key, amount_base_units, status, earned_at_ms, paid_at_ms, block_index, origin)
		 values ($1, $2, $3, $4, $5, 1716000000000, $6, $7, 'etl')`,
		[
			userId,
			awardType,
			awardKey,
			parseVxp(amount).toString(),
			status,
			paidAtMs ?? null,
			blockIndex ?? null
		]
	);
};

const awardRows = async (
	userId: string
): Promise<Array<{ award_type: string; award_key: string; status: string; origin: string }>> =>
	await query(
		`select award_type, award_key, status, origin from vxp_awards
		 where user_id = $1 order by award_type, award_key`,
		[userId]
	);

const landedTo = (userId: string): number =>
	(stub?.landed ?? []).filter(({ owner }) => owner === userIcPrincipalText(userId)).length;

/** Sweeps until nothing is left, so assertions do not depend on how much
 * unrelated backlog other suites left in the shared database. */
const reconcileUntilIdle = async (): Promise<void> => {
	for (let pass = 0; pass < 50; pass++) {
		if ((await reconcileUnpaidAwards({ graceMs: 0, limit: 500 })).scanned === 0) {
			return;
		}
	}
};

describe('transfer memo', () => {
	test('a memo within the ledger limit passes through verbatim', () => {
		expect(new TextDecoder().decode(encodeTransferMemo('vxp:new-user:m1'))).toBe('vxp:new-user:m1');
	});

	test('an over-long memo is capped deterministically, keeping a readable head', () => {
		const memo = 'vxp:league_founder:8f14e45f-ceea-467a-9575-2e2c1c5f8e1a';
		const encoded = encodeTransferMemo(memo);

		expect(encoded.length).toBe(MAX_TRANSFER_MEMO_BYTES);
		expect(new TextDecoder().decode(encoded).startsWith('vxp:league_founder')).toBe(true);
		expect(encodeTransferMemo(memo)).toEqual(encoded);
		expect(encodeTransferMemo(`${memo}0`)).not.toEqual(encoded);
	});
});

describe.if(dbAvailable)('treasury safety', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	describe('imported awards are never paid', () => {
		test('imported pending, paid and processing rows are skipped by every sweep', async () => {
			const userId = await createTestUser();
			const referrerId = await createTestUser();

			await seedImportedAward({
				userId,
				awardType: 'achievement',
				awardKey: 'oracle',
				amount: 500
			});
			await seedImportedAward({
				userId,
				awardType: 'streak',
				awardKey: 'streak_3',
				amount: 50,
				status: 'paid',
				paidAtMs: 1716000001000,
				blockIndex: '12'
			});
			await seedImportedAward({ userId, awardType: 'onboarding', awardKey: 'm1', amount: 1500 });
			await seedImportedAward({ userId, awardType: 'onboarding', awardKey: 'm2', amount: 4000 });
			await seedImportedAward({ userId, awardType: 'referral', awardKey: userId, amount: 500 });
			await seedImportedAward({
				userId: referrerId,
				awardType: 'referral',
				awardKey: userId,
				amount: 500
			});

			const imported = [...(await awardRows(userId)), ...(await awardRows(referrerId))];

			expect(imported.length).toBe(6);
			expect(imported.every(({ origin }) => origin === 'etl')).toBe(true);

			// A legacy claim left processing long ago must not look like a stale
			// claim of ours either.
			await query(
				`update vxp_awards set status = 'processing',
				   processing_at = now() - make_interval(secs => $2::double precision / 1000)
				 where user_id = $1 and award_type = 'onboarding' and award_key = 'm1'`,
				[userId, PROCESSING_STALE_MS + 60_000]
			);

			stub = stubVxpLedger();
			restoreMode = setVxpTreasuryDisabled(false);

			await reconcileUntilIdle();

			expect(landedTo(userId)).toBe(0);
			expect(landedTo(referrerId)).toBe(0);
			expect([...(await awardRows(userId)), ...(await awardRows(referrerId))]).toEqual(
				imported.map((row) =>
					row.award_type === 'onboarding' && row.award_key === 'm1'
						? { ...row, status: 'processing' }
						: row
				)
			);
		});

		test('a live trigger for an imported award collides instead of paying again', async () => {
			const userId = await createTestUser();

			await seedImportedAward({ userId, awardType: 'onboarding', awardKey: 'm1', amount: 1500 });

			stub = stubVxpLedger();
			restoreMode = setVxpTreasuryDisabled(false);

			const outcome = await grantAward({
				userId,
				awardType: 'onboarding',
				awardKey: 'm1',
				amountBaseUnits: parseVxp(1500),
				memo: 'vxp:new-user:m1'
			});

			expect(outcome.outcome).toBe('already');
			expect(stub.transfers).toHaveLength(0);
		});
	});

	describe('live awards are paid exactly once', () => {
		test('a fresh grant with the treasury on pays once; later sweeps leave it alone', async () => {
			stub = stubVxpLedger();
			restoreMode = setVxpTreasuryDisabled(false);
			const userId = await createTestUser();

			const outcome = await grantAward({
				userId,
				awardType: 'onboarding',
				awardKey: 'm1',
				amountBaseUnits: parseVxp(1500),
				memo: 'vxp:new-user:m1'
			});

			expect(outcome.outcome).toBe('paid');

			await reconcileUntilIdle();
			await reconcileUntilIdle();

			expect(landedTo(userId)).toBe(1);
			expect(stub.landed.find((t) => t.owner === userIcPrincipalText(userId))?.amount).toBe(
				parseVxp(1500)
			);
			expect(
				(await readAwardRow({ userId, awardType: 'onboarding', awardKey: 'm1' }))?.status
			).toBe('paid');
		});

		test('a recorded award pays once when record-only mode is switched off', async () => {
			stub = stubVxpLedger();
			restoreMode = setVxpTreasuryDisabled(true);
			const userId = await createTestUser();

			await grantAward({
				userId,
				awardType: 'onboarding',
				awardKey: 'm1',
				amountBaseUnits: parseVxp(1500),
				memo: 'vxp:new-user:m1'
			});

			restoreMode();
			restoreMode = setVxpTreasuryDisabled(false);

			await reconcileUntilIdle();

			const paid = stub.landed.filter((t) => t.owner === userIcPrincipalText(userId));

			expect(paid).toHaveLength(1);
			// The memo fixed at the grant survives into the reconciler's transfer.
			expect(paid[0]?.memo).toBe('vxp:new-user:m1');
		});

		test('a crash after the transfer landed replays as Duplicate, never a second payment', async () => {
			stub = stubVxpLedger();
			restoreMode = setVxpTreasuryDisabled(false);
			const userId = await createTestUser();

			const first = await grantAward({
				userId,
				awardType: 'achievement',
				awardKey: 'marathon',
				amountBaseUnits: parseVxp(800)
			});

			expect(first.outcome).toBe('paid');

			const blockIndex = first.outcome === 'paid' ? first.blockIndex : '';

			// The process died after the ledger moved the funds but before the
			// row was marked paid: it is left processing with a stale claim.
			await query(
				`update vxp_awards
				 set status = 'processing', paid_at_ms = null, block_index = null,
				     processing_at = now() - make_interval(secs => $2::double precision / 1000)
				 where user_id = $1 and award_type = 'achievement' and award_key = 'marathon'`,
				[userId, PROCESSING_STALE_MS + 60_000]
			);

			await reconcileUnpaidAwards({ graceMs: 0, limit: 500 });

			const memo = 'vxp:achievement:marathon';

			// Two attempts reached the ledger, one moved funds.
			expect(stub.transfers.filter((t) => t.memo === memo)).toHaveLength(2);
			expect(landedTo(userId)).toBe(1);

			const row = await readAwardRow({ userId, awardType: 'achievement', awardKey: 'marathon' });

			expect(row?.status).toBe('paid');
			expect(row?.block_index).toBe(blockIndex);
		});
	});

	describe("a Duplicate naming another award's transfer never pays", () => {
		// Rows stored before memos carried the award key share one memo, so two
		// of them with the same amount and stamp are one identical transfer.
		const SHARED_MEMO = 'vxp:referral:referrer';

		afterEach(() => {
			setSystemTime();
		});

		const grantShared = async ({
			userId,
			awardKey
		}: {
			userId: string;
			awardKey: string;
		}): Promise<GrantAwardOutcome> =>
			await grantAward({
				userId,
				awardType: 'referral',
				awardKey,
				amountBaseUnits: parseVxp(500),
				memo: SHARED_MEMO
			});

		const stampOf = async (
			userId: string,
			awardKey: string
		): Promise<string | null | undefined> => {
			const rows = await query<{ transfer_created_at_ns: string | null }>(
				`select transfer_created_at_ns::text from vxp_awards
				 where user_id = $1 and award_type = 'referral' and award_key = $2`,
				[userId, awardKey]
			);

			return rows[0]?.transfer_created_at_ns;
		};

		/** Records an award without sending it, as record-only mode does. */
		const recordShared = async ({
			userId,
			awardKey
		}: {
			userId: string;
			awardKey: string;
		}): Promise<void> => {
			const restoreRecordOnly = setVxpTreasuryDisabled(true);

			try {
				await grantShared({ userId, awardKey });
			} finally {
				restoreRecordOnly();
			}
		};

		const expectBothPaidApart = async (userId: string, keys: string[]): Promise<void> => {
			expect(landedTo(userId)).toBe(2);

			const blocks: (string | null | undefined)[] = [];

			for (const awardKey of keys) {
				const row = await readAwardRow({ userId, awardType: 'referral', awardKey });

				expect(row?.status).toBe('paid');

				blocks.push(row?.block_index);
			}

			expect(new Set(blocks).size).toBe(2);
		};

		test('a first send answered Duplicate goes back to pending and pays on the next sweep', async () => {
			stub = stubVxpLedger();
			restoreMode = setVxpTreasuryDisabled(false);
			const userId = await createTestUser();

			setSystemTime(new Date(Date.now()));

			expect((await grantShared({ userId, awardKey: 'dup-first-a' })).outcome).toBe('paid');
			expect((await grantShared({ userId, awardKey: 'dup-first-b' })).outcome).toBe('recorded');

			const reopened = await readAwardRow({
				userId,
				awardType: 'referral',
				awardKey: 'dup-first-b'
			});

			expect(reopened?.status).toBe('pending');
			expect(reopened?.block_index).toBeNull();
			expect(await stampOf(userId, 'dup-first-b')).toBeNull();
			expect(landedTo(userId)).toBe(1);

			setSystemTime();
			await reconcileUntilIdle();

			await expectBothPaidApart(userId, ['dup-first-a', 'dup-first-b']);
		});

		test('a replay answered with a block another award holds is sent fresh, not marked paid', async () => {
			stub = stubVxpLedger();
			restoreMode = setVxpTreasuryDisabled(false);
			const userId = await createTestUser();

			expect((await grantShared({ userId, awardKey: 'dup-replay-a' })).outcome).toBe('paid');

			await recordShared({ userId, awardKey: 'dup-replay-b' });

			// A stale claim of the second award carrying the first one's stamp.
			await query(
				`update vxp_awards
				 set status = 'processing', transfer_created_at_ns = $2, transfer_attempts = 1,
				     processing_at = now() - make_interval(secs => $3::double precision / 1000)
				 where user_id = $1 and award_type = 'referral' and award_key = 'dup-replay-b'`,
				[userId, await stampOf(userId, 'dup-replay-a'), PROCESSING_STALE_MS + 60_000]
			);

			await reconcileUntilIdle();

			await expectBothPaidApart(userId, ['dup-replay-a', 'dup-replay-b']);
		});

		test('a ledger check matching a block another award holds reissues instead of paying', async () => {
			stub = stubVxpLedger();
			restoreMode = setVxpTreasuryDisabled(false);
			const userId = await createTestUser();

			expect((await grantShared({ userId, awardKey: 'dup-check-a' })).outcome).toBe('paid');

			await recordShared({ userId, awardKey: 'dup-check-b' });

			// Quarantined with the first award's stamp: its history lookup matches
			// the first award's block.
			await query(
				`update vxp_awards
				 set status = 'needs_ledger_check', transfer_created_at_ns = $2, transfer_attempts = 1,
				     processing_at = now() - make_interval(secs => $3::double precision / 1000)
				 where user_id = $1 and award_type = 'referral' and award_key = 'dup-check-b'`,
				[userId, await stampOf(userId, 'dup-check-a'), PROCESSING_STALE_MS + 60_000]
			);

			await reconcileUntilIdle();

			await expectBothPaidApart(userId, ['dup-check-a', 'dup-check-b']);
		});
	});

	describe('a dry treasury defers instead of failing', () => {
		const insufficient = (): Promise<bigint> =>
			Promise.reject(
				new IcrcTransferError({
					msg: 'insufficient',
					errorType: { InsufficientFunds: { balance: BigInt(0) } }
				})
			);

		test('the award goes back to pending and pays once funds land', async () => {
			stub = stubVxpLedger({ transferImpl: insufficient });
			restoreMode = setVxpTreasuryDisabled(false);
			const userId = await createTestUser();

			const outcome = await grantAward({
				userId,
				awardType: 'comeback',
				awardKey: 'restore',
				amountBaseUnits: parseVxp(250)
			});

			expect(outcome.outcome).toBe('recorded');

			const deferred = await readAwardRow({ userId, awardType: 'comeback', awardKey: 'restore' });

			expect(deferred?.status).toBe('pending');
			expect(deferred?.error_message).toContain('InsufficientFunds');

			stub.restore();
			stub = stubVxpLedger();

			await reconcileUntilIdle();

			expect(landedTo(userId)).toBe(1);
			expect(
				(await readAwardRow({ userId, awardType: 'comeback', awardKey: 'restore' }))?.status
			).toBe('paid');
		});

		test('the sweep stops at the first deferral', async () => {
			stub = stubVxpLedger({ transferImpl: insufficient });
			restoreMode = setVxpTreasuryDisabled(true);
			const userId = await createTestUser();

			for (const key of ['2026-09-01', '2026-09-02', '2026-09-03']) {
				await grantAward({
					userId,
					awardType: 'flow_overtime',
					awardKey: key,
					amountBaseUnits: parseVxp(25)
				});
			}

			restoreMode();
			restoreMode = setVxpTreasuryDisabled(false);

			const report = await reconcileUnpaidAwards({ graceMs: 0, limit: 500 });

			expect(report.deferred).toBe(1);
			expect(stub.transfers).toHaveLength(1);
		});
	});

	describe('treasury backlog', () => {
		test('counts live owed awards and imported unsettled ones apart', async () => {
			stub = stubVxpLedger();
			restoreMode = setVxpTreasuryDisabled(true);
			const before = await getTreasuryBacklog();
			const userId = await createTestUser();

			await grantAward({
				userId,
				awardType: 'streak',
				awardKey: 'streak_30',
				amountBaseUnits: parseVxp(1000)
			});

			await seedImportedAward({
				userId: await createTestUser(),
				awardType: 'comeback',
				awardKey: 'restore',
				amount: 250
			});

			const after = await getTreasuryBacklog();

			expect(after.pendingCount - before.pendingCount).toBe(1);
			expect(BigInt(after.pendingBaseUnits) - BigInt(before.pendingBaseUnits)).toBe(parseVxp(1000));
			expect(after.importedUnsettledCount - before.importedUnsettledCount).toBe(1);
		});
	});

	describe('admin treasury status', () => {
		const getTreasury = async (userId: string): Promise<Response> =>
			await app.handle(
				new Request('http://localhost/api/v1/vxp/admin/treasury', {
					headers: { cookie: `vici_session=${await createSession(userId)}` }
				})
			);

		test('an admin reads the treasury principal, balance and backlog', async () => {
			stub = stubVxpLedger({ balance: () => Promise.resolve(parseVxp(9000)) });
			restoreMode = setVxpTreasuryDisabled(true);

			const res = await getTreasury(await createTestUser('admin'));

			expect(res.status).toBe(200);

			const body = (await res.json()) as {
				principal: string;
				recordOnly: boolean;
				balanceBaseUnits: string;
				backlog: { pendingCount: number };
			};

			expect(body.principal).toBe(treasuryIcPrincipalText());
			expect(body.recordOnly).toBe(true);
			expect(body.balanceBaseUnits).toBe(parseVxp(9000).toString());
			expect(typeof body.backlog.pendingCount).toBe('number');
		});

		test('is admin-only', async () => {
			expect((await getTreasury(await createTestUser())).status).toBe(403);
		});
	});

	describe('unconfirmed transfer recovery', () => {
		const HOUR_MS = 60 * 60_000;

		const stampAgoNs = (ms: number): bigint =>
			(BigInt(Date.now()) - BigInt(ms)) * BigInt(1_000_000);

		/** A live row left processing by a crashed claim, its last send long
		 * enough ago that no message carrying the stamp can still land. */
		const insertStaleClaim = async ({
			userId,
			awardKey,
			stampNs,
			status = 'processing',
			attempts = 1
		}: {
			userId: string;
			awardKey: string;
			stampNs: bigint;
			status?: string;
			attempts?: number;
		}): Promise<void> => {
			await query(
				`insert into vxp_awards (user_id, award_type, award_key, amount_base_units, status, earned_at_ms,
				   processing_at, transfer_memo, transfer_created_at_ns, transfer_attempts)
				 values ($1, 'achievement', $2, $3, $4, $5,
				   now() - make_interval(secs => $6::double precision / 1000), $7, $8, $9)`,
				[
					userId,
					awardKey,
					parseVxp(300).toString(),
					status,
					Date.now(),
					PROCESSING_STALE_MS + 60_000,
					`vxp:achievement:${awardKey}`,
					stampNs.toString(),
					attempts
				]
			);
		};

		const statusOf = async (userId: string, awardKey: string): Promise<string | undefined> =>
			(await readAwardRow({ userId, awardType: 'achievement', awardKey }))?.status;

		test('a replay past the dedup window that is in the history is marked paid, not sent again', async () => {
			stub = stubVxpLedger();
			restoreMode = setVxpTreasuryDisabled(false);
			const userId = await createTestUser();

			const first = await grantAward({
				userId,
				awardType: 'achievement',
				awardKey: 'history-found',
				amountBaseUnits: parseVxp(300)
			});
			const blockIndex = first.outcome === 'paid' ? first.blockIndex : '';

			// The payment landed, then the process died before recording it and
			// stayed down past the ledger's 24h dedup window.
			const oldStampNs = stampAgoNs(25 * HOUR_MS);
			const sent = stub.landed.find(({ memo }) => memo === 'vxp:achievement:history-found');

			if (nonNullish(sent)) {
				sent.createdAtTime = oldStampNs;
			}

			await query(
				`update vxp_awards
				 set status = 'processing', paid_at_ms = null, block_index = null,
				     transfer_created_at_ns = $2,
				     processing_at = now() - make_interval(secs => $3::double precision / 1000)
				 where user_id = $1 and award_key = 'history-found'`,
				[userId, oldStampNs.toString(), PROCESSING_STALE_MS + 60_000]
			);

			const report = await reconcileUnpaidAwards({ graceMs: 0, limit: 500 });

			expect(report.quarantined).toBeGreaterThanOrEqual(1);
			expect(
				stub.transfers.filter(({ memo }) => memo === 'vxp:achievement:history-found')
			).toHaveLength(1);
			expect(landedTo(userId)).toBe(1);

			const row = await readAwardRow({
				userId,
				awardType: 'achievement',
				awardKey: 'history-found'
			});

			expect(row?.status).toBe('paid');
			expect(row?.block_index).toBe(blockIndex);
		});

		test('a replay past the dedup window that the synced history lacks is sent fresh exactly once', async () => {
			stub = stubVxpLedger();
			restoreMode = setVxpTreasuryDisabled(false);
			const userId = await createTestUser();
			const oldStampNs = stampAgoNs(25 * HOUR_MS);

			await insertStaleClaim({ userId, awardKey: 'history-absent', stampNs: oldStampNs });

			await reconcileUntilIdle();

			const sends = stub.landed.filter(({ memo }) => memo === 'vxp:achievement:history-absent');

			expect(sends).toHaveLength(1);
			expect(sends[0]?.createdAtTime).not.toBe(oldStampNs);
			expect(await statusOf(userId, 'history-absent')).toBe('paid');
		});

		test('with the history not provably complete the row stays quarantined, nothing is sent', async () => {
			stub = stubVxpLedger({ historySynced: false });
			restoreMode = setVxpTreasuryDisabled(false);
			const userId = await createTestUser();

			await insertStaleClaim({
				userId,
				awardKey: 'history-unknown',
				stampNs: stampAgoNs(25 * HOUR_MS)
			});

			await reconcileUntilIdle();
			await reconcileUntilIdle();

			expect(landedTo(userId)).toBe(0);
			expect(
				stub.transfers.filter(({ memo }) => memo === 'vxp:achievement:history-unknown')
			).toHaveLength(0);
			expect(await statusOf(userId, 'history-unknown')).toBe('needs_ledger_check');
			expect((await getTreasuryBacklog()).needsLedgerCheckCount).toBeGreaterThanOrEqual(1);

			// Clients see it as still in flight.
			expect(
				(await getAward({ userId, awardType: 'achievement', awardKey: 'history-unknown' }))?.status
			).toBe('processing');
		});

		test('a replay answered TooOld is quarantined, never failed', async () => {
			stub = stubVxpLedger({
				transferImpl: () =>
					Promise.reject(new IcrcTransferError({ msg: 'too old', errorType: { TooOld: null } }))
			});
			restoreMode = setVxpTreasuryDisabled(false);
			const userId = await createTestUser();

			await insertStaleClaim({ userId, awardKey: 'replay-too-old', stampNs: stampAgoNs(HOUR_MS) });

			await reconcileUnpaidAwards({ graceMs: 0, limit: 500 });

			expect(await statusOf(userId, 'replay-too-old')).toBe('needs_ledger_check');
		});

		test('an ambiguous error on a first attempt is quarantined, never failed', async () => {
			stub = stubVxpLedger({
				transferImpl: () => Promise.reject(new Error('request timed out'))
			});
			restoreMode = setVxpTreasuryDisabled(false);
			const userId = await createTestUser();

			const outcome = await grantAward({
				userId,
				awardType: 'achievement',
				awardKey: 'first-ambiguous',
				amountBaseUnits: parseVxp(300)
			});

			expect(outcome.outcome).toBe('recorded');
			expect(await statusOf(userId, 'first-ambiguous')).toBe('needs_ledger_check');
		});

		test('a transfer proven absent after the attempt cap fails instead of looping', async () => {
			stub = stubVxpLedger();
			restoreMode = setVxpTreasuryDisabled(false);
			const userId = await createTestUser();

			await insertStaleClaim({
				userId,
				awardKey: 'attempt-cap',
				stampNs: stampAgoNs(HOUR_MS),
				status: 'needs_ledger_check',
				attempts: MAX_TRANSFER_ATTEMPTS
			});

			await reconcileUntilIdle();

			expect(await statusOf(userId, 'attempt-cap')).toBe('failed');
			expect(landedTo(userId)).toBe(0);
		});
	});

	// Runs last: re-applying the migration marks every row in the shared test
	// database non-payable, exactly as it does in production.
	describe('migration 0012', () => {
		test('every row that exists when it runs is non-payable; pre-migration pending and processing rows are never paid', async () => {
			const userId = await createTestUser();

			stub = stubVxpLedger();
			restoreMode = setVxpTreasuryDisabled(true);

			// A record-only grant from before the migration, plus a processing
			// row an older build sent without created_at_time and never confirmed.
			await grantAward({
				userId,
				awardType: 'onboarding',
				awardKey: 'm1',
				amountBaseUnits: parseVxp(1500)
			});
			await query(
				`insert into vxp_awards (user_id, award_type, award_key, amount_base_units, status, earned_at_ms, processing_at)
				 values ($1, 'achievement', 'pre-migration-processing', 10000, 'processing', $2,
				   now() - make_interval(secs => $3::double precision / 1000))`,
				[userId, Date.now(), PROCESSING_STALE_MS + 60_000]
			);
			await query(
				`update vxp_awards set origin = 'live', transfer_memo = null where user_id = $1`,
				[userId]
			);

			await query(
				readFileSync(
					join(import.meta.dir, '../src/db/migrations/0012_vxp_award_origin.sql'),
					'utf8'
				)
			);

			expect(
				(await awardRows(userId)).map(({ award_key, status, origin }) => ({
					award_key,
					status,
					origin
				}))
			).toEqual([
				{ award_key: 'pre-migration-processing', status: 'processing', origin: 'etl' },
				{ award_key: 'm1', status: 'pending', origin: 'etl' }
			]);

			restoreMode();
			restoreMode = setVxpTreasuryDisabled(false);
			await reconcileUntilIdle();

			expect(landedTo(userId)).toBe(0);
			expect(stub.lookups()).toBe(0);
			expect((await awardRows(userId)).map(({ status }) => status)).toEqual([
				'processing',
				'pending'
			]);
		});
	});
});
