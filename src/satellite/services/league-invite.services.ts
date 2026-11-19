import { Collection } from '#lib/constants/collections.constants.ts';
import {
	LEAGUE_INVITE_CODE_REGEX,
	type LeagueDoc,
	type LeagueInviteDoc
} from '#lib/types/league.ts';
import { controllerCaller } from '#satellite/services/authz.services.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import {
	decodeDocData,
	deleteDocStore,
	encodeDocData,
	getDocStore,
	listDocsStore,
	setDocStore
} from '@junobuild/functions/sdk';

/**
 * The invite-code store. A league's code is the only way into it, so it
 * never sits on the public `leagues` doc: it lives in the controllers-only
 * `league_invites` collection, one doc per league keyed by the league id,
 * with the code as the doc's description so a join finds the league with
 * a description matcher instead of decoding every doc. Every read and
 * write here signs as a controller, which the collection rule requires.
 */

const PURPOSE = 'league invite codes';

/** The invite code of `league`, read by the satellite for its members only. */
export const leagueInviteCode = (league: LeagueDoc): string | undefined => {
	const invite = getDocStore({
		caller: controllerCaller(PURPOSE),
		collection: Collection.LEAGUE_INVITES,
		key: league.id
	});

	return isNullish(invite) ? undefined : decodeDocData<LeagueInviteDoc>(invite.data).inviteCode;
};

/** The league that `inviteCode` opens, or `undefined` when none does. */
export const leagueIdForInviteCode = (inviteCode: string): string | undefined => {
	// The regex guard also keeps the code safe to embed in the matcher.
	if (!LEAGUE_INVITE_CODE_REGEX.test(inviteCode)) {
		return;
	}

	const {
		items: [stored]
	} = listDocsStore({
		caller: controllerCaller(PURPOSE),
		collection: Collection.LEAGUE_INVITES,
		params: { matcher: { description: `^${inviteCode}$` } }
	});

	return isNullish(stored) ? undefined : decodeDocData<LeagueInviteDoc>(stored[1].data).leagueId;
};

/**
 * Store `inviteCode` as the code of `leagueId`. Returns `false`, writing
 * nothing, when another league already holds the code: codes are unique,
 * since a join resolves a code to exactly one league.
 */
export const recordLeagueInvite = ({ leagueId, inviteCode }: LeagueInviteDoc): boolean => {
	const holder = leagueIdForInviteCode(inviteCode);

	if (nonNullish(holder) && holder !== leagueId) {
		return false;
	}

	const caller = controllerCaller(PURPOSE);
	const existing = getDocStore({ caller, collection: Collection.LEAGUE_INVITES, key: leagueId });

	setDocStore({
		caller,
		collection: Collection.LEAGUE_INVITES,
		key: leagueId,
		doc: {
			data: encodeDocData<LeagueInviteDoc>({ leagueId, inviteCode }),
			description: inviteCode,
			version: existing?.version
		}
	});

	return true;
};

/** Drop the code of a league that no longer exists. */
export const deleteLeagueInvite = ({ leagueId }: { leagueId: string }): void => {
	const caller = controllerCaller(PURPOSE);
	const existing = getDocStore({ caller, collection: Collection.LEAGUE_INVITES, key: leagueId });

	if (nonNullish(existing)) {
		deleteDocStore({
			caller,
			collection: Collection.LEAGUE_INVITES,
			key: leagueId,
			doc: { version: existing.version }
		});
	}
};
