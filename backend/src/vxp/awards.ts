// The award ledger core every VXP economy trigger funnels through: one
// idempotent grant path (insert-pending, claim, transfer, mark paid/failed)
// plus the reconciliation that pays recorded-unpaid awards later. Idempotency
// is structural: the (user, award_type, award_key) unique index makes a
// duplicate trigger collide instead of double-crediting, so no
// timestamp-based dedupe is ever needed. Double-pay is prevented by a
// DB-level claim: a row must atomically move pending -> processing before its
// transfer fires, so exactly one runner ever holds it. Only rows this backend
// granted (origin 'live') can ever be claimed: rows imported from the legacy
// on-chain app, and every row that predates provenance tracking, are never
// paid here. A row whose transfer may have landed without being confirmed is
// quarantined (needs_ledger_check) and only leaves that state on the word of
// the ledger history, never by blindly sending again.

import { isNullish, nonNullish } from '@dfinity/utils';
import { captureServerEvents, type ServerEventInput } from '../analytics/events';
import { DEDUP_SAFE_WINDOW_MS } from '../chains/ic/icrc';
import { query, tx, type TxQuery } from '../db/client';
import { env } from '../env';
import { ZERO } from '../lib/constants';
import { logger } from '../lib/logger';
import { MINUTE_IN_MS, msToNs, nowNs, optionalMs } from '../lib/time';
import { vxpFromBaseUnits } from './constants';
import { findTreasuryTransferToUser, transferVxpToUser } from './payout';

export type VxpAwardType =
	| 'onboarding'
	| 'streak'
	| 'calibration'
	| 'referral'
	| 'worlds_podium'
	| 'tournament_prize'
	| 'achievement'
	| 'comeback'
	| 'flow_milestone'
	| 'flow_overtime'
	| 'league_founder';

export type VxpAwardStatus = 'pending' | 'processing' | 'paid' | 'failed';

/** Stored status: the public lifecycle plus the quarantine for a transfer
 * whose outcome is unknown. Clients see a quarantined award as processing:
 * it is still in flight from their point of view. */
type AwardRowStatus = VxpAwardStatus | 'needs_ledger_check';

/**
 * How long a claimed (processing) row stays off-limits before the
 * reconciler may reclaim it. A crash between claim and paid must not strand
 * the award forever, so stale claims reopen; 10 minutes is far above any
 * ICRC transfer round-trip (seconds), so a live transfer is never
 * double-claimed, while still bounding how long a crashed run delays a
 * payout.
 */
export const PROCESSING_STALE_MS = 10 * MINUTE_IN_MS;

/** Sends per award before one the history proves never landed is given up
 * as failed, so a deterministic rejection cannot loop forever. */
export const MAX_TRANSFER_ATTEMPTS = 3;

export interface VxpAward {
	id: string;
	userId: string;
	awardType: VxpAwardType;
	awardKey: string;
	amountBaseUnits: string;
	status: VxpAwardStatus;
	earnedAtMs: number;
	paidAtMs?: number;
	blockIndex?: string;
	errorMessage?: string;
}

interface VxpAwardRow {
	id: string;
	user_id: string;
	award_type: VxpAwardType;
	award_key: string;
	amount_base_units: string;
	status: AwardRowStatus;
	earned_at_ms: string;
	paid_at_ms: string | null;
	block_index: string | null;
	error_message: string | null;
}

const AWARD_COLUMNS = `id, user_id, award_type, award_key, amount_base_units, status,
	earned_at_ms::text, paid_at_ms::text, block_index, error_message`;

const shapeAward = (row: VxpAwardRow): VxpAward => ({
	id: row.id,
	userId: row.user_id,
	awardType: row.award_type,
	awardKey: row.award_key,
	amountBaseUnits: row.amount_base_units,
	status: row.status === 'needs_ledger_check' ? 'processing' : row.status,
	earnedAtMs: Number(row.earned_at_ms),
	paidAtMs: optionalMs(row.paid_at_ms),
	blockIndex: row.block_index ?? undefined,
	errorMessage: row.error_message ?? undefined
});

// Record-only mode: the env value is the source of truth; the override is a
// test seam so suites can exercise both modes in one process.
let treasuryDisabledOverride: boolean | undefined;

