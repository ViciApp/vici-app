import { Collection } from '#lib/constants/collections.constants.ts';
import { RelationCategory, RelationState } from '#lib/enums/relation.ts';
import { MIN_CALLS_FOR_RANK, type AffiliationStatsDoc } from '#lib/types/affiliation-stats.ts';
import {
	isAffiliationKind,
	type AffiliationDoc,
	type AffiliationKind
} from '#lib/types/affiliation.ts';
import { readBattleDoc, type BattleDoc } from '#lib/types/battle.ts';
import type { LeagueMemberDoc } from '#lib/types/league-member.ts';
import {
	isLeaguePubliclyListed,
	isLeagueRecommendableToFriends,
	type LeagueDoc
} from '#lib/types/league.ts';
import type { Relation } from '#lib/types/relation.ts';
import type { UserMonthlyStatsDoc } from '#lib/types/user-monthly-stats.ts';
import {
	monthAnchorFromMs,
	monthAnchorStartMs,
	monthEndMs
} from '#lib/utils/month-anchor.utils.ts';
import {
	leagueIdForInviteCode,
	leagueInviteCode
} from '#satellite/services/league-invite.services.ts';
import { settledTotalsByPrincipal } from '#satellite/services/settled-history.services.ts';
import { escapeRegex } from '#satellite/utils/regex.utils.ts';
import { timeMs } from '#satellite/utils/time.utils.ts';
import { joinedBeforeMonthClose } from '#satellite/utils/worlds-podium.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import { msgCaller } from '@junobuild/functions/ic-cdk';
import { decodeDocData, getDocStore, listDocsStore } from '@junobuild/functions/sdk';

/**
 * Service-layer aggregation for the social-cohort surface. Pure
 * read helpers over the `leagues` + `league_members` collections;
 * exposed as `defineQuery` endpoints in `satellite/index.ts`.
 *
 * Mutations live in `league.services.ts` / `league-member.services.ts`
 * via the assert path; this file is read-only.
 */

/**
 * Shared affiliation-rank comparator factory. The Worlds leaderboard,
 * the monthly podium fan-out, and the per-affiliation championship
 * history all rank stats docs by the SAME rule:
 *
 *   accuracy desc → calls desc (rewards depth) → affiliationIdentifier asc
 *   (deterministic tie-break across re-runs)
 *
 * The lifetime surface feeds `wins / totalCalls` + `totalCalls`; the
 * monthly surfaces feed `monthWins / monthTotalCalls` + `monthTotalCalls`.
 * Both pass the matching accessors here so the three ranking surfaces
 * provably can't diverge. Pure; no I/O; the returned comparator closes
 * over the provided accessors and nothing else.
 */
const compareAffiliationRank =
	({
		accuracyOf,
		callsOf
	}: {
		accuracyOf: (doc: AffiliationStatsDoc) => number;
		callsOf: (doc: AffiliationStatsDoc) => number;
	}): ((a: AffiliationStatsDoc, b: AffiliationStatsDoc) => number) =>
	// eslint-disable-next-line local-rules/prefer-object-params -- Array.sort comparators take two positional args by contract
	(a, b) => {
		const aAcc = accuracyOf(a);
		const bAcc = accuracyOf(b);

		if (aAcc !== bAcc) {
			return bAcc - aAcc;
		}

		const aCalls = callsOf(a);
		const bCalls = callsOf(b);

		if (aCalls !== bCalls) {
			return bCalls - aCalls;
		}

		return a.affiliationIdentifier < b.affiliationIdentifier
			? -1
			: a.affiliationIdentifier > b.affiliationIdentifier
				? 1
				: 0;
	};

/** The monthly surfaces' ranking: the podium, the frozen month, the champion cup. */
const monthlyRankComparator = compareAffiliationRank({
	accuracyOf: (doc) => doc.monthWins / doc.monthTotalCalls,
	callsOf: (doc) => doc.monthTotalCalls
});

/** Hydrated `LeagueDoc` paired with the caller's role inside it. */
export interface LeagueWithRole {
	league: LeagueDoc;
	role: LeagueMemberDoc['role'];
	joinedAtMs: number;
	/**
	 * Total membership count of the league (owner included), tallied
	 * inline from the same `LEAGUE_MEMBERS` scan that resolves the
	 * caller's memberships; no extra read. Drives the `league-founder`
	 * achievement (owner of a league with ≥3 members).
	 */
	memberCount: number;
}

/**
 * Return every league the caller is a member of, paired with the
 * membership row's role + joinedAtMs.
 *
 * Two scans because juno's listDocs has no SQL-style join: first
 * `league_members` filtered to rows where `member === callerText`,
 * then `getDocStore` each parent league. The membership table is
 * the source of truth for "am I in this league?": joining off the
 * league.owner field would miss leagues where the caller is an
 * `admin` / `member` not `owner`.
 *
 * Sorted by `joinedAtMs` descending so the most recently-joined
 * league surfaces first.
 */
export const listMyLeaguesFn = (): LeagueWithRole[] => {
	const caller = msgCaller();
	const callerText = caller.toText();
	const callerBytes = caller.toUint8Array();

	const { items } = listDocsStore({
		collection: Collection.LEAGUE_MEMBERS,
		caller: callerBytes,
		params: {}
	});

	const myMemberships: { leagueId: string; role: LeagueMemberDoc['role']; joinedAtMs: number }[] =
		[];
	// Tally total members per league from the same scan so the
	// `memberCount` on each hydrated row costs no extra read.
	const memberCounts = new Map<string, number>();

	for (const [, item] of items) {
		try {
			const member = decodeDocData<LeagueMemberDoc>(item.data);

			memberCounts.set(member.leagueId, (memberCounts.get(member.leagueId) ?? 0) + 1);

			if (member.member === callerText) {
				myMemberships.push({
					leagueId: member.leagueId,
					role: member.role,
					joinedAtMs: member.joinedAtMs
				});
			}
		} catch {
			// Malformed rows should never have passed the assert; skip silently.
		}
	}

	const hydrated: LeagueWithRole[] = [];

	for (const m of myMemberships) {
		const leagueDoc = getDocStore({
			collection: Collection.LEAGUES,
			key: m.leagueId,
			caller: callerBytes
		});

		// Skip orphaned rows where the parent league is missing:
		// `assertDeleteLeagueMember` tolerates orphans, so this read
		// side mirrors that policy.
		if (nonNullish(leagueDoc)) {
			try {
				const league = decodeDocData<LeagueDoc>(leagueDoc.data);
				hydrated.push({
					// A member shares the league, so they read its invite code.
					league: { ...league, inviteCode: leagueInviteCode(league) },
					role: m.role,
					joinedAtMs: m.joinedAtMs,
					memberCount: memberCounts.get(m.leagueId) ?? 1
				});
			} catch {
				// Defensive skip on decode failure.
			}
		}
	}

	return hydrated.sort((a, b) => b.joinedAtMs - a.joinedAtMs);
};

