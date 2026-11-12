import { VXP_LEDGER_CANISTER_ID } from '#lib/constants/canisters.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import { VXP_TOKEN } from '#lib/constants/tokens/tokens.ic.constants.ts';
import type { LeagueMemberDoc } from '#lib/types/league-member.ts';
import type { LeagueDoc } from '#lib/types/league.ts';
import {
	matchCountForRound,
	monthAnchorFromMs,
	roundWindow,
	TOURNAMENT_BRACKET_SIZE,
	TOURNAMENT_MIN_CALLS_PER_MATCH,
	TOURNAMENT_PRIZE_TIERS,
	TOURNAMENT_ROUND_DURATION_MS,
	TOURNAMENT_ROUNDS,
	tournamentMatchKey,
	type TournamentDoc,
	type TournamentMatchDoc,
	type TournamentRound
} from '#lib/types/tournament.ts';
import { vxpAwardKey, type VxpAwardDoc } from '#lib/types/vxp-award.ts';
import { parseToken } from '#lib/utils/parse.utils.ts';
import { getLeagueStatsFn } from '#satellite/services/league-stats.services.ts';
import { transferWithBadFeeRetry } from '#satellite/services/vxp-payout.services.ts';
import { logError, logInfo } from '#satellite/utils/logger.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import type { AssertSetDocContext } from '@junobuild/functions';
import { IcrcLedgerCanister } from '@junobuild/functions/canisters/ledger/icrc';
import { msgCaller, time } from '@junobuild/functions/ic-cdk';
import {
	decodeDocData,
	encodeDocData,
	getDocStore,
	listDocsStore,
	setDocStore
} from '@junobuild/functions/sdk';

/**
 * Monthly tournament — the full chain.
 *
 *  - Asserts for both collections (key shape, write-once invariants
 *    on team / accuracy / winner / start-snapshot fields, forward-only
 *    state machine `in_flight → concluded`).
 *  - `triggerTournamentDrawFn` — anyone can call; idempotent via
 *    doc-key collision on the month anchor. Scans LEAGUE_MEMBERS,
 *    counts members per league, seeds the top-16 into Round 1, and
 *    snapshots each seeded league's `(totalCalls, wins)` for the
 *    per-window accuracy computation in resolution.
 *  - `getCurrentTournamentFn` — returns the latest tournament + its
 *    matches for the FE bracket.
 *  - `resolveTournamentRoundFn` — anyone can call once a round has
 *    closed; reads live LEAGUE_STATS, computes per-side window
 *    accuracy as `(currentStats - startSnapshot) / deltaCalls`,
 *    applies the 50-call forfeit rule, writes the winner + propagates
 *    them into the next round's slot. Idempotent via the match
 *    doc's `winnerLeagueId` write-once invariant.
 *  - `claimTournamentPrizeFn` — per-user claim once the tournament
 *    concludes; credits a single VXP_AWARDS doc per the caller's
 *    highest-tier placement.
 *
 * Forfeit rule: a league with fewer than 50 calls in the window
 * forfeits. If both sides forfeit, the lower-leagueId advances —
 * keeps the bracket deterministic without needing a coin-flip RNG.
 */

const ASSERT_PREFIX = 'tournament';

/**
 * Single-doc-per-month assert. Key must equal `${id}` and match
 * `monthAnchorFromMs(monthStartMs)`. `bracketSize` and
 * `seededLeagueIds` are immutable after the initial write; the only
 * field that ever mutates is `state` (in_flight → concluded).
 */
