// Streak-milestone awards: when a profile write moves dailyStreak across one
// of the milestone boundaries (3 / 7 / 14 / 30), the matching VXP bonus is
// credited once ever per milestone, keyed streak_<m>. Plus the idempotent
// underpayment backfill for imported awards that were paid in whole-VXP
// figures instead of base units.

import { isNullish } from '@dfinity/utils';
import { query } from '../db/client';
import { ZERO } from '../lib/constants';
import { logger } from '../lib/logger';
import { grantAward } from './awards';
import { parseVxp, VXP_STREAK_BONUSES } from './constants';

const STREAK_MILESTONES: readonly number[] = Object.freeze(
	Object.keys(VXP_STREAK_BONUSES)
		.map((k) => Number(k))
		.sort((a, b) => a - b)
);

/**
 * Milestone boundaries the user's streak just crossed on this write. Empty
 * when the streak did not increase or no boundary sits inside the jump (the
 * common case; most writes do not bump the streak).
 */
export const milestonesCrossed = ({ prev, next }: { prev: number; next: number }): number[] => {
	if (next <= prev) {
		return [];
	}

	return STREAK_MILESTONES.filter((m) => prev < m && m <= next);
};

export const streakAwardKey = (milestone: number): string => `streak_${milestone}`;

/**
 * Profile-write trigger: credits every milestone crossed between the stored
 * and the written dailyStreak. Idempotent per milestone via the award key;
 * a failure on one milestone does not block the others.
 */
export const runStreakAwardTrigger = async ({
	userId,
	prevDailyStreak,
	nextDailyStreak
}: {
	userId: string;
	prevDailyStreak: number;
	nextDailyStreak: number;
}): Promise<void> => {
	for (const milestone of milestonesCrossed({ prev: prevDailyStreak, next: nextDailyStreak })) {
		try {
			await grantAward({
				userId,
				awardType: 'streak',
				awardKey: streakAwardKey(milestone),
				amountBaseUnits: parseVxp(VXP_STREAK_BONUSES[milestone] ?? 0),
				memo: `vxp:streak:${streakAwardKey(milestone)}`
			});
		} catch (err) {
			logger.error(`streak award grant failed (${milestone} for ${userId}):`, err);
		}
	}
};

export interface StreakBackfillReport {
	scanned: number;
	underpaid: number;
	alreadyBackfilled: number;
	minted: number;
	failed: number;
	/** Underpaid rows that had no backfill marker when this run started. */
	pending: number;
	/** Includes rows topped up by earlier runs; see pendingShortfallBaseUnits. */
	totalShortfallBaseUnits: string;
	/** Shortfall of the pending rows only, i.e. what this run minted or would mint. */
	pendingShortfallBaseUnits: string;
}

interface UnderpaidRow {
	user_id: string;
	award_key: string;
	amount_base_units: string;
	earned_at_ms: string;
}

const MILESTONE_RE = /^streak_(\d+)$/;

/**
 * Idempotent remediation for underpaid streak awards (paid rows whose amount
 * is below the milestone's correct base units, e.g. legacy rows imported
 * from a period when the bonus was booked as whole-VXP figures). Each
 * shortfall is minted once via a streak_<m>_backfill marker award, so a
 * re-run skips anything already topped up; correctly-paid rows are never
 * touched. dryRun (the default) reports without minting.
 */
/**
 * Remediates one paid streak row. Returns the shortfall it identified
 * (counted into the running total whether or not it was minted this run),
 * or ZERO for rows that do not qualify. Mutates the report counters; early
 * returns keep the caller a flat loop.
 */
const remediateRow = async ({
	row,
	dryRun,
	report
}: {
	row: UnderpaidRow;
	dryRun: boolean;
	report: StreakBackfillReport;
}): Promise<bigint> => {
	report.scanned += 1;

	const match = MILESTONE_RE.exec(row.award_key);
	const bonus: number | undefined = VXP_STREAK_BONUSES[Number(match?.[1])];

	if (isNullish(bonus)) {
		return ZERO;
	}

	const shortfall = parseVxp(bonus) - BigInt(row.amount_base_units);

	if (shortfall <= ZERO) {
		return ZERO;
	}

	report.underpaid += 1;

	const backfillKey = `${row.award_key}_backfill`;
	const existing = await query<{ id: string }>(
		`select id from vxp_awards
		 where user_id = $1 and award_type = 'streak' and award_key = $2`,
		[row.user_id, backfillKey]
	);

	if (existing.length > 0) {
		report.alreadyBackfilled += 1;

		return shortfall;
	}

	report.pending += 1;
	report.pendingShortfallBaseUnits = (
		BigInt(report.pendingShortfallBaseUnits) + shortfall
	).toString();

	if (dryRun) {
		return shortfall;
	}

	const outcome = await grantAward({
		userId: row.user_id,
		awardType: 'streak',
		awardKey: backfillKey,
		amountBaseUnits: shortfall,
		memo: `vxp:streak:${backfillKey}`,
		earnedAtMs: Number(row.earned_at_ms)
	});

	if (outcome.outcome === 'paid' || outcome.outcome === 'recorded') {
		report.minted += 1;
	} else if (outcome.outcome === 'failed') {
		report.failed += 1;
	}

	return shortfall;
};

export const backfillStreakUnderpayments = async ({
	dryRun = true
}: { dryRun?: boolean } = {}): Promise<StreakBackfillReport> => {
	const report: StreakBackfillReport = {
		scanned: 0,
		underpaid: 0,
		alreadyBackfilled: 0,
		minted: 0,
		failed: 0,
		pending: 0,
		totalShortfallBaseUnits: '0',
		pendingShortfallBaseUnits: '0'
	};

	const rows = await query<UnderpaidRow>(
		`select user_id, award_key, amount_base_units, earned_at_ms::text
		 from vxp_awards
		 where award_type = 'streak' and status = 'paid' and award_key ~ '^streak_[0-9]+$'`,
		[]
	);

	let totalShortfall = ZERO;

	for (const row of rows) {
		totalShortfall += await remediateRow({ row, dryRun, report });
	}

	report.totalShortfallBaseUnits = totalShortfall.toString();

	return report;
};

/**
 * Worker log line for a backfill run, or undefined when there is nothing to
 * act on. Rows topped up by earlier runs stay underpaid forever (the original
 * row is never rewritten), so keying the log on them would repeat the same
 * line every hour.
 */
export const streakBackfillLogLine = (report: StreakBackfillReport): string | undefined => {
	if (report.pending === 0 && report.failed === 0) {
		return;
	}

	return `streak backfill: ${report.pending} pending (${report.minted} minted, ${report.failed} failed, shortfall ${report.pendingShortfallBaseUnits})`;
};