/**
 * Return every membership row for a league. The doc key prefix is
 * `${leagueId}/` (per `leagueMemberKey`) so the scan filters on
 * that.
 *
 * Sorted by `joinedAtMs` ascending so the league's roster reads
 * "earliest joiner first": the league-detail member panel ordering.
 */
export const listLeagueMembersFn = ({ leagueId }: { leagueId: string }): LeagueMemberDoc[] => {
	const caller = msgCaller();

	const { items } = listDocsStore({
		collection: Collection.LEAGUE_MEMBERS,
		caller: caller.toUint8Array(),
		params: {}
	});

	const prefix = `${leagueId}/`;
	const members: LeagueMemberDoc[] = [];

	for (const [key, item] of items) {
		if (key.startsWith(prefix)) {
			try {
				const member = decodeDocData<LeagueMemberDoc>(item.data);

				// Belt-and-braces: only accept rows whose embedded
				// `leagueId` matches the prefix, in case a future key
				// shape change drifts.
				if (member.leagueId === leagueId) {
					members.push(member);
				}
			} catch {
				// skip malformed
			}
		}
	}

	return members.sort((a, b) => a.joinedAtMs - b.joinedAtMs);
};

/**
 * List battles that reference a specific league, either as sideA or
 * sideB. Used by the league detail page's "Battles" panel to render
 * proposed / accepted / in-flight / resolved competitions involving
 * this cohort.
 *
 * Sorted by `kickoffMs` ascending so in-flight battles surface before
 * future ones, then proposed/accepted in chronological order.
 */
export const listLeagueBattlesFn = ({ leagueId }: { leagueId: string }): BattleDoc[] => {
	const caller = msgCaller();

	const { items } = listDocsStore({
		collection: Collection.BATTLES,
		caller: caller.toUint8Array(),
		params: {}
	});

	const battles: BattleDoc[] = [];

	for (const [, item] of items) {
		try {
			const battle = readBattleDoc(decodeDocData<BattleDoc>(item.data));

			if (battle.kind === 'league' && (battle.sideA === leagueId || battle.sideB === leagueId)) {
				battles.push(battle);
			}
		} catch {
			// skip malformed
		}
	}

	return battles.sort((a, b) => a.kickoffMs - b.kickoffMs);
};

/**
 * List every battle that involves the caller, either as a duel
 * principal (sideA / sideB on kind='duel') OR as the owner of a
 * league participating in a kind='league' battle.
 *
 * League-side resolution is N+1: each kind='league' battle triggers a
 * `getDocStore` lookup against `LEAGUES` to check ownership. Fine for
 * the battle volumes we expect on the social surface; a reverse
 * index would only matter past ~100s of battles per user.
 *
 * Sorted by `kickoffMs` ascending.
 */
export const listMyBattlesFn = (): BattleDoc[] => {
	const caller = msgCaller();
	const callerText = caller.toText();
	const callerBytes = caller.toUint8Array();

	const { items } = listDocsStore({
		collection: Collection.BATTLES,
		caller: callerBytes,
		params: {}
	});

	const isLeagueOwnedByCaller = (leagueId: string): boolean => {
		const leagueDoc = getDocStore({
			collection: Collection.LEAGUES,
			key: leagueId,
			caller: callerBytes
		});

		if (isNullish(leagueDoc)) {
			return false;
		}

		try {
			return decodeDocData<LeagueDoc>(leagueDoc.data).owner === callerText;
		} catch {
			return false;
		}
	};

	const battles: BattleDoc[] = [];

	for (const [, item] of items) {
		try {
			const battle = readBattleDoc(decodeDocData<BattleDoc>(item.data));

			const involvesCaller =
				battle.kind === 'duel'
					? battle.sideA === callerText || battle.sideB === callerText
					: isLeagueOwnedByCaller(battle.sideA) || isLeagueOwnedByCaller(battle.sideB);

			if (involvesCaller) {
				battles.push(battle);
			}
		} catch {
			// skip malformed
		}
	}

	return battles.sort((a, b) => a.kickoffMs - b.kickoffMs);
};

/** Scalar battle aggregates for the caller: see {@link getMyBattleStatsFn}. */
export interface MyBattleStats {
	/** Resolved battles the caller's side won (draws excluded). */
	boutsWon: number;
}

/**
 * Count the resolved battles the caller's side won: duels by principal
 * match on the winning side, league bouts by the caller owning the
 * winning league. The scalar behind the profile's `boutsWon` counter,
 * served as one number so the recurring stats sync doesn't page the
 * full battle list through {@link listMyBattlesFn}.
 *
 * Cost: one `BATTLES` scan, with league ownership resolved for the
 * WINNING side of resolved non-draw league battles only: memoised to
 * one `getDocStore` per distinct winning league. `listMyBattlesFn`'s
 * N+1 (two lookups per league battle regardless of state) never enters
 * this path.
 */
export const getMyBattleStatsFn = (): MyBattleStats => {
	const caller = msgCaller();
	const callerText = caller.toText();
	const callerBytes = caller.toUint8Array();

	const { items } = listDocsStore({
		collection: Collection.BATTLES,
		caller: callerBytes,
		params: {}
	});

	const ownershipByLeague = new Map<string, boolean>();

	const isLeagueOwnedByCaller = (leagueId: string): boolean => {
		const memo = ownershipByLeague.get(leagueId);

		if (nonNullish(memo)) {
			return memo;
		}

		const leagueDoc = getDocStore({
			collection: Collection.LEAGUES,
			key: leagueId,
			caller: callerBytes
		});

		let owned = false;

		if (nonNullish(leagueDoc)) {
			try {
				owned = decodeDocData<LeagueDoc>(leagueDoc.data).owner === callerText;
			} catch {
				// Malformed league row: treat as not owned.
			}
		}

		ownershipByLeague.set(leagueId, owned);

		return owned;
	};

	let boutsWon = 0;

	for (const [, item] of items) {
		try {
			const battle = readBattleDoc(decodeDocData<BattleDoc>(item.data));

			const hasWinner =
				battle.state === 'resolved' && nonNullish(battle.winner) && battle.winner !== 'draw';

			if (hasWinner) {
				const winningSide = battle.winner === 'A' ? battle.sideA : battle.sideB;

				const callerWon =
					battle.kind === 'duel' ? winningSide === callerText : isLeagueOwnedByCaller(winningSide);

				if (callerWon) {
					boutsWon += 1;
				}
			}
		} catch {
			// skip malformed
		}
	}

	return { boutsWon };
};

