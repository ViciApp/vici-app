import { VXP_LEDGER_CANISTER_ID } from '#lib/constants/canisters.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import { MILLISECOND_IN_NANOSECONDS } from '#lib/constants/time.constants.ts';
import type { LeagueMemberDoc } from '#lib/types/league-member.ts';
import type { LeagueDoc } from '#lib/types/league.ts';
import {
	matchCountForRound,
	monthStartMs,
	roundWindow,
	TOURNAMENT_BRACKET_SIZE,
	TOURNAMENT_MIN_CALLS_PER_MATCH,
	TOURNAMENT_PRIZE_TIERS,
	TOURNAMENT_ROUND_DURATION_MS,
	TOURNAMENT_ROUNDS,
	tournamentMatchKey,
	type TournamentDoc,
	type TournamentMatchDoc,
	type TournamentRound,
	type TriggerTournamentDrawRefusalReason
} from '#lib/types/tournament.ts';
import { vxpAwardKey, type VxpAwardDoc } from '#lib/types/vxp-award.ts';
import { MONTH_ANCHOR_RE, monthAnchorFromMs } from '#lib/utils/month-anchor.utils.ts';
import { vxpBaseUnits } from '#lib/utils/vxp-amount.utils.ts';
import { assertControllerCaller, controllerCaller } from '#satellite/services/authz.services.ts';
import { leagueMemberPrincipals } from '#satellite/services/league-member.services.ts';
import {
	settledTotals,
	settledTotalsByPrincipal
} from '#satellite/services/settled-history.services.ts';
import { persistAward, updateAward } from '#satellite/services/vxp-awards.services.ts';
import { transferWithBadFeeRetry } from '#satellite/services/vxp-payout.services.ts';
import { logError, logInfo } from '#satellite/utils/logger.utils.ts';
import { timeMs } from '#satellite/utils/time.utils.ts';
import { tournamentDrawRefusal } from '#satellite/utils/tournament-draw.utils.ts';
import {
	decideTournamentPrize,
	tournamentPodium,
	type TournamentPrizeDecision,
	type TournamentPrizeMembership
} from '#satellite/utils/tournament-prize.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import type { AssertDeleteDocContext, AssertSetDocContext } from '@junobuild/functions';
import { IcrcLedgerCanister } from '@junobuild/functions/canisters/ledger/icrc';
import { msgCaller } from '@junobuild/functions/ic-cdk';
import {
	decodeDocData,
	encodeDocData,
	getDocStore,
	listDocsStore,
	setDocStore
} from '@junobuild/functions/sdk';

/**
 * Monthly tournament: the full chain.
 *
 *  - Asserts for both collections: only a satellite controller may
 *    write or delete (see `assertControllerCaller`), then key shape,
 *    write-once invariants on team / accuracy / winner / start-snapshot
 *    fields, forward-only state machine `in_flight → concluded`.
 *  - `triggerTournamentDrawFn`: anyone can call, for the current UTC
 *    month only and only while its round 1 window is open;
 *    idempotent via doc-key collision on the month anchor. Scans
 *    LEAGUE_MEMBERS, counts per league the members who settled at least
 *    one call in the calendar month before the draw, and seeds the
 *    top-16 into Round 1, writing the bracket a few docs per call.
 *  - `getCurrentTournamentFn`: returns the latest tournament + its
 *    matches for the FE bracket.
 *  - `resolveTournamentRoundFn`: anyone can call once a round has
 *    closed; scores each side from its members' settled history over
 *    the round window, read from the clearing canister (the source
 *    league battles are scored from, never the member-writable
 *    `league_stats`), counting only members stored by the draw,
 *    applies the 50-call forfeit rule, writes the
 *    winner + propagates them into the next round's slot. Idempotent
 *    via the match doc's `winnerLeagueId` write-once invariant.
 *  - `claimTournamentPrizeFn`: per-user claim once the tournament
 *    concludes; credits a single VXP_AWARDS doc per the caller's
 *    highest-tier placement, for a member who settled at least one call
 *    inside the tournament window.
 *
 * Forfeit rule: a league with fewer than 50 calls in the window
 * forfeits. If both sides forfeit, the lower-leagueId advances:
 * keeps the bracket deterministic without needing a coin-flip RNG.
 */

const ASSERT_PREFIX = 'tournament';

const writerPurpose = 'tournament bracket write';

/**
 * Single-doc-per-month assert. Both tournament collections are
 * `write: 'public'` and their docs decide who may claim the tournament prize
 * (real VXP), so the draw and round-resolution endpoints compute every doc and
 * write it as a controller; a client write is rejected before its payload is
 * read.
 *
 * Key must equal `${id}` and match
 * `monthAnchorFromMs(monthStartMs)`. `bracketSize` and
 * `seededLeagueIds` are immutable after the initial write; the only
 * field that ever mutates is `state` (in_flight → concluded).
 */
