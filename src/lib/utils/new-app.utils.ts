import { REFERRAL_CODE_REGEX } from '$lib/constants/referral.constants';
import { LEAGUE_INVITE_CODE_REGEX } from '$lib/types/league';
import { isNullish, nonNullish } from '@dfinity/utils';

/**
 * Where the legacy build sends a would-be new user on the new app. The new app
 * serves the same invite routes (`/league/{code}?ref=`, `/i/{code}`) and its
 * importer carried the invite and referral codes over, so an invite captured
 * here keeps working there. Codes come from browser storage, so anything that
 * fails its canonical shape is dropped rather than put in the URL.
 */
export const newAppSignupUrl = ({
	origin,
	referralCode,
	leagueInvite
}: {
	origin: string;
	referralCode?: string;
	leagueInvite?: string;
}): string => {
	const referral =
		nonNullish(referralCode) && REFERRAL_CODE_REGEX.test(referralCode) ? referralCode : undefined;

	if (nonNullish(leagueInvite) && LEAGUE_INVITE_CODE_REGEX.test(leagueInvite)) {
		const query = isNullish(referral) ? '' : `?ref=${referral}`;

		return `${origin}/league/${leagueInvite}${query}`;
	}

	if (nonNullish(referral)) {
		return `${origin}/i/${referral}`;
	}

	return `${origin}/signup`;
};
