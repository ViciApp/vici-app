import { Collection } from '#lib/constants/collections.constants.ts';
import { MILLISECOND_IN_NANOSECONDS } from '#lib/constants/time.constants.ts';
import {
	LEAGUE_MEMBER_ROLES,
	leagueMemberKey,
	type LeagueMemberDoc
} from '#lib/types/league-member.ts';
import type { LeagueDoc } from '#lib/types/league.ts';
import { isControllerText } from '#satellite/services/authz.services.ts';
import { escapeRegex } from '#satellite/utils/regex.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import type { AssertDeleteDocContext, AssertSetDocContext } from '@junobuild/functions';
import { decodeDocData, getDocStore, listDocsStore } from '@junobuild/functions/sdk';

/**
 * Pre-write guard for `league_members`. The collection holds the
 * `(league, member, role)` triplet that the social surface
 * lists, sorts, and counts against.
 *
 *  1. **Key shape.** The doc key must equal
 *     `${leagueId}/${member}`. Drift between key and the embedded
 *     fields is the most common path to a duplicate membership
 *     slipping through; this assertion makes it impossible.
 *
 *  2. **Authorisation model.** The invite code is the only way into a
 *     league, so a new row comes from one of two writers: the league
 *     owner writing their own `owner` row when the league is created,
 *     or a satellite controller adding a plain `member` for
 *     `joinLeagueByInvite`, which checks the code first. Nobody else
 *     creates one, the member included: the roster gates the
 *     league-founder achievement and the tournament seeding. A league
 *     owner may rewrite an existing row for another principal (admin
 *     promotion / demotion), and a satellite controller may rewrite one
 *     too (the account purge hands an owned league to a surviving
 *     member); the shape and role rules still hold for both. Leave /
 *     kick is {@link assertDeleteLeagueMember}.
 *
 *  3. **Identity fields are immutable.** `leagueId`, `member`, and
 *     `joinedAtMs` are write-once. Only `role` can change after the
 *     initial join, and only by the league owner.
 *
 *  4. **Role validation.** Must be one of `owner | admin | member`.
 *     `owner` rows are written at league creation (one per league);
 *     this assert allows that path but rejects subsequent attempts
 *     to mint a second `owner` row for the same league.
 *
 * Follow-up `battles` collection references both `leagueId` and the
 * member roster, so the integrity guarantees here flow into the
 * battle state machine.
 */
export const assertSetLeagueMember = ({
	caller,
	data: {
		collection,
		key,
		data: { current, proposed }
	}
}: AssertSetDocContext): void => {
	if (collection !== Collection.LEAGUE_MEMBERS) {
		return;
	}

	const proposedDoc = decodeDocData<LeagueMemberDoc>(proposed.data);

	// 1. Key shape: must match the canonical builder.
	const expectedKey = leagueMemberKey({
		leagueId: proposedDoc.leagueId,
		memberPrincipal: proposedDoc.member
	});

	if (key !== expectedKey) {
		throw new Error(
			`league_members key mismatch: expected ${expectedKey}, got ${key} (leagueId/member must match the doc body).`
		);
	}

	// Member principal must parse: defensive against malformed writes.
	try {
		Principal.fromText(proposedDoc.member);
	} catch {
		throw new Error('league_members member must be a valid principal text.');
	}

	// 4. Role validation.
	if (!LEAGUE_MEMBER_ROLES.has(proposedDoc.role)) {
		throw new Error(
			`league_members role must be one of ${[...LEAGUE_MEMBER_ROLES].join(' | ')} (got "${proposedDoc.role}").`
		);
	}

	// Look up the parent league once: both the auth check and the
	// "no second owner" rule depend on it. Missing parent league = the
	// membership has nothing to attach to; reject.
	const leagueDoc = getDocStore({
		collection: Collection.LEAGUES,
		key: proposedDoc.leagueId,
		caller
	});

	if (isNullish(leagueDoc)) {
		throw new Error(`league_members references unknown league "${proposedDoc.leagueId}".`);
	}

	const league = decodeDocData<LeagueDoc>(leagueDoc.data);
	const callerText = Principal.fromUint8Array(caller).toText();
	const callerIsController = isControllerText(callerText);
	const callerIsOwner = league.owner === callerText || callerIsController;
	const callerIsSelf = proposedDoc.member === callerText;

	// 2. Authorisation: self-join OR league owner writing for someone.
	if (!callerIsSelf && !callerIsOwner) {
		throw new Error(
			'league_members may only be written by the member themselves or the league owner.'
		);
	}

	// 4 (continued). The `owner` role is reserved for the principal
	// that owns the league doc: even an owner-as-caller can't grant
	// `owner` to a different principal, since league ownership is a
	// property of the parent doc, not the membership row.
	if (proposedDoc.role === 'owner' && proposedDoc.member !== league.owner) {
		throw new Error('league_members role="owner" is reserved for the league owner principal.');
	}

	// Creation path: the owner's own row at league creation (the
	// reserved-owner check above already ties an `owner` row to the league
	// owner), or a plain member added by the satellite once
	// `joinLeagueByInvite` has checked the invite code.
	if (isNullish(current)) {
		const isFounderRow = callerIsSelf && league.owner === callerText;

		if (!isFounderRow && !callerIsController) {
			throw new Error('league_members: join a league through joinLeagueByInvite.');
		}

		if (!isFounderRow && proposedDoc.role !== 'member') {
			throw new Error('league_members: a joining member gets role="member".');
		}

		return;
	}

	// 3. Identity fields are immutable on edits.
	const currentDoc = decodeDocData<LeagueMemberDoc>(current.data);

	if (
		currentDoc.leagueId !== proposedDoc.leagueId ||
		currentDoc.member !== proposedDoc.member ||
		currentDoc.joinedAtMs !== proposedDoc.joinedAtMs
	) {
		throw new Error('league_members identity fields are immutable (leagueId, member, joinedAtMs).');
	}

	// Role transitions on existing rows are owner-only: a self-edit
	// can re-write the same row (idempotent) but cannot promote oneself.
	if (currentDoc.role !== proposedDoc.role && !callerIsOwner) {
		throw new Error('league_members role changes require the league owner.');
	}
};

