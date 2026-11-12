// ONE-TIME remediation endpoint — run once on prod, then REMOVE in a
// follow-up PR. Not a permanent surface.
//
// Backfills the streak-award underpayment fixed in #957. Before the fix,
// `payStreakMilestone` transferred `BigInt(VXP_STREAK_BONUSES[m])` (whole
// VXP read as base units) instead of `parseToken(...)`, so every streak
// award paid ~10^VXP_TOKEN.decimals too little. This walks the paid
// `vxp_awards` streak docs, computes each shortfall, and (when not a dry
// run) mints the difference to the recipient. No amounts change — it pays
// the difference up to the already-intended bonus (50 / 150 / 400 / 1000).
//
// Safety: admin-gated; `dryRun: true` is the default (reports only, mints
// nothing). Idempotent — it writes a marker award doc keyed
// `streak_<m>_backfill` per remediated award, so a re-run skips anything
// already topped up, and it only touches docs whose recorded
// `amountBaseUnits` is BELOW the correct base-unit amount (correctly-paid
// post-fix awards are left alone).
//
// Runbook (mainnet, after this PR ships in a release):
//   1. Call with `{ dryRun: true }` → review the report (count + total owed).
//   2. Only if the numbers look right, call with `{ dryRun: false }`.
//   3. Open a follow-up PR removing this file + its `index.ts` wiring.

import { ZERO } from '#lib/constants/app.constants.ts';
import { VXP_LEDGER_CANISTER_ID } from '#lib/constants/canisters.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import { VXP_TOKEN } from '#lib/constants/tokens/tokens.ic.constants.ts';
import { VXP_STREAK_BONUSES } from '#lib/constants/vxp-economy.constants.ts';
import { vxpAwardKey, type VxpAwardDoc } from '#lib/types/vxp-award.ts';
import { parseToken } from '#lib/utils/parse.utils.ts';
import { isAdmin } from '#satellite/services/authz.services.ts';
import { transferWithBadFeeRetry } from '#satellite/services/vxp-payout.services.ts';
import { logError, logInfo } from '#satellite/utils/logger.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import { IcrcLedgerCanister } from '@junobuild/functions/canisters/ledger/icrc';
import { msgCaller } from '@junobuild/functions/ic-cdk';
import {
	decodeDocData,
	encodeDocData,
	getAdminAccessKeys,
	getDocStore,
	listDocsStore,
	setDocStore
} from '@junobuild/functions/sdk';

export interface StreakBackfillReport {
	scanned: number;
	underpaid: number;
	alreadyBackfilled: number;
	minted: number;
	failed: number;
	totalShortfallBaseUnits: string;
}

const MILESTONE_RE = /^streak_(\d+)$/;

const correctBaseUnits = (milestone: number): bigint | null => {
	const whole = VXP_STREAK_BONUSES[milestone];

	if (isNullish(whole)) {
		return null;
	}

	return parseToken({ value: whole.toString(), unitName: VXP_TOKEN.decimals });
};

/**
 * Remediates one award doc. Returns the shortfall it identified (added to
 * the running total whether or not it was minted this run), or `ZERO` for
 * docs that don't qualify. Mutates `report` counters. Uses early `return`
 * rather than loop `continue` so the caller stays a flat `for…of`.
 */