/**
 * Look up a league by its 6-char invite code: the read backing the
 * join-by-code preview. Resolves the code through `league_invites` (see
 * `league-invite.services.ts`) and returns the league without the code.
 *
 * Returns `undefined` when no league carries the code. Callers
 * should treat that as "invalid code" UX, not an error.
 */
export const lookupLeagueByInviteFn = ({
	inviteCode
}: {
	inviteCode: string;
}): LeagueDoc | undefined => {
	const leagueId = leagueIdForInviteCode(inviteCode);

	if (isNullish(leagueId)) {
		return;
	}

	const leagueDoc = getDocStore({
		collection: Collection.LEAGUES,
		key: leagueId,
		caller: msgCaller().toUint8Array()
	});

	if (isNullish(leagueDoc)) {
		return;
	}

	const { inviteCode: _legacyCode, ...league } = decodeDocData<LeagueDoc>(leagueDoc.data);

	return league;
};

/**
 * List the leagues the caller can challenge to a battle: the opponent
 * pool for the create-battle picker.
 *
 * Challengeable = every **publicly listed** (Open) league plus every
 * league the caller is a member of (so invite-only / private leagues the
 * caller belongs to are reachable too), **minus** any league the caller
 * owns; those are the from-side of a challenge, never the opponent.
 *
 * Privacy mirrors the rest of the social surface: invite-only and private
 * leagues the caller is NOT a member of stay hidden (they're reachable by
 * invite code, not by browsing the opponent pool). The membership scan
 * resolves "am I in this league?" the same way {@link listMyLeaguesFn}
 * does.
 *
 * Sorted by `name` ascending (locale-naive) so the FE picker reads
 * alphabetically before any client-side search filter narrows it.
 */
export const listChallengeableLeaguesFn = (): LeagueDoc[] => {
	const caller = msgCaller();
	const callerText = caller.toText();
	const callerBytes = caller.toUint8Array();

	// Leagues the caller is a member of: lets invite-only / private
	// leagues the caller belongs to surface as opponents while non-members
	// can't see them.
	const myLeagueIds = new Set<string>();

	const { items: memberItems } = listDocsStore({
		collection: Collection.LEAGUE_MEMBERS,
		caller: callerBytes,
		params: {}
	});

	for (const [, item] of memberItems) {
		try {
			const member = decodeDocData<LeagueMemberDoc>(item.data);

			if (member.member === callerText) {
				myLeagueIds.add(member.leagueId);
			}
		} catch {
			// skip malformed
		}
	}

	const { items } = listDocsStore({
		collection: Collection.LEAGUES,
		caller: callerBytes,
		params: {}
	});

	const challengeable: LeagueDoc[] = [];

	for (const [, item] of items) {
		try {
			const league = decodeDocData<LeagueDoc>(item.data);

			// Never offer a league the caller owns as the opponent: it's
			// the from-side of any challenge they send.
			const ownedByCaller = league.owner === callerText;
			const isPubliclyListed = isLeaguePubliclyListed(league);
			const isMember = myLeagueIds.has(league.id);

			if (!ownedByCaller && (isPubliclyListed || isMember)) {
				challengeable.push(league);
			}
		} catch {
			// skip malformed
		}
	}

	return challengeable.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
};

/**
 * A non-private (Open or Invite-only) league a friend is in but the
 * caller is not, plus the overlap.
 */
export interface FriendRecommendedLeague {
	league: LeagueDoc;
	/** Total members in the league (owner included). */
	memberCount: number;
	/**
	 * Principals of the caller's friends who are members of this league.
	 * Drives the stacked-avatar cluster + "N friends here" count on the
	 * recommendation card.
	 */
	friendMembers: string[];
}

/**
 * Recommend leagues the caller's **friends** are in but the caller is
 * **not**: the "Friends are in" row at the foot of the Leagues list.
 *
 * Definition of "friend": a confirmed, bilateral friendship, i.e. a
 * `RELATIONS` doc with `category === FRIEND`, `state === ACTIVE`, and
 * the caller among its participants. The same definition
 * {@link listFriends} (relation.services) uses. One-way follows are
 * intentionally NOT treated as friends here: a follow is asymmetric and
 * does not imply the followed user consented to a relationship, so
 * surfacing "leagues that someone you follow is in" would leak that
 * user's league membership to an account they never opted into.
 *
 * Privacy scope: Open **and** Invite-only leagues a friend is in are
 * recommended: an invite-only league is a code gate, not secrecy, and a
 * friend already in it is the natural inviter, so a "friends are in" nudge
 * is appropriate. Only **Private** leagues are withheld: they stay hidden
 * and invite-code-only, never surfaced via a friend. Membership itself is
 * only ever exposed for the caller's own confirmed friends (never for
 * strangers), so the surface answers "which Open/Invite-only leagues are
 * my friends in?" and nothing broader.
 *
 * Cost: one scan of `RELATIONS` (friend set), one scan of
 * `LEAGUE_MEMBERS` (member buckets + the caller's own leagues + member
 * tallies), then a `getDocStore` per candidate league to read its
 * privacy + metadata. Candidate count is bounded by the number of
 * distinct leagues the caller's friends belong to.
 *
 * Sorted by friend-overlap count descending (most friends first), then
 * by league name ascending for a deterministic tie-break.
 */