export const assertSetTournament = ({
	caller,
	data: {
		collection,
		key,
		data: { current, proposed }
	}
}: AssertSetDocContext): void => {
	if (collection !== Collection.TOURNAMENTS) {
		return;
	}

	assertControllerCaller({ caller, collection });

	const proposedDoc = decodeDocData<TournamentDoc>(proposed.data);

	if (key !== proposedDoc.id) {
		throw new Error(
			`${ASSERT_PREFIX}: doc key "${key}" must match embedded id "${proposedDoc.id}".`
		);
	}

	if (!MONTH_ANCHOR_RE.test(proposedDoc.id)) {
		throw new Error(
			`${ASSERT_PREFIX}: id must be a YYYY-MM month anchor, got "${proposedDoc.id}".`
		);
	}

	if (monthAnchorFromMs(proposedDoc.monthStartMs) !== proposedDoc.id) {
		throw new Error(`${ASSERT_PREFIX}: monthStartMs disagrees with id "${proposedDoc.id}".`);
	}

	if (proposedDoc.bracketSize !== TOURNAMENT_BRACKET_SIZE) {
		throw new Error(
			`${ASSERT_PREFIX}: bracketSize must be ${TOURNAMENT_BRACKET_SIZE}, got ${proposedDoc.bracketSize}.`
		);
	}

	if (proposedDoc.seededLeagueIds.length !== TOURNAMENT_BRACKET_SIZE) {
		throw new Error(
			`${ASSERT_PREFIX}: seededLeagueIds must have length ${TOURNAMENT_BRACKET_SIZE}, got ${proposedDoc.seededLeagueIds.length}.`
		);
	}

	if (isNullish(current)) {
		if (proposedDoc.state !== 'in_flight') {
			throw new Error(`${ASSERT_PREFIX}: new tournaments must start in "in_flight" state.`);
		}

		return;
	}

	const currentDoc = decodeDocData<TournamentDoc>(current.data);

	if (
		currentDoc.id !== proposedDoc.id ||
		currentDoc.monthStartMs !== proposedDoc.monthStartMs ||
		currentDoc.monthEndMs !== proposedDoc.monthEndMs ||
		currentDoc.bracketSize !== proposedDoc.bracketSize ||
		currentDoc.createdAtMs !== proposedDoc.createdAtMs ||
		JSON.stringify(currentDoc.seededLeagueIds) !== JSON.stringify(proposedDoc.seededLeagueIds)
	) {
		throw new Error(
			`${ASSERT_PREFIX}: id / monthStartMs / monthEndMs / bracketSize / createdAtMs / seededLeagueIds are immutable.`
		);
	}

	if (currentDoc.state === 'concluded') {
		throw new Error(`${ASSERT_PREFIX}: doc is terminal (state="concluded"); no further writes.`);
	}

	if (proposedDoc.state !== 'concluded') {
		throw new Error(`${ASSERT_PREFIX}: state may only transition in_flight → concluded.`);
	}
};

/**
 * Per-match assert. Key must equal
 * `${tournamentId}/${round}/${index}` and agree with the embedded
 * fields. `fromLeagueId` / `toLeagueId` / `startMs` / `endMs` are
 * immutable; accuracy + winner are write-once (null → number).
 */
export const assertSetTournamentMatch = ({
	caller,
	data: {
		collection,
		key,
		data: { current, proposed }
	}
}: AssertSetDocContext): void => {
	if (collection !== Collection.TOURNAMENT_MATCHES) {
		return;
	}

	assertControllerCaller({ caller, collection });

	const proposedDoc = decodeDocData<TournamentMatchDoc>(proposed.data);
	const expectedKey = tournamentMatchKey({
		tournamentId: proposedDoc.tournamentId,
		round: proposedDoc.round,
		index: proposedDoc.index
	});

	if (key !== expectedKey) {
		throw new Error(
			`${ASSERT_PREFIX}_match: key "${key}" must equal "${expectedKey}" (tournamentId/round/index drift).`
		);
	}

	if (!TOURNAMENT_ROUNDS.includes(proposedDoc.round)) {
		throw new Error(`${ASSERT_PREFIX}_match: round "${proposedDoc.round}" is not a valid round.`);
	}

	const expectedMatchCount = matchCountForRound(proposedDoc.round);

	if (proposedDoc.index < 0 || proposedDoc.index >= expectedMatchCount) {
		throw new Error(
			`${ASSERT_PREFIX}_match: index ${proposedDoc.index} out of range for ${proposedDoc.round} (0..${expectedMatchCount - 1}).`
		);
	}

	if (proposedDoc.endMs <= proposedDoc.startMs) {
		throw new Error(`${ASSERT_PREFIX}_match: endMs must be greater than startMs.`);
	}

	if (isNullish(current)) {
		return;
	}

	const currentDoc = decodeDocData<TournamentMatchDoc>(current.data);

	if (
		currentDoc.tournamentId !== proposedDoc.tournamentId ||
		currentDoc.round !== proposedDoc.round ||
		currentDoc.index !== proposedDoc.index ||
		currentDoc.startMs !== proposedDoc.startMs ||
		currentDoc.endMs !== proposedDoc.endMs
	) {
		throw new Error(
			`${ASSERT_PREFIX}_match: tournamentId / round / index / startMs / endMs are immutable.`
		);
	}

	// `fromLeagueId` / `toLeagueId` are write-once: null → string allowed
	// (the round-resolution job fills them in when the previous round
	// settles), but a non-null value can never change.
	if (nonNullish(currentDoc.fromLeagueId) && currentDoc.fromLeagueId !== proposedDoc.fromLeagueId) {
		throw new Error(`${ASSERT_PREFIX}_match: fromLeagueId is immutable once set.`);
	}

	if (nonNullish(currentDoc.toLeagueId) && currentDoc.toLeagueId !== proposedDoc.toLeagueId) {
		throw new Error(`${ASSERT_PREFIX}_match: toLeagueId is immutable once set.`);
	}

	// Start-of-window counters: write-once from null. The draw and the
	// resolution leave them null; a doc that carries them keeps them.
	if (
		nonNullish(currentDoc.fromStartCalls) &&
		currentDoc.fromStartCalls !== proposedDoc.fromStartCalls
	) {
		throw new Error(`${ASSERT_PREFIX}_match: fromStartCalls is write-once.`);
	}

	if (
		nonNullish(currentDoc.fromStartWins) &&
		currentDoc.fromStartWins !== proposedDoc.fromStartWins
	) {
		throw new Error(`${ASSERT_PREFIX}_match: fromStartWins is write-once.`);
	}

	if (nonNullish(currentDoc.toStartCalls) && currentDoc.toStartCalls !== proposedDoc.toStartCalls) {
		throw new Error(`${ASSERT_PREFIX}_match: toStartCalls is write-once.`);
	}

	if (nonNullish(currentDoc.toStartWins) && currentDoc.toStartWins !== proposedDoc.toStartWins) {
		throw new Error(`${ASSERT_PREFIX}_match: toStartWins is write-once.`);
	}

	if (nonNullish(currentDoc.fromAcc) && currentDoc.fromAcc !== proposedDoc.fromAcc) {
		throw new Error(`${ASSERT_PREFIX}_match: fromAcc is write-once.`);
	}

	if (nonNullish(currentDoc.toAcc) && currentDoc.toAcc !== proposedDoc.toAcc) {
		throw new Error(`${ASSERT_PREFIX}_match: toAcc is write-once.`);
	}

	if (
		nonNullish(currentDoc.winnerLeagueId) &&
		currentDoc.winnerLeagueId !== proposedDoc.winnerLeagueId
	) {
		throw new Error(`${ASSERT_PREFIX}_match: winnerLeagueId is write-once.`);
	}
};

