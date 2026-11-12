import { VXP_TOKEN } from '#lib/constants/tokens/tokens.ic.constants.ts';
import { parseToken } from '#lib/utils/parse.utils.ts';

/**
 * Whole VXP, as the economy tables write it, to ledger base units. VXP has 4
 * decimals, so a bare `BigInt(400)` would be 0.04 VXP: every award, floor and
 * stake amount goes through here.
 */
export const vxpBaseUnits = (wholeVxp: number | string): bigint =>
	parseToken({ value: `${wholeVxp}`, unitName: VXP_TOKEN.decimals });