export const listFriendRecommendedLeaguesFn = (): FriendRecommendedLeague[] => {
	const caller = msgCaller();
	const callerText = caller.toText();
	const callerBytes = caller.toUint8Array();

	// ── Friend set: confirmed bilateral friendships involving the caller.
	const { items: relationItems } = listDocsStore({
		collection: Collection.RELATIONS,
		caller: callerBytes,
		params: {}
	});

	const friendPrincipals = new Set<string>();

	for (const [, item] of relationItems) {
		try {
			const relation = decodeDocData<Relation>(item.data);

			if (
				relation.category === RelationCategory.FRIEND &&
				relation.state === RelationState.ACTIVE &&
				relation.participants.includes(callerText)
			) {
				const other = relation.participants.find((p) => p !== callerText);

				if (nonNullish(other)) {
					friendPrincipals.add(other);
				}
			}
		} catch {
			// skip malformed
		}
	}

	// No friends ⇒ nothing to recommend; skip the membership scan.
	if (friendPrincipals.size === 0) {
		return [];
	}

	// ── Single pass over `league_members`: bucket friend members per
	// league, tally total members per league, and collect the caller's
	// own leagues (to exclude them).
	const { items: memberItems } = listDocsStore({
		collection: Collection.LEAGUE_MEMBERS,
		caller: callerBytes,
		params: {}
	});

	const myLeagueIds = new Set<string>();
	const memberCounts = new Map<string, number>();
	const friendsByLeague = new Map<string, Set<string>>();

	for (const [, item] of memberItems) {
		try {
			const member = decodeDocData<LeagueMemberDoc>(item.data);

			memberCounts.set(member.leagueId, (memberCounts.get(member.leagueId) ?? 0) + 1);

			if (member.member === callerText) {
				myLeagueIds.add(member.leagueId);
			} else if (friendPrincipals.has(member.member)) {
				const bucket = friendsByLeague.get(member.leagueId);

				if (nonNullish(bucket)) {
					bucket.add(member.member);
				} else {
					friendsByLeague.set(member.leagueId, new Set([member.member]));
				}
			}
		} catch {
			// skip malformed
		}
	}

	const recommendations: FriendRecommendedLeague[] = [];

	for (const [leagueId, friendSet] of friendsByLeague.entries()) {
		// A friend is in it, but the caller already is too ⇒ not a rec.
		const isRecommendable = !myLeagueIds.has(leagueId);

		if (isRecommendable) {
			const leagueDoc = getDocStore({
				collection: Collection.LEAGUES,
				key: leagueId,
				caller: callerBytes
			});

			// Skip orphaned membership rows whose parent league is gone,
			// mirroring `listMyLeaguesFn`'s tolerance of orphans.
			if (nonNullish(leagueDoc)) {
				try {
					const league = decodeDocData<LeagueDoc>(leagueDoc.data);

					// Never surface a Private league to a non-member, even via a
					// friend. Open and Invite-only both qualify (invite-only is a
					// code gate, not secrecy, and a friend is the natural inviter).
					if (isLeagueRecommendableToFriends(league)) {
						recommendations.push({
							league,
							memberCount: memberCounts.get(leagueId) ?? friendSet.size,
							// Sort for a stable order: the Set's insertion order
							// follows the LEAGUE_MEMBERS scan, which would make the
							// highlighted friend + stacked avatars non-deterministic.
							friendMembers: [...friendSet].sort()
						});
					}
				} catch {
					// skip malformed
				}
			}
		}
	}

	return recommendations.sort((a, b) => {
		if (a.friendMembers.length !== b.friendMembers.length) {
			return b.friendMembers.length - a.friendMembers.length;
		}

		return a.league.name < b.league.name ? -1 : a.league.name > b.league.name ? 1 : 0;
	});
};

/**
 * Caller's current Worlds affiliations: at most one university +
 * one country per user (the assert key shape allows one of each
 * kind simultaneously). Returns the pair as `{ university?, country? }`;
 * when both slots are empty the FE Worlds picker can offer them.
 *
 * Single-pass scan filtered to `member === callerText`; per
 * `AFFILIATION_LOCK_MS` semantics the rows are stable for 90 days
 * once written.
 *
 * Backwards-compat: rows written before the
 * `affiliationId` → `affiliationIdentifier` rename still live in
 * stable memory with the old field key. `decodeDocData` returns the
 * raw msgpack shape (the TS type is a compile-time assertion), so a
 * pre-rename doc decodes with `aff.affiliationIdentifier === undefined`
 * and `aff.affiliationId` populated. Reading both and dropping the
 * row when neither is present keeps `listMyAffiliations` from
 * trapping at the JsonData → Candid boundary (the inner Option
 * struct requires `affiliationIdentifier`).
 */
export const listMyAffiliationsFn = (): {
	university?: AffiliationDoc;
	country?: AffiliationDoc;
} => {
	const caller = msgCaller();
	const held = heldAffiliations({ caller: caller.toUint8Array(), member: caller.toText() });
	const ofKind = (kind: AffiliationKind): AffiliationDoc | undefined =>
		held.find(({ affiliation }) => affiliation.kind === kind)?.affiliation;

	return { university: ofKind('university'), country: ofKind('country') };
};

/**
 * Tolerant `AffiliationDoc` reader. Coerces the legacy
 * `affiliationId` field to `affiliationIdentifier` so pre-rename
 * rows decode cleanly, AND fully validates the remaining required
 * fields so every call site can rely on a well-formed shape.
 *
 * Returns `undefined` when any required field is missing or
 * structurally invalid:
 *
 *  - `affiliationIdentifier` (or legacy `affiliationId`): non-empty string
 *  - `member`: non-empty string (a real principal-text check costs more
 *    than it's worth here; the write-time assert already enforced it)
 *  - `kind`: an `AffiliationKind`
 *  - `joinedAtMs` / `lockedUntilMs`: finite numbers (guards against
 *    `NaN` flowing into the Option-schema parse and into roster sort
 *    comparisons in `listWorldsRosterFn`)
 *
 * Callers skip the row rather than emit a malformed wire shape that
 * would trap the `j.optional(AffiliationWireSchema)` parse or
 * the JsonData → Candid conversion.
 */
export const readAffiliationDoc = (data: Uint8Array): AffiliationDoc | undefined => {
	const raw = decodeDocData<AffiliationDoc & { affiliationId?: string }>(data);
	const identifier = raw.affiliationIdentifier ?? raw.affiliationId;

	if (typeof identifier !== 'string' || identifier.length === 0) {
		return;
	}

	if (typeof raw.member !== 'string' || raw.member.length === 0) {
		return;
	}

	if (!isAffiliationKind(raw.kind)) {
		return;
	}

	if (typeof raw.joinedAtMs !== 'number' || !Number.isFinite(raw.joinedAtMs)) {
		return;
	}

	if (typeof raw.lockedUntilMs !== 'number' || !Number.isFinite(raw.lockedUntilMs)) {
		return;
	}

	return {
		member: raw.member,
		kind: raw.kind,
		affiliationIdentifier: identifier,
		joinedAtMs: raw.joinedAtMs,
		lockedUntilMs: raw.lockedUntilMs
	};
};

/** A member's affiliation of one kind, with the doc's server-stamped `created_at`. */
export interface HeldAffiliation {
	affiliation: AffiliationDoc;
	createdAtNs: bigint;
}

/**
 * Each member's affiliation of each kind: the one row every reader counts.
 * A member holds at most one per kind (`assertSetAffiliation`), but rows
 * written before that rule can hold two; the earliest stored one (Juno
 * `created_at`, then key) is the one the 90-day lock bound, so it wins
 * everywhere. Pass `member` to scan only that member's rows, `kind` to keep
 * one kind.
 */