/**
 * Pre-delete guard for both collections. No satellite path deletes a
 * tournament or a match; dropping one would let a client reopen a month
 * for a fresh draw, so only a controller may.
 */
export const assertDeleteTournamentDoc = ({
	caller,
	data: { collection }
}: AssertDeleteDocContext): void => {
	if (collection !== Collection.TOURNAMENTS && collection !== Collection.TOURNAMENT_MATCHES) {
		return;
	}

	assertControllerCaller({ caller, collection });
};

/** Every league's member principals, by scanning LEAGUE_MEMBERS. */
const membersPerLeague = (callerBytes: Uint8Array): Map<string, string[]> => {
	const { items } = listDocsStore({
		collection: Collection.LEAGUE_MEMBERS,
		caller: callerBytes,
		params: {}
	});

	const members = new Map<string, string[]>();

	for (const [, item] of items) {
		try {
			const member = decodeDocData<LeagueMemberDoc>(item.data);
			const leagueMembers = members.get(member.leagueId) ?? [];

			leagueMembers.push(member.member);
			members.set(member.leagueId, leagueMembers);
		} catch {
			// skip malformed
		}
	}

	return members;
};

/**
 * Rank leagues for the draw by how many of their members settled at least
 * one call in the calendar month before `startMs`, read from the clearing
 * canister, so accounts that never play cannot lift a league's seed. A
 * member of several leagues counts in each. Returns a `[leagueId,
 * activeCount]` array sorted by count desc; ties broken by leagueId asc so
 * the seeding is deterministic.
 *
 * Heavy scan, but the satellite has no compound index, and a
 * draw runs at most once per month, so the cost is acceptable.
 */
const rankLeaguesForDraw = async ({
	callerBytes,
	startMs
}: {
	callerBytes: Uint8Array;
	startMs: number;
}): Promise<Array<[string, number]>> => {
	const members = membersPerLeague(callerBytes);
	const settled = await settledTotalsByPrincipal({
		members: [...new Set([...members.values()].flat())].map((text) => Principal.fromText(text)),
		fromMs: monthStartMs(startMs - 1),
		toMs: startMs
	});

	return Array.from(members.entries())
		.map(([leagueId, principals]): [string, number] => [
			leagueId,
			principals.filter((text) => (settled.get(text)?.calls ?? 0) > 0).length
		])
		.sort(([aId, aCount], [bId, bCount]) => {
			if (aCount !== bCount) {
				return bCount - aCount;
			}

			return aId < bId ? -1 : aId > bId ? 1 : 0;
		});
};

/**
 * Standard single-elimination seeding: seed 1 plays seed 16, seed 2
 * plays seed 15, etc. Returns the pair list for Round 1 in match
 * order (8 pairs total).
 */
const seedFirstRoundPairs = (
	seededLeagueIds: string[]
): Array<{ fromLeagueId: string; toLeagueId: string }> => {
	const pairs: Array<{ fromLeagueId: string; toLeagueId: string }> = [];
	const n = seededLeagueIds.length;

	for (let i = 0; i < n / 2; i += 1) {
		pairs.push({
			fromLeagueId: seededLeagueIds[i],
			toLeagueId: seededLeagueIds[n - 1 - i]
		});
	}

	return pairs;
};

export interface TriggerTournamentDrawResult {
	ok: boolean;
	tournamentId?: string;
	reason?: TriggerTournamentDrawRefusalReason;
	availableLeagues?: number;
}

/**
 * How many bracket docs one `triggerTournamentDraw` call writes. The bracket
 * is the tournament doc plus every match of every round
 * (`TOURNAMENT_BRACKET_SIZE` docs), and each is a serverless write costing
 * billions of instructions, so a call writes a few and the draw goes in
 * rounds (see the bulk-rewrite budget note in docs/ai/satellite/patterns.md).
 */
const TOURNAMENT_DRAW_BATCH = 4;

/**
 * Every match doc of the bracket `tournament` seeds, in write order: the
 * round 1 pairs from its seeding, then the TBD slots of the later rounds so
 * the bracket UI can render the skeleton; the previous round's resolution
 * promotes each winner into its slot.
 */
const bracketMatches = (
	tournament: TournamentDoc
): Array<{ key: string; doc: TournamentMatchDoc }> => {
	const r1Pairs = seedFirstRoundPairs(tournament.seededLeagueIds);

	return TOURNAMENT_ROUNDS.flatMap((round) => {
		const window_ = roundWindow({ tournamentMonthStartMs: tournament.monthStartMs, round });

		return Array.from({ length: matchCountForRound(round) }, (_, index) => {
			const pair = round === 'r1' ? r1Pairs[index] : undefined;

			const doc: TournamentMatchDoc = {
				tournamentId: tournament.id,
				round,
				index,
				fromLeagueId: pair?.fromLeagueId ?? null,
				toLeagueId: pair?.toLeagueId ?? null,
				fromStartCalls: null,
				fromStartWins: null,
				toStartCalls: null,
				toStartWins: null,
				fromAcc: null,
				toAcc: null,
				winnerLeagueId: null,
				startMs: window_.startMs,
				endMs: window_.endMs
			};

			return { key: tournamentMatchKey({ tournamentId: tournament.id, round, index }), doc };
		});
	});
};

/**
 * Write the first `limit` match docs of `tournament`'s bracket that are not
 * stored yet. Returns how many it wrote.
 */
const writeMissingMatches = ({
	tournament,
	limit,
	callerBytes
}: {
	tournament: TournamentDoc;
	limit: number;
	callerBytes: Uint8Array;
}): number => {
	const missing = bracketMatches(tournament)
		.filter(({ key }) =>
			isNullish(
				getDocStore({ collection: Collection.TOURNAMENT_MATCHES, key, caller: callerBytes })
			)
		)
		.slice(0, limit);
	const writer = controllerCaller(writerPurpose);

	for (const { key, doc } of missing) {
		setDocStore({
			collection: Collection.TOURNAMENT_MATCHES,
			key,
			caller: writer,
			doc: {
				data: encodeDocData(doc)
			}
		});
	}

	return missing.length;
};

