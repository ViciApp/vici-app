// Monthly tournament: a 16-league single-elimination bracket drawn once per
// month (the YYYY-MM primary key makes a re-draw collide), seeded by member
// count with the league id as the deterministic tie-break, resolved round by
// round from league_stats window deltas (7-day windows, 50-call forfeit
// floor), and paid out through the economy's idempotent prize grants.

import { isNullish, nonNullish } from '@dfinity/utils';
import { query, tx, type TxQuery } from '../db/client';
import { getLeagueStats } from '../leagues/stats';
import { logger } from '../lib/logger';
import { DAY_IN_MS, MONTH_ANCHOR_RE, monthAnchorFromMs, monthStartMs } from '../lib/time';
import { TOURNAMENT_PRIZE_TIERS } from '../vxp/constants';
import { grantTournamentPrize } from '../vxp/prizes';

export const TOURNAMENT_ROUNDS = ['r1', 'quarter', 'semifinal', 'final'] as const;

export type TournamentRound = (typeof TOURNAMENT_ROUNDS)[number];

export const TOURNAMENT_BRACKET_SIZE = 16;
export const TOURNAMENT_ROUND_DURATION_MS = 7 * DAY_IN_MS;

/** Per-match qualification floor: a league below this many resolved calls in
 * the round window forfeits the match. */
export const TOURNAMENT_MIN_CALLS_PER_MATCH = 50;

export type TournamentState = 'in_flight' | 'concluded';

export interface Tournament {
	id: string;
	monthStartMs: number;
	monthEndMs: number;
	bracketSize: number;
	state: TournamentState;
	seededLeagueIds: string[];
	createdAtMs: number;
}

export interface TournamentMatch {
	tournamentId: string;
	round: TournamentRound;
	index: number;
	fromLeagueId: string | null;
	toLeagueId: string | null;
	fromStartCalls: number | null;
	fromStartWins: number | null;
	toStartCalls: number | null;
	toStartWins: number | null;
	fromAcc: number | null;
	toAcc: number | null;
	winnerLeagueId: string | null;
	startMs: number;
	endMs: number;
}

interface TournamentRow {
	id: string;
	month_start_ms: string;
	month_end_ms: string;
	bracket_size: number;
	state: TournamentState;
	seeded_league_ids: string[];
	created_at_ms: string;
}

interface TournamentMatchRow {
	tournament_id: string;
	round: TournamentRound;
	index: number;
	from_league_id: string | null;
	to_league_id: string | null;
	from_start_calls: number | null;
	from_start_wins: number | null;
	to_start_calls: number | null;
	to_start_wins: number | null;
	from_acc: number | null;
	to_acc: number | null;
	winner_league_id: string | null;
	start_ms: string;
	end_ms: string;
}

const TOURNAMENT_COLUMNS = `id, month_start_ms::text, month_end_ms::text, bracket_size, state,
	seeded_league_ids, created_at_ms::text`;

const MATCH_COLUMNS = `tournament_id, round, index, from_league_id, to_league_id,
	from_start_calls, from_start_wins, to_start_calls, to_start_wins, from_acc, to_acc,
	winner_league_id, start_ms::text, end_ms::text`;

const shapeTournament = (row: TournamentRow): Tournament => ({
	id: row.id,
	monthStartMs: Number(row.month_start_ms),
	monthEndMs: Number(row.month_end_ms),
	bracketSize: row.bracket_size,
	state: row.state,
	seededLeagueIds: row.seeded_league_ids,
	createdAtMs: Number(row.created_at_ms)
});

const shapeMatch = (row: TournamentMatchRow): TournamentMatch => ({
	tournamentId: row.tournament_id,
	round: row.round,
	index: row.index,
	fromLeagueId: row.from_league_id,
	toLeagueId: row.to_league_id,
	fromStartCalls: row.from_start_calls,
	fromStartWins: row.from_start_wins,
	toStartCalls: row.to_start_calls,
	toStartWins: row.to_start_wins,
	fromAcc: row.from_acc,
	toAcc: row.to_acc,
	winnerLeagueId: row.winner_league_id,
	startMs: Number(row.start_ms),
	endMs: Number(row.end_ms)
});