/**
 * Pre-delete guard for `league_members`. Closes the membership
 * lifecycle: join (write) → leave / kick (delete).
 *
 *  1. **Owner cannot be removed.** A league always has an owner: even
 *     transferring ownership is a *role change* on the rows, not a
 *     delete-then-recreate. Deleting the owner row would orphan the
 *     league.
 *
 *  2. **Self-leave OR owner-kick.** Either the member themselves
 *     (`caller === currentDoc.member`) or the league owner can remove
 *     a membership row. Admins can't kick: the remove-other action
 *     is reserved for owners so a rogue admin can't quietly empty a
 *     league.
 *
 * A satellite controller skips both rules: the owner disband
 * (`deleteLeagueFn`) and the account purge remove every row of a league,
 * the owner row included, and sign those deletes as a controller.
 *
 *  3. **Parent league must exist.** Defensive: if the league has
 *     already been deleted (which would only happen if a future
 *     `assertDeleteLeague` lands and cascades) the membership is
 *     orphaned and any caller can clean it up. Until then, this is a
 *     belt-and-braces guard.
 */
export const assertDeleteLeagueMember = ({
	caller,
	data: {
		collection,
		data: { current }
	}
}: AssertDeleteDocContext): void => {
	if (collection !== Collection.LEAGUE_MEMBERS) {
		return;
	}

	// No existing doc → nothing to delete; juno typically won't even
	// call the assert in this case, but defend against it anyway.
	if (isNullish(current)) {
		return;
	}

	if (isControllerText(Principal.fromUint8Array(caller).toText())) {
		return;
	}

	const currentDoc = decodeDocData<LeagueMemberDoc>(current.data);

	// 1. Owner cannot be removed.
	if (currentDoc.role === 'owner') {
		throw new Error('league_members owner row cannot be deleted (transfer ownership first).');
	}

	const leagueDoc = getDocStore({
		collection: Collection.LEAGUES,
		key: currentDoc.leagueId,
		caller
	});

	// 3. Orphaned membership: parent league missing. Let it through;
	//    cleanup is harmless and avoids stuck dangling rows.
	if (isNullish(leagueDoc)) {
		return;
	}

	const league = decodeDocData<LeagueDoc>(leagueDoc.data);
	const callerText = Principal.fromUint8Array(caller).toText();
	const callerIsSelf = currentDoc.member === callerText;
	const callerIsOwner = league.owner === callerText;

	// 2. Self-leave OR owner-kick.
	if (!callerIsSelf && !callerIsOwner) {
		throw new Error(
			'league_members may only be removed by the member themselves or the league owner.'
		);
	}
};