export const isVxpTreasuryDisabled = (): boolean =>
	treasuryDisabledOverride ?? env.vxpTreasuryDisabled;

export const setVxpTreasuryDisabled = (value: boolean | undefined): (() => void) => {
	const previous = treasuryDisabledOverride;

	treasuryDisabledOverride = value;

	return () => {
		treasuryDisabledOverride = previous;
	};
};

/**
 * Behavioural events on the pending-to-paid transition, mirroring the
 * satellite bridge: vxp_awarded (value = whole-VXP amount, label = award
 * type) exactly once per award, plus streak_milestone for streak awards
 * (step = the crossed day count from the award key). Best-effort: analytics
 * must never break a payout.
 */
const captureAwardPaid = async ({
	userId,
	awardType,
	awardKey,
	amountBaseUnits
}: {
	userId: string;
	awardType: VxpAwardType;
	awardKey: string;
	amountBaseUnits: bigint;
}): Promise<void> => {
	try {
		const events: ServerEventInput[] = [
			{
				name: 'vxp_awarded',
				userId,
				props: { value: vxpFromBaseUnits(amountBaseUnits), label: awardType }
			}
		];

		if (awardType === 'streak') {
			const days = Number(awardKey.replace('streak_', ''));

			if (Number.isFinite(days) && days > 0) {
				events.push({ name: 'streak_milestone', userId, props: { step: days } });
			}
		}

		await captureServerEvents({ events });
	} catch (err) {
		logger.error('vxp award analytics capture failed:', err);
	}
};

const dedupCutoffNs = (): bigint => nowNs() - msToNs(DEDUP_SAFE_WINDOW_MS);

/** paid transition from a given status, emitting the analytics exactly once
 * (the conditional update is the guard). */
const markAwardPaid = async ({
	id,
	fromStatus,
	userId,
	awardType,
	awardKey,
	amountBaseUnits,
	blockIndex
}: {
	id: string;
	fromStatus: AwardRowStatus;
	userId: string;
	awardType: VxpAwardType;
	awardKey: string;
	amountBaseUnits: bigint;
	blockIndex: string;
}): Promise<void> => {
	const updated = await query<{ id: string }>(
		`update vxp_awards
		 set status = 'paid', paid_at_ms = $3, block_index = $4, error_message = null
		 where id = $1 and status = $2
		 returning id`,
		[id, fromStatus, Date.now(), blockIndex]
	);

	if (nonNullish(updated[0])) {
		await captureAwardPaid({ userId, awardType, awardKey, amountBaseUnits });
	}
};

/**
 * Whether another award of the same recipient already holds a block. The
 * ledger keeps one block per identical transfer, so a Duplicate or history
 * match pointing at a block another award holds proves this award's own
 * sends moved nothing: the two transfers were identical (same stamp, memo
 * and amount) and the ledger deduplicated one into the other.
 */
const blockHeldByAnotherAward = async ({
	id,
	userId,
	blockIndex
}: {
	id: string;
	userId: string;
	blockIndex: string;
}): Promise<boolean> => {
	const rows = await query<{ id: string }>(
		`select id from vxp_awards where user_id = $1 and block_index = $2 and id <> $3 limit 1`,
		[userId, blockIndex, id]
	);

	return rows.length > 0;
};

/** Returns a claimed row to pending once the ledger proved nothing moved.
 * The stamp is cleared with the claim: no transfer carrying it belongs to
 * this award, and a fresh one keeps the retry inside the ledger's dedup
 * window. */
const reopenUnsentAward = async ({ id, error }: { id: string; error: string }): Promise<void> => {
	await query(
		`update vxp_awards
		 set status = 'pending', processing_at = null, transfer_created_at_ns = null,
		     error_message = $2
		 where id = $1 and status = 'processing'`,
		[id, error]
	);
};

interface SettleResult {
	paid: boolean;
	claimed: boolean;
	deferred?: boolean;
	/** Back to pending: the ledger answered Duplicate with another award's
	 * block, so nothing moved for this one. */
	reopened?: boolean;
	quarantined?: boolean;
	blockIndex?: string;
	error?: string;
}