const remediateAward = async ({
	doc,
	dryRun,
	ledger,
	report
}: {
	doc: VxpAwardDoc;
	dryRun: boolean;
	ledger: IcrcLedgerCanister;
	report: StreakBackfillReport;
}): Promise<bigint> => {
	if (doc.awardType !== 'streak' || doc.status !== 'paid') {
		return ZERO;
	}

	const m = doc.awardKey.match(MILESTONE_RE);

	if (isNullish(m)) {
		return ZERO; // a `_backfill` marker or an unexpected key
	}

	report.scanned += 1;

	const correct = correctBaseUnits(Number(m[1]));

	if (isNullish(correct)) {
		return ZERO;
	}

	const shortfall = correct - BigInt(doc.amountBaseUnits);

	if (shortfall <= ZERO) {
		return ZERO; // already correct (post-fix payment)
	}

	report.underpaid += 1;

	const backfillKey = `${doc.awardKey}_backfill`;
	const recipientBytes = Principal.fromText(doc.recipient).toUint8Array();
	const markerKey = vxpAwardKey({
		recipient: doc.recipient,
		awardType: 'streak',
		awardKey: backfillKey
	});

	if (
		nonNullish(
			getDocStore({ collection: Collection.VXP_AWARDS, key: markerKey, caller: recipientBytes })
		)
	) {
		report.alreadyBackfilled += 1;

		return shortfall;
	}

	if (dryRun) {
		return shortfall;
	}

	const pending: VxpAwardDoc = {
		recipient: doc.recipient,
		awardType: 'streak',
		awardKey: backfillKey,
		amountBaseUnits: shortfall.toString(),
		status: 'pending',
		earnedAtMs: doc.earnedAtMs
	};
	setDocStore({
		caller: recipientBytes,
		collection: Collection.VXP_AWARDS,
		key: markerKey,
		doc: { data: encodeDocData(pending) }
	});

	const result = await transferWithBadFeeRetry({
		ledger,
		toOwner: Principal.fromText(doc.recipient),
		amount: shortfall,
		memo: `vxp:streak:${backfillKey}`
	});

	const settled: VxpAwardDoc = result.ok
		? { ...pending, status: 'paid', paidAtMs: Date.now(), blockIndex: result.blockIndex.toString() }
		: { ...pending, status: 'failed', errorMessage: result.error };

	// Version-lock the settled write against the version the datastore just
	// assigned the pending doc (never a hard-coded literal).
	const created = getDocStore({
		collection: Collection.VXP_AWARDS,
		key: markerKey,
		caller: recipientBytes
	});
	setDocStore({
		caller: recipientBytes,
		collection: Collection.VXP_AWARDS,
		key: markerKey,
		doc: { data: encodeDocData(settled), version: created?.version }
	});

	if (result.ok) {
		report.minted += 1;
		logInfo({
			message: 'streak_backfill_paid',
			detail: { user: doc.recipient, awardKey: backfillKey, shortfall: shortfall.toString() }
		});
	} else {
		report.failed += 1;
		logError({
			message: 'streak_backfill_failed',
			detail: { user: doc.recipient, awardKey: backfillKey, error: result.error }
		});
	}

	return shortfall;
};

/**
 * Admin-gated. `dryRun` defaults to `true` (reports only, mints nothing);
 * pass `false` to mint. Each `setDocStore` is signed with the recipient's
 * own principal as `caller` so the `vxp_awards` assert (recipient binds
 * caller) accepts it — exactly how the streak hook writes its docs.
 */
export const backfillStreakUnderpaymentsFn = async ({
	dryRun = true
}: {
	dryRun?: boolean;
}): Promise<StreakBackfillReport> => {
	if (!isAdmin({ caller: msgCaller() })) {
		throw new Error('backfillStreakUnderpayments: admin only.');
	}

	const ledger = new IcrcLedgerCanister({
		canisterId: Principal.fromText(VXP_LEDGER_CANISTER_ID)
	});

	// Controllers can read the whole collection; use the admin key as the
	// list caller (same pattern as the reaction-count recompute).
	const admin = getAdminAccessKeys()[0]?.[0];

	if (isNullish(admin)) {
		throw new Error('backfillStreakUnderpayments: no admin access key available.');
	}

	const { items } = listDocsStore({
		collection: Collection.VXP_AWARDS,
		caller: admin,
		// Streak award keys are `${recipient}/streak/streak_<m>`; this prefix
		// is matched as a regex, so it scopes the scan to streak awards only.
		params: { matcher: { key: '/streak/streak_' } }
	});

	const report: StreakBackfillReport = {
		scanned: 0,
		underpaid: 0,
		alreadyBackfilled: 0,
		minted: 0,
		failed: 0,
		totalShortfallBaseUnits: '0'
	};
	let totalShortfall = ZERO;

	for (const [, item] of items) {
		const doc = decodeDocData<VxpAwardDoc>(item.data);
		totalShortfall += await remediateAward({ doc, dryRun, ledger, report });
	}

	report.totalShortfallBaseUnits = totalShortfall.toString();

	return report;
};
