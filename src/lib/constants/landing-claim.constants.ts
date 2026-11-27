import { PublicPath } from '#lib/constants/routes.constants.ts';

/** Quiet time after the last keystroke before the typed handle is probed. */
export const LANDING_CLAIM_CHECK_DEBOUNCE_MS = 250;

/** Digits in the emailed confirmation code. */
export const LANDING_CLAIM_CODE_LENGTH = 6;

/** The capsule widens out of the top-bar button; a very short label still starts it this wide. */
export const LANDING_CLAIM_MIN_ORIGIN_PX = 120;

/** The legal page the email step links to; a literal path so the landing does not bundle the legal texts. */
export const LANDING_CLAIM_PRIVACY_PATH = `${PublicPath.Info}/privacy` as const;

/**
 * The handle this browser last put on the waitlist. A display convenience
 * only (the top-bar button reads @handle on a later visit); the waitlist
 * itself is the record.
 */
export const LANDING_CLAIM_HANDLE_STORAGE_KEY = 'vici.landing.claimed-handle.v1';

/** The parchment wordmark the top bar shows over the dark footage. */
export const LANDING_NAV_WORDMARK_SRC = '/branding/vici-wordmark-parchment.png';
