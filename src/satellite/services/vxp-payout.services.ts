import { transferErrorText } from '#satellite/utils/vxp-payout.utils.ts';
import type { Principal } from '@icp-sdk/core/principal';
import type { Account, IcrcLedgerCanister } from '@junobuild/functions/canisters/ledger/icrc';

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
