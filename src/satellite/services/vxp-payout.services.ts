import { VXP_LEDGER_CANISTER_ID } from '#lib/constants/canisters.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import { vxpAwardKey, type VxpAwardDoc, type VxpAwardType } from '#lib/types/vxp-award.ts';
import { controllerCaller } from '#satellite/services/authz.services.ts';
import { reclaimAward, updateAward } from '#satellite/services/vxp-awards.services.ts';
import { logError, logInfo } from '#satellite/utils/logger.utils.ts';
import { escapeRegex } from '#satellite/utils/regex.utils.ts';
import { transferErrorText } from '#satellite/utils/vxp-payout.utils.ts';
import { Principal } from '@icp-sdk/core/principal';
import { IcrcLedgerCanister, type Account } from '@junobuild/functions/canisters/ledger/icrc';
import { msgCaller } from '@junobuild/functions/ic-cdk';
import { decodeDocData, listDocsStore } from '@junobuild/functions/sdk';

/**
 * Send a VXP `icrc1Transfer` to a recipient's default account, retrying
 * once with the ledger-reported `expected_fee` on a `BadFee` rejection
 * (the only error worth an automatic second attempt: every other case
 * is terminal). The `memo` is a short tag string (e.g.
 * `vxp:calibration:{seriesId}`) encoded to bytes here so call sites pass
 * a plain string.
 *
 * Shared by every VXP award path (calibration, referral, onboarding,
 * streak / achievement / comeback bonuses, Worlds-podium prizes) so the
 * transfer + single-retry + error-mapping behaviour can't drift between
 * them.
 */
export const transferWithBadFeeRetry = async ({
	ledger,
	toOwner,
	amount,
	memo
}: {
	ledger: IcrcLedgerCanister;
	toOwner: Principal;
	amount: bigint;
	memo: string;
}): Promise<{ ok: true; blockIndex: bigint } | { ok: false; error: string }> => {
	const to: Account = { owner: toOwner };
	const memoBytes = new TextEncoder().encode(memo);

	const tryTransfer = (fee?: bigint) =>
		ledger.icrc1Transfer({
			args: { to, amount, fee, memo: memoBytes }
		});

	const firstAttempt = await tryTransfer();
	const finalAttempt =
		'Err' in firstAttempt && 'BadFee' in firstAttempt.Err
			? await tryTransfer(firstAttempt.Err.BadFee.expected_fee)
			: firstAttempt;

	if ('Ok' in finalAttempt) {
		return { ok: true, blockIndex: finalAttempt.Ok };
	}

	return { ok: false, error: transferErrorText(finalAttempt.Err) };
};

/**
 * The award types whose trigger (a profile write adding the achievement id,
 * or crossing the lifetime call milestone) rarely comes again for the same
 * key, so a `failed` payout of theirs is retried when the profile opens.
 */
const PROFILE_SETTLED_AWARD_TYPES: readonly VxpAwardType[] = ['achievement', 'flow_milestone'];

/**
 * How many failed payouts one {@link settleProfileAwardsFn} call sends
 * again. Each is two serverless writes plus a ledger transfer, and each
 * write costs billions of instructions, so a call stays well under the
 * update limit (see the bulk-rewrite budget note in
 * docs/ai/satellite/patterns.md); the rest wait for the next open.
 */
const PROFILE_AWARD_RETRY_BATCH = 2;

interface FailedAward {
	awardType: VxpAwardType;
	awardKey: string;
	updatedAtNs: bigint;
}

/** `recipient`'s `failed` payouts of `awardType`, with when each was last written. */
const failedAwards = ({
	recipient,
	awardType
}: {
	recipient: string;
	awardType: VxpAwardType;
}): FailedAward[] => {
	const prefix = vxpAwardKey({ recipient, awardType, awardKey: '' });
	const { items } = listDocsStore({
		collection: Collection.VXP_AWARDS,
		caller: controllerCaller(Collection.VXP_AWARDS),
		params: { matcher: { key: `^${escapeRegex(prefix)}` } }
	});

	return items
		.map(([, { data, updated_at }]) => ({
			doc: decodeDocData<VxpAwardDoc>(data),
			updatedAtNs: updated_at
		}))
		.filter(({ doc }) => doc.status === 'failed')
		.map(({ doc, updatedAtNs }) => ({ awardType, awardKey: doc.awardKey, updatedAtNs }));
};

/**
 * Sends one `failed` payout again through `reclaimAward`: at its recorded
 * amount, with the memo every award path uses (`vxp:<type>:<key>`).
 * Returns whether it was paid now.
 */
const retryFailedAward = async ({
	ledger,
	recipient,
	awardType,
	awardKey
}: {
	ledger: IcrcLedgerCanister;
	recipient: string;
	awardType: VxpAwardType;
	awardKey: string;
}): Promise<boolean> => {
	const slot = reclaimAward({ recipient, awardType, awardKey });

	if (slot.kind !== 'retry') {
		return false;
	}

	const result = await transferWithBadFeeRetry({
		ledger,
		toOwner: Principal.fromText(recipient),
		amount: BigInt(slot.doc.amountBaseUnits),
		memo: `vxp:${awardType}:${awardKey}`
	});

	if (result.ok) {
		logInfo({
			message: 'vxp_award_retry_paid',
			detail: { user: recipient, awardType, awardKey, block_index: result.blockIndex.toString() }
		});

		updateAward({
			recipient,
			awardType,
			awardKey,
			patch: { status: 'paid', paidAtMs: Date.now(), blockIndex: result.blockIndex.toString() }
		});

		return true;
	}

	logError({
		message: 'vxp_award_retry_failed',
		detail: { user: recipient, awardType, awardKey, error: result.error }
	});

	updateAward({
		recipient,
		awardType,
		awardKey,
		patch: { status: 'failed', errorMessage: result.error }
	});

	return false;
};

/**
 * Settle path for the caller's failed achievement and Flow milestone
 * payouts, called when the profile opens: sends at most
 * {@link PROFILE_AWARD_RETRY_BATCH} of them again, least recently tried
 * first, and returns how many were paid now. A `pending` payout is never sent again (its transfer may have
 * landed), and a `paid` one is left alone, so calling it on every open
 * is safe.
 */
export const settleProfileAwardsFn = async (): Promise<number> => {
	const caller = msgCaller();

	if (caller.isAnonymous()) {
		return 0;
	}

	const recipient = caller.toText();
	// Least recently tried first: a retry that fails again rewrites its doc,
	// so it moves behind the others and cannot hold the batch on every open.
	const failed = PROFILE_SETTLED_AWARD_TYPES.flatMap((awardType) =>
		failedAwards({ recipient, awardType })
	)
		.sort((a, b) => (a.updatedAtNs < b.updatedAtNs ? -1 : a.updatedAtNs > b.updatedAtNs ? 1 : 0))
		.slice(0, PROFILE_AWARD_RETRY_BATCH);

	if (failed.length === 0) {
		return 0;
	}

	const ledger = new IcrcLedgerCanister({
		canisterId: Principal.fromText(VXP_LEDGER_CANISTER_ID)
	});
	let settled = 0;

	for (const { awardType, awardKey } of failed) {
		if (await retryFailedAward({ ledger, recipient, awardType, awardKey })) {
			settled += 1;
		}
	}

	return settled;
};
