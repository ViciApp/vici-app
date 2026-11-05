import { ICP_TOKEN } from '#lib/constants/tokens/tokens.ic.constants.ts';

export const PORTFOLIO_DEFAULT_DECIMALS = ICP_TOKEN.decimals;

// Default page size for paginated portfolio tables (positions, trade
// history, open orders). Tuned to keep the first viewport on mobile
// readable without forcing too many round-trips through the controls.
export const PORTFOLIO_PAGE_SIZE = 10;
