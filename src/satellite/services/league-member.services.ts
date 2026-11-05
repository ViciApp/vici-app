import { Collection } from '#lib/constants/collections.constants.ts';
import {
	LEAGUE_MEMBER_ROLES,
	leagueMemberKey,
	type LeagueMemberDoc
} from '#lib/types/league-member.ts';
import type { LeagueDoc } from '#lib/types/league.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import type { AssertDeleteDocContext, AssertSetDocContext } from '@junobuild/functions';
import { decodeDocData, getDocStore } from '@junobuild/functions/sdk';

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
 *  2. **Authorisation model.** A user can write their own
 *     membership row (`member === caller`) — that covers the
 *     join-by-code flow. A league owner can also write rows for
 *     other principals — that covers admin promotion / member
 *     invite. (Demotion / removal under the same gate; a separate
 *     `assertDeleteDoc` will handle leave / kick in a follow-up.)
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
 * member roster — so the integrity guarantees here flow into the
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

	// 1. Key shape — must match the canonical builder.
	const expectedKey = leagueMemberKey({
		leagueId: proposedDoc.leagueId,
		memberPrincipal: proposedDoc.member
	});

	if (key !== expectedKey) {
		throw new Error(
			`league_members key mismatch: expected ${expectedKey}, got ${key} (leagueId/member must match the doc body).`
		);
	}

	// Member principal must parse — defensive against malformed writes.
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

	// Look up the parent league once — both the auth check and the
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
	const callerIsOwner = league.owner === callerText;
	const callerIsSelf = proposedDoc.member === callerText;

	// 2. Authorisation — self-join OR league owner writing for someone.
	if (!callerIsSelf && !callerIsOwner) {
		throw new Error(
			'league_members may only be written by the member themselves or the league owner.'
		);
	}

	// 4 (continued). The `owner` role is reserved for the principal
	// that owns the league doc — even an owner-as-caller can't grant
	// `owner` to a different principal, since league ownership is a
	// property of the parent doc, not the membership row.
	if (proposedDoc.role === 'owner' && proposedDoc.member !== league.owner) {
		throw new Error('league_members role="owner" is reserved for the league owner principal.');
	}

	// Creation path — nothing more to check beyond shape + auth.
	if (isNullish(current)) {
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

	// Role transitions on existing rows are owner-only — a self-edit
	// can re-write the same row (idempotent) but cannot promote oneself.
	if (currentDoc.role !== proposedDoc.role && !callerIsOwner) {
		throw new Error('league_members role changes require the league owner.');
	}
};

/**
 * Pre-delete guard for `league_members`. Closes the membership
 * lifecycle: join (write) → leave / kick (delete).
 *
 *  1. **Owner cannot be removed.** A league always has an owner — even
 *     transferring ownership is a *role change* on the rows, not a
 *     delete-then-recreate. Deleting the owner row would orphan the
 *     league.
 *
 *  2. **Self-leave OR owner-kick.** Either the member themselves
 *     (`caller === currentDoc.member`) or the league owner can remove
 *     a membership row. Admins can't kick — the remove-other action
 *     is reserved for owners so a rogue admin can't quietly empty a
 *     league.
 *
 *  3. **Parent league must exist.** Defensive — if the league has
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

	// 3. Orphaned membership — parent league missing. Let it through;
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

// Exported for future battle / standings services that need to enforce
// "only members of league X can write Y." Keeping the predicate next
// to the assert keeps the auth contract in one place.
export const isLeagueMember = ({
	leagueId,
	principal,
	caller
}: {
	leagueId: string;
	principal: string;
	caller: Uint8Array;
}): boolean => {
	const doc = getDocStore({
		collection: Collection.LEAGUE_MEMBERS,
		key: leagueMemberKey({ leagueId, memberPrincipal: principal }),
		caller
	});

	if (isNullish(doc)) {
		return false;
	}

	const { role } = decodeDocData<LeagueMemberDoc>(doc.data);

	return nonNullish(role);
};