export const heldAffiliations = ({
	caller,
	member,
	kind
}: {
	caller: Uint8Array;
	member?: string;
	kind?: AffiliationKind;
}): HeldAffiliation[] => {
	const { items } = listDocsStore({
		collection: Collection.AFFILIATIONS,
		caller,
		params: isNullish(member) ? {} : { matcher: { key: `^${escapeRegex(member)}/` } }
	});

	const held = new Map<string, HeldAffiliation & { key: string }>();

	for (const [key, item] of items) {
		let affiliation: AffiliationDoc | undefined;

		try {
			affiliation = readAffiliationDoc(item.data);
		} catch {
			// skip malformed
			affiliation = undefined;
		}

		if (
			nonNullish(affiliation) &&
			(isNullish(member) || affiliation.member === member) &&
			(isNullish(kind) || affiliation.kind === kind)
		) {
			const slot = `${affiliation.member}/${affiliation.kind}`;
			const kept = held.get(slot);
			const earlier =
				isNullish(kept) ||
				item.created_at < kept.createdAtNs ||
				(item.created_at === kept.createdAtNs && key < kept.key);

			if (earlier) {
				held.set(slot, { affiliation, createdAtNs: item.created_at, key });
			}
		}
	}

	return [...held.values()].map(({ affiliation, createdAtNs }) => ({ affiliation, createdAtNs }));
};

/**
 * Roster scan for a Worlds slot: every user affiliated with a given
 * university or country. Drives the Worlds leaderboard / cohort
 * summary surface.
 *
 * Scans the full `affiliations` collection and filters on the
 * embedded `kind` + `affiliationIdentifier`. Sorted by `joinedAtMs`
 * ascending so the leaderboard reads "earliest joiner first" before
 * any accuracy-based re-sort the FE layers on top.
 */
export const listWorldsRosterFn = ({
	kind,
	affiliationIdentifier
}: {
	kind: AffiliationKind;
	affiliationIdentifier: string;
}): AffiliationDoc[] => {
	const roster = heldAffiliations({ caller: msgCaller().toUint8Array(), kind })
		.map(({ affiliation }) => affiliation)
		.filter((aff) => aff.affiliationIdentifier === affiliationIdentifier);

	return roster.sort((a, b) => a.joinedAtMs - b.joinedAtMs);
};

/** A single affiliation's real member tally for a Worlds kind. */
export interface AffiliationMemberCount {
	affiliationIdentifier: string;
	kind: AffiliationKind;
	memberCount: number;
}

/**
 * Member-count aggregate for every affiliation of a Worlds kind.
 * One pass over the `affiliations` collection, bucketed by
 * `affiliationIdentifier`. Returns a real count (number of users who
 * hold that university / country slot): the same source of truth as
 * `listWorldsRosterFn`, but tallied to a scalar so a caller that only
 * needs "N members" (the picker, a detail-page chip) doesn't have to
 * page the full roster payload per affiliation.
 *
 * Affiliations with no members simply don't appear in the result:
 * callers treat a missing entry as zero / "no members yet".
 */
export const listWorldsMemberCountsFn = ({
	kind
}: {
	kind: AffiliationKind;
}): AffiliationMemberCount[] => {
	const counts = new Map<string, number>();

	for (const { affiliation } of heldAffiliations({ caller: msgCaller().toUint8Array(), kind })) {
		counts.set(
			affiliation.affiliationIdentifier,
			(counts.get(affiliation.affiliationIdentifier) ?? 0) + 1
		);
	}

	return [...counts.entries()]
		.map(([affiliationIdentifier, memberCount]) => ({ affiliationIdentifier, kind, memberCount }))
		.sort((a, b) =>
			b.memberCount !== a.memberCount
				? b.memberCount - a.memberCount
				: a.affiliationIdentifier < b.affiliationIdentifier
					? -1
					: a.affiliationIdentifier > b.affiliationIdentifier
						? 1
						: 0
		);
};

/** A past month an affiliation topped its kind: one champion cup. */
export interface AffiliationChampionship {
	/** YYYY-MM of the closed month the affiliation finished first. */
	monthAnchor: string;
	/** Frozen month accuracy at the time of the win (0..1). */
	accuracy: number;
	/** Resolved calls in that month: the depth behind the accuracy. */
	monthTotalCalls: number;
}

/**
 * Champion history for a single affiliation: every past month in
 * which it finished **first** in its kind's monthly ranking.
 *
 * This reads the frozen `affiliation_stats` snapshot docs (3-segment
 * keys, written by the Worlds podium freeze in
 * `vxp-worlds-podium.services.ts`). For each closed month present in
 * the snapshots, the top-ranked affiliation, by the same sort the
 * podium fan-out uses (`listAffiliationStatsForMonthFn`), is that
 * month's champion. We collect the months where the requested
 * affiliation held that top slot.
 *
 * There is no separate "season conclusion" or champion-recording
 * entity in the backend: a closed month is captured only when its
 * podium is first claimed (Juno exposes no scheduler primitive, so
 * nothing ends a season and stamps a winner on its own). History
 * therefore populates one entry per month that has been frozen and had
 * a ranked leader: a month with no claim yet confers no cup.
 *
 * Cost: O(snapshots) scan + a group-by; the per-month winner is the
 * first element of each month's sorted bucket.
 */
export const listAffiliationChampionshipsFn = ({
	kind,
	affiliationIdentifier
}: {
	kind: AffiliationKind;
	affiliationIdentifier: string;
}): AffiliationChampionship[] => {
	const caller = msgCaller();

	const { items } = listDocsStore({
		collection: Collection.AFFILIATION_STATS,
		caller: caller.toUint8Array(),
		params: {}
	});

	// Group every qualifying snapshot doc by its month so we can pick a
	// single winner per closed month.
	const byMonth = new Map<string, AffiliationStatsDoc[]>();

	for (const [docKey, item] of items) {
		// Cheap pre-filter: snapshot keys carry an extra segment, so they
		// have more than one slash. The precise test (key ends in
		// `/${monthAnchor}`) needs the decoded doc, so it runs below:
		// this only skips obvious non-snapshot keys before decoding.
		const hasExtraSegment = docKey.indexOf('/') !== docKey.lastIndexOf('/');

		if (hasExtraSegment) {
			try {
				const doc = decodeDocData<AffiliationStatsDoc>(item.data);

				// Snapshot docs only: the key must end in `/${monthAnchor}`
				// (same precise test as `listAffiliationStatsForMonthFn`), so
				// non-snapshot keys that merely have extra slashes aren't
				// misread as snapshots.
				const isSnapshot = docKey.endsWith(`/${doc.monthAnchor}`);

				if (isSnapshot && doc.kind === kind && doc.monthTotalCalls >= MIN_CALLS_FOR_RANK) {
					const bucket = byMonth.get(doc.monthAnchor);

					if (nonNullish(bucket)) {
						bucket.push(doc);
					} else {
						byMonth.set(doc.monthAnchor, [doc]);
					}
				}
			} catch {
				// skip malformed
			}
		}
	}

	const championships: AffiliationChampionship[] = [];

	for (const [monthAnchor, bucket] of byMonth.entries()) {
		// Same tie-break as the podium / leaderboard: accuracy desc →
		// monthTotalCalls desc → affiliationIdentifier asc.
		bucket.sort(monthlyRankComparator);

		const [winner] = bucket;

		if (nonNullish(winner) && winner.affiliationIdentifier === affiliationIdentifier) {
			championships.push({
				monthAnchor,
				accuracy: winner.monthWins / winner.monthTotalCalls,
				monthTotalCalls: winner.monthTotalCalls
			});
		}
	}

	// Most recent cup first.
	return championships.sort((a, b) =>
		a.monthAnchor < b.monthAnchor ? 1 : a.monthAnchor > b.monthAnchor ? -1 : 0
	);
};

