import { ZERO } from '#lib/constants/app.constants.ts';
import { VXP_LEDGER_CANISTER_ID } from '#lib/constants/canisters.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import {
	COMEBACK_AWAY_DAYS,
	COMEBACK_BALANCE_FLOOR_BASE_UNITS,
	COMEBACK_RESTORE_TARGET_BASE_UNITS
} from '#lib/constants/vxp-economy.constants.ts';
import { vxpAwardKey, type VxpAwardDoc } from '#lib/types/vxp-award.ts';
import { persistAward, updateAward } from '#satellite/services/vxp-awards.services.ts';
import { transferWithBadFeeRetry } from '#satellite/services/vxp-payout.services.ts';
import { logError, logInfo } from '#satellite/utils/logger.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import type { OnSetDocContext } from '@junobuild/functions';
import { IcrcLedgerCanister } from '@junobuild/functions/canisters/ledger/icrc';
import { decodeDocData, getDocStore } from '@junobuild/functions/sdk';

/**
 * Comeback-restore hook. Runs after every `profiles` write; when a user returns after an absence of
 * at least {@link COMEBACK_AWAY_DAYS} days (measured from the jump in `lastActiveDay`) with a free
 * balance below {@link COMEBACK_BALANCE_FLOOR_BASE_UNITS}, it tops their ledger balance up to
 * {@link COMEBACK_RESTORE_TARGET_BASE_UNITS} so they have stake to play again.
 *
 * `lastActiveDay` is only advanced when the user makes a prediction on a new day (there is no
 * app-open write), so the restore fires as the returning user re-engages rather than on mere
 * app-open — a deliberate, architecture-driven trigger.
 *
 * Idempotency is structural and one-time per account: the award doc key is
 * `${recipient}/comeback/restore` (a single fixed `awardKey`), so it can be granted at most once —
 * the anti-farming bound that stops a deplete→wait→return loop from milking the restore repeatedly.
 *
 * Mirrors the streak / achievement award mechanism (`vxp_awards`, `pending`→`paid`/`failed`).
 */

const AWARD_TYPE = 'comeback' as const;
const COMEBACK_AWARD_KEY = 'restore';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Subset of the profile shape this hook reads — the full `UserProfile` isn't needed. */
interface LastActiveDaySlice {
	lastActiveDay?: string;
}

/**
 * Whole days between two `YYYY-MM-DD` day strings (UTC-anchored), or `undefined` if either is
 * missing or unparseable. Negative spans (clock skew / backdated day) read as `undefined` so they
 * can't satisfy the absence gate.
 */
const daysBetween = ({
	fromDay,
	toDay
}: {
	fromDay: string;
	toDay: string;
}): number | undefined => {
	const fromMs = Date.parse(`${fromDay}T00:00:00Z`);
	const toMs = Date.parse(`${toDay}T00:00:00Z`);

	if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs < fromMs) {
		return;
	}

	return Math.floor((toMs - fromMs) / MS_PER_DAY);
};

/**
 * Profile post-write hook — composes alongside the other `profiles` hooks in `satellite/index.ts`.
 * Tops a returning, depleted user's balance back up once.
 */
export const onProfileSetForComebackRestore = async (ctx: OnSetDocContext): Promise<void> => {
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

		// Need both endpoints of the gap. A brand-new profile (no `before`) can't be a "return".
		const prevDay = nonNullish(before)
			? decodeDocData<LastActiveDaySlice>(before.data).lastActiveDay
			: undefined;
		const nextDay = decodeDocData<LastActiveDaySlice>(after.data).lastActiveDay;

		if (isNullish(prevDay) || isNullish(nextDay)) {
			return;
		}

		const gap = daysBetween({ fromDay: prevDay, toDay: nextDay });

		if (isNullish(gap) || gap < COMEBACK_AWAY_DAYS) {
			return;
		}

		// One-time per account: if the restore award already exists, skip before any ledger work.
		const existing = getDocStore({
			collection: Collection.VXP_AWARDS,
			key: vxpAwardKey({
				recipient: callerText,
				awardType: AWARD_TYPE,
				awardKey: COMEBACK_AWARD_KEY
			}),
			caller
		});

		if (nonNullish(existing)) {
			return;
		}

		const ledger = new IcrcLedgerCanister({
			canisterId: Principal.fromText(VXP_LEDGER_CANISTER_ID)
		});

		const balance = await ledger.icrc1BalanceOf({
			account: { owner: Principal.fromText(callerText) }
		});

		// Only restore a genuinely depleted stack, and only top up the shortfall to the target.
		if (balance >= COMEBACK_BALANCE_FLOOR_BASE_UNITS) {
			return;
		}

		const amount = COMEBACK_RESTORE_TARGET_BASE_UNITS - balance;

		if (amount <= ZERO) {
			return;
		}

		const pending: VxpAwardDoc = {
			recipient: callerText,
			awardType: AWARD_TYPE,
			awardKey: COMEBACK_AWARD_KEY,
			amountBaseUnits: amount.toString(),
			status: 'pending',
			earnedAtMs: Date.now()
		};

		try {
			persistAward({
				caller,
				recipient: callerText,
				awardType: AWARD_TYPE,
				awardKey: COMEBACK_AWARD_KEY,
				doc: pending
			});
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);

			// A concurrent profile write already armed the restore — stop; the other firing pays it.
			logInfo({
				message: 'comeback_award_pending_blocked',
				detail: { user: callerText, error: msg }
			});

			return;
		}

		const result = await transferWithBadFeeRetry({
			ledger,
			toOwner: Principal.fromText(callerText),
			amount,
			memo: `vxp:comeback:${COMEBACK_AWARD_KEY}`
		});

		if (result.ok) {
			logInfo({
				message: 'comeback_award_paid',
				detail: {
					user: callerText,
					amount: amount.toString(),
					gap_days: gap,
					block_index: result.blockIndex.toString()
				}
			});

			updateAward({
				caller,
				recipient: callerText,
				awardType: AWARD_TYPE,
				awardKey: COMEBACK_AWARD_KEY,
				patch: {
					status: 'paid',
					paidAtMs: Date.now(),
					blockIndex: result.blockIndex.toString()
				}
			});

			return;
		}

		logError({
			message: 'comeback_award_failed',
			detail: { user: callerText, amount: amount.toString(), error: result.error }
		});

		updateAward({
			caller,
			recipient: callerText,
			awardType: AWARD_TYPE,
			awardKey: COMEBACK_AWARD_KEY,
			patch: {
				status: 'failed',
				errorMessage: result.error
			}
		});
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		const user = key.length > 0 ? key : Principal.fromUint8Array(caller).toText();

		logError({
			message: 'hook_error',
			detail: { hook: 'comeback_restore', user, error: msg }
		});

		throw e;
	}
};
