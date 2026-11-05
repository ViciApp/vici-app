import { DAY_IN_MS } from '#lib/constants/app.constants.ts';

/**
 * How long a rejected friend-request sender must wait before they can
 * send a new request to the same person. The rejecter is exempt — they
 * may re-initiate at any time. Shared FE + satellite: the satellite
 * computes the retry timestamp it returns; the FE only formats it.
 *
 * Product rules: docs/ai/PRODUCT.md § Friendship rules.
 */
export const FRIEND_REQUEST_REJECTED_COOLDOWN_MS = 7 * DAY_IN_MS;
