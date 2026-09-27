// Treasury switch-on safety: once record-only mode is off, a live award is
// paid exactly once (grant, reconcile sweeps and a crash replay included),
// an award imported from the legacy app is never paid whatever status it
// arrived with, a dry treasury defers instead of failing for good, and the
// origin backfill of migration 0012 tells imported rows from live ones.

import { isNullish, nonNullish } from '@dfinity/utils';
import { IcrcTransferError } from '@icp-sdk/canisters/ledger/icrc';
import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExportedDoc } from '../scripts/etl/lib';
import { importDocs } from '../scripts/etl/transforms';
import { createSession } from '../src/auth/sessions';
import { query } from '../src/db/client';
import { app } from '../src/index';
import { treasuryIcPrincipalText, userIcPrincipalText } from '../src/lib/keys';
import {
	getTreasuryBacklog,
	grantAward,
	listUserAwards,
	MAX_TRANSFER_ATTEMPTS,
	PROCESSING_STALE_MS,
	reconcileUnpaidAwards,
	setVxpTreasuryDisabled
} from '../src/vxp/awards';
import { parseVxp } from '../src/vxp/constants';
import { encodeTransferMemo, MAX_TRANSFER_MEMO_BYTES } from '../src/vxp/payout';
import { createTestUser, ensureMigrated, uniquePrincipal } from './helpers/auth';
import { readAwardRow, stubVxpLedger, type LedgerStub } from './helpers/vxp';

let stub: LedgerStub | undefined;
let restoreMode: (() => void) | undefined;

beforeAll(async () => {
	await ensureMigrated();
});

afterEach(() => {
	stub?.restore();
	stub = undefined;
	restoreMode?.();
	restoreMode = undefined;
});

const legacyDoc = ({ key, data }: { key: string; data: unknown }): ExportedDoc => ({
	key,
	data,
	createdAtNs: '1700000000000000000',
	updatedAtNs: '1710000000000000000'
});

