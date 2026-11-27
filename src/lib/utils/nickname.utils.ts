import {
	MAX_NICKNAME_LENGTH,
	MIN_NICKNAME_LENGTH,
	NICKNAME_PATTERN,
	isReservedHandle
} from '#lib/constants/profile.constants.ts';

/** Why a nickname cannot be claimed whatever the server says: the format rules
 * the API enforces too, plus the platform handles only the app holds. */
export type NicknameFormatIssue = 'required' | 'too_short' | 'too_long' | 'invalid' | 'reserved';

/**
 * The first format rule `nickname` breaks, or `undefined` when only the
 * server's uniqueness check is left. Checked in the server's order, so the
 * reason shown before a probe is the one the probe would give. Reserved
 * handles match on the uniqueness fold, so a case or accent variant of one is
 * reserved too.
 */
export const nicknameFormatIssue = (nickname: string): NicknameFormatIssue | undefined => {
	const trimmed = nickname.trim();

	if (trimmed === '') {
		return 'required';
	}

	if (trimmed.length < MIN_NICKNAME_LENGTH) {
		return 'too_short';
	}

	if (trimmed.length > MAX_NICKNAME_LENGTH) {
		return 'too_long';
	}

	if (!NICKNAME_PATTERN.test(nickname)) {
		return 'invalid';
	}

	return isReservedHandle(nickname) ? 'reserved' : undefined;
};
