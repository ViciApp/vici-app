import { VXP_LEDGER_CANISTER_ID } from '#lib/constants/canisters.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import {
	VXP_LEAGUE_FOUNDER_MAX_AWARDS,
	VXP_LEAGUE_FOUNDER_REWARD_BASE_UNITS
} from '#lib/constants/vxp-economy.constants.ts';
import type { LeagueDoc } from '#lib/types/league.ts';
import { vxpAwardKey, type VxpAwardDoc } from '#lib/types/vxp-award.ts';
import { listMyLeaguesFn } from '#satellite/services/cohort.services.ts';
import { persistAward, updateAward } from '#satellite/services/vxp-awards.services.ts';
import { transferWithBadFeeRetry } from '#satellite/services/vxp-payout.services.ts';
import { logError, logInfo } from '#satellite/utils/logger.utils.ts';
import { nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import type { OnSetDocContext } from '@junobuild/functions';
import { IcrcLedgerCanister } from '@junobuild/functions/canisters/ledger/icrc';
import { msgCaller } from '@junobuild/functions/ic-cdk';
import { countDocsStore, decodeDocData, getDocStore } from '@junobuild/functions/sdk';

/**
 * League-founder hook. Runs after every `leagues` write; on the
 * *creation* write (no `before` doc) it credits the founder the
 * "Founder +100 VXP" the create-league CTA promises and persists the
 * payout in `vxp_awards`.
 *
 * This hook genuinely fires because `leagues` rows are written by the
 * **client** (`createLeague` calls `setDoc`), and Juno only invokes
 * `onSetDoc` for client `set_doc` writes — not for serverless
 * `setDocStore` (the trap that silently dropped the referral payout).
 *
 * Idempotency is structural: the award doc key is
 * `${recipient}/league_founder/${leagueId}` — a second hook firing for
 * the same league collides with the first and the assert blocks the
 * duplicate write. No timestamp-based dedupe needed.
 *
 * Founding a league is free, so an uncapped per-league payout would be
 * an unbounded mint; a per-account cap of
 * {@link VXP_LEAGUE_FOUNDER_MAX_AWARDS} bounds the total, counted off the
 * caller's own `league_founder` award docs.
 */

const AWARD_TYPE = 'league_founder' as const;

/**
 * Count of `league_founder` award docs this recipient already owns. The
 * docs are keyed `{recipient}/league_founder/{leagueId}`, so the builder
 * with an empty `awardKey` yields the caller's founder-award key prefix;
 * `matcher.key` is matched as a regex by the datastore, so anchor it to
 * the start to bound the scan to just this caller's founder docs.
 */
const founderAwardCount = ({
	caller,
	recipient
}: {
	caller: Uint8Array;
	recipient: string;
}): number => {
	const prefix = vxpAwardKey({ recipient, awardType: AWARD_TYPE, awardKey: '' });

	return Number(
		countDocsStore({
			collection: Collection.VXP_AWARDS,
			caller,
			params: { matcher: { key: `^${prefix}` } }
		})
	);
};

/**
 * Outcome of a single founder-reward attempt. `paid` means a transfer
 * landed on this call; the others are no-ops the caller can tally.
 */
type FounderPayoutOutcome = 'paid' | 'already' | 'capped' | 'blocked' | 'failed';

const payFounderReward = async ({
	ledger,
	caller,
	recipient,
	leagueId
}: {
	ledger: IcrcLedgerCanister;
	caller: Uint8Array;
	recipient: string;
	leagueId: string;
}): Promise<FounderPayoutOutcome> => {
	const amount = VXP_LEAGUE_FOUNDER_REWARD_BASE_UNITS;
	const earnedAtMs = Date.now();

	// Idempotency: if this league's award doc already exists, skip — the
	// assert rejects duplicate creations anyway, but checking up front
	// avoids the wasted ledger call on a hook re-fire or a self-heal pass.
	const key = vxpAwardKey({ recipient, awardType: AWARD_TYPE, awardKey: leagueId });
	const existing = getDocStore({
		collection: Collection.VXP_AWARDS,
		key,
		caller
	});

	if (nonNullish(existing)) {
		return 'already';
	}

	// Per-account cap: founding a league is free, so bound the total mint.
	if (founderAwardCount({ caller, recipient }) >= VXP_LEAGUE_FOUNDER_MAX_AWARDS) {
		logInfo({
			message: 'league_founder_award_capped',
			detail: { user: recipient, league: leagueId, cap: VXP_LEAGUE_FOUNDER_MAX_AWARDS }
		});

		return 'capped';
	}

	const pending: VxpAwardDoc = {
		recipient,
		awardType: AWARD_TYPE,
		awardKey: leagueId,
		amountBaseUnits: amount.toString(),
		status: 'pending',
		earnedAtMs
	};

	try {
		persistAward({ caller, recipient, awardType: AWARD_TYPE, awardKey: leagueId, doc: pending });
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);

		// Most likely cause: a concurrent hook firing already wrote the
		// pending doc. Either way, surface and stop — the other firing will
		// (or has already) issued the transfer.
		logInfo({
			message: 'league_founder_award_pending_blocked',
			detail: { user: recipient, league: leagueId, error: msg }
		});

		return 'blocked';
	}

	const result = await transferWithBadFeeRetry({
		ledger,
		toOwner: Principal.fromText(recipient),
		amount,
		memo: `vxp:league_founder:${leagueId}`
	});

	if (result.ok) {
		logInfo({
			message: 'league_founder_award_paid',
			detail: {
				user: recipient,
				league: leagueId,
				amount: amount.toString(),
				block_index: result.blockIndex.toString()
			}
		});

		updateAward({
			caller,
			recipient,
			awardType: AWARD_TYPE,
			awardKey: leagueId,
			patch: {
				status: 'paid',
				paidAtMs: Date.now(),
				blockIndex: result.blockIndex.toString()
			}
		});

		return 'paid';
	}

	logError({
		message: 'league_founder_award_failed',
		detail: {
			user: recipient,
			league: leagueId,
			amount: amount.toString(),
			error: result.error
		}
	});

	updateAward({
		caller,
		recipient,
		awardType: AWARD_TYPE,
		awardKey: leagueId,
		patch: {
			status: 'failed',
			errorMessage: result.error
		}
	});

	return 'failed';
};

