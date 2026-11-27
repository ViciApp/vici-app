import { HANDLE_POOL } from '#lib/constants/handle-pool.constants.ts';
import {
	HANDLE_PATTERN,
	handleUniqueKey,
	isReservedHandle,
	MAX_HANDLE_LENGTH,
	MIN_HANDLE_LENGTH
} from '#lib/constants/handle.constants.ts';

/** Why a handle cannot be claimed whatever the server says: the format rules
 * and the reserved names, which the API enforces too. */
export type HandleFormatIssue = 'required' | 'too_short' | 'too_long' | 'invalid' | 'reserved';

/** Every reason a handle can be refused: a format issue, or another account
 * holds it (or a lookalike of it). */
export type HandleRefusal = HandleFormatIssue | 'taken';

/**
 * The typed handle as the field keeps it, so what is shown is always what
 * {@link HANDLE_PATTERN} accepts: lowercased, accents folded to the base
 * letter, the letters with no accent to strip spelled plainly (`ß` as `ss`),
 * everything else removed, capped at {@link MAX_HANDLE_LENGTH}. A pasted
 * "@Antonio.Ventilii" reads "antonioventilii", "José.M" reads "josem". The
 * same fold as {@link handleUniqueKey}, so what the field shows is the key
 * the server checks for lookalikes.
 */
export const sanitizeHandleInput = (raw: string): string =>
	handleUniqueKey(raw).slice(0, MAX_HANDLE_LENGTH);

/**
 * The first rule `handle` breaks, or `undefined` when only the server's
 * uniqueness check is left. Checked in the server's order, so the reason
 * shown before a probe is the one the probe would give.
 */
export const handleFormatIssue = (handle: string): HandleFormatIssue | undefined => {
	if (handle === '') {
		return 'required';
	}

	if (handle.length < MIN_HANDLE_LENGTH) {
		return 'too_short';
	}

	if (handle.length > MAX_HANDLE_LENGTH) {
		return 'too_long';
	}

	if (!HANDLE_PATTERN.test(handle)) {
		return 'invalid';
	}

	return isReservedHandle(handle) ? 'reserved' : undefined;
};

/**
 * The suggestion pool without the reserved names, so neither a suggestion
 * nor a generated handle is one the server refuses.
 */
export const HANDLE_SUGGESTIONS: readonly string[] = HANDLE_POOL.filter(
	(name) => !isReservedHandle(name)
);

/** Generated handles end in two digits, `00` to `99`. */
const GENERATED_HANDLE_SUFFIX_DIGITS = 2;

/**
 * A handle for an account that arrives without one: a name from the
 * {@link HANDLE_SUGGESTIONS} plus two digits (`seneca42`). The
 * name is cut so the result stays within {@link MAX_HANDLE_LENGTH}; no
 * reserved name carries a digit, so the result is never reserved either.
 * `random` is injectable for tests.
 */
export const generateHandle = (random: () => number = Math.random): string => {
	const name = HANDLE_SUGGESTIONS[Math.floor(random() * HANDLE_SUGGESTIONS.length)];
	const suffix = String(Math.floor(random() * 10 ** GENERATED_HANDLE_SUFFIX_DIGITS)).padStart(
		GENERATED_HANDLE_SUFFIX_DIGITS,
		'0'
	);

	return `${name.slice(0, MAX_HANDLE_LENGTH - GENERATED_HANDLE_SUFFIX_DIGITS)}${suffix}`;
};