export const assertSetTournament = ({
	data: {
		collection,
		key,
		data: { current, proposed }
	}
}: AssertSetDocContext): void => {
	if (collection !== Collection.TOURNAMENTS) {
		return;
	}

	const proposedDoc = decodeDocData<TournamentDoc>(proposed.data);

	if (key !== proposedDoc.id) {
		throw new Error(
			`${ASSERT_PREFIX}: doc key "${key}" must match embedded id "${proposedDoc.id}".`
		);
	}

	if (!/^\d{4}-\d{2}$/.test(proposedDoc.id)) {
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
	data: {
		collection,
		key,
		data: { current, proposed }
	}
}: AssertSetDocContext): void => {
	if (collection !== Collection.TOURNAMENT_MATCHES) {
		return;
	}

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

	// Start-of-window stat snapshots — write-once from null. Set when
	// a league is first assigned to a slot, frozen thereafter.
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
 * Count active members per league by scanning LEAGUE_MEMBERS. Returns
 * a `[leagueId, memberCount]` array sorted by count desc; ties
 * broken by leagueId asc so the seeding is deterministic.
 *
 * Heavy scan, but the satellite has no compound index — and a
 * draw runs at most once per month, so the cost is acceptable.
 */
const countMembersPerLeague = (callerBytes: Uint8Array): Array<[string, number]> => {
	const { items } = listDocsStore({
		collection: Collection.LEAGUE_MEMBERS,
		caller: callerBytes,
		params: {}
	});

	const counts = new Map<string, number>();

	for (const [, item] of items) {
		try {
			const member = decodeDocData<LeagueMemberDoc>(item.data);
			counts.set(member.leagueId, (counts.get(member.leagueId) ?? 0) + 1);
		} catch {
			// skip malformed
		}
	}

	return Array.from(counts.entries()).sort(([aId, aCount], [bId, bCount]) => {
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

export type TriggerTournamentDrawRefusalReason =
	'already_drawn' | 'month_not_started' | 'insufficient_leagues' | 'invalid_input';

export interface TriggerTournamentDrawResult {
	ok: boolean;
	tournamentId?: string;
	reason?: TriggerTournamentDrawRefusalReason;
	availableLeagues?: number;
}

/**
 * Run the monthly draw for `monthAnchor`. Anyone can call (the
 * doc-key collision makes the draw idempotent — a second call for
 * the same month returns `already_drawn` cleanly), so the FE can
 * fire-and-forget on every Tournament-page mount.
 *
 * Refuses if fewer than `TOURNAMENT_BRACKET_SIZE` leagues exist —
 * the data set is too small to seed a full bracket. The FE surfaces
 * this as a "waiting on more leagues" hint.
 */
export const triggerTournamentDrawFn = ({
	monthAnchor
}: {
	monthAnchor: string;
}): TriggerTournamentDrawResult => {
	if (!/^\d{4}-\d{2}$/.test(monthAnchor)) {
		return { ok: false, reason: 'invalid_input' };
	}

	const caller = msgCaller();
	const callerBytes = caller.toUint8Array();

	// Idempotency — collide on doc key for the same month.
	const existing = getDocStore({
		collection: Collection.TOURNAMENTS,
		key: monthAnchor,
		caller: callerBytes
	});

	if (nonNullish(existing)) {
		return { ok: false, reason: 'already_drawn', tournamentId: monthAnchor };
	}

	// Compute the month's window. The draw can be triggered for any
	// month that has *started*; the lazy-on-mount pattern triggers
	// the draw on the first day of a new month.
	const nowMs = Number(time() / 1_000_000n);
	const [year, monthStr] = monthAnchor.split('-');
	const monthDate = new Date(Date.UTC(Number(year), Number(monthStr) - 1, 1, 0, 0, 0, 0));
	const startMs = monthDate.getTime();

	if (startMs > nowMs) {
		return { ok: false, reason: 'month_not_started' };
	}

	const ranking = countMembersPerLeague(callerBytes);

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
	// here would still be eligible by member-count, but we skip it.
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
		monthEndMs: startMs + 4 * TOURNAMENT_ROUND_DURATION_MS,
		bracketSize: TOURNAMENT_BRACKET_SIZE,
		state: 'in_flight',
		seededLeagueIds: verifiedSeeded,
		createdAtMs: nowMs
	};

	setDocStore({
		collection: Collection.TOURNAMENTS,
		key: monthAnchor,
		caller: callerBytes,
		doc: {
			data: encodeDocData(tournamentDoc)
		}
	});

	// Write the 8 Round-1 matches with the seeded pairs. For each
	// league we snapshot the current `LEAGUE_STATS` counters so the
	// round-resolution endpoint can compute the window delta later.
	const r1Pairs = seedFirstRoundPairs(verifiedSeeded);
	const r1Window = roundWindow({ tournamentMonthStartMs: startMs, round: 'r1' });

	for (let index = 0; index < r1Pairs.length; index += 1) {
		const pair = r1Pairs[index];
		const fromSnapshot = readLeagueStartSnapshot({
			leagueId: pair.fromLeagueId,
			caller: callerBytes
		});
		const toSnapshot = readLeagueStartSnapshot({
			leagueId: pair.toLeagueId,
			caller: callerBytes
		});

		const matchDoc: TournamentMatchDoc = {
			tournamentId: monthAnchor,
			round: 'r1',
			index,
			fromLeagueId: pair.fromLeagueId,
			toLeagueId: pair.toLeagueId,
			fromStartCalls: fromSnapshot.totalCalls,
			fromStartWins: fromSnapshot.wins,
			toStartCalls: toSnapshot.totalCalls,
			toStartWins: toSnapshot.wins,
			fromAcc: null,
			toAcc: null,
			winnerLeagueId: null,
			startMs: r1Window.startMs,
			endMs: r1Window.endMs
		};

		setDocStore({
			collection: Collection.TOURNAMENT_MATCHES,
			key: tournamentMatchKey({ tournamentId: monthAnchor, round: 'r1', index }),
			caller: callerBytes,
			doc: {
				data: encodeDocData(matchDoc)
			}
		});
	}

	// Write the TBD-slot matches for quarter / semifinal / final so
	// the bracket UI can render the skeleton immediately. Start
	// snapshots are null until the previous round's resolution
	// promotes the winner into the slot.
	for (const round of ['quarter', 'semifinal', 'final'] as const) {
		const window_ = roundWindow({ tournamentMonthStartMs: startMs, round });
		const count = matchCountForRound(round);

		for (let index = 0; index < count; index += 1) {
			const matchDoc: TournamentMatchDoc = {
				tournamentId: monthAnchor,
				round,
				index,
				fromLeagueId: null,
				toLeagueId: null,
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

			setDocStore({
				collection: Collection.TOURNAMENT_MATCHES,
				key: tournamentMatchKey({ tournamentId: monthAnchor, round, index }),
				caller: callerBytes,
				doc: {
					data: encodeDocData(matchDoc)
				}
			});
		}
	}

	return { ok: true, tournamentId: monthAnchor };
};

/**
 * Read a league's current `(totalCalls, wins)` for the start-of-
 * window snapshot. Returns zeroes when the league has no stats doc
 * yet — a brand-new league with no resolved trades, which means its
 * round window will simply have `delta = 0` calls and forfeit per
 * the 50-call minimum.
 */
const readLeagueStartSnapshot = ({
	leagueId,
	caller
}: {
	leagueId: string;
	caller: Uint8Array;
}): { totalCalls: number; wins: number } => {
	const stats = getLeagueStatsFn({ leagueId, caller });

	return {
		totalCalls: stats?.totalCalls ?? 0,
		wins: stats?.wins ?? 0
	};
};

/**
 * Read the most recent tournament (highest YYYY-MM key) and its
 * matches. Returns `null` for the tournament when none has been
 * drawn yet — the FE renders the "no tournament yet" / draw CTA.
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
 * Compute a league's accuracy in a single round window. The match
 * doc carries the league's `(totalCalls, wins)` snapshot at the
 * moment it was assigned to the slot; the current `LEAGUE_STATS`
 * doc carries the live counter. The window delta is the difference.
 *
 * Returns:
 *  - `{ qualifies: false }` when fewer than
 *    `TOURNAMENT_MIN_CALLS_PER_MATCH` calls happened in the window
 *    — the league forfeits per decision 3.3.
 *  - `{ qualifies: true, accuracy, deltaCalls }` otherwise. Accuracy
 *    is in [0,1].
 */
const leagueWindowAccuracy = ({
	leagueId,
	startCalls,
	startWins,
	caller
}: {
	leagueId: string;
	startCalls: number;
	startWins: number;
	caller: Uint8Array;
}): { qualifies: boolean; accuracy: number; deltaCalls: number } => {
	const current = getLeagueStatsFn({ leagueId, caller });
	const currentCalls = current?.totalCalls ?? 0;
	const currentWins = current?.wins ?? 0;
	const deltaCalls = Math.max(0, currentCalls - startCalls);
	const deltaWins = Math.max(0, Math.min(deltaCalls, currentWins - startWins));

	if (deltaCalls < TOURNAMENT_MIN_CALLS_PER_MATCH) {
		return { qualifies: false, accuracy: 0, deltaCalls };
	}

	return {
		qualifies: true,
		accuracy: deltaWins / deltaCalls,
		deltaCalls
	};
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
		// Both forfeit — lower leagueId advances (matches the seeding
		// tie-break in `countMembersPerLeague`).
		return fromLeagueId < toLeagueId ? fromLeagueId : toLeagueId;
	}

	// Both qualify — higher accuracy wins. Tie-break: lower leagueId.
	if (fromAccuracy === toAccuracy) {
		return fromLeagueId < toLeagueId ? fromLeagueId : toLeagueId;
	}

	return fromAccuracy > toAccuracy ? fromLeagueId : toLeagueId;
};

/**
 * Write the resolved-match payload to the datastore and propagate
 * the winner to the next round's slot. Returns 1 to bump the
 * `matchesResolved` counter in the caller.
 *
 * Split out of the resolution loop so the loop body has no `continue`
 * statements — every branch falls through cleanly.
 */
const resolveMatchInPlace = ({
	entry,
	fromEval,
	toEval,
	winner,
	round,
	matchesByRound,
	caller
}: {
	entry: { key: string; doc: TournamentMatchDoc; version?: bigint };
	fromEval: { qualifies: boolean; accuracy: number };
	toEval: { qualifies: boolean; accuracy: number };
	winner: string;
	round: TournamentRound;
	matchesByRound: Record<
		TournamentRound,
		Array<{ key: string; doc: TournamentMatchDoc; version?: bigint }>
	>;
	caller: Uint8Array;
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
		caller,
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
		caller
	});

	return 1;
};

/**
 * Resolve every match in a closed round. Anyone can call; idempotent
 * via the `winnerLeagueId` write-once invariant — a second call for
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
export const resolveTournamentRoundFn = ({
	tournamentId,
	round
}: {
	tournamentId: string;
	round: string;
}): ResolveTournamentRoundResult => {
	if (!TOURNAMENT_ROUNDS.includes(round as TournamentRound)) {
		return { ok: false, reason: 'invalid_input' };
	}

	const round_ = round as TournamentRound;
	const caller = msgCaller();
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
	const nowMs = Number(time() / 1_000_000n);

	// Scan match docs once; bucket by round so we can verify earlier
	// rounds are resolved before settling this one.
	const { items } = listDocsStore({
		collection: Collection.TOURNAMENT_MATCHES,
		caller: callerBytes,
		params: {}
	});

	const matchesByRound: Record<
		TournamentRound,
		Array<{ key: string; doc: TournamentMatchDoc; version?: bigint }>
	> = {
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

	// Sort each round by match index — populating next-round slots
	// requires deterministic ordering.
	for (const r of TOURNAMENT_ROUNDS) {
		matchesByRound[r].sort((a, b) => a.doc.index - b.doc.index);
	}

	const targetMatches = matchesByRound[round_];

	if (targetMatches.length === 0) {
		return { ok: false, reason: 'no_matches' };
	}

	// Round window must have closed.
	if (targetMatches[0].doc.endMs > nowMs) {
		return { ok: false, reason: 'round_not_yet_closed' };
	}

	// Earlier rounds must be fully resolved.
	const roundIndex = TOURNAMENT_ROUNDS.indexOf(round_);

	for (let i = 0; i < roundIndex; i += 1) {
		const earlier = matchesByRound[TOURNAMENT_ROUNDS[i]];
		const unresolved = earlier.find((m) => isNullish(m.doc.winnerLeagueId));

		if (nonNullish(unresolved)) {
			return { ok: false, reason: 'previous_round_not_resolved' };
		}
	}

	// Resolve every still-open match in the target round.
	let matchesResolved = 0;

	for (const entry of targetMatches) {
		// Already-settled matches are skipped (idempotent re-run); a
		// match with no league ids is also a no-op (malformed bracket).
		// Both branches fall through cleanly without `continue`.
		if (isNullish(entry.doc.winnerLeagueId)) {
			const fromEval = leagueWindowAccuracy({
				leagueId: entry.doc.fromLeagueId ?? '',
				startCalls: entry.doc.fromStartCalls ?? 0,
				startWins: entry.doc.fromStartWins ?? 0,
				caller: callerBytes
			});
			const toEval = leagueWindowAccuracy({
				leagueId: entry.doc.toLeagueId ?? '',
				startCalls: entry.doc.toStartCalls ?? 0,
				startWins: entry.doc.toStartWins ?? 0,
				caller: callerBytes
			});

			const winner = pickMatchWinner({
				fromLeagueId: entry.doc.fromLeagueId,
				toLeagueId: entry.doc.toLeagueId,
				fromQualifies: fromEval.qualifies,
				toQualifies: toEval.qualifies,
				fromAccuracy: fromEval.accuracy,
				toAccuracy: toEval.accuracy
			});

			if (nonNullish(winner)) {
				matchesResolved += resolveMatchInPlace({
					entry,
					fromEval,
					toEval,
					winner,
					round: round_,
					matchesByRound,
					caller: callerBytes
				});
			}
		}
	}

	// If this was the final round, flip the tournament to concluded.
	let tournamentConcluded = false;

	if (round_ === 'final') {
		const [finalMatch] = matchesByRound.final;

		if (nonNullish(finalMatch) && nonNullish(finalMatch.doc.winnerLeagueId)) {
			setDocStore({
				collection: Collection.TOURNAMENTS,
				key: tournamentId,
				caller: callerBytes,
				doc: {
					data: encodeDocData<TournamentDoc>({
						...tournament,
						state: 'concluded'
					}),
					version: tournamentDoc.version
				}
			});
			tournamentConcluded = true;
		}
	}

	return { ok: true, matchesResolved, tournamentConcluded };
};

/**
 * After resolving a match, fill the matching slot in the next-round
 * match doc with the winner + their current `(totalCalls, wins)`
 * snapshot. The next match doc's `fromLeagueId` / `toLeagueId` slots
 * are write-once-from-null, so a second resolution call (idempotent)
 * is a no-op — the assert rejects the overwrite cleanly.
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
	caller
}: {
	round: TournamentRound;
	index: number;
	winnerLeagueId: string;
	matchesByRound: Record<
		TournamentRound,
		Array<{ key: string; doc: TournamentMatchDoc; version?: bigint }>
	>;
	caller: Uint8Array;
}): void => {
	const nextRoundIndex = TOURNAMENT_ROUNDS.indexOf(round) + 1;

	if (nextRoundIndex >= TOURNAMENT_ROUNDS.length) {
		// Final round — no propagation.
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

	const snapshot = readLeagueStartSnapshot({ leagueId: winnerLeagueId, caller });
	const updated: TournamentMatchDoc = {
		...nextMatchEntry.doc,
		...(isFromSlot
			? {
					fromLeagueId: winnerLeagueId,
					fromStartCalls: snapshot.totalCalls,
					fromStartWins: snapshot.wins
				}
			: {
					toLeagueId: winnerLeagueId,
					toStartCalls: snapshot.totalCalls,
					toStartWins: snapshot.wins
				})
	};

	setDocStore({
		collection: Collection.TOURNAMENT_MATCHES,
		key: nextMatchEntry.key,
		caller,
		doc: {
			data: encodeDocData(updated),
			version: nextMatchEntry.version
		}
	});

	// Keep the in-memory matchesByRound in sync so subsequent
	// resolution writes in the same call don't try to overwrite the
	// freshly-populated slot. The `setDocStore` returns no version
	// number we could re-stamp, so we just bump the doc payload;
	// a follow-up `setDocStore` in the same call would race on
	// version, but the round-by-round flow only propagates one win
	// per next-round slot per call, so this stays safe.
	nextMatchEntry.doc = updated;
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
 * computes the caller's eligible placements (1 / 2 / 3) by checking
 * `LEAGUE_MEMBERS` against the bracket's winning leagues, and
 * credits one `VXP_AWARDS` doc per placement.
 *
 * Place 1: member of the final-winner league.
 * Place 2: member of the final-loser league (= the other finalist).
 * Place 3: member of *either* semifinal loser league (semifinal
 *          losers split the bronze tier evenly under the single
 *          bronze placement).
 *
 * A user who's a member of multiple eligible leagues only gets the
 * highest-tier award (place 1 trumps place 3, etc.) — the doc-key
 * collision invariant naturally enforces this since the award is
 * keyed `${caller}/tournament_prize/${tournamentId}_${place}` and
 * higher tiers write first.
 *
 * Idempotent via the doc key — a second claim returns
 * `awardsAlreadyClaimed > 0`.
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

	// Read the bracket — find the final match + the semifinal losers.
	const { items } = listDocsStore({
		collection: Collection.TOURNAMENT_MATCHES,
		caller: callerBytes,
		params: {}
	});

	let finalMatch: TournamentMatchDoc | undefined;
	const semifinalLosers: string[] = [];
	const prefix = `${tournamentId}/`;

	for (const [docKey, item] of items) {
		if (docKey.startsWith(prefix)) {
			try {
				const doc = decodeDocData<TournamentMatchDoc>(item.data);

				if (doc.round === 'final' && doc.tournamentId === tournamentId) {
					finalMatch = doc;
				} else if (doc.round === 'semifinal' && nonNullish(doc.winnerLeagueId)) {
					const loser = doc.winnerLeagueId === doc.fromLeagueId ? doc.toLeagueId : doc.fromLeagueId;

					if (nonNullish(loser)) {
						semifinalLosers.push(loser);
					}
				}
			} catch {
				// skip malformed
			}
		}
	}

	if (isNullish(finalMatch) || isNullish(finalMatch.winnerLeagueId)) {
		return { ok: false, reason: 'tournament_not_concluded' };
	}

	const placeOneLeague = finalMatch.winnerLeagueId;
	const placeTwoLeague =
		finalMatch.winnerLeagueId === finalMatch.fromLeagueId
			? finalMatch.toLeagueId
			: finalMatch.fromLeagueId;

	// Determine the caller's placement. Highest-tier wins.
	const callerLeagueIds = readCallerLeagueIds({ callerText, callerBytes });
	let myPlace: 1 | 2 | 3 | null = null;

	if (callerLeagueIds.has(placeOneLeague)) {
		myPlace = 1;
	} else if (nonNullish(placeTwoLeague) && callerLeagueIds.has(placeTwoLeague)) {
		myPlace = 2;
	} else if (semifinalLosers.some((id) => callerLeagueIds.has(id))) {
		myPlace = 3;
	}

	if (isNullish(myPlace)) {
		return { ok: false, reason: 'not_member_of_top_league' };
	}

	const tier = TOURNAMENT_PRIZE_TIERS.find((t) => t.place === myPlace);

	if (isNullish(tier)) {
		// Defensive — should never happen since `myPlace` was just
		// derived from the same enum, but guard anyway.
		return { ok: false, reason: 'not_member_of_top_league' };
	}

	const awardKey = `${tournamentId}_place_${myPlace}`;
	const docKey = vxpAwardKey({
		recipient: callerText,
		awardType: 'tournament_prize',
		awardKey
	});

	const existing = getDocStore({
		collection: Collection.VXP_AWARDS,
		key: docKey,
		caller: callerBytes
	});

	if (nonNullish(existing)) {
		return {
			ok: true,
			awardsCreated: 0,
			awardsAlreadyClaimed: 1,
			totalVxpCredited: 0
		};
	}

	const nowMs = Number(time() / 1_000_000n);
	// `tier.vxp` is the human-readable whole-VXP prize (5000 / 2500 / 1000),
	// the same value the FE renders. The award doc / ledger work in base
	// units (VXP has 4 decimals), so size it via `parseToken` like every
	// other award constant — writing the raw whole number here would
	// under-pay by 10⁴ (5000 base units = 0.5 VXP).
	const amountBaseUnits = parseToken({
		value: tier.vxp.toString(),
		unitName: VXP_TOKEN.decimals
	});
	const pendingDoc: VxpAwardDoc = {
		recipient: callerText,
		awardType: 'tournament_prize',
		awardKey,
		amountBaseUnits: amountBaseUnits.toString(),
		status: 'pending',
		earnedAtMs: nowMs
	};

	setDocStore({
		collection: Collection.VXP_AWARDS,
		key: docKey,
		caller: callerBytes,
		doc: {
			data: encodeDocData(pendingDoc)
		}
	});

	// Pay the prize inline — same pending → paid/failed ledger pattern as
	// claimWorldsPodiumPrize — so the award reflects a real transfer rather
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

	// Re-read to pick up the version stamp from the pending write.
	const pendingExisting = getDocStore({
		collection: Collection.VXP_AWARDS,
		key: docKey,
		caller: callerBytes
	});

	if (transferResult.ok) {
		setDocStore({
			collection: Collection.VXP_AWARDS,
			key: docKey,
			caller: callerBytes,
			doc: {
				data: encodeDocData<VxpAwardDoc>({
					...pendingDoc,
					status: 'paid',
					paidAtMs: nowMs,
					blockIndex: transferResult.blockIndex.toString()
				}),
				version: pendingExisting?.version
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

	setDocStore({
		collection: Collection.VXP_AWARDS,
		key: docKey,
		caller: callerBytes,
		doc: {
			data: encodeDocData<VxpAwardDoc>({
				...pendingDoc,
				status: 'failed',
				errorMessage: transferResult.error
			}),
			version: pendingExisting?.version
		}
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

/**
 * Scan `LEAGUE_MEMBERS` for the caller's memberships. Returns the
 * set of league ids the caller currently belongs to.
 */
const readCallerLeagueIds = ({
	callerText,
	callerBytes
}: {
	callerText: string;
	callerBytes: Uint8Array;
}): Set<string> => {
	const { items } = listDocsStore({
		collection: Collection.LEAGUE_MEMBERS,
		caller: callerBytes,
		params: {}
	});

	const suffix = `/${callerText}`;
	const out = new Set<string>();

	for (const [docKey, item] of items) {
		if (docKey.endsWith(suffix)) {
			try {
				const member = decodeDocData<LeagueMemberDoc>(item.data);

				if (member.member === callerText) {
					out.add(member.leagueId);
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