/**
 * Run the monthly draw for `monthAnchor`, at most
 * {@link TOURNAMENT_DRAW_BATCH} bracket docs per call. Anyone can call:
 * the first call seeds the bracket and writes the tournament doc (the key
 * collision on the month anchor keeps the seeding to one), each later call
 * writes the next missing matches and answers `ok`, and once the bracket is
 * complete a call returns `already_drawn` cleanly. The FE calls it on every
 * Tournament-page mount until it stops answering `ok`. Only the current
 * UTC month is drawn, and only while its round 1 window is open; any
 * other new draw is refused (`tournamentDrawRefusal`). A month that already
 * has a tournament doc answers from it whatever the time, and a bracket
 * seeded inside that window is still finished after it closes: its rounds
 * are timed from the tournament doc, not from when each match is written,
 * and a half-written bracket could never be resolved.
 *
 * Refuses if fewer than `TOURNAMENT_BRACKET_SIZE` leagues exist:
 * the data set is too small to seed a full bracket. The FE surfaces
 * this as a "waiting on more leagues" hint.
 */
export const triggerTournamentDrawFn = async ({
	monthAnchor
}: {
	monthAnchor: string;
}): Promise<TriggerTournamentDrawResult> => {
	const nowMs = timeMs();
	const caller = msgCaller();
	const callerBytes = caller.toUint8Array();

	const readTournament = () =>
		getDocStore({
			collection: Collection.TOURNAMENTS,
			key: monthAnchor,
			caller: callerBytes
		});

	const existing = readTournament();

	if (nonNullish(existing)) {
		const written = writeMissingMatches({
			tournament: decodeDocData<TournamentDoc>(existing.data),
			limit: TOURNAMENT_DRAW_BATCH,
			callerBytes
		});

		return written > 0
			? { ok: true, tournamentId: monthAnchor }
			: { ok: false, reason: 'already_drawn', tournamentId: monthAnchor };
	}

	const refusal = tournamentDrawRefusal({ monthAnchor, nowMs });

	if (nonNullish(refusal)) {
		return { ok: false, reason: refusal };
	}

	const startMs = monthStartMs(nowMs);

	const ranking = await rankLeaguesForDraw({ callerBytes, startMs });

	// Another draw may have committed during the clearing read; nothing below
	// awaits, so this check and the writes run as one step. Its bracket is
	// finished by the next calls.
	if (nonNullish(readTournament())) {
		return { ok: false, reason: 'already_drawn', tournamentId: monthAnchor };
	}

	if (ranking.length < TOURNAMENT_BRACKET_SIZE) {
		return {
			ok: false,
			reason: 'insufficient_leagues',
			availableLeagues: ranking.length
		};
	}

	const seededLeagueIds = ranking.slice(0, TOURNAMENT_BRACKET_SIZE).map(([id]) => id);

	// Defensive: belt-and-braces verify the league docs still exist for
	// each seeded id. A league that drained between the member scan and
	// here would still be ranked by the scan, but we skip it.
	const verifiedSeeded: string[] = [];

	for (const id of seededLeagueIds) {
		const league = getDocStore({
			collection: Collection.LEAGUES,
			key: id,
			caller: callerBytes
		});

		if (nonNullish(league)) {
			try {
				decodeDocData<LeagueDoc>(league.data);
				verifiedSeeded.push(id);
			} catch {
				// skip malformed
			}
		}
	}

	if (verifiedSeeded.length < TOURNAMENT_BRACKET_SIZE) {
		return {
			ok: false,
			reason: 'insufficient_leagues',
			availableLeagues: verifiedSeeded.length
		};
	}

	// Write the tournament doc first so the asserts on the match docs
	// have something to reference.
	const tournamentDoc: TournamentDoc = {
		id: monthAnchor,
		monthStartMs: startMs,
		monthEndMs: startMs + TOURNAMENT_ROUNDS.length * TOURNAMENT_ROUND_DURATION_MS,
		bracketSize: TOURNAMENT_BRACKET_SIZE,
		state: 'in_flight',
		seededLeagueIds: verifiedSeeded,
		createdAtMs: nowMs
	};

	setDocStore({
		collection: Collection.TOURNAMENTS,
		key: monthAnchor,
		caller: controllerCaller(writerPurpose),
		doc: {
			data: encodeDocData(tournamentDoc)
		}
	});

	writeMissingMatches({ tournament: tournamentDoc, limit: TOURNAMENT_DRAW_BATCH - 1, callerBytes });

	return { ok: true, tournamentId: monthAnchor };
};

/**
 * Read the most recent tournament (highest YYYY-MM key) and its
 * matches. Returns `null` for the tournament when none has been
 * drawn yet: the FE renders the "no tournament yet" / draw CTA.
 */
export const getCurrentTournamentFn = (): {
	tournament: TournamentDoc | null;
	matches: TournamentMatchDoc[];
} => {
	const caller = msgCaller();
	const callerBytes = caller.toUint8Array();

	// Scan tournaments; pick the lexicographically-highest key (which
	// is also the latest month under the YYYY-MM convention).
	const { items: tournamentItems } = listDocsStore({
		collection: Collection.TOURNAMENTS,
		caller: callerBytes,
		params: {}
	});

	let latest: TournamentDoc | null = null;

	for (const [, item] of tournamentItems) {
		try {
			const doc = decodeDocData<TournamentDoc>(item.data);

			if (isNullish(latest) || doc.id > latest.id) {
				latest = doc;
			}
		} catch {
			// skip malformed
		}
	}

	if (isNullish(latest)) {
		return { tournament: null, matches: [] };
	}

	const { items: matchItems } = listDocsStore({
		collection: Collection.TOURNAMENT_MATCHES,
		caller: callerBytes,
		params: {}
	});

	const matches: TournamentMatchDoc[] = [];
	const prefix = `${latest.id}/`;

	for (const [docKey, item] of matchItems) {
		if (docKey.startsWith(prefix)) {
			try {
				const doc = decodeDocData<TournamentMatchDoc>(item.data);

				if (doc.tournamentId === latest.id) {
					matches.push(doc);
				}
			} catch {
				// skip malformed
			}
		}
	}

	// Sort by round (canonical order) then index for deterministic
	// FE rendering.
	matches.sort((a, b) => {
		const ra = TOURNAMENT_ROUNDS.indexOf(a.round);
		const rb = TOURNAMENT_ROUNDS.indexOf(b.round);

		if (ra !== rb) {
			return ra - rb;
		}

		return a.index - b.index;
	});

	return { tournament: latest, matches };
};