/**
 * Subset of the profile payload the Worlds aggregates read: the lifetime
 * totals plus the Worlds sharing opt-out. `decodeDocData` returns the raw
 * msgpack shape, so a partial / legacy `preferences` decodes with the
 * nested fields simply absent.
 */
interface ProfileLifetimeSlice {
	totalTrades?: number;
	winRate?: number;
	preferences?: {
		sharing?: {
			worldsOptIn?: boolean;
		};
	};
}

/**
 * Worlds sharing opt-out. `preferences.sharing.worldsOptIn === false` hides
 * the member from every Worlds standing (all-time, monthly, frozen podium).
 * The flag is an opt-out defaulting to `true`, so a missing / legacy value
 * (anything that isn't the literal `false`) counts as opted-in / shown.
 */
const isWorldsOptedOut = (slice: ProfileLifetimeSlice): boolean =>
	slice.preferences?.sharing?.worldsOptIn === false;

/** {@link isWorldsOptedOut} read off a member's profile doc; a missing or malformed profile is opted-in (shown). */
const isMemberWorldsOptedOut = ({
	member,
	caller
}: {
	member: string;
	caller: Uint8Array;
}): boolean => {
	const profileDoc = getDocStore({ collection: Collection.PROFILES, key: member, caller });

	if (isNullish(profileDoc)) {
		return false;
	}

	try {
		return isWorldsOptedOut(decodeDocData<ProfileLifetimeSlice>(profileDoc.data));
	} catch {
		return false;
	}
};

/**
 * Real lifetime tally for a Worlds kind, summed over each affiliation's
 * CURRENT roster. For every membership row of the kind we read the member's
 * profile and add their lifetime `totalTrades` (calls) plus derived wins
 * (`round(totalTrades × winRate / 100)`, capped at the trade count) into that
 * affiliation's bucket.
 *
 * This is what makes the all-time board reflect the members' real history:
 * the moment a user with prior activity joins, their full record counts
 * toward the affiliation, and leaving removes it, rather than only the
 * activity accrued *while* affiliated (which the rolling `affiliation_stats`
 * doc tracks for the monthly/season board).
 *
 * Cost: one `affiliations` scan plus one `profiles` read per membership of the
 * kind (bounded by the active roster). Pass `affiliationIdentifier` to limit
 * the profile reads to a single affiliation (the detail-page lookup).
 */
const aggregateMembersLifetime = ({
	kind,
	affiliationIdentifier
}: {
	kind: AffiliationKind;
	affiliationIdentifier?: string;
}): Map<string, { totalCalls: number; wins: number }> => {
	const caller = msgCaller().toUint8Array();

	const lifetime = new Map<string, { totalCalls: number; wins: number }>();

	for (const { affiliation: aff } of heldAffiliations({ caller, kind })) {
		if (isNullish(affiliationIdentifier) || aff.affiliationIdentifier === affiliationIdentifier) {
			const profileDoc = getDocStore({
				collection: Collection.PROFILES,
				key: aff.member,
				caller
			});

			let slice: ProfileLifetimeSlice | undefined;

			if (nonNullish(profileDoc)) {
				try {
					slice = decodeDocData<ProfileLifetimeSlice>(profileDoc.data);
				} catch {
					// skip malformed
					slice = undefined;
				}
			}

			const trades = slice?.totalTrades ?? 0;

			// Worlds opt-out: an opted-out member contributes to no standing.
			if (nonNullish(slice) && !isWorldsOptedOut(slice) && trades > 0) {
				// `winRate` is a 0..100 percentage; cap the derived win count at the
				// trade total so the aggregate keeps `wins ≤ totalCalls`.
				const wins = Math.min(trades, Math.round((trades * (slice.winRate ?? 0)) / 100));
				const bucket = lifetime.get(aff.affiliationIdentifier) ?? { totalCalls: 0, wins: 0 };

				bucket.totalCalls += trades;
				bucket.wins += wins;
				lifetime.set(aff.affiliationIdentifier, bucket);
			}
		}
	}

	return lifetime;
};

/**
 * Display per-month tally for a Worlds kind, summed over each affiliation's
 * CURRENT opted-in roster. The monthly mirror of {@link aggregateMembersLifetime}:
 * where the lifetime aggregate reads each member's profile totals, this reads
 * each member's `USER_MONTHLY_STATS[${member}/${monthAnchor}]` row and folds
 * that month's `monthCalls` / `monthWins` into the member's affiliation bucket.
 *
 * This is what lets the monthly Worlds window retract on leave / opt-out with
 * no per-month deltas on the profile: the month's numbers live per-member in
 * `USER_MONTHLY_STATS`, and the aggregate is recomputed over whoever is a
 * current, opted-in member now. Those rows are client-written, so this tally
 * only ever feeds a view: the podium pays from {@link settledMonthlyRows}.
 *
 * Cost: one `USER_MONTHLY_STATS` scan (filtered by the `/${monthAnchor}`
 * suffix, same shape as `getMonthlyLeaderboard`) + one `affiliations` scan +
 * one `profiles` read per member who has activity in the month (for the
 * opt-out gate). Pass `affiliationIdentifier` to limit to a single affiliation.
 * Pure read (no writes) so both query and update paths can call it.
 */