export const matchCountForRound = (round: TournamentRound): number => {
	switch (round) {
		case 'r1':
			return 8;
		case 'quarter':
			return 4;
		case 'semifinal':
			return 2;
		case 'final':
			return 1;
	}
};

export const roundWindow = ({
	tournamentMonthStartMs,
	round
}: {
	tournamentMonthStartMs: number;
	round: TournamentRound;
}): { startMs: number; endMs: number } => {
	const startMs =
		tournamentMonthStartMs + TOURNAMENT_ROUNDS.indexOf(round) * TOURNAMENT_ROUND_DURATION_MS;

	return { startMs, endMs: startMs + TOURNAMENT_ROUND_DURATION_MS };
};

/** Standard single-elimination pairing: seed 1 plays seed 16, seed 2 plays
 * seed 15, and so on. */
const seedFirstRoundPairs = (
	seededLeagueIds: string[]
): { fromLeagueId: string; toLeagueId: string }[] => {
	const n = seededLeagueIds.length;
	const pairs: { fromLeagueId: string; toLeagueId: string }[] = [];

	for (let i = 0; i < n / 2; i += 1) {
		const from = seededLeagueIds[i];
		const to = seededLeagueIds[n - 1 - i];

		if (nonNullish(from) && nonNullish(to)) {
			pairs.push({ fromLeagueId: from, toLeagueId: to });
		}
	}

	return pairs;
};