// ─── Round resolution ────────────────────────────────────────────

export type ResolveTournamentRoundRefusalReason =
	| 'tournament_not_found'
	| 'round_not_yet_closed'
	| 'previous_round_not_resolved'
	| 'no_matches'
	| 'invalid_input';

export interface ResolveTournamentRoundResult {
	ok: boolean;
	reason?: ResolveTournamentRoundRefusalReason;
	matchesResolved?: number;
	tournamentConcluded?: boolean;
}

/**
 * The instant memberships must be stored before to count: every membership
 * stored at or before the draw (the tournament doc's own `created_at`), the
 * roster the draw seeded from. Match scores and prizes count that roster
 * only.
 */
const drawRosterCutoffMs = (drawnAtNs: bigint): number =>
	Number(drawnAtNs / MILLISECOND_IN_NANOSECONDS) + 1;

/**
 * A league's accuracy in one round window, from its members' settled
 * history over `[startMs, endMs)` read from the clearing canister: the
 * source league battles are scored from, never the member-writable
 * `league_stats` counters. Only memberships stored by the draw count, so
 * a member who joins mid-tournament cannot lift the score.
 *
 * Returns:
 *  - `{ qualifies: false }` when fewer than
 *    `TOURNAMENT_MIN_CALLS_PER_MATCH` calls settled in the window;
 *    the league forfeits the match.
 *  - `{ qualifies: true, accuracy, calls }` otherwise. Accuracy is in
 *    [0,1].
 */
const leagueWindowAccuracy = async ({
	leagueId,
	startMs,
	endMs,
	drawnAtNs,
	caller
}: {
	leagueId: string | null;
	startMs: number;
	endMs: number;
	drawnAtNs: bigint;
	caller: Uint8Array;
}): Promise<{ qualifies: boolean; accuracy: number; calls: number }> => {
	const members = isNullish(leagueId)
		? []
		: leagueMemberPrincipals({
				leagueId,
				caller,
				joinedBeforeMs: drawRosterCutoffMs(drawnAtNs)
			});
	const { calls, wins } = await settledTotals({ members, fromMs: startMs, toMs: endMs });

	if (calls < TOURNAMENT_MIN_CALLS_PER_MATCH) {
		return { qualifies: false, accuracy: 0, calls };
	}

	return { qualifies: true, accuracy: wins / calls, calls };
};

/**
 * Decide the winner of a single match given each side's window
 * accuracy + qualification. Implements decision 3.4: forfeit ⇒
 * opponent advances; if both sides forfeit, the lower-seed
 * (lexicographically-lower leagueId, matching the draw's tie-break)
 * advances so the bracket stays deterministic.
 *
 * Returns the winning leagueId, or `null` only when the match has
 * no two competing leagues (shouldn't happen at resolution time but
 * is defensive).
 */
const pickMatchWinner = ({
	fromLeagueId,
	toLeagueId,
	fromQualifies,
	toQualifies,
	fromAccuracy,
	toAccuracy
}: {
	fromLeagueId: string | null;
	toLeagueId: string | null;
	fromQualifies: boolean;
	toQualifies: boolean;
	fromAccuracy: number;
	toAccuracy: number;
}): string | null => {
	if (isNullish(fromLeagueId) || isNullish(toLeagueId)) {
		return null;
	}

	if (fromQualifies && !toQualifies) {
		return fromLeagueId;
	}

	if (!fromQualifies && toQualifies) {
		return toLeagueId;
	}

	if (!fromQualifies && !toQualifies) {
		// Both forfeit: lower leagueId advances (matches the seeding
		// tie-break in `countMembersPerLeague`).
		return fromLeagueId < toLeagueId ? fromLeagueId : toLeagueId;
	}

	// Both qualify: higher accuracy wins. Tie-break: lower leagueId.
	if (fromAccuracy === toAccuracy) {
		return fromLeagueId < toLeagueId ? fromLeagueId : toLeagueId;
	}

	return fromAccuracy > toAccuracy ? fromLeagueId : toLeagueId;
};

type MatchesByRound = Record<
	TournamentRound,
	Array<{ key: string; doc: TournamentMatchDoc; version?: bigint }>
>;

/** Every match doc of the tournament with its key and version, bucketed by
 * round and sorted by index (populating next-round slots requires a
 * deterministic order). */
const readMatchesByRound = ({
	tournamentId,
	callerBytes
}: {
	tournamentId: string;
	callerBytes: Uint8Array;
}): MatchesByRound => {
	const { items } = listDocsStore({
		collection: Collection.TOURNAMENT_MATCHES,
		caller: callerBytes,
		params: {}
	});

	const matchesByRound: MatchesByRound = {
		r1: [],
		quarter: [],
		semifinal: [],
		final: []
	};

	const prefix = `${tournamentId}/`;

	for (const [docKey, item] of items) {
		if (docKey.startsWith(prefix)) {
			try {
				const doc = decodeDocData<TournamentMatchDoc>(item.data);

				if (doc.tournamentId === tournamentId) {
					matchesByRound[doc.round].push({ key: docKey, doc, version: item.version });
				}
			} catch {
				// skip malformed
			}
		}
	}

	for (const r of TOURNAMENT_ROUNDS) {
		matchesByRound[r].sort((a, b) => a.doc.index - b.doc.index);
	}

	return matchesByRound;
};

/** Why `round` cannot be resolved at `nowMs`: it has no matches, its window
 * has not closed, or an earlier round still has an open match (the bracket
 * advances in order so winners can propagate). Nothing when it can. */