const aggregateMembersForMonth = ({
	kind,
	monthAnchor,
	affiliationIdentifier
}: {
	kind: AffiliationKind;
	monthAnchor: string;
	affiliationIdentifier?: string;
}): Map<string, { monthTotalCalls: number; monthWins: number }> => {
	const caller = msgCaller().toUint8Array();

	// Per-owner month totals for the requested month: one collection scan,
	// suffix-filtered to the month (rolling docs live under `${owner}/${anchor}`).
	const { items: monthlyItems } = listDocsStore({
		collection: Collection.USER_MONTHLY_STATS,
		caller,
		params: {}
	});

	const suffix = `/${monthAnchor}`;
	const byOwner = new Map<string, { monthCalls: number; monthWins: number }>();

	for (const [docKey, item] of monthlyItems) {
		if (docKey.endsWith(suffix)) {
			try {
				const doc = decodeDocData<UserMonthlyStatsDoc>(item.data);

				// Guard against a key/anchor drift (a malformed write that slipped
				// the assert): only trust rows whose embedded anchor matches.
				if (doc.monthAnchor === monthAnchor) {
					byOwner.set(doc.owner, { monthCalls: doc.monthCalls, monthWins: doc.monthWins });
				}
			} catch {
				// skip malformed
			}
		}
	}

	const monthly = new Map<string, { monthTotalCalls: number; monthWins: number }>();

	for (const { affiliation: aff } of heldAffiliations({ caller, kind })) {
		if (isNullish(affiliationIdentifier) || aff.affiliationIdentifier === affiliationIdentifier) {
			const owned = byOwner.get(aff.member);

			// Only members with activity in the month can contribute; skip the
			// profile read entirely for members with no month row.
			if (nonNullish(owned) && !isMemberWorldsOptedOut({ member: aff.member, caller })) {
				const bucket = monthly.get(aff.affiliationIdentifier) ?? {
					monthTotalCalls: 0,
					monthWins: 0
				};

				bucket.monthTotalCalls += owned.monthCalls;
				bucket.monthWins += owned.monthWins;
				monthly.set(aff.affiliationIdentifier, bucket);
			}
		}
	}

	return monthly;
};

/**
 * Single-affiliation stats for the detail page. Both windows are recomputed
 * live over the affiliation's CURRENT opted-in roster: the all-time totals
 * (`totalCalls` / `wins`) from {@link aggregateMembersLifetime}, the
 * current-month window (`monthTotalCalls` / `monthWins`) from
 * {@link aggregateMembersForMonth}. A member who has left or opted out is
 * absent from both; no baked-in aggregate survives them.
 *
 * Returns `undefined` only when the affiliation has neither lifetime nor
 * current-month activity from its present roster: callers treat that as
 * "unranked / no data".
 */
export const getAffiliationStatsFn = ({
	kind,
	affiliationIdentifier
}: {
	kind: AffiliationKind;
	affiliationIdentifier: string;
}): AffiliationStatsDoc | undefined => {
	const nowMs = timeMs();
	const anchor = monthAnchorFromMs(nowMs);

	const lifetime = aggregateMembersLifetime({ kind, affiliationIdentifier }).get(
		affiliationIdentifier
	);
	const month = aggregateMembersForMonth({ kind, monthAnchor: anchor, affiliationIdentifier }).get(
		affiliationIdentifier
	);

	if (isNullish(lifetime) && isNullish(month)) {
		return;
	}

	return {
		kind,
		affiliationIdentifier,
		totalCalls: lifetime?.totalCalls ?? 0,
		wins: lifetime?.wins ?? 0,
		monthAnchor: anchor,
		monthTotalCalls: month?.monthTotalCalls ?? 0,
		monthWins: month?.monthWins ?? 0,
		updatedAtMs: nowMs
	};
};

/**
 * Ranked leaderboard scan for a Worlds kind. Both windows are recomputed
 * live over each affiliation's CURRENT opted-in roster: the all-time totals
 * (`totalCalls` / `wins`) from {@link aggregateMembersLifetime} (the ranking
 * base), the current-month window (`monthTotalCalls` / `monthWins`) from
 * {@link aggregateMembersForMonth}. An affiliation surfaces as soon as its
 * roster's combined lifetime crosses `MIN_CALLS_FOR_RANK`; a member who has
 * left or opted out contributes to neither window.
 *
 * Sort key: `wins / totalCalls` desc, then `totalCalls` desc (rewards depth),
 * then `affiliationIdentifier` asc (deterministic tie break across re-runs:
 * same rule the Worlds podium fan-out uses, so the leaderboard and the awards
 * agree).
 */
export const listAffiliationStatsFn = ({
	kind,
	limit
}: {
	kind: AffiliationKind;
	limit?: number;
}): AffiliationStatsDoc[] => {
	const nowMs = timeMs();
	const anchor = monthAnchorFromMs(nowMs);

	// All-time totals: the real lifetime of the current opted-in roster.
	const lifetime = aggregateMembersLifetime({ kind });
	// Current-month window: live recompute over the same roster.
	const monthly = aggregateMembersForMonth({ kind, monthAnchor: anchor });

	// Rank over the affiliations that have current members: their roster lifetime
	// is the all-time tally. An affiliation whose roster has emptied has a zero
	// tally and falls below the floor; the monthly map only fills each ranked
	// row's current-month window.
	const stats: AffiliationStatsDoc[] = [];

	for (const [affiliationIdentifier, life] of lifetime) {
		const month = monthly.get(affiliationIdentifier);
		const { totalCalls, wins } = life;

		// Same depth floor as before, now against the real lifetime tally: at
		// tiny call counts the accuracy is too noisy to rank.
		if (totalCalls >= MIN_CALLS_FOR_RANK) {
			stats.push({
				kind,
				affiliationIdentifier,
				totalCalls,
				wins,
				monthAnchor: anchor,
				monthTotalCalls: month?.monthTotalCalls ?? 0,
				monthWins: month?.monthWins ?? 0,
				updatedAtMs: nowMs
			});
		}
	}

	stats.sort(
		compareAffiliationRank({
			accuracyOf: (doc) => doc.wins / doc.totalCalls,
			callsOf: (doc) => doc.totalCalls
		})
	);

	if (nonNullish(limit) && limit > 0) {
		return stats.slice(0, limit);
	}

	return stats;
};

/**
 * Month-scoped `AffiliationStatsDoc` rows for the affiliations clearing
 * `MIN_CALLS_FOR_RANK`. The lifetime fields mirror the monthly ones (the
 * podium reads only the monthly window). `nowMs` stamps `updatedAtMs`; a
 * query context that needs no real timestamp may pass `0`.
 */
