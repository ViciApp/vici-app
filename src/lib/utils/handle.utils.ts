import {
	HANDLE_DISALLOWED_CHARS,
	HANDLE_PATTERN,
	MAX_HANDLE_LENGTH,
	MIN_HANDLE_LENGTH,
	RESERVED_HANDLES
} from '#lib/constants/profile.constants.ts';
import type { NicknameFormatIssue } from '#lib/utils/nickname.utils.ts';

/**
 * The typed handle as the field keeps it: lowercased, every character
 * {@link HANDLE_PATTERN} refuses stripped, capped at
 * {@link MAX_HANDLE_LENGTH}. A pasted "@Antonio.Ventilii" reads
 * "antonioventilii".
 */
export const sanitizeHandleInput = (raw: string): string =>
	raw.toLowerCase().replace(HANDLE_DISALLOWED_CHARS, '').slice(0, MAX_HANDLE_LENGTH);

/**
 * The first rule `handle` breaks under {@link HANDLE_PATTERN}, or `undefined`
 * when only the server's uniqueness check is left: empty, the length
 * bounds, the charset, then the platform's reserved names.
 */
export const handleFormatIssue = (handle: string): NicknameFormatIssue | undefined => {
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

	return RESERVED_HANDLES.has(handle) ? 'reserved' : undefined;
};
