import { ACHIEVEMENTS } from '#lib/constants/achievements.constants.ts';
import { VXP_LEDGER_CANISTER_ID } from '#lib/constants/canisters.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import type { VxpAwardDoc } from '#lib/types/vxp-award.ts';
import { vxpBaseUnits } from '#lib/utils/vxp-amount.utils.ts';
import {
	persistAward,
	reclaimAward,
	updateAward
} from '#satellite/services/vxp-awards.services.ts';
import { transferWithBadFeeRetry } from '#satellite/services/vxp-payout.services.ts';
import { logError, logInfo } from '#satellite/utils/logger.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import type { OnSetDocContext } from '@junobuild/functions';
import { IcrcLedgerCanister } from '@junobuild/functions/canisters/ledger/icrc';
import { decodeDocData } from '@junobuild/functions/sdk';

/**
 * Achievement-unlock hook. Runs after every `profiles` write; when an id appears in
 * `unlockedAchievements` for the first time, it mints the achievement's catalog XP value as real,
 * spendable VXP to the user's ledger account and records the payout in `vxp_awards`. The cosmetic
 * `points` accumulation (leaderboard XP) is maintained elsewhere and is untouched here; this adds
 * the real-VXP grant on top.
 *
 * Idempotency is structural, mirroring the streak hook: the award doc key is
 * `${recipient}/achievement/${achievementId}`: a second firing for the same id collides with the
 * first and the assert blocks the duplicate. Combined with the append-only `unlockedAchievements`
 * array, each achievement pays at most once per account.
 *
 * Only the delta (newly added ids on this write) is paid: achievements already unlocked before
 * this write are never retroactively minted. A `failed` payout is sent again when its id is newly
 * unlocked on a later write (`reclaimAward`).
 */

const AWARD_TYPE = 'achievement' as const;

/** Catalog XP per achievement id (whole VXP), frozen at module load. */
const ACHIEVEMENT_XP: Readonly<Record<string, number>> = Object.freeze(
	Object.fromEntries(ACHIEVEMENTS.map(({ id, xp }) => [id, xp]))
);

/** Subset of the profile shape this hook reads: the full `UserProfile` isn't needed. */
interface UnlockedAchievementsSlice {
	unlockedAchievements?: string[];
}

/**
 * Ids newly present in `next` versus `prev`: the achievements unlocked on this write. Empty in the
 * common case (most profile writes don't unlock anything).
 */
const newlyUnlocked = ({ prev, next }: { prev: string[]; next: string[] }): string[] => {
	if (next.length === 0) {
		return [];
	}

	const known = new Set(prev);

	return next.filter((id) => !known.has(id));
};

/**
 * Files the pending award doc of a first payout. Returns false when the write is refused: most
 * likely a concurrent hook firing already wrote the pending doc, and that firing will (or has
 * already) issue the transfer.
 */
const persistAchievementAward = ({
	recipient,
	achievementId,
	amount
}: {
	recipient: string;
	achievementId: string;
	amount: bigint;
}): boolean => {
	const pending: VxpAwardDoc = {
		recipient,
		awardType: AWARD_TYPE,
		awardKey: achievementId,
		amountBaseUnits: amount.toString(),
		status: 'pending',
		earnedAtMs: Date.now()
	};

	try {
		persistAward({ recipient, awardType: AWARD_TYPE, awardKey: achievementId, doc: pending });

		return true;
	} catch (e: unknown) {
		logInfo({
			message: 'achievement_award_pending_blocked',
			detail: {
				user: recipient,
				achievement: achievementId,
				error: e instanceof Error ? e.message : String(e)
			}
		});

		return false;
	}
};

const payAchievement = async ({
	ledger,
	recipient,
	achievementId
}: {
	ledger: IcrcLedgerCanister;
	recipient: string;
	achievementId: string;
}): Promise<void> => {
	const xp = ACHIEVEMENT_XP[achievementId];

	// Unknown id (not in the catalog) or a non-positive reward; nothing to mint.
	if (isNullish(xp) || xp <= 0) {
		return;
	}

	const awardKey = achievementId;
	const slot = reclaimAward({ recipient, awardType: AWARD_TYPE, awardKey });

	if (slot.kind === 'held') {
		return;
	}

	const amount = slot.kind === 'retry' ? BigInt(slot.doc.amountBaseUnits) : vxpBaseUnits(xp);

	if (slot.kind === 'free' && !persistAchievementAward({ recipient, achievementId, amount })) {
		return;
	}

	const result = await transferWithBadFeeRetry({
		ledger,
		toOwner: Principal.fromText(recipient),
		amount,
		memo: `vxp:achievement:${awardKey}`
	});

	if (result.ok) {
		logInfo({
			message: 'achievement_award_paid',
			detail: {
				user: recipient,
				achievement: achievementId,
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
		message: 'achievement_award_failed',
		detail: {
			user: recipient,
			achievement: achievementId,
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
 * Profile post-write hook: composes alongside the other `profiles` hooks in `satellite/index.ts`.
 * Mints real VXP for every achievement unlocked on this write.
 */
export const onProfileSetForAchievementAward = async (ctx: OnSetDocContext): Promise<void> => {
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

		const prevDoc = nonNullish(before)
			? decodeDocData<UnlockedAchievementsSlice>(before.data)
			: undefined;
		const nextDoc = decodeDocData<UnlockedAchievementsSlice>(after.data);

		const unlocked = newlyUnlocked({
			prev: prevDoc?.unlockedAchievements ?? [],
			next: nextDoc.unlockedAchievements ?? []
		});

		if (unlocked.length === 0) {
			return;
		}

		const ledger = new IcrcLedgerCanister({
			canisterId: Principal.fromText(VXP_LEDGER_CANISTER_ID)
		});

		for (const achievementId of unlocked) {
			await payAchievement({ ledger, recipient: callerText, achievementId });
		}
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		const user = key.length > 0 ? key : Principal.fromUint8Array(caller).toText();

		logError({
			message: 'hook_error',
			detail: { hook: 'achievement_award', user, error: msg }
		});

		throw e;
	}
};
