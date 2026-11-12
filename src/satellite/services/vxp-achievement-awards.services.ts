import { ACHIEVEMENTS } from '#lib/constants/achievements.constants.ts';
import { VXP_LEDGER_CANISTER_ID } from '#lib/constants/canisters.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import { vxpAwardKey, type VxpAwardDoc } from '#lib/types/vxp-award.ts';
import { vxpBaseUnits } from '#lib/utils/vxp-amount.utils.ts';
import { transferWithBadFeeRetry } from '#satellite/services/vxp-payout.services.ts';
import { logError, logInfo } from '#satellite/utils/logger.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import type { OnSetDocContext } from '@junobuild/functions';
import { IcrcLedgerCanister } from '@junobuild/functions/canisters/ledger/icrc';
import { decodeDocData, encodeDocData, getDocStore, setDocStore } from '@junobuild/functions/sdk';

/**
 * Achievement-unlock hook. Runs after every `profiles` write; when an id appears in
 * `unlockedAchievements` for the first time, it mints the achievement's catalog XP value as real,
 * spendable VXP to the user's ledger account and records the payout in `vxp_awards`. The cosmetic
 * `points` accumulation (leaderboard XP) is maintained elsewhere and is untouched here — this adds
 * the real-VXP grant on top.
 *
 * Idempotency is structural, mirroring the streak hook: the award doc key is
 * `${recipient}/achievement/${achievementId}` — a second firing for the same id collides with the
 * first and the assert blocks the duplicate. Combined with the append-only `unlockedAchievements`
 * array, each achievement pays at most once per account.
 *
 * Only the delta (newly added ids on this write) is paid — achievements already unlocked before
 * this write are never retroactively minted.
 */

/** Catalog XP per achievement id (whole VXP), frozen at module load. */
const ACHIEVEMENT_XP: Readonly<Record<string, number>> = Object.freeze(
	Object.fromEntries(ACHIEVEMENTS.map(({ id, xp }) => [id, xp]))
);

/** Subset of the profile shape this hook reads — the full `UserProfile` isn't needed. */
interface UnlockedAchievementsSlice {
	unlockedAchievements?: string[];
}

/**
 * Ids newly present in `next` versus `prev` — the achievements unlocked on this write. Empty in the
 * common case (most profile writes don't unlock anything).
 */
const newlyUnlocked = ({ prev, next }: { prev: string[]; next: string[] }): string[] => {
	if (next.length === 0) {
		return [];
	}

	const known = new Set(prev);

	return next.filter((id) => !known.has(id));
};

const persistAward = ({
	caller,
	recipient,
	awardKey,
	doc
}: {
	caller: Uint8Array;
	recipient: string;
	awardKey: string;
	doc: VxpAwardDoc;
}): void => {
	const key = vxpAwardKey({ recipient, awardType: 'achievement', awardKey });

	setDocStore({
		caller,
		collection: Collection.VXP_AWARDS,
		key,
		doc: {
			data: encodeDocData(doc)
		}
	});
};

const updateAward = ({
	caller,
	recipient,
	awardKey,
	patch
}: {
	caller: Uint8Array;
	recipient: string;
	awardKey: string;
	patch: Partial<VxpAwardDoc> & Pick<VxpAwardDoc, 'status'>;
}): void => {
	const key = vxpAwardKey({ recipient, awardType: 'achievement', awardKey });
	const existing = getDocStore({
		collection: Collection.VXP_AWARDS,
		key,
		caller
	});

	if (isNullish(existing)) {
		return;
	}

	const existingDoc = decodeDocData<VxpAwardDoc>(existing.data);
	const next: VxpAwardDoc = { ...existingDoc, ...patch };

	setDocStore({
		caller,
		collection: Collection.VXP_AWARDS,
		key,
		doc: {
			data: encodeDocData(next),
			version: existing.version
		}
	});
};

const payAchievement = async ({
	ledger,
	caller,
	recipient,
	achievementId
}: {
	ledger: IcrcLedgerCanister;
	caller: Uint8Array;
	recipient: string;
	achievementId: string;
}): Promise<void> => {
	const xp = ACHIEVEMENT_XP[achievementId];

	// Unknown id (not in the catalog) or a non-positive reward — nothing to mint.
	if (isNullish(xp) || xp <= 0) {
		return;
	}

	const amount = vxpBaseUnits(xp);
	const awardKey = achievementId;
	const earnedAtMs = Date.now();

	// Idempotency: if the award doc already exists, skip — the assert rejects duplicate creations
	// anyway, but checking up front avoids the wasted ledger call.
	const existingKey = vxpAwardKey({ recipient, awardType: 'achievement', awardKey });
	const existing = getDocStore({
		collection: Collection.VXP_AWARDS,
		key: existingKey,
		caller
	});

	if (nonNullish(existing)) {
		return;
	}

	const pending: VxpAwardDoc = {
		recipient,
		awardType: 'achievement',
		awardKey,
		amountBaseUnits: amount.toString(),
		status: 'pending',
		earnedAtMs
	};

	try {
		persistAward({ caller, recipient, awardKey, doc: pending });
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);

		// Most likely a concurrent hook firing already wrote the pending doc. Surface and stop — the
		// other firing will (or has already) issued the transfer.
		logInfo({
			message: 'achievement_award_pending_blocked',
			detail: { user: recipient, achievement: achievementId, error: msg }
		});

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
			caller,
			recipient,
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
		caller,
		recipient,
		awardKey,
		patch: {
			status: 'failed',
			errorMessage: result.error
		}
	});
};

/**
 * Profile post-write hook — composes alongside the other `profiles` hooks in `satellite/index.ts`.
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
			await payAchievement({ ledger, caller, recipient: callerText, achievementId });
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
