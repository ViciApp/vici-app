import { REFERRAL_CODE_REGEX } from '#lib/constants/referral.constants.ts';
import { LEAGUE_INVITE_CODE_REGEX } from '#lib/types/league.ts';
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

/**
 * The same page on the new app, for the legacy build once it is shut down. The
 * new app serves the same routes, so a bookmark, an installed app's start URL
 * or a shared market link keeps landing where it pointed.
 */
export const newAppPageUrl = ({
	origin,
	pathname,
	search,
	hash
}: {
	origin: string;
	pathname: string;
	search: string;
	hash: string;
}): string => `${origin}${pathname}${search}${hash}`;
