import { REFERRAL_CODE_REGEX } from '#lib/constants/referral.constants.ts';
import { LEAGUE_INVITE_CODE_REGEX } from '#lib/types/league.ts';
import { nonNullish } from '@dfinity/utils';

/**
 * The invite codes a signed-out visitor carries until there is an account:
 * pure helpers, so they are specced apart from the storage that holds them
 * (`pending-onboarding.utils`).
 */

/** The invite a signed-out visitor arrived with: a referral code and a league invite code, either optional. */
export interface PendingInvite {
	referralCode?: string;
	leagueInvite?: string;
}

/**
 * The referral code a `?ref=` param carries, normalized, or `undefined` when
 * there is none or it is not a code: a share link falls back to the
 * sharer's handle while their code loads, and a handle fails the pattern.
 */
export const referralCodeFromSearch = (search: string): string | undefined => {
	const normalized = new URLSearchParams(search).get('ref')?.toUpperCase().trim();

	return nonNullish(normalized) && REFERRAL_CODE_REGEX.test(normalized) ? normalized : undefined;
};

/** The well-formed invite codes of a stashed pending-onboarding payload; anything else is dropped. */
export const pendingInviteOf = (payload: Record<string, unknown>): PendingInvite => {
	const { referralCode, leagueInvite } = payload;

	return {
		...(typeof referralCode === 'string' && REFERRAL_CODE_REGEX.test(referralCode)
			? { referralCode }
			: {}),
		...(typeof leagueInvite === 'string' && LEAGUE_INVITE_CODE_REGEX.test(leagueInvite)
			? { leagueInvite }
			: {})
	};
};