const readLeagueStartSnapshot = async ({
	leagueId,
	q
}: {
	leagueId: string;
	q: TxQuery;
}): Promise<{ totalCalls: number; wins: number }> => {
	const stats = await getLeagueStats(leagueId, q);

	return { totalCalls: stats?.totalCalls ?? 0, wins: stats?.wins ?? 0 };
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
 * Run the monthly draw. Deterministic seeding: leagues ranked by member
 * count desc with the league id as the tie-break, top 16 taken; the same
 * roster always draws the same bracket. Idempotent by the tournament
 * primary-key collision on the month anchor.
 */
export const triggerTournamentDraw = async ({
	monthAnchor,
	nowMs = Date.now()
}: {
	monthAnchor: string;
	nowMs?: number;
}): Promise<TriggerTournamentDrawResult> => {
	if (!MONTH_ANCHOR_RE.test(monthAnchor)) {
		return { ok: false, reason: 'invalid_input' };
	}

	const startMs = monthStartMs(monthAnchor);

	if (startMs > nowMs) {
		return { ok: false, reason: 'month_not_started' };
	}

	return await tx(async (q) => {
		const existing = await q<{ id: string }>(`select id from tournaments where id = $1`, [
			monthAnchor
		]);

		if (nonNullish(existing[0])) {
			return { ok: false, reason: 'already_drawn', tournamentId: monthAnchor };
		}

		// Member-count ranking with the id tie-break; the join guarantees each
		// seeded id is an existing league.
		const ranking = await q<{ league_id: string }>(
			`select m.league_id
			 from league_members m
			 join leagues l on l.id = m.league_id
			 group by m.league_id
			 order by count(*) desc, m.league_id asc`,
			[]
		);

		if (ranking.length < TOURNAMENT_BRACKET_SIZE) {
			return { ok: false, reason: 'insufficient_leagues', availableLeagues: ranking.length };
		}

		const seededLeagueIds = ranking
			.slice(0, TOURNAMENT_BRACKET_SIZE)
			.map(({ league_id }) => league_id);

		// The do-nothing conflict clause closes the race the pre-check leaves
		// open: a concurrent draw that committed between the check and this
		// insert wins the month, and this caller observes the same already_drawn
		// outcome as if the pre-check had caught it.
		const inserted = await q<{ id: string }>(
			`insert into tournaments (id, month_start_ms, month_end_ms, bracket_size, state,
			   seeded_league_ids, created_at_ms)
			 values ($1, $2, $3, $4, 'in_flight', $5, $6)
			 on conflict (id) do nothing
			 returning id`,
			[
				monthAnchor,
				startMs,
				startMs + TOURNAMENT_ROUNDS.length * TOURNAMENT_ROUND_DURATION_MS,
				TOURNAMENT_BRACKET_SIZE,
				JSON.stringify(seededLeagueIds),
				nowMs
			]
		);

		if (isNullish(inserted[0])) {
			return { ok: false, reason: 'already_drawn', tournamentId: monthAnchor };
		}

		// Round 1 slots carry each side's league_stats snapshot so resolution
		// can score the window delta later.
		const r1Pairs = seedFirstRoundPairs(seededLeagueIds);
		const r1Window = roundWindow({ tournamentMonthStartMs: startMs, round: 'r1' });

		for (let index = 0; index < r1Pairs.length; index += 1) {
			const pair = r1Pairs[index];

			if (isNullish(pair)) {
				break;
			}

			const fromSnapshot = await readLeagueStartSnapshot({ leagueId: pair.fromLeagueId, q });
			const toSnapshot = await readLeagueStartSnapshot({ leagueId: pair.toLeagueId, q });

			await q(
				`insert into tournament_matches (tournament_id, round, index, from_league_id,
				   to_league_id, from_start_calls, from_start_wins, to_start_calls, to_start_wins,
				   start_ms, end_ms)
				 values ($1, 'r1', $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
				[
					monthAnchor,
					index,
					pair.fromLeagueId,
					pair.toLeagueId,
					fromSnapshot.totalCalls,
					fromSnapshot.wins,
					toSnapshot.totalCalls,
					toSnapshot.wins,
					r1Window.startMs,
					r1Window.endMs
				]
			);
		}

		// TBD slots for the later rounds so the bracket renders immediately;
		// snapshots stay null until a resolution promotes the winner in.
		for (const round of ['quarter', 'semifinal', 'final'] as const) {
			const window = roundWindow({ tournamentMonthStartMs: startMs, round });
			const count = matchCountForRound(round);

			for (let index = 0; index < count; index += 1) {
				await q(
					`insert into tournament_matches (tournament_id, round, index, start_ms, end_ms)
					 values ($1, $2, $3, $4, $5)`,
					[monthAnchor, round, index, window.startMs, window.endMs]
				);
			}
		}

		return { ok: true, tournamentId: monthAnchor };
	});
};

const listMatches = async (
	tournamentId: string,
	q: TxQuery = query
): Promise<TournamentMatch[]> => {
	const rows = await q<TournamentMatchRow>(
		`select ${MATCH_COLUMNS} from tournament_matches where tournament_id = $1`,
		[tournamentId]
	);

	return rows
		.map(shapeMatch)
		.sort((a, b) =>
			a.round === b.round
				? a.index - b.index
				: TOURNAMENT_ROUNDS.indexOf(a.round) - TOURNAMENT_ROUNDS.indexOf(b.round)
		);
};

/** The most recent tournament (highest YYYY-MM id) and its bracket; null
 * tournament when no draw has run yet. */
export const getCurrentTournament = async (): Promise<{
	tournament: Tournament | null;
	matches: TournamentMatch[];
}> => {
	const rows = await query<TournamentRow>(
		`select ${TOURNAMENT_COLUMNS} from tournaments order by id desc limit 1`
	);
	const [row] = rows;

	if (isNullish(row)) {
		return { tournament: null, matches: [] };
	}

	return { tournament: shapeTournament(row), matches: await listMatches(row.id) };
};

const leagueWindowAccuracy = async ({
	leagueId,
	startCalls,
	startWins,
	q
}: {
	leagueId: string;
	startCalls: number;
	startWins: number;
	q: TxQuery;
}): Promise<{ qualifies: boolean; accuracy: number }> => {
	const current = await getLeagueStats(leagueId, q);
	const deltaCalls = Math.max(0, (current?.totalCalls ?? 0) - startCalls);
	const deltaWins = Math.max(0, Math.min(deltaCalls, (current?.wins ?? 0) - startWins));

	if (deltaCalls < TOURNAMENT_MIN_CALLS_PER_MATCH) {
		return { qualifies: false, accuracy: 0 };
	}

	return { qualifies: true, accuracy: deltaWins / deltaCalls };
};

/** Winner rule: forfeit hands the match to the opponent; a double forfeit
 * advances the lexicographically lower league id (the same tie-break the
 * seeding uses), as does an exact accuracy tie. */
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
		return fromLeagueId < toLeagueId ? fromLeagueId : toLeagueId;
	}

	if (fromAccuracy === toAccuracy) {
		return fromLeagueId < toLeagueId ? fromLeagueId : toLeagueId;
	}

	return fromAccuracy > toAccuracy ? fromLeagueId : toLeagueId;
};

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

const propagateWinnerToNextRound = async ({
	tournamentId,
	round,
	index,
	winnerLeagueId,
	q
}: {
	tournamentId: string;
	round: TournamentRound;
	index: number;
	winnerLeagueId: string;
	q: TxQuery;
}): Promise<void> => {
	const nextRoundIndex = TOURNAMENT_ROUNDS.indexOf(round) + 1;
	const nextRound = TOURNAMENT_ROUNDS[nextRoundIndex];

	if (isNullish(nextRound)) {
		return;
	}

	const nextIndex = Math.floor(index / 2);
	const isFromSlot = index % 2 === 0;
	const snapshot = await readLeagueStartSnapshot({ leagueId: winnerLeagueId, q });

	// Write-once slot fill: the null guard in the predicate keeps an
	// idempotent re-run from overwriting an already-promoted winner.
	if (isFromSlot) {
		await q(
			`update tournament_matches
			 set from_league_id = $4, from_start_calls = $5, from_start_wins = $6
			 where tournament_id = $1 and round = $2 and index = $3 and from_league_id is null`,
			[tournamentId, nextRound, nextIndex, winnerLeagueId, snapshot.totalCalls, snapshot.wins]
		);

		return;
	}

	await q(
		`update tournament_matches
		 set to_league_id = $4, to_start_calls = $5, to_start_wins = $6
		 where tournament_id = $1 and round = $2 and index = $3 and to_league_id is null`,
		[tournamentId, nextRound, nextIndex, winnerLeagueId, snapshot.totalCalls, snapshot.wins]
	);
};

/** Score one open match, write the result and propagate the winner into the
 * next round's slot. Returns 1 when a winner landed, 0 for a no-op. */
const resolveOpenMatch = async ({
	tournamentId,
	round,
	match,
	q
}: {
	tournamentId: string;
	round: TournamentRound;
	match: TournamentMatch;
	q: TxQuery;
}): Promise<number> => {
	const fromEval = await leagueWindowAccuracy({
		leagueId: match.fromLeagueId ?? '',
		startCalls: match.fromStartCalls ?? 0,
		startWins: match.fromStartWins ?? 0,
		q
	});
	const toEval = await leagueWindowAccuracy({
		leagueId: match.toLeagueId ?? '',
		startCalls: match.toStartCalls ?? 0,
		startWins: match.toStartWins ?? 0,
		q
	});

	const winner = pickMatchWinner({
		fromLeagueId: match.fromLeagueId,
		toLeagueId: match.toLeagueId,
		fromQualifies: fromEval.qualifies,
		toQualifies: toEval.qualifies,
		fromAccuracy: fromEval.accuracy,
		toAccuracy: toEval.accuracy
	});

	if (isNullish(winner)) {
		return 0;
	}

	await q(
		`update tournament_matches
		 set from_acc = $4, to_acc = $5, winner_league_id = $6
		 where tournament_id = $1 and round = $2 and index = $3`,
		[
			tournamentId,
			round,
			match.index,
			fromEval.qualifies ? fromEval.accuracy : null,
			toEval.qualifies ? toEval.accuracy : null,
			winner
		]
	);

	await propagateWinnerToNextRound({
		tournamentId,
		round,
		index: match.index,
		winnerLeagueId: winner,
		q
	});

	return 1;
};

/**
 * Resolve every still-open match of a closed round. Idempotent: settled
 * matches are skipped, and the write-once slot fill keeps propagation from
 * overwriting. Earlier rounds must be fully resolved first; resolving the
 * final concludes the tournament.
 */
export const resolveTournamentRound = async ({
	tournamentId,
	round,
	nowMs = Date.now()
}: {
	tournamentId: string;
	round: string;
	nowMs?: number;
}): Promise<ResolveTournamentRoundResult> => {
	if (!(TOURNAMENT_ROUNDS as readonly string[]).includes(round)) {
		return { ok: false, reason: 'invalid_input' };
	}

	const round_ = round as TournamentRound;

	return await tx(async (q) => {
		const tournamentRows = await q<TournamentRow>(
			`select ${TOURNAMENT_COLUMNS} from tournaments where id = $1 for update`,
			[tournamentId]
		);

		if (isNullish(tournamentRows[0])) {
			return { ok: false, reason: 'tournament_not_found' };
		}

		const matches = await listMatches(tournamentId, q);
		const targetMatches = matches.filter((m) => m.round === round_);
		const [firstTarget] = targetMatches;

		if (isNullish(firstTarget)) {
			return { ok: false, reason: 'no_matches' };
		}

		if (firstTarget.endMs > nowMs) {
			return { ok: false, reason: 'round_not_yet_closed' };
		}

		const roundIndex = TOURNAMENT_ROUNDS.indexOf(round_);
		const unresolvedEarlier = matches.some(
			(m) => TOURNAMENT_ROUNDS.indexOf(m.round) < roundIndex && isNullish(m.winnerLeagueId)
		);

		if (unresolvedEarlier) {
			return { ok: false, reason: 'previous_round_not_resolved' };
		}

		let matchesResolved = 0;

		// Already-settled matches are skipped (idempotent re-run); a match with
		// no winner pick (missing league ids) is a no-op.
		for (const match of targetMatches) {
			if (isNullish(match.winnerLeagueId)) {
				matchesResolved += await resolveOpenMatch({ tournamentId, round: round_, match, q });
			}
		}

		let tournamentConcluded = false;

		if (round_ === 'final') {
			const finalRows = await q<{ winner_league_id: string | null }>(
				`select winner_league_id from tournament_matches
				 where tournament_id = $1 and round = 'final' and index = 0`,
				[tournamentId]
			);

			if (nonNullish(finalRows[0]?.winner_league_id)) {
				await q(`update tournaments set state = 'concluded' where id = $1`, [tournamentId]);
				tournamentConcluded = true;
			}
		}

		return { ok: true, matchesResolved, tournamentConcluded };
	});
};

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
 * Per-user prize claim on a concluded tournament. Place 1: member of the
 * final winner; place 2: member of the other finalist; place 3: member of
 * either semifinal loser. Only memberships that predate the draw count. A
 * member of several eligible leagues is offered the highest tier, and the
 * grant pays at most one prize per user per tournament, so a re-claim (for
 * the same place or another) is a no-op.
 */
export const claimTournamentPrize = async ({
	tournamentId,
	userId
}: {
	tournamentId: string;
	userId: string;
}): Promise<ClaimTournamentPrizeResult> => {
	const tournamentRows = await query<TournamentRow>(
		`select ${TOURNAMENT_COLUMNS} from tournaments where id = $1`,
		[tournamentId]
	);
	const [tournamentRow] = tournamentRows;

	if (isNullish(tournamentRow)) {
		return { ok: false, reason: 'tournament_not_found' };
	}

	if (tournamentRow.state !== 'concluded') {
		return { ok: false, reason: 'tournament_not_concluded' };
	}

	const matches = await listMatches(tournamentId);
	const finalMatch = matches.find((m) => m.round === 'final');
	const semifinalLosers = matches
		.filter((m) => m.round === 'semifinal' && nonNullish(m.winnerLeagueId))
		.map((m) => (m.winnerLeagueId === m.fromLeagueId ? m.toLeagueId : m.fromLeagueId))
		.filter(nonNullish);

	if (isNullish(finalMatch) || isNullish(finalMatch.winnerLeagueId)) {
		return { ok: false, reason: 'tournament_not_concluded' };
	}

	const placeOneLeague = finalMatch.winnerLeagueId;
	const placeTwoLeague =
		finalMatch.winnerLeagueId === finalMatch.fromLeagueId
			? finalMatch.toLeagueId
			: finalMatch.fromLeagueId;

	// The draw is the kickoff: it seeds the bracket from the member counts of
	// that moment and stamps the round 1 stats snapshots every score is a
	// delta from, so its roster is the one that played. month_start_ms is only
	// the calendar anchor of the round windows and can precede a late draw.
	// Joining a placed league afterwards (or being added by its owner) earns
	// nothing.
	const membershipRows = await query<{ league_id: string }>(
		`select league_id from league_members
		 where member_user_id = $1 and joined_at_ms <= $2`,
		[userId, tournamentRow.created_at_ms]
	);
	const myLeagueIds = new Set(membershipRows.map(({ league_id }) => league_id));

	let myPlace: 1 | 2 | 3 | null = null;

	if (myLeagueIds.has(placeOneLeague)) {
		myPlace = 1;
	} else if (nonNullish(placeTwoLeague) && myLeagueIds.has(placeTwoLeague)) {
		myPlace = 2;
	} else if (semifinalLosers.some((id) => myLeagueIds.has(id))) {
		myPlace = 3;
	}

	if (isNullish(myPlace)) {
		return { ok: false, reason: 'not_member_of_top_league' };
	}

	const tier = TOURNAMENT_PRIZE_TIERS.find((t) => t.place === myPlace);
	const outcome = await grantTournamentPrize({ userId, tournamentId, place: myPlace });

	if (outcome.outcome === 'already') {
		return { ok: true, awardsCreated: 0, awardsAlreadyClaimed: 1, totalVxpCredited: 0 };
	}

	if (outcome.outcome === 'paid' || outcome.outcome === 'recorded') {
		return {
			ok: true,
			awardsCreated: 1,
			awardsAlreadyClaimed: 0,
			totalVxpCredited: tier?.vxp ?? 0
		};
	}

	// A failed transfer leaves the award row behind for reconciliation; the
	// client never sees a credit that did not land.
	return { ok: true, awardsCreated: 0, awardsAlreadyClaimed: 0, totalVxpCredited: 0 };
};

/** Worker tick: draw the current month's bracket once it can be drawn; the
 * key collision and the refusal reasons make every pass a cheap no-op. */
export const tournamentDrawTick = async (nowMs = Date.now()): Promise<void> => {
	const monthAnchor = monthAnchorFromMs(nowMs);
	const result = await triggerTournamentDraw({ monthAnchor, nowMs });

	if (result.ok) {
		logger.info(`tournament ${monthAnchor} drawn by worker`);
	}
};

/** Worker tick: resolve every closed, still-open round of the latest
 * in-flight tournament, in bracket order. */
export const tournamentResolveTick = async (nowMs = Date.now()): Promise<void> => {
	const rows = await query<TournamentRow>(
		`select ${TOURNAMENT_COLUMNS} from tournaments where state = 'in_flight' order by id desc limit 1`
	);
	const [row] = rows;

	if (isNullish(row)) {
		return;
	}

	const matches = await listMatches(row.id);

	for (const round of TOURNAMENT_ROUNDS) {
		const roundMatches = matches.filter((m) => m.round === round);
		const closed = roundMatches.length > 0 && roundMatches.every((m) => m.endMs <= nowMs);
		const open = roundMatches.some((m) => isNullish(m.winnerLeagueId));

		if (closed && open) {
			const result = await resolveTournamentRound({ tournamentId: row.id, round, nowMs });

			if (result.ok && (result.matchesResolved ?? 0) > 0) {
				logger.info(
					`tournament ${row.id} ${round}: ${result.matchesResolved} matches resolved${result.tournamentConcluded === true ? ', tournament concluded' : ''}`
				);
			}
		}
	}
};
