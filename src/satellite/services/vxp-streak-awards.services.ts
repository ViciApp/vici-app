import { VXP_LEDGER_CANISTER_ID } from '#lib/constants/canisters.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import { VXP_STREAK_BONUSES } from '#lib/constants/vxp-economy.constants.ts';
import type { VxpAwardDoc } from '#lib/types/vxp-award.ts';
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
import { decodeDocData } from '@junobuild/functions/sdk';

/**
 * Streak-milestone hook. Runs after every `profiles` write; when the
 * user's `dailyStreak` crosses one of the milestone boundaries
 * (3 / 7 / 14 / 30), credits the corresponding VXP bonus to their
 * ledger account and persists the payout in `vxp_awards`.
 *
 * Idempotency is structural: the award doc key is
 * `${recipient}/streak/streak_${milestone}`: the second hook firing
 * at the same milestone collides with the first and the assert blocks
 * the duplicate write. No timestamp-based dedupe needed. A `failed`
 * payout is sent again the next time the streak crosses that milestone
 * (`reclaimAward`).
 *
 * Composes alongside `onProfileSetForVxpOnboarding` and
 * `onProfileSetForReferralCode` in the profile dispatch table.
 */

const AWARD_TYPE = 'streak' as const;

const STREAK_MILESTONES: readonly number[] = Object.freeze(
	Object.keys(VXP_STREAK_BONUSES)
		.map((k) => Number(k))
		.sort((a, b) => a - b)
);

/**
 * Subset of the profile shape the streak hook actually reads. Decoded
 * from the satellite doc payload: full `UserProfile` isn't needed.
 */
interface DailyStreakSlice {
	dailyStreak?: number;
}

/**
 * Milestone boundaries the user's streak just crossed on this write.
 * Returns an empty array if neither end is set or no boundary was
 * crossed (the common case: most writes don't bump streak).
 */
const milestonesCrossed = ({ prev, next }: { prev: number; next: number }): number[] => {
	if (next <= prev) {
		return [];
	}

	return STREAK_MILESTONES.filter((m) => prev < m && m <= next);
};

const streakAwardKey = (milestone: number): string => `streak_${milestone}`;

/**
 * Files the pending award doc of a first payout. Returns false when the
 * write is refused: most likely a concurrent hook firing already wrote the
 * pending doc, and that firing will (or has already) issue the transfer.
 */
const persistStreakAward = ({
	recipient,
	milestone,
	awardKey,
	amount
}: {
	recipient: string;
	milestone: number;
	awardKey: string;
	amount: bigint;
}): boolean => {
	const pending: VxpAwardDoc = {
		recipient,
		awardType: AWARD_TYPE,
		awardKey,
		amountBaseUnits: amount.toString(),
		status: 'pending',
		earnedAtMs: Date.now()
	};

	try {
		persistAward({ recipient, awardType: AWARD_TYPE, awardKey, doc: pending });

		return true;
	} catch (e: unknown) {
		logInfo({
			message: 'streak_award_pending_blocked',
			detail: { user: recipient, milestone, error: e instanceof Error ? e.message : String(e) }
		});

		return false;
	}
};

const payStreakMilestone = async ({
	ledger,
	recipient,
	milestone
}: {
	ledger: IcrcLedgerCanister;
	recipient: string;
	milestone: number;
}): Promise<void> => {
	const awardKey = streakAwardKey(milestone);
	const slot = reclaimAward({ recipient, awardType: AWARD_TYPE, awardKey });

	if (slot.kind === 'held') {
		return;
	}

	// `VXP_STREAK_BONUSES` is whole VXP and the ledger works in base units, so
	// size via `vxpBaseUnits`: a raw `BigInt(50)` would transfer 50 base units
	// (0.0050 VXP), under-paying by `10 ** VXP_TOKEN.decimals` (mirrors the
	// Worlds-podium award's `vxpBaseUnits` sizing).
	const amount =
		slot.kind === 'retry'
			? BigInt(slot.doc.amountBaseUnits)
			: vxpBaseUnits(VXP_STREAK_BONUSES[milestone]);

	if (slot.kind === 'free' && !persistStreakAward({ recipient, milestone, awardKey, amount })) {
		return;
	}

	const result = await transferWithBadFeeRetry({
		ledger,
		toOwner: Principal.fromText(recipient),
		amount,
		memo: `vxp:streak:${awardKey}`
	});

	if (result.ok) {
		logInfo({
			message: 'streak_award_paid',
			detail: {
				user: recipient,
				milestone,
				amount: amount.toString(),
				block_index: result.blockIndex.toString()
			}
		});

		updateAward({
			recipient,
			awardType: AWARD_TYPE,
			awardKey,
			patch: {
				status: 'paid',
				paidAtMs: Date.now(),
				blockIndex: result.blockIndex.toString()
			}
		});

		return;
	}

	logError({
		message: 'streak_award_failed',
		detail: {
			user: recipient,
			milestone,
			amount: amount.toString(),
			error: result.error
		}
	});

	updateAward({
		recipient,
		awardType: AWARD_TYPE,
		awardKey,
		patch: {
			status: 'failed',
			errorMessage: result.error
		}
	});
};

/**
 * Profile post-write hook: composes alongside the other `profiles`
 * hooks in `satellite/index.ts`. Detects daily-streak milestone
 * crossings and credits the matching VXP bonus.
 */
export const onProfileSetForStreakAward = async (ctx: OnSetDocContext): Promise<void> => {
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

		const prevDoc = nonNullish(before) ? decodeDocData<DailyStreakSlice>(before.data) : undefined;
		const nextDoc = decodeDocData<DailyStreakSlice>(after.data);

		const prev = prevDoc?.dailyStreak ?? 0;
		const next = nextDoc.dailyStreak ?? 0;
		const crossed = milestonesCrossed({ prev, next });

		if (crossed.length === 0) {
			return;
		}

		const ledger = new IcrcLedgerCanister({
			canisterId: Principal.fromText(VXP_LEDGER_CANISTER_ID)
		});

		for (const milestone of crossed) {
			await payStreakMilestone({
				ledger,
				recipient: callerText,
				milestone
			});
		}
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		const user = key.length > 0 ? key : Principal.fromUint8Array(caller).toText();

		logError({
			message: 'hook_error',
			detail: { hook: 'streak_award', user, error: msg }
		});

		throw e;
	}
};