const roundRefusal = ({
	matchesByRound,
	round,
	nowMs
}: {
	matchesByRound: MatchesByRound;
	round: TournamentRound;
	nowMs: number;
}): ResolveTournamentRoundRefusalReason | undefined => {
	const [first] = matchesByRound[round];

	if (isNullish(first)) {
		return 'no_matches';
	}

	if (first.doc.endMs > nowMs) {
		return 'round_not_yet_closed';
	}

	const earlierOpen = TOURNAMENT_ROUNDS.slice(0, TOURNAMENT_ROUNDS.indexOf(round)).some((r) =>
		matchesByRound[r].some((m) => isNullish(m.doc.winnerLeagueId))
	);

	if (earlierOpen) {
		return 'previous_round_not_resolved';
	}
};

/** Flip the tournament to `concluded` once the final has a winner; whether it did. */
const concludeTournament = ({
	tournamentId,
	matchesByRound,
	writer
}: {
	tournamentId: string;
	matchesByRound: MatchesByRound;
	writer: Uint8Array;
}): boolean => {
	const [finalMatch] = matchesByRound.final;
	const tournamentDoc = getDocStore({
		collection: Collection.TOURNAMENTS,
		key: tournamentId,
		caller: writer
	});

	if (
		isNullish(finalMatch) ||
		isNullish(finalMatch.doc.winnerLeagueId) ||
		isNullish(tournamentDoc)
	) {
		return false;
	}

	setDocStore({
		collection: Collection.TOURNAMENTS,
		key: tournamentId,
		caller: writer,
		doc: {
			data: encodeDocData<TournamentDoc>({
				...decodeDocData<TournamentDoc>(tournamentDoc.data),
				state: 'concluded'
			}),
			version: tournamentDoc.version
		}
	});

	return true;
};

/**
 * Write the resolved-match payload to the datastore and propagate
 * the winner to the next round's slot. Returns 1 to bump the
 * `matchesResolved` counter in the caller.
 *
 * Split out of the resolution loop so the loop body has no `continue`
 * statements: every branch falls through cleanly.
 */
const resolveMatchInPlace = ({
	entry,
	fromEval,
	toEval,
	winner,
	round,
	matchesByRound,
	writer
}: {
	entry: MatchesByRound[TournamentRound][number];
	fromEval: { qualifies: boolean; accuracy: number };
	toEval: { qualifies: boolean; accuracy: number };
	winner: string;
	round: TournamentRound;
	matchesByRound: MatchesByRound;
	writer: Uint8Array;
}): number => {
	const updated: TournamentMatchDoc = {
		...entry.doc,
		fromAcc: fromEval.qualifies ? fromEval.accuracy : null,
		toAcc: toEval.qualifies ? toEval.accuracy : null,
		winnerLeagueId: winner
	};

	setDocStore({
		collection: Collection.TOURNAMENT_MATCHES,
		key: entry.key,
		caller: writer,
		doc: {
			data: encodeDocData(updated),
			version: entry.version
		}
	});

	// Propagate the winner to the next round's slot. For a 16-team
	// bracket the mapping is: match (i) feeds next-round match
	// (i/2), alternating from/to slot by parity.
	propagateWinnerToNextRound({
		round,
		index: entry.doc.index,
		winnerLeagueId: winner,
		matchesByRound,
		writer
	});

	return 1;
};

/**
 * Resolve every match in a closed round. Anyone can call; idempotent
 * via the `winnerLeagueId` write-once invariant: a second call for
 * the same round either re-resolves any matches that haven't been
 * settled yet (no-op for already-settled ones) or returns the same
 * `matchesResolved` count.
 *
 * Refuses if `round.endMs > now` (round hasn't closed) or if any
 * earlier round has unresolved matches (the bracket must advance
 * in order so winners can propagate).
 *
 * On `final` resolution the tournament doc flips from `in_flight`
 * to `concluded` and the FE can fire prize claims.
 */
export const resolveTournamentRoundFn = async ({
	tournamentId,
	round
}: {
	tournamentId: string;
	round: string;
}): Promise<ResolveTournamentRoundResult> => {
	if (!TOURNAMENT_ROUNDS.includes(round as TournamentRound)) {
		return { ok: false, reason: 'invalid_input' };
	}

	const round_ = round as TournamentRound;
	const callerBytes = msgCaller().toUint8Array();

	const tournamentDoc = getDocStore({
		collection: Collection.TOURNAMENTS,
		key: tournamentId,
		caller: callerBytes
	});

	if (isNullish(tournamentDoc)) {
		return { ok: false, reason: 'tournament_not_found' };
	}

	const scored = readMatchesByRound({ tournamentId, callerBytes });
	const refusal = roundRefusal({ matchesByRound: scored, round: round_, nowMs: timeMs() });

	if (nonNullish(refusal)) {
		return { ok: false, reason: refusal };
	}

	// Already-settled matches are skipped (idempotent re-run).
	const scores = await Promise.all(
		scored[round_]
			.filter((entry) => isNullish(entry.doc.winnerLeagueId))
			.map(async ({ doc }) => {
				const [fromEval, toEval] = await Promise.all([
					leagueWindowAccuracy({
						leagueId: doc.fromLeagueId,
						startMs: doc.startMs,
						endMs: doc.endMs,
						drawnAtNs: tournamentDoc.created_at,
						caller: callerBytes
					}),
					leagueWindowAccuracy({
						leagueId: doc.toLeagueId,
						startMs: doc.startMs,
						endMs: doc.endMs,
						drawnAtNs: tournamentDoc.created_at,
						caller: callerBytes
					})
				]);

				return { index: doc.index, fromEval, toEval };
			})
	);

	// Re-read after the clearing reads: another resolver may have written
	// the bracket meanwhile, and every write below goes against the
	// versions stored now.
	const matchesByRound = readMatchesByRound({ tournamentId, callerBytes });
	const writer = controllerCaller(writerPurpose);
	let matchesResolved = 0;

	for (const { index, fromEval, toEval } of scores) {
		const entry = matchesByRound[round_].find((m) => m.doc.index === index);
		const winner = isNullish(entry)
			? null
			: pickMatchWinner({
					fromLeagueId: entry.doc.fromLeagueId,
					toLeagueId: entry.doc.toLeagueId,
					fromQualifies: fromEval.qualifies,
					toQualifies: toEval.qualifies,
					fromAccuracy: fromEval.accuracy,
					toAccuracy: toEval.accuracy
				});

		// A match settled meanwhile, or with no league ids (malformed
		// bracket), is a no-op.
		if (nonNullish(entry) && isNullish(entry.doc.winnerLeagueId) && nonNullish(winner)) {
			matchesResolved += resolveMatchInPlace({
				entry,
				fromEval,
				toEval,
				winner,
				round: round_,
				matchesByRound,
				writer
			});
		}
	}

	const tournamentConcluded =
		round_ === 'final' && concludeTournament({ tournamentId, matchesByRound, writer });

	return { ok: true, matchesResolved, tournamentConcluded };
};

