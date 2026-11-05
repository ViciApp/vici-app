import { USD_DECIMALS } from '#lib/constants/app.constants.ts';
import { LOCKED_CAPACITY_DISPLAY_UNIT } from '#lib/types/locked-capacity-display.types.ts';

/**
 * Clearing margin / equity fields use this scale for both settlement USD UI and playground VXP 1:1 display.
 */
export const PLAYGROUND_CLEARING_MARGIN_DECIMALS = USD_DECIMALS;

export const PLAYGROUND_DISPLAY_SYMBOL = LOCKED_CAPACITY_DISPLAY_UNIT.Playground;

/**
 * Display decimals for VXP balances.
 *
 * VXP is framed as a point-like currency, so balances render as whole numbers
 * (e.g. `1,000 VXP`) to reinforce the "points" feel. Transfers and other
 * non-balance flows keep their native precision.
 */
export const VXP_BALANCE_DISPLAY_DECIMALS = 0;