const userIdForPrincipal = async (principal: string): Promise<string> => {
	const rows = await query<{ user_id: string }>(
		`select user_id from legacy_principals where principal = $1`,
		[principal]
	);
	const userId = rows[0]?.user_id;

	if (isNullish(userId)) {
		throw new Error(`no user for ${principal}`);
	}

	return userId;
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

describe('imported awards are never paid', () => {
	test('legacy pending, owed and processing states import as etl and every sweep skips them', async () => {
		const recipient = uniquePrincipal();
		const referrer = uniquePrincipal();

		await importDocs({
			collection: 'vxp_awards',
			docs: [
				legacyDoc({
					key: `${recipient}/achievement/oracle`,
					data: {
						recipient,
						awardType: 'achievement',
						awardKey: 'oracle',
						amountBaseUnits: parseVxp(500).toString(),
						status: 'pending',
						earnedAtMs: 1716000000000
					}
				}),
				legacyDoc({
					key: `${recipient}/streak/streak_3`,
					data: {
						recipient,
						awardType: 'streak',
						awardKey: 'streak_3',
						amountBaseUnits: parseVxp(50).toString(),
						status: 'paid',
						earnedAtMs: 1716000000000,
						paidAtMs: 1716000001000,
						blockIndex: '12'
					}
				})
			]
		});
		await importDocs({
			collection: 'vxp_onboarding',
			docs: [
				legacyDoc({
					key: recipient,
					data: {
						version: 1,
						tradeCount: 1,
						milestones: {
							m1: { status: 'processing', amountBaseUnits: parseVxp(1500).toString() },
							m2: { status: 'owed', amountBaseUnits: parseVxp(4000).toString() },
							m3: { status: 'none', amountBaseUnits: '0' }
						}
					}
				})
			]
		});
		await importDocs({
			collection: 'referrals',
			docs: [
				legacyDoc({
					key: recipient,
					data: {
						version: 1,
						referrer,
						code: 'ABCD2345',
						redeemedAtMs: 1718000000000,
						withinReferrerCap: true,
						refereePayout: { status: 'owed', amountBaseUnits: parseVxp(500).toString() },
						referrerPayout: { status: 'owed', amountBaseUnits: parseVxp(500).toString() }
					}
				})
			]
		});

		const userId = await userIdForPrincipal(recipient);
		const referrerId = await userIdForPrincipal(referrer);
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
		const recipient = uniquePrincipal();

		await importDocs({
			collection: 'vxp_onboarding',
			docs: [
				legacyDoc({
					key: recipient,
					data: {
						version: 1,
						tradeCount: 0,
						milestones: {
							m1: { status: 'owed', amountBaseUnits: parseVxp(1500).toString() },
							m2: { status: 'none', amountBaseUnits: '0' },
							m3: { status: 'none', amountBaseUnits: '0' }
						}
					}
				})
			]
		});

		const userId = await userIdForPrincipal(recipient);

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

	test('a pending live row that a legacy doc also covers is taken over by the import', async () => {
		const recipient = uniquePrincipal();

		// Map the principal first so the live grant and the import share a user.
		await importDocs({
			collection: 'vxp_awards',
			docs: [
				legacyDoc({
					key: `${recipient}/streak/streak_7`,
					data: {
						recipient,
						awardType: 'streak',
						awardKey: 'streak_7',
						amountBaseUnits: parseVxp(150).toString(),
						status: 'paid',
						earnedAtMs: 1716000000000,
						paidAtMs: 1716000001000,
						blockIndex: '5'
					}
				})
			]
		});

		const userId = await userIdForPrincipal(recipient);

		stub = stubVxpLedger();
		restoreMode = setVxpTreasuryDisabled(true);

		expect(
			(
				await grantAward({
					userId,
					awardType: 'flow_milestone',
					awardKey: '10',
					amountBaseUnits: parseVxp(50)
				})
			).outcome
		).toBe('recorded');

		await importDocs({
			collection: 'vxp_awards',
			docs: [
				legacyDoc({
					key: `${recipient}/flow_milestone/10`,
					data: {
						recipient,
						awardType: 'flow_milestone',
						awardKey: '10',
						amountBaseUnits: parseVxp(50).toString(),
						status: 'pending',
						earnedAtMs: 1716000000000
					}
				})
			]
		});

		restoreMode();
		restoreMode = setVxpTreasuryDisabled(false);
		await reconcileUntilIdle();

		const row = (await awardRows(userId)).find(({ award_type }) => award_type === 'flow_milestone');

		expect(row).toEqual({
			award_type: 'flow_milestone',
			award_key: '10',
			status: 'pending',
			origin: 'etl'
		});
		expect(stub.transfers.filter(({ memo }) => memo === 'vxp:flow_milestone:10')).toHaveLength(0);
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
		expect((await readAwardRow({ userId, awardType: 'onboarding', awardKey: 'm1' }))?.status).toBe(
			'paid'
		);
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

		const principal = uniquePrincipal();

		await importDocs({
			collection: 'vxp_awards',
			docs: [
				legacyDoc({
					key: `${principal}/comeback/restore`,
					data: {
						recipient: principal,
						awardType: 'comeback',
						awardKey: 'restore',
						amountBaseUnits: parseVxp(250).toString(),
						status: 'pending',
						earnedAtMs: 1716000000000
					}
				})
			]
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

describe('unconfirmed transfer recovery', () => {
	const HOUR_MS = 60 * 60_000;

	const stampAgoNs = (ms: number): bigint => (BigInt(Date.now()) - BigInt(ms)) * BigInt(1_000_000);

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

		const row = await readAwardRow({ userId, awardType: 'achievement', awardKey: 'history-found' });

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
		expect((await listUserAwards({ userId }))[0]?.status).toBe('processing');
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
		await query(`update vxp_awards set origin = 'live', transfer_memo = null where user_id = $1`, [
			userId
		]);

		await query(
			readFileSync(join(import.meta.dir, '../src/db/migrations/0012_vxp_award_origin.sql'), 'utf8')
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
