import {
	VXP_DEFAULT_STAKE,
	VXP_P_WIN_FLOOR,
	VXP_STAKE_LADDER,
	type VxpStake
} from '#lib/constants/vxp-economy.constants.ts';

/**
 * Compute the *net* VXP a user would gain on a winning call.
 *
 * Formula:
 *
 *   payout_on_win = stake / max(P_WIN_FLOOR, p_win)
 *   net_win       = payout_on_win − stake
 *
 * The floor on `p_win` caps long-shot payouts at ~20× stake; without it
 * a 1% side would pay 100× and deplete the economy.
 *
 * Returns the *true* net, which can be **below 1** for a heavy favourite:
 * the server settles the raw `stake·(1/price − 1)` cashflow (minus a small
 * fee) with **no** payout floor, so a 0.99 side on a 50 stake really nets
 * ~0.5 VXP. We deliberately do **not** round or floor here — that would
 * over-promise a "+1" the settlement never credits (see issue #188). The
 * caller decides display granularity via `formatWholeVxpMagnitude`, which
 * renders a sub-1 win as `<1` rather than rounding it to a misleading `+1`
 * or a broken `+0`. The ~0.15% settlement fee is not modelled here — it is
 * a known, negligible gap (the FE shows `<1` rather than over-promising a
 * `+1` the settlement won't credit).
 */
export const vxpNetWin = ({
	stake,
	pWin
}: {
	/** User's stake on the call, in VXP. */
	stake: number;
	/** Execution price of the chosen side, 0–1 (the ask via `resolveOutcomeExecutionPrice`, not the consensus mid). */
	pWin: number;
}): number => {
	const safeP = Math.max(VXP_P_WIN_FLOOR, pWin);

	return stake / safeP - stake;
};

/**
 * Snap an arbitrary numeric stake to the nearest valid ladder rung. Used
 * defensively when consuming server / persisted stake values that may
 * have been written before a ladder change.
 */
export const snapToStakeLadder = ({ value }: { value: number }): VxpStake => {
	if (!Number.isFinite(value)) {
		return VXP_DEFAULT_STAKE;
	}

	const [first] = VXP_STAKE_LADDER;
	let best: VxpStake = first;
	let bestDist = Math.abs(value - best);

	for (const stake of VXP_STAKE_LADDER) {
		const dist = Math.abs(value - stake);

		if (dist < bestDist) {
			best = stake;
			bestDist = dist;
		}
	}

	return best;
};
