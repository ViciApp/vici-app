import { DAY_IN_MS } from '#lib/constants/time.constants.ts';

/**
 * Length of a challenge link id. 16 characters over the 32-character alphabet below = 80 bits,
 * so a guessed id hits a live link with negligible probability. The id carries no user, handle or
 * market. Mirrors the API (`backend/src/social/challenges.ts`), pinned by its shared-drift suite.
 */
export const CHALLENGE_ID_LENGTH = 16;

/**
 * Crockford base32, the alphabet of referral codes (no `I`, `L`, `O`, `U`). The API issues ids in
 * uppercase and normalises input before checking it, so a pasted lowercase id still resolves.
 */
export const CHALLENGE_ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** The format of a challenge link id, in its stored (uppercase) form. */
export const CHALLENGE_ID_REGEX = new RegExp(
	`^[${CHALLENGE_ID_ALPHABET}]{${CHALLENGE_ID_LENGTH}}$`
);

/**
 * Where the receiving page keeps the link a visitor opened, so their own call on that market,
 * maybe after signing up, can be recorded as the answer.
 */
export const CHALLENGE_CONTEXT_STORAGE_KEY = 'vici.challenge.context.v1';

/** How long an opened link waits for the visitor's call before it is forgotten. */
export const CHALLENGE_CONTEXT_TTL_MS = 7 * DAY_IN_MS;