/**
 * Every membership row of a league, the owner row included. The
 * `league_members` key is `${leagueId}/${principal}`, so the scan is anchored
 * to that prefix with a key matcher: the datastore skips (and never decodes)
 * rows for other leagues, keeping this O(this-league's-members) rather than
 * O(all-members).
 */
export const leagueMemberRows = ({
	leagueId,
	caller
}: {
	leagueId: string;
	caller: Uint8Array;
}): ReturnType<typeof listDocsStore>['items'] =>
	listDocsStore({
		collection: Collection.LEAGUE_MEMBERS,
		caller,
		params: { matcher: { key: `^${escapeRegex(`${leagueId}/`)}` } }
	}).items;

/**
 * Every membership row of one member, across leagues. Anchored to the
 * `/${principal}` key suffix for the same reason as {@link leagueMemberRows}:
 * O(this member's leagues) rather than O(all memberships).
 */
export const memberLeagueRows = ({
	memberPrincipal,
	caller
}: {
	memberPrincipal: string;
	caller: Uint8Array;
}): ReturnType<typeof listDocsStore>['items'] =>
	listDocsStore({
		collection: Collection.LEAGUE_MEMBERS,
		caller,
		params: { matcher: { key: `${escapeRegex(`/${memberPrincipal}`)}$` } }
	}).items;

/**
 * Current member principals of a league: the members whose settled history a
 * league's score is read from, scanned with {@link leagueMemberRows}.
 *
 * `joinedBeforeMs` keeps only memberships stored before that instant (the
 * doc's own `created_at`, never the client-written `joinedAtMs`), so a
 * member who joins after a scoring window cannot lift it.
 */
export const leagueMemberPrincipals = ({
	leagueId,
	caller,
	joinedBeforeMs
}: {
	leagueId: string;
	caller: Uint8Array;
	joinedBeforeMs?: number;
}): Principal[] => {
	const prefix = `${leagueId}/`;
	const joinedBeforeNs = isNullish(joinedBeforeMs)
		? undefined
		: BigInt(joinedBeforeMs) * MILLISECOND_IN_NANOSECONDS;

	const principals: Principal[] = [];

	for (const [key, item] of leagueMemberRows({ leagueId, caller })) {
		const inWindow = isNullish(joinedBeforeNs) || item.created_at < joinedBeforeNs;

		if (key.startsWith(prefix) && inWindow) {
			try {
				const member = decodeDocData<LeagueMemberDoc>(item.data);

				if (member.leagueId === leagueId) {
					principals.push(Principal.fromText(member.member));
				}
			} catch {
				// A malformed row can't contribute a member: skip it.
			}
		}
	}

	return principals;
};

/**
 * Whether `callerText` is part way through disbanding `leagueId`: the league
 * doc is gone (the first disband call deletes it) while the caller's own
 * `owner` membership row is not (the last call deletes it). That row is what
 * authorises the rest of the disband once the doc is gone.
 */
export const leagueDisbandInProgress = ({
	leagueId,
	callerText,
	callerBytes
}: {
	leagueId: string;
	callerText: string;
	callerBytes: Uint8Array;
}): boolean => {
	if (
		nonNullish(getDocStore({ collection: Collection.LEAGUES, key: leagueId, caller: callerBytes }))
	) {
		return false;
	}

	const ownerRow = getDocStore({
		collection: Collection.LEAGUE_MEMBERS,
		key: leagueMemberKey({ leagueId, memberPrincipal: callerText }),
		caller: callerBytes
	});

	return nonNullish(ownerRow) && decodeDocData<LeagueMemberDoc>(ownerRow.data).role === 'owner';
};

/**
 * Every league `callerText` is part way through disbanding
 * ({@link leagueDisbandInProgress}), found from the caller's own membership
 * rows (keys end in `/${callerText}`), not from what a request names: once
 * the first disband call has deleted the league doc, no reader lists that
 * league any more, so a later request cannot be relied on to name it.
 */
export const leagueDisbandsInProgress = ({
	callerText,
	callerBytes
}: {
	callerText: string;
	callerBytes: Uint8Array;
}): string[] => {
	const suffix = `/${callerText}`;

	return memberLeagueRows({ memberPrincipal: callerText, caller: callerBytes })
		.map(([key]) => key.slice(0, -suffix.length))
		.filter((leagueId) => leagueDisbandInProgress({ leagueId, callerText, callerBytes }));
};