/** Claim + transfer + settle one row; used by the grant path and the
 * reconciliation, so the transition behaviour cannot drift. The claim (an
 * atomic pending -> processing transition, with a timed reclaim of stale
 * processing rows) happens BEFORE the transfer, so a grant-path settle racing
 * the reconciler, or two reconcilers, resolves at the database: exactly one
 * runner holds the row when the transfer fires, the loser reports
 * claimed=false without transferring.
 *
 * The memo and created_at_time fixed by the first claim are replayed on a
 * reclaim, and a reclaim is only allowed while that stamp is inside
 * DEDUP_SAFE_WINDOW_MS, so if the earlier transfer landed the ledger answers
 * Duplicate and the row settles paid without a second payment. Outcomes:
 * - insufficient funds: nothing moved (the ledger checks duplicates first),
 *   so the row goes back to pending for the next pass;
 * - a Duplicate that cannot be this award's own transfer (answered to a
 *   first send, or naming a block another award holds): nothing moved
 *   either, so the row goes back to pending with its stamp cleared;
 * - a replay that is not answered with success or Duplicate, or any
 *   ambiguous error (the transfer may have executed): quarantined as
 *   needs_ledger_check, never failed, because only the ledger history can
 *   tell whether the award was paid;
 * - a ledger rejection of a first attempt: nothing moved, terminal failed. */
const settlePendingAward = async ({
	id,
	userId,
	awardType,
	awardKey,
	amountBaseUnits,
	memo
}: {
	id: string;
	userId: string;
	awardType: VxpAwardType;
	awardKey: string;
	amountBaseUnits: bigint;
	memo: string;
}): Promise<SettleResult> => {
	const stampNs = nowNs();
	const claimed = await query<{ transfer_memo: string; transfer_created_at_ns: string }>(
		`update vxp_awards
		 set status = 'processing', processing_at = now(),
		     transfer_memo = coalesce(transfer_memo, $3),
		     transfer_created_at_ns = coalesce(transfer_created_at_ns, $4),
		     transfer_attempts = transfer_attempts + 1
		 where id = $1
		   and origin = 'live'
		   and (status = 'pending'
		     or (status = 'processing'
		       and processing_at < now() - make_interval(secs => $2::double precision / 1000)
		       and transfer_created_at_ns > $5))
		 returning transfer_memo, transfer_created_at_ns::text`,
		[id, PROCESSING_STALE_MS, memo, stampNs.toString(), dedupCutoffNs().toString()]
	);
	const [claim] = claimed;

	if (isNullish(claim)) {
		return { paid: false, claimed: false };
	}

	const createdAtTimeNs = BigInt(claim.transfer_created_at_ns);
	// A stamp other than the one just offered was set by an earlier claim,
	// whose transfer may have landed.
	const replay = createdAtTimeNs !== stampNs;

	const result = await transferVxpToUser({
		userId,
		amount: amountBaseUnits,
		memo: claim.transfer_memo,
		createdAtTimeNs
	});

	// A first send with this stamp cannot match an earlier send of this award,
	// so a Duplicate there is another award's identical transfer.
	if (
		result.ok &&
		result.duplicate &&
		(!replay || (await blockHeldByAnotherAward({ id, userId, blockIndex: result.blockIndex })))
	) {
		const error = `Duplicate of block ${result.blockIndex}, another award's transfer`;

		await reopenUnsentAward({ id, error });

		logger.warn(`vxp award payout reopened (${awardType}/${awardKey} for ${userId}):`, error);

		return { paid: false, claimed: true, reopened: true, error };
	}

	if (result.ok) {
		await markAwardPaid({
			id,
			fromStatus: 'processing',
			userId,
			awardType,
			awardKey,
			amountBaseUnits,
			blockIndex: result.blockIndex
		});

		return { paid: true, claimed: true, blockIndex: result.blockIndex };
	}

	if (result.insufficientFunds) {
		await reopenUnsentAward({ id, error: result.error });

		logger.warn(
			`vxp award payout deferred (${awardType}/${awardKey} for ${userId}):`,
			result.error
		);

		return { paid: false, claimed: true, deferred: true, error: result.error };
	}

	if (replay || result.ambiguous) {
		await query(
			`update vxp_awards set status = 'needs_ledger_check', error_message = $2
			 where id = $1 and status = 'processing'`,
			[id, result.error]
		);

		logger.warn(
			`vxp award payout needs a ledger check (${awardType}/${awardKey} for ${userId}):`,
			result.error
		);

		return { paid: false, claimed: true, quarantined: true, error: result.error };
	}

	await query(
		`update vxp_awards set status = 'failed', error_message = $2
		 where id = $1 and status = 'processing'`,
		[id, result.error]
	);

	logger.error(`vxp award payout failed (${awardType}/${awardKey} for ${userId}):`, result.error);

	return { paid: false, claimed: true, error: result.error };
};