/**
 * Leagues post-write hook — wired into the `leagues` dispatch in
 * `satellite/index.ts`. Pays the founder reward once, on creation.
 */
export const onLeagueSetForFounderVxpPayout = async (ctx: OnSetDocContext): Promise<void> => {
	const {
		caller,
		data: {
			collection,
			key,
			data: { before, after }
		}
	} = ctx;

	try {
		if (collection !== Collection.LEAGUES) {
			return;
		}

		// Only the creation write mints the reward. Edits (rename, privacy,
		// cover image) carry a `before` doc and must not re-pay.
		if (nonNullish(before)) {
			return;
		}

		const league = decodeDocData<LeagueDoc>(after.data);
		const callerText = Principal.fromUint8Array(caller).toText();

		// Pay the owner, and only when the founder is the writing caller —
		// the `vxp_awards` assert binds recipient to caller, and a league is
		// created by its owner (`createLeague` sets `owner` to the signer).
		if (league.owner !== callerText) {
			return;
		}

		const ledger = new IcrcLedgerCanister({
			canisterId: Principal.fromText(VXP_LEDGER_CANISTER_ID)
		});

		await payFounderReward({
			ledger,
			caller,
			recipient: callerText,
			leagueId: league.id
		});
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		// `key` is the league id for this collection — the user is the
		// writing caller (the founder), logged separately so a payout
		// failure is traceable to the right principal.
		const user = Principal.fromUint8Array(caller).toText();

		logError({
			message: 'hook_error',
			detail: { hook: 'league_founder_award', league: key, user, error: msg }
		});

		throw e;
	}
};

/**
 * Result of a self-heal settle pass: how many founder rewards this call
 * newly paid. The FE surfaces a one-off "+100 VXP" beat when `settled > 0`.
 */
export interface SettleFounderAwardsResult {
	settled: number;
}

/**
 * Retroactive self-heal for the founder reward. The `onSetDoc` hook only
 * fires on the creation write, so leagues founded before that hook
 * shipped were never paid. This endpoint lets a founder back-claim those:
 * it walks the caller's owned leagues and pays any that still lack a
 * `league_founder` award doc, up to the same per-account cap.
 *
 * Idempotent and safe to call on every Leagues-page mount — it shares the
 * `${recipient}/league_founder/${leagueId}` dedupe key with the hook, so a
 * league already paid (by the hook or a prior pass) is skipped, never
 * double-paid. Recipients and amounts come entirely from the caller's own
 * leagues plus server constants, so it is gated only on a non-anonymous
 * caller.
 */
export const settleFounderAwardsFn = async (): Promise<SettleFounderAwardsResult> => {
	const callerPrincipal = msgCaller();

	if (callerPrincipal.isAnonymous()) {
		return { settled: 0 };
	}

	const caller = callerPrincipal.toUint8Array();
	const recipient = callerPrincipal.toText();

	// Owned leagues only — `listMyLeaguesFn` resolves the caller's
	// memberships (and skips orphaned rows whose league doc is gone, which
	// can't carry a founder award anyway).
	const ownedLeagueIds = listMyLeaguesFn()
		.filter(({ role }) => role === 'owner')
		.map(({ league }) => league.id);

	if (ownedLeagueIds.length === 0) {
		return { settled: 0 };
	}

	const ledger = new IcrcLedgerCanister({
		canisterId: Principal.fromText(VXP_LEDGER_CANISTER_ID)
	});

	let settled = 0;

	for (const leagueId of ownedLeagueIds) {
		try {
			// Sequential by design: each paid award writes its pending doc
			// before the next iteration's cap check reads the count, so the
			// per-account cap holds across the whole batch.
			const outcome = await payFounderReward({ ledger, caller, recipient, leagueId });

			if (outcome === 'paid') {
				settled += 1;
			}
		} catch (e: unknown) {
			// One league's payout hiccup must not abort the rest of the
			// self-heal pass — log and move on; the next pass retries.
			const msg = e instanceof Error ? e.message : String(e);
			logError({
				message: 'league_founder_settle_error',
				detail: { user: recipient, league: leagueId, error: msg }
			});
		}
	}

	return { settled };
};
