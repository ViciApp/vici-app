import { Collection } from '#lib/constants/collections.constants.ts';
import { HOUR_IN_MS } from '#lib/constants/time.constants.ts';
import type { LeagueInviteAttemptsDoc, LookupLeagueRefusalReason } from '#lib/types/league.ts';
import { controllerCaller } from '#satellite/services/authz.services.ts';
import { leagueIdForInviteCode } from '#satellite/services/league-invite.services.ts';
import { timeMs } from '#satellite/utils/time.utils.ts';
import { isNullish } from '@dfinity/utils';
import { decodeDocData, encodeDocData, getDocStore, setDocStore } from '@junobuild/functions/sdk';

/**
 * How many invite codes an account may miss within an hour. A code is the
 * only way into a league, so the misses are what bounds guessing one: past
 * the cap no code resolves for the account, a right one included, until its
 * oldest miss is an hour old. A typo or two never comes near it.
 */
export const LEAGUE_INVITE_MISSES_PER_HOUR = 10;

const PURPOSE = 'league invite attempts';

/** The account's misses inside the last hour, with the stored doc's version. */
const recentMisses = (
	callerText: string
): { missedAtMs: number[]; version: bigint | undefined } => {
	const doc = getDocStore({
		caller: controllerCaller(PURPOSE),
		collection: Collection.LEAGUE_INVITE_ATTEMPTS,
		key: callerText
	});

	if (isNullish(doc)) {
		return { missedAtMs: [], version: undefined };
	}

	const sinceMs = timeMs() - HOUR_IN_MS;
	const { missedAtMs } = decodeDocData<LeagueInviteAttemptsDoc>(doc.data);

	return { missedAtMs: missedAtMs.filter((atMs) => atMs > sinceMs), version: doc.version };
};

/** What {@link resolveInviteCode} found: the league, nothing (a miss), or a refusal. */
export interface InviteResolution {
	leagueId?: string;
	reason?: LookupLeagueRefusalReason;
}

/**
 * The league `inviteCode` opens for `callerText`, counting a code that opens
 * none as a miss. An account that has missed {@link LEAGUE_INVITE_MISSES_PER_HOUR}
 * codes within the hour is refused before the code is read, so the cap holds
 * for a right code as much as a wrong one. The lookup preview and the join
 * share the count.
 */
export const resolveInviteCode = ({
	callerText,
	inviteCode
}: {
	callerText: string;
	inviteCode: string;
}): InviteResolution => {
	const { missedAtMs, version } = recentMisses(callerText);

	if (missedAtMs.length >= LEAGUE_INVITE_MISSES_PER_HOUR) {
		return { reason: 'rate_limited' };
	}

	const leagueId = leagueIdForInviteCode(inviteCode);

	if (isNullish(leagueId)) {
		setDocStore({
			caller: controllerCaller(PURPOSE),
			collection: Collection.LEAGUE_INVITE_ATTEMPTS,
			key: callerText,
			doc: {
				data: encodeDocData<LeagueInviteAttemptsDoc>({ missedAtMs: [...missedAtMs, timeMs()] }),
				version
			}
		});
	}

	return { leagueId };
};
