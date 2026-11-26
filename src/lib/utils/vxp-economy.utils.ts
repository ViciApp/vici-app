import {
	isVxpCallSize,
	VXP_CALL_SIZE_STEP,
	VXP_DEFAULT_CALL_SIZE,
	VXP_MAX_CALL_SIZE,
	VXP_MIN_CALL_SIZE,
	VXP_P_WIN_FLOOR,
	type VxpCallSize
} from '#lib/constants/vxp-economy.constants.ts';

/**
 * Compute the *net* VXP a user would gain on a winning call.
 *
 * Formula:
 *
 *   payout_on_win = amount / max(P_WIN_FLOOR, p_win)
 *   net_win       = payout_on_win − amount
 *
 * The floor on `p_win` caps long-shot payouts at ~20× the amount; without it
 * a 1% side would pay 100× and deplete the economy.
 *
 * Returns the *true* net, which can be **below 1** for a heavy favourite:
 * the server settles the raw `amount·(1/price − 1)` cashflow (minus a small
 * fee) with **no** payout floor, so a 0.99 side on a default-size call really nets
 * ~0.5 VXP. We deliberately do **not** round or floor here: that would
 * over-promise a "+1" the settlement never credits. The
 * caller decides display granularity via `formatWholeVxpMagnitude`, which
 * renders a sub-1 win as `<1` rather than rounding it to a misleading `+1`
 * or a broken `+0`. The ~0.15% settlement fee is not modelled here: it is
 * a known, negligible gap (the FE shows `<1` rather than over-promising a
 * `+1` the settlement won't credit).
 */
export const vxpNetWin = ({
	amount,
	pWin
}: {
	/** VXP the user puts on the call. */
	amount: number;
	/** Execution price of the chosen side, 0–1 (the ask via `resolveOutcomeExecutionPrice`, not the consensus mid). */
	pWin: number;
}): number => {
	const safeP = Math.max(VXP_P_WIN_FLOOR, pWin);

	return amount / safeP - amount;
};

/**
 * Normalize any number to a valid call size: the nearest multiple of
 * `VXP_CALL_SIZE_STEP`, clamped into `[VXP_MIN_CALL_SIZE, VXP_MAX_CALL_SIZE]`.
 * A value that is not finite or not positive (the stored `'0'` that means "no
 * size saved") reads as the default. Used on every persisted or bound size, so
 * a preference stored under wider bounds restores inside the current ones.
 */
export const clampVxpCallSize = ({ value }: { value: number }): VxpCallSize => {
	if (!Number.isFinite(value) || value <= 0) {
		return VXP_DEFAULT_CALL_SIZE;
	}

	const stepped = Math.round(value / VXP_CALL_SIZE_STEP) * VXP_CALL_SIZE_STEP;

	return Math.min(VXP_MAX_CALL_SIZE, Math.max(VXP_MIN_CALL_SIZE, stepped)) as VxpCallSize;
};

/**
 * @throws Error when the premium isn't a valid ViciXp call size: a whole
 * multiple of `VXP_CALL_SIZE_STEP` inside `[VXP_MIN_CALL_SIZE, VXP_MAX_CALL_SIZE]`.
 *
 * No max-payout floor is enforced: a winning call always nets a positive
 * amount (the settlement cashflow is `amount·(1/price − 1)`, above zero for
 * any price < 1), so gating on gross payout (`amount / price`) added nothing;
 * it only made any side priced above 0.5 unplaceable at small call sizes,
 * which left users on the smallest sizes with no placeable side on a 50/50
 * market. Heavy favourites net a real sub-1 amount; the UI shows that
 * honestly as "<1" rather than over-promising a "+1" (see `vxpNetWin`).
 */
export const assertViciXpHumanPremium = ({ amountStr }: { amountStr: string }): void => {
	const premiumHuman = Number(String(amountStr).trim());

	if (!isVxpCallSize(premiumHuman)) {
		throw new Error(
			`VXP premium must be a multiple of ${VXP_CALL_SIZE_STEP} from ${VXP_MIN_CALL_SIZE} to ${VXP_MAX_CALL_SIZE}`
		);
	}
};