/**
 * After resolving a match, fill the matching slot in the next-round
 * match doc with the winner. The next match doc's `fromLeagueId` / `toLeagueId` slots
 * are write-once-from-null, so a second resolution call (idempotent)
 * is a no-op: the assert rejects the overwrite cleanly.
 *
 * Slot mapping for 16-team single-elim:
 *  - r1 match (2k)   → quarter match (k), from-slot
 *  - r1 match (2k+1) → quarter match (k), to-slot
 *  - quarter match (2k)   → semi match (k), from-slot
 *  - quarter match (2k+1) → semi match (k), to-slot
 *  - semi match (0) → final match (0), from-slot
 *  - semi match (1) → final match (0), to-slot
 */
const propagateWinnerToNextRound = ({
	round,
	index,
	winnerLeagueId,
	matchesByRound,
	writer
}: {
	round: TournamentRound;
	index: number;
	winnerLeagueId: string;
	matchesByRound: MatchesByRound;
	writer: Uint8Array;
}): void => {
	const nextRoundIndex = TOURNAMENT_ROUNDS.indexOf(round) + 1;

	if (nextRoundIndex >= TOURNAMENT_ROUNDS.length) {
		// Final round: no propagation.
		return;
	}

	const nextRound = TOURNAMENT_ROUNDS[nextRoundIndex];
	const nextIndex = Math.floor(index / 2);
	const isFromSlot = index % 2 === 0;
	const nextMatchEntry = matchesByRound[nextRound].find((m) => m.doc.index === nextIndex);

	if (isNullish(nextMatchEntry)) {
		return;
	}

	// Skip if the slot is already filled (idempotent re-run).
	if (isFromSlot && nonNullish(nextMatchEntry.doc.fromLeagueId)) {
		return;
	}

	if (!isFromSlot && nonNullish(nextMatchEntry.doc.toLeagueId)) {
		return;
	}

	const updated: TournamentMatchDoc = {
		...nextMatchEntry.doc,
		...(isFromSlot ? { fromLeagueId: winnerLeagueId } : { toLeagueId: winnerLeagueId })
	};

	const {
		data: { after }
	} = setDocStore({
		collection: Collection.TOURNAMENT_MATCHES,
		key: nextMatchEntry.key,
		caller: writer,
		doc: {
			data: encodeDocData(updated),
			version: nextMatchEntry.version
		}
	});

	// Matches 2k and 2k+1 both write next-round match k in the same call:
	// the second write must carry the version the first one produced, or
	// the datastore rejects it as stale.
	nextMatchEntry.doc = updated;
	nextMatchEntry.version = after.version;
};

// ─── Prize claim ─────────────────────────────────────────────────

export type ClaimTournamentPrizeRefusalReason =
	'tournament_not_found' | 'tournament_not_concluded' | 'not_member_of_top_league';

export interface ClaimTournamentPrizeResult {
	ok: boolean;
	reason?: ClaimTournamentPrizeRefusalReason;
	awardsCreated?: number;
	awardsAlreadyClaimed?: number;
	totalVxpCredited?: number;
}

/**
 * Per-user claim endpoint. Reads the concluded tournament + matches,
 * computes the caller's placement (1 / 2 / 3) by checking
 * `LEAGUE_MEMBERS` against the bracket's podium leagues, and credits
 * one `VXP_AWARDS` doc.
 *
 * Place 1: member of the final-winner league.
 * Place 2: member of the final-loser league (= the other finalist).
 * Place 3: member of *either* semifinal loser league (semifinal
 *          losers split the bronze tier evenly under the single
 *          bronze placement).
 *
 * Only memberships stored at or before the draw count, and only for a
 * caller who settled at least one call inside the tournament window: a
 * podium league's idle members earn nothing (refused as not a member of a
 * placed league). A member of several podium leagues is offered the
 * highest tier (`decideTournamentPrize`). One prize per caller per
 * tournament: the
 * award is keyed on the tournament alone, and a doc under any per-place
 * key of an earlier claim counts as claimed too, so a second claim (for
 * the same place or another) returns `awardsAlreadyClaimed: 1`.
 */