/** How many awards of one type the user holds, any status, optionally only
 * those created after sinceMs. The row's server-stamped created_at is the
 * window boundary because the caller cannot forge it, unlike any
 * client-supplied day key. */
const countUserAwards = async (
	{
		userId,
		awardType,
		sinceMs
	}: {
		userId: string;
		awardType: VxpAwardType;
		sinceMs?: number;
	},
	q: TxQuery
): Promise<number> => {
	const rows = await q<{ count: string }>(
		`select count(*)::text as count from vxp_awards
		 where user_id = $1 and award_type = $2
		   and ($3::double precision is null or created_at > to_timestamp($3::double precision / 1000))`,
		[userId, awardType, sinceMs ?? null]
	);

	return Number(rows[0]?.count ?? 0);
};

export type GrantAwardOutcome =
	| { outcome: 'paid'; blockIndex: string }
	| { outcome: 'recorded' }
	| { outcome: 'already' }
	| { outcome: 'skipped_zero' }
	| { outcome: 'failed'; error: string };

interface GrantAwardParams {
	userId: string;
	awardType: VxpAwardType;
	awardKey: string;
	amountBaseUnits: bigint;
	memo?: string;
	earnedAtMs?: number;
}

const transferMemoOf = ({ awardType, awardKey, memo }: GrantAwardParams): string =>
	memo ?? `vxp:${awardType}:${awardKey}`;

/** Inserts the pending row; undefined when the award already exists. The
 * memo is stored with the row so a reconciler paying it later (after a
 * record-only stretch or a crash) sends the same memo the grant chose. The
 * conflict clause names no target so a type-specific unique index (one
 * tournament prize per tournament, migration 0018) collides into 'already'
 * like the (user, award_type, award_key) one, instead of raising. */
const insertPendingAward = async (
	grant: GrantAwardParams,
	q: TxQuery = query
): Promise<string | undefined> => {
	const inserted = await q<{ id: string }>(
		`insert into vxp_awards (user_id, award_type, award_key, amount_base_units, status, earned_at_ms, transfer_memo)
		 values ($1, $2, $3, $4, 'pending', $5, $6)
		 on conflict do nothing
		 returning id`,
		[
			grant.userId,
			grant.awardType,
			grant.awardKey,
			grant.amountBaseUnits.toString(),
			grant.earnedAtMs ?? Date.now(),
			transferMemoOf(grant)
		]
	);

	return inserted[0]?.id;
};

/** Drives a freshly inserted row to its outcome: recorded in record-only
 * mode, otherwise the treasury transfer and the paid/failed transition. */
const settleInsertedAward = async ({
	id,
	grant
}: {
	id: string;
	grant: GrantAwardParams;
}): Promise<GrantAwardOutcome> => {
	if (isVxpTreasuryDisabled()) {
		return { outcome: 'recorded' };
	}

	const settled = await settlePendingAward({
		id,
		userId: grant.userId,
		awardType: grant.awardType,
		awardKey: grant.awardKey,
		amountBaseUnits: grant.amountBaseUnits,
		memo: transferMemoOf(grant)
	});

	if (settled.paid) {
		return { outcome: 'paid', blockIndex: settled.blockIndex ?? '' };
	}

	// A lost claim means another runner (a zero-grace reconcile) already holds
	// this freshly inserted row and will drive it to paid; a deferred one waits
	// pending for the treasury refill; a reopened one waits pending for the
	// next sweep; a quarantined one waits for the ledger check. Nothing is
	// known to have failed, so the caller sees it as recorded.
	if (
		!settled.claimed ||
		settled.deferred === true ||
		settled.reopened === true ||
		settled.quarantined === true
	) {
		return { outcome: 'recorded' };
	}

	return { outcome: 'failed', error: settled.error ?? 'transfer failed' };
};

