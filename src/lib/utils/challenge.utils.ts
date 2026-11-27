import { CHALLENGE_ID_REGEX } from '#lib/constants/challenge.constants.ts';

/**
 * A challenge link id in its stored form, or `undefined` when the input cannot be one: the same
 * normalisation the API applies (trimmed, uppercased), so a malformed id never costs a request and
 * a pasted lowercase id still resolves.
 */
export const parseChallengeId = (raw: string): string | undefined => {
	const normalized = raw.trim().toUpperCase();

	return CHALLENGE_ID_REGEX.test(normalized) ? normalized : undefined;
};