export const claimTournamentPrizeFn = async ({
	tournamentId
}: {
	tournamentId: string;
}): Promise<ClaimTournamentPrizeResult> => {
	const caller = msgCaller();
	const callerText = caller.toText();
	const callerBytes = caller.toUint8Array();

	const tournamentDoc = getDocStore({
		collection: Collection.TOURNAMENTS,
		key: tournamentId,
		caller: callerBytes
	});

	if (isNullish(tournamentDoc)) {
		return { ok: false, reason: 'tournament_not_found' };
	}

	const tournament = decodeDocData<TournamentDoc>(tournamentDoc.data);

	if (tournament.state !== 'concluded') {
		return { ok: false, reason: 'tournament_not_concluded' };
	}

	const podium = tournamentPodium(readTournamentMatches({ tournamentId, callerBytes }));

	if (isNullish(podium)) {
		return { ok: false, reason: 'tournament_not_concluded' };
	}

	const decide = (): TournamentPrizeDecision =>
		decideTournamentPrize({
			tournamentId,
			podium,
			memberships: readCallerMemberships({ callerText, callerBytes }),
			// The doc's own `created_at` is the draw time: the `createdAtMs`
			// field is written by whoever wrote the doc, so it cannot be the
			// cutoff.
			drawnAtNs: tournamentDoc.created_at,
			isHeld: (heldAwardKey) =>
				nonNullish(
					getDocStore({
						collection: Collection.VXP_AWARDS,
						key: vxpAwardKey({
							recipient: callerText,
							awardType: 'tournament_prize',
							awardKey: heldAwardKey
						}),
						caller: callerBytes
					})
				)
		});

	const firstDecision = decide();

	// Settled history is read only for a claim that would pay: every
	// Tournament page mount claims.
	if (
		firstDecision.outcome === 'grant' &&
		!(await settledInTournament({
			caller,
			tournament: decodeDocData<TournamentDoc>(tournamentDoc.data)
		}))
	) {
		return { ok: false, reason: 'not_member_of_top_league' };
	}

	// Decided again after the clearing read: a concurrent claim may have
	// written the award meanwhile.
	const decision = firstDecision.outcome === 'grant' ? decide() : firstDecision;

	if (decision.outcome === 'not_placed') {
		return { ok: false, reason: 'not_member_of_top_league' };
	}

	if (decision.outcome === 'already_claimed') {
		return {
			ok: true,
			awardsCreated: 0,
			awardsAlreadyClaimed: 1,
			totalVxpCredited: 0
		};
	}

	const { place: myPlace, awardKey } = decision;
	const tier = TOURNAMENT_PRIZE_TIERS.find((t) => t.place === myPlace);

	if (isNullish(tier)) {
		// Defensive: should never happen since `myPlace` was just
		// derived from the same enum, but guard anyway.
		return { ok: false, reason: 'not_member_of_top_league' };
	}

	const nowMs = timeMs();
	// `tier.vxp` is the human-readable whole-VXP prize (5000 / 2500 / 1000),
	// the same value the FE renders. The award doc / ledger work in base
	// units (VXP has 4 decimals), so size it via `vxpBaseUnits` like every
	// other award constant: writing the raw whole number here would
	// under-pay by 10⁴ (5000 base units = 0.5 VXP).
	const amountBaseUnits = vxpBaseUnits(tier.vxp);
	const pendingDoc: VxpAwardDoc = {
		recipient: callerText,
		awardType: 'tournament_prize',
		awardKey,
		amountBaseUnits: amountBaseUnits.toString(),
		status: 'pending',
		earnedAtMs: nowMs
	};

	persistAward({ recipient: callerText, awardType: 'tournament_prize', awardKey, doc: pendingDoc });

	// Pay the prize inline: same pending → paid/failed ledger pattern as
	// claimWorldsPodiumPrize, so the award reflects a real transfer rather
	// than sitting `pending` forever (nothing sweeps `tournament_prize`).
	const ledger = new IcrcLedgerCanister({
		canisterId: Principal.fromText(VXP_LEDGER_CANISTER_ID)
	});
	const transferResult = await transferWithBadFeeRetry({
		ledger,
		toOwner: caller,
		amount: amountBaseUnits,
		memo: `vxp:tournament_prize:${awardKey}`
	});

	if (transferResult.ok) {
		updateAward({
			recipient: callerText,
			awardType: 'tournament_prize',
			awardKey,
			patch: {
				status: 'paid',
				paidAtMs: nowMs,
				blockIndex: transferResult.blockIndex.toString()
			}
		});

		logInfo({
			message: 'tournament_prize credited',
			detail: { recipient: callerText, tournamentId, place: myPlace, amount: amountBaseUnits }
		});

		return {
			ok: true,
			awardsCreated: 1,
			awardsAlreadyClaimed: 0,
			totalVxpCredited: tier.vxp
		};
	}

	updateAward({
		recipient: callerText,
		awardType: 'tournament_prize',
		awardKey,
		patch: { status: 'failed', errorMessage: transferResult.error }
	});

	logError({
		message: 'tournament_prize transfer failed',
		detail: { recipient: callerText, tournamentId, place: myPlace, error: transferResult.error }
	});

	// Transfer failed: report nothing credited (the doc is left `failed`
	// for diagnostics) so the FE never shows a credit that didn't land.
	return {
		ok: true,
		awardsCreated: 0,
		awardsAlreadyClaimed: 0,
		totalVxpCredited: 0
	};
};

/** Whether the caller settled at least one call inside the tournament window. */
const settledInTournament = async ({
	caller,
	tournament
}: {
	caller: Principal;
	tournament: TournamentDoc;
}): Promise<boolean> => {
	const { calls } = await settledTotals({
		members: [caller],
		fromMs: tournament.monthStartMs,
		toMs: tournament.monthEndMs
	});

	return calls > 0;
};

/** Every match doc of the tournament, in no particular order. */
const readTournamentMatches = ({
	tournamentId,
	callerBytes
}: {
	tournamentId: string;
	callerBytes: Uint8Array;
}): TournamentMatchDoc[] => {
	const { items } = listDocsStore({
		collection: Collection.TOURNAMENT_MATCHES,
		caller: callerBytes,
		params: {}
	});

	const prefix = `${tournamentId}/`;
	const out: TournamentMatchDoc[] = [];

	for (const [docKey, item] of items) {
		if (docKey.startsWith(prefix)) {
			try {
				const doc = decodeDocData<TournamentMatchDoc>(item.data);

				if (doc.tournamentId === tournamentId) {
					out.push(doc);
				}
			} catch {
				// skip malformed
			}
		}
	}

	return out;
};

/**
 * Scan `LEAGUE_MEMBERS` for the caller's current memberships, each with
 * the time its doc was stored.
 */
const readCallerMemberships = ({
	callerText,
	callerBytes
}: {
	callerText: string;
	callerBytes: Uint8Array;
}): TournamentPrizeMembership[] => {
	const { items } = listDocsStore({
		collection: Collection.LEAGUE_MEMBERS,
		caller: callerBytes,
		params: {}
	});

	const suffix = `/${callerText}`;
	const out: TournamentPrizeMembership[] = [];

	for (const [docKey, item] of items) {
		if (docKey.endsWith(suffix)) {
			try {
				const member = decodeDocData<LeagueMemberDoc>(item.data);

				if (member.member === callerText) {
					out.push({ leagueId: member.leagueId, joinedAtNs: item.created_at });
				}
			} catch {
				// skip malformed
			}
		}
	}

	return out;
};

// Re-export for type narrowing in callers without re-importing
// `#lib/types/tournament.ts`.
export type { TournamentDoc, TournamentMatchDoc };