/**
 * The single grant path: insert the pending row (colliding silently when the
 * award already exists), then either leave it recorded (record-only mode) or
 * drive the treasury transfer and the paid/failed transition. Non-positive
 * amounts are skipped entirely; nothing is owed.
 */
export const grantAward = async (grant: GrantAwardParams): Promise<GrantAwardOutcome> => {
	if (grant.amountBaseUnits <= ZERO) {
		return { outcome: 'skipped_zero' };
	}

	const id = await insertPendingAward(grant);

	if (isNullish(id)) {
		return { outcome: 'already' };
	}

	return await settleInsertedAward({ id, grant });
};

/** A ceiling on how many awards of one type a user may hold: over their
 * lifetime, or inside a rolling wall-clock window when windowMs is set.
 * reason is what the grant answers when this cap is the one reached. */
export interface AwardCap<Reason extends string> {
	max: number;
	windowMs?: number;
	reason: Reason;
}

export type CappedGrantOutcome<Reason extends string> =
	GrantAwardOutcome | { outcome: 'capped'; reason: Reason };

/**
 * grantAward under caps. The count and the insert run in one transaction
 * behind a per-user, per-type advisory lock, so concurrent grants queue and
 * each one counts the rows the earlier ones inserted: a cap is never
 * exceeded, however many claims race. The lock is released at commit, before
 * the transfer, so a slow ledger never holds up the next grant. Every row
 * counts whatever its status: anything in flight consumes a slot.
 */
export const grantCappedAward = async <Reason extends string>({
	caps,
	...grant
}: GrantAwardParams & { caps: readonly AwardCap<Reason>[] }): Promise<
	CappedGrantOutcome<Reason>
> => {
	if (grant.amountBaseUnits <= ZERO) {
		return { outcome: 'skipped_zero' };
	}

	const claim = await tx(async (q): Promise<{ id?: string } | { capped: Reason }> => {
		await q(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [
			`vxp-award-cap:${grant.userId}:${grant.awardType}`
		]);

		const nowMs = Date.now();

		for (const cap of caps) {
			const held = await countUserAwards(
				{
					userId: grant.userId,
					awardType: grant.awardType,
					sinceMs: nonNullish(cap.windowMs) ? nowMs - cap.windowMs : undefined
				},
				q
			);

			if (held >= cap.max) {
				return { capped: cap.reason };
			}
		}

		return { id: await insertPendingAward(grant, q) };
	});

	if ('capped' in claim) {
		return { outcome: 'capped', reason: claim.capped };
	}

	if (isNullish(claim.id)) {
		return { outcome: 'already' };
	}

	return await settleInsertedAward({ id: claim.id, grant });
};

export const getAward = async ({
	userId,
	awardType,
	awardKey
}: {
	userId: string;
	awardType: VxpAwardType;
	awardKey: string;
}): Promise<VxpAward | undefined> => {
	const rows = await query<VxpAwardRow>(
		`select ${AWARD_COLUMNS} from vxp_awards
		 where user_id = $1 and award_type = $2 and award_key = $3`,
		[userId, awardType, awardKey]
	);

	return nonNullish(rows[0]) ? shapeAward(rows[0]) : undefined;
};

export const listUserAwards = async ({
	userId,
	awardType
}: {
	userId: string;
	awardType?: VxpAwardType;
}): Promise<VxpAward[]> => {
	const rows = nonNullish(awardType)
		? await query<VxpAwardRow>(
				`select ${AWARD_COLUMNS} from vxp_awards
				 where user_id = $1 and award_type = $2 order by created_at desc`,
				[userId, awardType]
			)
		: await query<VxpAwardRow>(
				`select ${AWARD_COLUMNS} from vxp_awards
				 where user_id = $1 order by created_at desc`,
				[userId]
			);

	return rows.map(shapeAward);
};

export interface ReconcileReport {
	scanned: number;
	paid: number;
	failed: number;
	deferred: number;
	/** Rows moved into needs_ledger_check this pass. */
	quarantined: number;
	/** Quarantined rows the history proved unpaid, sent again this pass. */
	reissued: number;
}

interface LedgerCheckRow {
	id: string;
	user_id: string;
	award_type: VxpAwardType;
	award_key: string;
	amount_base_units: string;
	transfer_memo: string | null;
	transfer_created_at_ns: string | null;
	transfer_attempts: number;
}