const rankEligibleMonthlyRows = ({
	kind,
	monthAnchor,
	nowMs,
	monthly
}: {
	kind: AffiliationKind;
	monthAnchor: string;
	nowMs: number;
	monthly: Map<string, { monthTotalCalls: number; monthWins: number }>;
}): AffiliationStatsDoc[] => {
	const rows: AffiliationStatsDoc[] = [];

	for (const [affiliationIdentifier, m] of monthly) {
		if (m.monthTotalCalls >= MIN_CALLS_FOR_RANK) {
			rows.push({
				kind,
				affiliationIdentifier,
				totalCalls: m.monthTotalCalls,
				wins: m.monthWins,
				monthAnchor,
				monthTotalCalls: m.monthTotalCalls,
				monthWins: m.monthWins,
				updatedAtMs: nowMs
			});
		}
	}

	return rows;
};

/**
 * The frozen ranking of a closed month: the immutable snapshot docs
 * (`${kind}/${affiliationIdentifier}/${monthAnchor}`) the podium freeze in
 * `vxp-worlds-podium.services` writes from settled history the first time the
 * month's podium is claimed, ranked by the leaderboard's rule. Empty until the
 * month is frozen; the podium pays from this and nothing else.
 */
export const frozenMonthlyRanking = ({
	kind,
	monthAnchor
}: {
	kind: AffiliationKind;
	monthAnchor: string;
}): AffiliationStatsDoc[] => {
	const caller = msgCaller();
	const { items } = listDocsStore({
		collection: Collection.AFFILIATION_STATS,
		caller: caller.toUint8Array(),
		params: {}
	});

	const expectedSuffix = `/${monthAnchor}`;
	const frozen: AffiliationStatsDoc[] = [];

	for (const [docKey, item] of items) {
		// Only 3-segment keys ending in `/${monthAnchor}` qualify: the frozen
		// snapshots captured when the month's podium was first claimed.
		const isSnapshotForMonth =
			docKey.indexOf('/') !== docKey.lastIndexOf('/') && docKey.endsWith(expectedSuffix);

		if (isSnapshotForMonth) {
			try {
				const doc = decodeDocData<AffiliationStatsDoc>(item.data);

				if (
					doc.kind === kind &&
					doc.monthAnchor === monthAnchor &&
					doc.monthTotalCalls >= MIN_CALLS_FOR_RANK
				) {
					frozen.push(doc);
				}
			} catch {
				// skip malformed
			}
		}
	}

	return frozen.sort(monthlyRankComparator);
};

/**
 * Ranked affiliation rows for a specific month, for display: the frozen
 * ranking ({@link frozenMonthlyRanking}) once the month's podium has been
 * claimed, else a **provisional** live recompute over the current opted-in
 * roster from the client-written monthly stats ({@link aggregateMembersForMonth}).
 * Sort key matches `listAffiliationStatsFn`.
 */
export const listAffiliationStatsForMonthFn = ({
	kind,
	monthAnchor
}: {
	kind: AffiliationKind;
	monthAnchor: string;
}): AffiliationStatsDoc[] => {
	const frozen = frozenMonthlyRanking({ kind, monthAnchor });

	if (frozen.length > 0) {
		return frozen;
	}

	return rankEligibleMonthlyRows({
		kind,
		monthAnchor,
		nowMs: 0,
		monthly: aggregateMembersForMonth({ kind, monthAnchor })
	}).sort(monthlyRankComparator);
};

/**
 * The rank-eligible rows of a closed month computed from settled history:
 * what the podium freeze captures and pays from. Each affiliation's tally is
 * its members' settled calls and wins over the month window
 * `[month start, month close)`, read from the clearing canister (the same
 * source league battles are scored from), never the client-written monthly
 * stats. A member counts when they are opted in to Worlds sharing and hold a
 * slot joined before the month closed (the satellite doc's own `created_at`),
 * so a join after close can neither collect the prize nor lift the ranking.
 */
export const settledMonthlyRows = async ({
	kind,
	monthAnchor,
	nowMs
}: {
	kind: AffiliationKind;
	monthAnchor: string;
	nowMs: number;
}): Promise<AffiliationStatsDoc[]> => {
	const caller = msgCaller().toUint8Array();

	const affiliationOf = new Map<string, string>();

	for (const { affiliation: aff, createdAtNs } of heldAffiliations({ caller, kind })) {
		if (
			joinedBeforeMonthClose({ joinedAtNs: createdAtNs, monthAnchor }) &&
			!isMemberWorldsOptedOut({ member: aff.member, caller })
		) {
			affiliationOf.set(aff.member, aff.affiliationIdentifier);
		}
	}

	const members: Principal[] = [];

	for (const member of affiliationOf.keys()) {
		try {
			members.push(Principal.fromText(member));
		} catch {
			// A malformed member principal has no settled history to count.
		}
	}

	const settled = await settledTotalsByPrincipal({
		members,
		fromMs: monthAnchorStartMs(monthAnchor),
		toMs: monthEndMs(monthAnchor)
	});

	const monthly = new Map<string, { monthTotalCalls: number; monthWins: number }>();

	for (const [member, { calls, wins }] of settled) {
		const affiliationIdentifier = affiliationOf.get(member);

		if (nonNullish(affiliationIdentifier)) {
			const bucket = monthly.get(affiliationIdentifier) ?? { monthTotalCalls: 0, monthWins: 0 };

			bucket.monthTotalCalls += calls;
			bucket.monthWins += wins;
			monthly.set(affiliationIdentifier, bucket);
		}
	}

	return rankEligibleMonthlyRows({ kind, monthAnchor, nowMs, monthly });
};

/**
 * Whether a closed month has already been frozen; i.e. at least one snapshot
 * doc exists for `(kind, monthAnchor)`. The podium freeze uses this as an
 * all-or-nothing gate: the first claim writes the whole ranked set, and every
 * later claim sees the month as frozen and leaves it untouched, so the frozen
 * ranking never grows or drifts as the roster later churns.
 */
export const hasFrozenMonthlySnapshotFn = ({
	kind,
	monthAnchor
}: {
	kind: AffiliationKind;
	monthAnchor: string;
}): boolean => {
	const caller = msgCaller().toUint8Array();
	const { items } = listDocsStore({
		collection: Collection.AFFILIATION_STATS,
		caller,
		params: {}
	});

	const suffix = `/${monthAnchor}`;

	for (const [docKey, item] of items) {
		const isSnapshotForMonth =
			docKey.indexOf('/') !== docKey.lastIndexOf('/') && docKey.endsWith(suffix);

		if (isSnapshotForMonth) {
			try {
				const doc = decodeDocData<AffiliationStatsDoc>(item.data);

				if (doc.kind === kind && doc.monthAnchor === monthAnchor) {
					return true;
				}
			} catch {
				// skip malformed
			}
		}
	}

	return false;
};
