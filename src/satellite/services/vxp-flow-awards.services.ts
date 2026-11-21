import { VXP_LEDGER_CANISTER_ID } from '#lib/constants/canisters.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import { MILLISECOND_IN_NANOSECONDS } from '#lib/constants/time.constants.ts';
import {
	VXP_FLOW_MILESTONES,
	VXP_FLOW_OVERTIME_BONUS,
	VXP_FLOW_OVERTIME_ROLLING_CAP,
	VXP_FLOW_OVERTIME_ROLLING_WINDOW_MS
} from '#lib/constants/vxp-economy.constants.ts';
import { vxpAwardKey, type VxpAwardDoc, type VxpAwardType } from '#lib/types/vxp-award.ts';
import { vxpBaseUnits } from '#lib/utils/vxp-amount.utils.ts';
import {
	persistAward,
	reclaimAward,
	updateAward
} from '#satellite/services/vxp-awards.services.ts';
import { transferWithBadFeeRetry } from '#satellite/services/vxp-payout.services.ts';
import { logError, logInfo } from '#satellite/utils/logger.utils.ts';
import { nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import type { OnSetDocContext } from '@junobuild/functions';
import { IcrcLedgerCanister } from '@junobuild/functions/canisters/ledger/icrc';
import { decodeDocData, listDocsStore } from '@junobuild/functions/sdk';

/**
 * Flow VXP award hooks: the real-credit path for the two Flow earn
 * surfaces:
 *
 *  - `flow_milestone`: crossing a lifetime call-count boundary
 *    (`VXP_FLOW_MILESTONES`), once each ever.
 *    Fired from the `profiles` post-write hook off the lifetime
 *    `totalTrades` delta (the same client-synced count the affiliation /
 *    podium awards already trust).
 *  - `flow_overtime`: finishing a day in overtime (the Flow daily counter
 *    hitting the hard cap pays `VXP_FLOW_OVERTIME_BONUS`). Minted *inline* from
 *    `recordFlowSwipeFn`, because that endpoint writes the counter with
 *    `setDocStore` and serverless writes fire no `onSetDoc` hook.
 *
 * Both reuse the existing server-fired `vxp_awards` pending→paid machinery
 * and its structural idempotency (`${recipient}/${awardType}/${awardKey}`).
 * Amounts are sized via `vxpBaseUnits`: the constants are whole VXP and the
 * ledger works in base units (mirrors the podium award; a raw `BigInt`
 * would under-pay by `10 ** VXP_TOKEN.decimals`).
 */

const FLOW_MILESTONES: readonly number[] = Object.freeze(
	Object.keys(VXP_FLOW_MILESTONES)
		.map((k) => Number(k))
		.sort((a, b) => a - b)
);

/** Subset of the profile the milestone hook reads. */
interface TotalTradesSlice {
	totalTrades?: number;
}

/**
 * Milestone boundaries the user's lifetime call count just crossed on this
 * write. Empty for the common case (most writes don't advance the count
 * past a boundary).
 */
const milestonesCrossed = ({ prev, next }: { prev: number; next: number }): number[] => {
	if (next <= prev) {
		return [];
	}

	return FLOW_MILESTONES.filter((m) => prev < m && m <= next);
};

/** Sends a claimed flow award and records its paid / failed outcome. */
const transferFlowAward = async ({
	ledger,
	recipient,
	awardType,
	awardKey,
	amount,
	logScope,
	logDetail
}: {
	ledger: IcrcLedgerCanister;
	recipient: string;
	awardType: VxpAwardType;
	awardKey: string;
	amount: bigint;
	logScope: string;
	logDetail: Record<string, unknown>;
}): Promise<void> => {
	const result = await transferWithBadFeeRetry({
		ledger,
		toOwner: Principal.fromText(recipient),
		amount,
		memo: `vxp:${awardType}:${awardKey}`
	});

	if (result.ok) {
		logInfo({
			message: `${logScope}_paid`,
			detail: { ...logDetail, amount: amount.toString(), block_index: result.blockIndex.toString() }
		});

		updateAward({
			recipient,
			awardType,
			awardKey,
			patch: { status: 'paid', paidAtMs: Date.now(), blockIndex: result.blockIndex.toString() }
		});

		return;
	}

	logError({
		message: `${logScope}_failed`,
		detail: { ...logDetail, amount: amount.toString(), error: result.error }
	});

	updateAward({
		recipient,
		awardType,
		awardKey,
		patch: { status: 'failed', errorMessage: result.error }
	});
};

/**
 * Files a pending award doc, issues the ledger transfer, and records the
 * paid / failed outcome: the shared body behind both flow award types.
 * Idempotent: a `pending` or `paid` doc for the key short-circuits before
 * any ledger call, and a `failed` one is sent again (`reclaimAward`).
 * `mayEarn` gates a first payout only: a retry was already allowed when it
 * was earned. `logTag` carries the award-specific log scope + detail.
 */
const payFlowAward = async ({
	ledger,
	recipient,
	awardType,
	awardKey,
	wholeVxp,
	mayEarn = () => true,
	logScope,
	logDetail
}: {
	ledger: IcrcLedgerCanister;
	recipient: string;
	awardType: VxpAwardType;
	awardKey: string;
	wholeVxp: number;
	mayEarn?: () => boolean;
	logScope: string;
	logDetail: Record<string, unknown>;
}): Promise<void> => {
	const slot = reclaimAward({ recipient, awardType, awardKey });

	if (slot.kind === 'held') {
		return;
	}

	if (slot.kind === 'retry') {
		await transferFlowAward({
			ledger,
			recipient,
			awardType,
			awardKey,
			amount: BigInt(slot.doc.amountBaseUnits),
			logScope,
			logDetail
		});

		return;
	}

	if (!mayEarn()) {
		return;
	}

	const amount = vxpBaseUnits(wholeVxp);

	const pending: VxpAwardDoc = {
		recipient,
		awardType,
		awardKey,
		amountBaseUnits: amount.toString(),
		status: 'pending',
		earnedAtMs: Date.now()
	};

	try {
		persistAward({ recipient, awardType, awardKey, doc: pending });
	} catch (e: unknown) {
		// Most likely a concurrent write already created the pending doc;
		// surface and stop: the other path will issue (or has issued) the
		// transfer.
		logInfo({
			message: `${logScope}_pending_blocked`,
			detail: { ...logDetail, error: e instanceof Error ? e.message : String(e) }
		});

		return;
	}

	await transferFlowAward({ ledger, recipient, awardType, awardKey, amount, logScope, logDetail });
};

const ledgerActor = (): IcrcLedgerCanister =>
	new IcrcLedgerCanister({ canisterId: Principal.fromText(VXP_LEDGER_CANISTER_ID) });

/**
 * Profile post-write hook: credits any lifetime-call milestone the user
 * just crossed. Composes alongside the other `profiles` award hooks; reads
 * the client-synced `totalTrades` delta (same trust model as the streak
 * and Worlds-podium awards).
 */
export const onProfileSetForFlowMilestone = async (ctx: OnSetDocContext): Promise<void> => {
	const {
		caller,
		data: {
			collection,
			key,
			data: { before, after }
		}
	} = ctx;

	try {
		if (collection !== Collection.PROFILES) {
			return;
		}

		const callerText = Principal.fromUint8Array(caller).toText();

		// Only react to the user writing their own profile.
		if (key !== callerText) {
			return;
		}

		const prev =
			(nonNullish(before) ? decodeDocData<TotalTradesSlice>(before.data) : undefined)
				?.totalTrades ?? 0;
		const next = decodeDocData<TotalTradesSlice>(after.data).totalTrades ?? 0;
		const crossed = milestonesCrossed({ prev, next });

		if (crossed.length === 0) {
			return;
		}

		const ledger = ledgerActor();

		for (const milestone of crossed) {
			await payFlowAward({
				ledger,
				recipient: callerText,
				awardType: 'flow_milestone',
				awardKey: milestone.toString(),
				wholeVxp: VXP_FLOW_MILESTONES[milestone],
				logScope: 'flow_milestone_award',
				logDetail: { user: callerText, milestone }
			});
		}
	} catch (e: unknown) {
		logError({
			message: 'hook_error',
			detail: {
				hook: 'flow_milestone_award',
				user: key.length > 0 ? key : Principal.fromUint8Array(caller).toText(),
				error: e instanceof Error ? e.message : String(e)
			}
		});

		throw e;
	}
};

/**
 * Counts the caller's `flow_overtime` award docs whose store-stamped
 * `created_at` falls within the rolling window. `created_at` (not the
 * in-body `earnedAtMs`) is the boundary because the datastore stamps it on
 * write and the caller cannot forge it: `recordFlowSwipe` validates only
 * that `dayKey` is well-formed, so a replayed day key cannot inflate this.
 */
const overtimeAwardsInWindow = ({
	caller,
	recipient,
	nowMs
}: {
	caller: Uint8Array;
	recipient: string;
	nowMs: number;
}): number => {
	const prefix = vxpAwardKey({ recipient, awardType: 'flow_overtime', awardKey: '' });
	const cutoffNs = BigInt(nowMs - VXP_FLOW_OVERTIME_ROLLING_WINDOW_MS) * MILLISECOND_IN_NANOSECONDS;

	const { items } = listDocsStore({
		collection: Collection.VXP_AWARDS,
		caller,
		params: {
			matcher: { key: `^${prefix}`, created_at: { greater_than: cutoffNs } }
		}
	});

	return items.length;
};

/**
 * Mints the overtime bonus for `dayKey`, called inline from
 * `recordFlowSwipeFn` once the daily counter reaches the hard cap.
 * Idempotent per day via the `${recipient}/flow_overtime/${dayKey}` key,
 * and bounded by the rolling wall-clock cap so a client replaying forged
 * day keys can't farm it. Never throws: a payout failure is logged and
 * recorded on the award doc, leaving the swipe counter result intact.
 */
export const mintFlowOvertime = async ({
	caller,
	recipient,
	dayKey
}: {
	caller: Uint8Array;
	recipient: string;
	dayKey: string;
}): Promise<void> => {
	try {
		// Idempotent per day: the award key is the day, checked before the
		// rolling-window scan.
		await payFlowAward({
			ledger: ledgerActor(),
			recipient,
			awardType: 'flow_overtime',
			awardKey: dayKey,
			wholeVxp: VXP_FLOW_OVERTIME_BONUS,
			mayEarn: () => {
				if (
					overtimeAwardsInWindow({ caller, recipient, nowMs: Date.now() }) <
					VXP_FLOW_OVERTIME_ROLLING_CAP
				) {
					return true;
				}

				logInfo({
					message: 'flow_overtime_award_rate_limited',
					detail: { user: recipient, day: dayKey, cap: VXP_FLOW_OVERTIME_ROLLING_CAP }
				});

				return false;
			},
			logScope: 'flow_overtime_award',
			logDetail: { user: recipient, day: dayKey }
		});
	} catch (e: unknown) {
		logError({
			message: 'hook_error',
			detail: {
				hook: 'flow_overtime_award',
				user: recipient,
				day: dayKey,
				error: e instanceof Error ? e.message : String(e)
			}
		});
	}
};
