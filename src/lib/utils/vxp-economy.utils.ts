import {
	VXP_CALL_SIZE_LADDER,
	VXP_DEFAULT_CALL_SIZE,
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
 * fee) with **no** payout floor, so a 0.99 side on a 50 VXP call really nets
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
 * Snap an arbitrary numeric call size to the nearest valid ladder rung. Used
 * defensively when consuming server / persisted call-size values that may
 * have been written before a ladder change.
 */
export const snapToCallSizeLadder = ({ value }: { value: number }): VxpCallSize => {
	if (!Number.isFinite(value)) {
		return VXP_DEFAULT_CALL_SIZE;
	}

	const [first] = VXP_CALL_SIZE_LADDER;
	let best: VxpCallSize = first;
	let bestDist = Math.abs(value - best);

	for (const rung of VXP_CALL_SIZE_LADDER) {
		const dist = Math.abs(value - rung);

		if (dist < bestDist) {
			best = rung;
			bestDist = dist;
		}
	}

	return best;
};