/**
 * Settles one quarantined row from the ledger history. Only rows whose last
 * send is older than PROCESSING_STALE_MS reach here, far past the ingress
 * expiry, so no message carrying the stamp can still land after the lookup.
 * found: paid with that block, unless another award holds it, which proves
 * this one never landed (handled as absent). absent (proven): back to pending with the
 * stamp cleared so the sweep sends it fresh, or failed once the attempt cap
 * is reached. unknown (index behind, lookup error, no stamp to match): the
 * row stays quarantined for the next pass or an operator.
 */
const resolveLedgerCheck = async ({
	row,
	report
}: {
	row: LedgerCheckRow;
	report: ReconcileReport;
}): Promise<void> => {
	const label = `${row.award_type}/${row.award_key} for ${row.user_id}`;

	if (isNullish(row.transfer_memo) || isNullish(row.transfer_created_at_ns)) {
		logger.warn(`vxp ledger check cannot match ${label}: no stored transfer stamp`);

		return;
	}

	const amountBaseUnits = BigInt(row.amount_base_units);
	const lookup = await findTreasuryTransferToUser({
		userId: row.user_id,
		amount: amountBaseUnits,
		memo: row.transfer_memo,
		createdAtTimeNs: BigInt(row.transfer_created_at_ns)
	});

	if (
		lookup.status === 'found' &&
		!(await blockHeldByAnotherAward({
			id: row.id,
			userId: row.user_id,
			blockIndex: lookup.blockIndex
		}))
	) {
		await markAwardPaid({
			id: row.id,
			fromStatus: 'needs_ledger_check',
			userId: row.user_id,
			awardType: row.award_type,
			awardKey: row.award_key,
			amountBaseUnits,
			blockIndex: lookup.blockIndex
		});
		report.paid += 1;

		return;
	}

	if (lookup.status === 'unknown') {
		logger.warn(`vxp ledger check inconclusive for ${label}:`, lookup.reason);

		return;
	}

	if (row.transfer_attempts >= MAX_TRANSFER_ATTEMPTS) {
		await query(
			`update vxp_awards
			 set status = 'failed',
			     error_message = coalesce(error_message, '') || ' (not on the ledger after ' || $2 || ' attempts)'
			 where id = $1 and status = 'needs_ledger_check'`,
			[row.id, row.transfer_attempts]
		);
		report.failed += 1;

		return;
	}

	await query(
		`update vxp_awards
		 set status = 'pending', processing_at = null, transfer_created_at_ns = null
		 where id = $1 and status = 'needs_ledger_check'`,
		[row.id]
	);
	report.reissued += 1;
};

/**
 * The recovery half of a reconcile pass: quarantines stale claims whose
 * stamp can no longer be safely replayed, then resolves quarantined rows
 * from the ledger history. Runs before the pending sweep so a row proven
 * unpaid is sent again in the same pass.
 */
const recoverUnconfirmedTransfers = async ({
	limit,
	report
}: {
	limit: number;
	report: ReconcileReport;
}): Promise<void> => {
	const quarantined = await query<{ id: string }>(
		`update vxp_awards
		 set status = 'needs_ledger_check'
		 where origin = 'live'
		   and status = 'processing'
		   and processing_at < now() - make_interval(secs => $1::double precision / 1000)
		   and (transfer_created_at_ns is null or transfer_created_at_ns <= $2)
		 returning id`,
		[PROCESSING_STALE_MS, dedupCutoffNs().toString()]
	);

	report.quarantined += quarantined.length;

	const rows = await query<LedgerCheckRow>(
		`select id, user_id, award_type, award_key, amount_base_units::text,
		   transfer_memo, transfer_created_at_ns::text, transfer_attempts
		 from vxp_awards
		 where origin = 'live'
		   and status = 'needs_ledger_check'
		   and processing_at < now() - make_interval(secs => $1::double precision / 1000)
		 order by processing_at asc
		 limit $2`,
		[PROCESSING_STALE_MS, limit]
	);

	for (const row of rows) {
		try {
			await resolveLedgerCheck({ row, report });
		} catch (err) {
			// A failed lookup proves nothing: the row stays quarantined.
			logger.error(`vxp ledger check error on ${row.award_type}/${row.award_key}:`, err);
		}
	}
};

/**
 * Pays every recorded-unpaid (pending) award this backend granted: the
 * catch-up path after a record-only stretch, and the retry for grants whose
 * process died between insert and transfer. Also sweeps processing rows whose
 * claim went stale (older than PROCESSING_STALE_MS) while their stamp is
 * still replayable, and first resolves unconfirmed transfers from the ledger
 * history (recoverUnconfirmedTransfers). Imported rows are never selected. A
 * no-op while record-only mode is on; the grace window keeps it off the heels
 * of an in-flight grant. The sweep stops at the first insufficient-funds
 * deferral: every later row would bounce off the same empty treasury.
 */
export const reconcileUnpaidAwards = async ({
	graceMs = MINUTE_IN_MS,
	limit = 200
}: { graceMs?: number; limit?: number } = {}): Promise<ReconcileReport> => {
	const report: ReconcileReport = {
		scanned: 0,
		paid: 0,
		failed: 0,
		deferred: 0,
		quarantined: 0,
		reissued: 0
	};

	if (isVxpTreasuryDisabled()) {
		return report;
	}

	await recoverUnconfirmedTransfers({ limit, report });

	const rows = await query<VxpAwardRow>(
		`select ${AWARD_COLUMNS} from vxp_awards
		 where origin = 'live'
		   and ((status = 'pending' and created_at < now() - make_interval(secs => $1::double precision / 1000))
		     or (status = 'processing'
		       and processing_at < now() - make_interval(secs => $3::double precision / 1000)
		       and transfer_created_at_ns > $4))
		 order by created_at asc
		 limit $2`,
		[graceMs, limit, PROCESSING_STALE_MS, dedupCutoffNs().toString()]
	);

	for (const row of rows) {
		report.scanned += 1;

		try {
			const settled = await settlePendingAward({
				id: row.id,
				userId: row.user_id,
				awardType: row.award_type,
				awardKey: row.award_key,
				amountBaseUnits: BigInt(row.amount_base_units),
				memo: `vxp:${row.award_type}:${row.award_key}`
			});

			if (settled.paid) {
				report.paid += 1;
			} else if (settled.deferred === true) {
				report.deferred += 1;

				break;
			} else if (settled.quarantined === true) {
				report.quarantined += 1;
			} else if (settled.claimed) {
				report.failed += 1;
			}
			// A lost claim is neither paid nor failed: a concurrent runner holds
			// the row and reports its outcome.
		} catch (err) {
			// One award's hiccup must not abort the sweep; the row stays pending
			// for the next pass.
			logger.error(`vxp reconcile error on ${row.award_type}/${row.award_key}:`, err);
		}
	}

	return report;
};

export interface TreasuryBacklog {
	/** Live awards still owed: what the treasury must cover before (or right
	 * after) record-only mode is switched off. */
	pendingCount: number;
	pendingBaseUnits: string;
	/** Imported or pre-provenance awards left unsettled; never paid here,
	 * listed for manual handling. */
	importedUnsettledCount: number;
	/** Live awards whose transfer outcome is unknown, awaiting the ledger
	 * history (count stays up while the index lags). */
	needsLedgerCheckCount: number;
}

export const getTreasuryBacklog = async (): Promise<TreasuryBacklog> => {
	const rows = await query<{
		pending_count: string;
		pending_base_units: string;
		imported_unsettled_count: string;
		needs_ledger_check_count: string;
	}>(
		`select
		   count(*) filter (where origin = 'live' and status in ('pending', 'processing'))::text
		     as pending_count,
		   coalesce(sum(amount_base_units)
		     filter (where origin = 'live' and status in ('pending', 'processing')), 0)::text
		     as pending_base_units,
		   count(*) filter (where origin = 'etl' and status in ('pending', 'processing'))::text
		     as imported_unsettled_count,
		   count(*) filter (where origin = 'live' and status = 'needs_ledger_check')::text
		     as needs_ledger_check_count
		 from vxp_awards`
	);
	const [row] = rows;

	return {
		pendingCount: Number(row?.pending_count ?? 0),
		pendingBaseUnits: row?.pending_base_units ?? '0',
		importedUnsettledCount: Number(row?.imported_unsettled_count ?? 0),
		needsLedgerCheckCount: Number(row?.needs_ledger_check_count ?? 0)
	};
};
