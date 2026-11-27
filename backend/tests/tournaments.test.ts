// Monthly tournament: deterministic seeding (members with a settled call in
// the calendar month before the draw, desc, league id as the tie-break; the
// same roster and history always draw the same bracket), the idempotent draw,
// round resolution from the members' settled history with the forfeit floor
// and write-once winner propagation, and the prize tiers of a full bracket in
// record-only mode (claim eligibility lives in tournament-prize.test.ts).

import { isNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { query } from '../src/db/client';
import { DAY_IN_MS } from '../src/lib/time';
import {
	claimTournamentPrize,
	resolveTournamentRound,
	roundWindow,
	TOURNAMENT_BRACKET_SIZE,
	TOURNAMENT_MIN_CALLS_PER_MATCH,
	TOURNAMENT_ROUND_DURATION_MS,
	TOURNAMENT_ROUNDS,
	triggerTournamentDraw,
	type TournamentRound
} from '../src/tournaments/tournaments';
import { setVxpTreasuryDisabled } from '../src/vxp/awards';
import { ensureMigrated } from './helpers/auth';
import { stubSettledHistory, type SettledHistoryStub } from './helpers/settlements';
import { dbAvailable } from './helpers/setup';

const uniqueLeagueId = (): string => `tlg-${randomBytes(6).toString('hex')}`;

// Month anchors reserved per suite so concurrent files never share one:
// worlds-podium 2000 to 2099, monthly-stats 2100 to 2899, tournaments 2900 to
// 2999, affiliation-stats 3000 and up (on its own tables), tournament-prize
// 3900 to 3999, tournament-scoring 4000 and up.
const FIRST_TEST_YEAR = 2900;
const FIRST_TEST_ANCHOR = `${FIRST_TEST_YEAR}-`;
const PAST_LAST_TEST_ANCHOR = `${FIRST_TEST_YEAR + 100}-`;

let monthsDrawn = 0;

/** A far-future month, drawn sequentially rather than at random: two tests
 * landing on the same anchor would answer already_drawn instead of drawing. */
const uniqueMonth = (): { monthAnchor: string; startMs: number } => {
	const year = FIRST_TEST_YEAR + Math.floor(monthsDrawn / 12);
	const month = (monthsDrawn % 12) + 1;

	monthsDrawn += 1;

	return {
		monthAnchor: `${year}-${String(month).padStart(2, '0')}`,
		startMs: Date.UTC(year, month - 1, 1)
	};
};

/** A league with `memberCount` synthetic members, bulk-inserted; its id and
 * its owner's. */
const seedLeagueWithMembers = async (
	memberCount: number
): Promise<{ leagueId: string; ownerId: string }> => {
	const leagueId = uniqueLeagueId();
	const ownerRows = await query<{ id: string }>(
		`insert into users (role) values ('user') returning id`
	);
	const ownerId = ownerRows[0]?.id ?? '';

	await query(
		`insert into leagues (id, name, invite_code, owner_user_id, created_at_ms)
		 values ($1, $2, $3, $4, $5)`,
		[
			leagueId,
			`League ${leagueId}`,
			randomBytes(3).toString('hex').toUpperCase(),
			ownerId,
			Date.now()
		]
	);
	await query(
		`insert into league_members (league_id, member_user_id, joined_at_ms, role)
		 values ($1, $2, $3, 'owner')`,
		[leagueId, ownerId, Date.now()]
	);
	await query(
		`with new_users as (
		   insert into users (role) select 'user' from generate_series(1, $3::int) returning id
		 )
		 insert into league_members (league_id, member_user_id, joined_at_ms, role)
		 select $1, id, $2, 'member' from new_users`,
		[leagueId, Date.now(), memberCount - 1]
	);

	return { leagueId, ownerId };
};

describe.if(dbAvailable)('tournament', () => {
	// Record-only mode: prize claims must not attempt real treasury
	// transfers from the test suite.
	const restoreTreasury = setVxpTreasuryDisabled(true);

	// Seeded once for the whole suite: 16 leagues with strictly decreasing
	// member counts (60 down to 45) so they deterministically outrank any
	// league other suites create.
	const leagueIds: string[] = [];

	const ownerIds: string[] = [];

	// Every member of each seeded league, its owner first.
	const memberIds: string[][] = [];

	// Settled history the clearing stub answers from; each league's owner
	// settles its calls.
	let settled: SettledHistoryStub | undefined;

	/** One round window of settled calls for every league: seed i settles
	 * 500 calls at a strictly seed-graded accuracy, so the higher seed wins
	 * every match it plays; the bottom seed stays under the forfeit floor
	 * when `forfeitBottomSeed` is set. */
	const settleRoundForAll = ({
		monthStartMs,
		round,
		forfeitBottomSeed
	}: {
		monthStartMs: number;
		round: TournamentRound;
		forfeitBottomSeed: boolean;
	}): void => {
		const { startMs } = roundWindow({ tournamentMonthStartMs: monthStartMs, round });

		for (let i = 0; i < ownerIds.length; i += 1) {
			const forfeits = forfeitBottomSeed && i === ownerIds.length - 1;
			const calls = forfeits ? TOURNAMENT_MIN_CALLS_PER_MATCH - 1 : 500;

			settled?.settle({
				userId: ownerIds[i] ?? '',
				atMs: startMs + DAY_IN_MS,
				calls,
				wins: forfeits ? calls : 500 - i * 10
			});
		}
	};

	/** One settled call in the calendar month before `monthStartMs` for the
	 * first `activeCount(i)` members of seeded league i (its owner first), the
	 * history the draw seeds from. */
	const settleSeedingMonth = ({
		monthStartMs,
		activeCount
	}: {
		monthStartMs: number;
		activeCount: (seed: number) => number;
	}): void => {
		for (let i = 0; i < memberIds.length; i += 1) {
			for (const userId of (memberIds[i] ?? []).slice(0, activeCount(i))) {
				settled?.settle({ userId, atMs: monthStartMs - DAY_IN_MS, calls: 1, wins: 0 });
			}
		}
	};

	/** The draw of a month whose seeding history ranks the leagues in
	 * `leagueIds` order: seed i has 16 - i active members. */
	const drawInSeedOrder = async ({
		monthAnchor,
		startMs,
		nowMs
	}: {
		monthAnchor: string;
		startMs: number;
		nowMs: number;
	}): ReturnType<typeof triggerTournamentDraw> => {
		settleSeedingMonth({
			monthStartMs: startMs,
			activeCount: (seed) => TOURNAMENT_BRACKET_SIZE - seed
		});

		return await triggerTournamentDraw({ monthAnchor, nowMs });
	};

	beforeAll(async () => {
		await ensureMigrated();

		// Leagues from previous local runs carry the same member counts and
		// would tie into the ranking; the cascade drops their memberships too.
		await query(`delete from leagues where id like 'tlg-%'`);

		// Every run draws the same anchors, so tournaments left by a previous
		// run on this database would answer already_drawn instead of drawing.
		await query(`delete from tournaments where id >= $1 and id < $2`, [
			FIRST_TEST_ANCHOR,
			PAST_LAST_TEST_ANCHOR
		]);

		for (let i = 0; i < TOURNAMENT_BRACKET_SIZE; i += 1) {
			const { leagueId, ownerId } = await seedLeagueWithMembers(60 - i);

			leagueIds.push(leagueId);
			ownerIds.push(ownerId);

			const members = await query<{ member_user_id: string }>(
				`select member_user_id from league_members where league_id = $1
				 order by (member_user_id = $2) desc, member_user_id`,
				[leagueId, ownerId]
			);

			memberIds.push(members.map(({ member_user_id }) => member_user_id));
		}

		settled = stubSettledHistory();
	});

	afterAll(() => {
		settled?.restore();
		restoreTreasury();
	});

	test('the draw is deterministic and idempotent', async () => {
		const { monthAnchor, startMs } = uniqueMonth();
		const nowMs = startMs + 1000;

		const early = await triggerTournamentDraw({ monthAnchor, nowMs: startMs - 1000 });

		expect(early.reason).toBe('month_not_started');

		const drawn = await drawInSeedOrder({ monthAnchor, startMs, nowMs });

		expect(drawn.ok).toBe(true);

		const again = await triggerTournamentDraw({ monthAnchor, nowMs });

		expect(again.reason).toBe('already_drawn');

		const rows = await query<{ seeded_league_ids: string[] }>(
			`select seeded_league_ids from tournaments where id = $1`,
			[monthAnchor]
		);

		// Active-member ranking: exactly the 16 seeded leagues, most active first.
		expect(rows[0]?.seeded_league_ids).toEqual(leagueIds);

		// A second draw over the same roster and history (different month)
		// produces the identical seeding: the bracket is a pure function of
		// the data.
		const second = uniqueMonth();

		await drawInSeedOrder({
			monthAnchor: second.monthAnchor,
			startMs: second.startMs,
			nowMs: second.startMs + 1000
		});

		const secondRows = await query<{ seeded_league_ids: string[] }>(
			`select seeded_league_ids from tournaments where id = $1`,
			[second.monthAnchor]
		);

		expect(secondRows[0]?.seeded_league_ids).toEqual(leagueIds);
	});

	test('seeds by members with a settled call in the month before the draw, not by member count', async () => {
		const { monthAnchor, startMs } = uniqueMonth();
		const nowMs = startMs + 1000;

		// Seed i has i + 1 active members: the reverse of its member count.
		settleSeedingMonth({ monthStartMs: startMs, activeCount: (seed) => seed + 1 });

		// History outside the calendar month before the draw lifts nobody:
		// every member of the biggest league settles in the draw's own month
		// and two months back.
		for (const userId of memberIds[0] ?? []) {
			settled?.settle({ userId, atMs: startMs, calls: 1, wins: 0 });
			settled?.settle({ userId, atMs: startMs - 40 * DAY_IN_MS, calls: 1, wins: 0 });
		}

		expect((await triggerTournamentDraw({ monthAnchor, nowMs })).ok).toBe(true);

		const rows = await query<{ seeded_league_ids: string[] }>(
			`select seeded_league_ids from tournaments where id = $1`,
			[monthAnchor]
		);

		expect(rows[0]?.seeded_league_ids).toEqual([...leagueIds].reverse());
	});

	test('a member active only under a linked principal counts toward the seed', async () => {
		const { monthAnchor, startMs } = uniqueMonth();

		// Seed i has i + 1 active members, so the last league would seed first;
		// 20 more members of the first league settle only under a linked
		// principal, which lifts it above every other league.
		settleSeedingMonth({ monthStartMs: startMs, activeCount: (seed) => seed + 1 });

		for (const userId of (memberIds[0] ?? []).slice(1, 21)) {
			const legacy = Principal.fromUint8Array(randomBytes(29)).toText();

			await query(
				`insert into legacy_principals (principal, user_id, matched_via) values ($1, $2, 'claim')`,
				[legacy, userId]
			);
			settled?.settlePrincipal({
				principal: legacy,
				atMs: startMs - DAY_IN_MS,
				calls: 1,
				wins: 0
			});
		}

		expect((await triggerTournamentDraw({ monthAnchor, nowMs: startMs + 1000 })).ok).toBe(true);

		const rows = await query<{ seeded_league_ids: string[] }>(
			`select seeded_league_ids from tournaments where id = $1`,
			[monthAnchor]
		);

		expect(rows[0]?.seeded_league_ids).toEqual([
			...leagueIds.slice(0, 1),
			...leagueIds.slice(1).reverse()
		]);
	});

	test('only the current UTC month is drawn, while its round 1 is open: a late, closed or future month is refused', async () => {
		const { monthAnchor, startMs } = uniqueMonth();
		const next = uniqueMonth();

		// The month that just closed, at the rollover and later on.
		for (const nowMs of [next.startMs, next.startMs + 20 * TOURNAMENT_ROUND_DURATION_MS]) {
			const closed = await triggerTournamentDraw({ monthAnchor, nowMs });

			expect(closed).toEqual({ ok: false, reason: 'invalid_input' });
		}

		const future = await triggerTournamentDraw({
			monthAnchor: next.monthAnchor,
			nowMs: startMs + 1000
		});

		expect(future).toEqual({ ok: false, reason: 'month_not_started' });

		const refused = await query<{ id: string }>(`select id from tournaments where id in ($1, $2)`, [
			monthAnchor,
			next.monthAnchor
		]);

		expect(refused).toEqual([]);

		// Once round 1 has closed, the current month has no tournament: its
		// closed rounds would conclude at once on double forfeits.
		const roundOne = roundWindow({ tournamentMonthStartMs: startMs, round: 'r1' });

		for (const nowMs of [roundOne.endMs, next.startMs - 1]) {
			const late = await triggerTournamentDraw({ monthAnchor, nowMs });

			expect(late).toEqual({ ok: false, reason: 'invalid_input' });
		}

		expect(await query(`select id from tournaments where id = $1`, [monthAnchor])).toEqual([]);

		// It still draws on the last instant of round 1.
		const lastChance = await drawInSeedOrder({ monthAnchor, startMs, nowMs: roundOne.endMs - 1 });

		expect(lastChance.ok).toBe(true);

		// A drawn month that has since closed is left as it is.
		const afterClose = await triggerTournamentDraw({ monthAnchor, nowMs: next.startMs + 1000 });

		expect(afterClose.reason).toBe('invalid_input');

		const drawn = await query<{ id: string; month_start_ms: string }>(
			`select id, month_start_ms::text from tournaments where id = $1`,
			[monthAnchor]
		);

		expect(drawn).toEqual([{ id: monthAnchor, month_start_ms: String(startMs) }]);
	});

	test('two concurrent draws of the same month: one draws, the other reports already_drawn', async () => {
		const { monthAnchor, startMs } = uniqueMonth();
		const nowMs = startMs + 1000;

		// Both callers pass the pre-check before either commits; the insert's
		// conflict clause must hand exactly one of them the draw.
		settleSeedingMonth({
			monthStartMs: startMs,
			activeCount: (seed) => TOURNAMENT_BRACKET_SIZE - seed
		});

		const [a, b] = await Promise.all([
			triggerTournamentDraw({ monthAnchor, nowMs }),
			triggerTournamentDraw({ monthAnchor, nowMs })
		]);

		const outcomes = [a, b].map(({ ok, reason }) => ({ ok, reason }));

		expect(outcomes).toContainEqual({ ok: true, reason: undefined });
		expect(outcomes).toContainEqual({ ok: false, reason: 'already_drawn' });

		const tournaments = await query<{ id: string }>(`select id from tournaments where id = $1`, [
			monthAnchor
		]);

		expect(tournaments.length).toBe(1);

		// The bracket was written exactly once: 8 r1 + 4 quarter + 2 semifinal
		// + 1 final slots.
		const matchCounts = await query<{ round: string; count: string }>(
			`select round, count(*)::text as count from tournament_matches
			 where tournament_id = $1 group by round`,
			[monthAnchor]
		);
		const byRound = Object.fromEntries(matchCounts.map((m) => [m.round, Number(m.count)]));

		expect(byRound).toEqual({ r1: 8, quarter: 4, semifinal: 2, final: 1 });
	});

	test('round 1 pairs seed 1 with seed 16 and stores no start counters; later rounds are TBD', async () => {
		const { monthAnchor, startMs } = uniqueMonth();

		await drawInSeedOrder({ monthAnchor, startMs, nowMs: startMs + 1000 });

		const matches = await query<{
			round: string;
			index: number;
			from_league_id: string | null;
			to_league_id: string | null;
			from_start_calls: number | null;
		}>(
			`select round, index, from_league_id, to_league_id, from_start_calls
			 from tournament_matches where tournament_id = $1 order by round, index`,
			[monthAnchor]
		);

		const r1 = matches.filter((m) => m.round === 'r1');

		expect(r1.length).toBe(8);
		expect(r1.find((m) => m.index === 0)?.from_league_id).toBe(leagueIds[0] ?? '');
		expect(r1.find((m) => m.index === 0)?.to_league_id).toBe(leagueIds[15] ?? '');
		expect(r1.find((m) => m.index === 0)?.from_start_calls).toBeNull();

		const quarters = matches.filter((m) => m.round === 'quarter');

		expect(quarters.length).toBe(4);
		expect(quarters.every((m) => isNullish(m.from_league_id) && isNullish(m.to_league_id))).toBe(
			true
		);
	});

	test('resolution applies the forfeit floor, propagates write-once, concludes, and pays the prize tiers', async () => {
		const { monthAnchor, startMs } = uniqueMonth();

		await drawInSeedOrder({ monthAnchor, startMs, nowMs: startMs + 1000 });

		// Mid-window refusals.
		const early = await resolveTournamentRound({
			tournamentId: monthAnchor,
			round: 'r1',
			nowMs: startMs + 1000
		});

		expect(early.reason).toBe('round_not_yet_closed');

		const outOfOrder = await resolveTournamentRound({
			tournamentId: monthAnchor,
			round: 'quarter',
			nowMs: startMs + 2 * TOURNAMENT_ROUND_DURATION_MS + 1000
		});

		expect(outOfOrder.reason).toBe('previous_round_not_resolved');

		expect(
			(await resolveTournamentRound({ tournamentId: monthAnchor, round: 'nope', nowMs: startMs }))
				.reason
		).toBe('invalid_input');

		// Resolve round by round, one qualifying seed-graded window of settled
		// calls each so every window orders by seed. The bottom seed stays
		// under the floor in round 1 and forfeits.
		const afterAllRounds = startMs + TOURNAMENT_ROUNDS.length * TOURNAMENT_ROUND_DURATION_MS + 1000;

		settleRoundForAll({ monthStartMs: startMs, round: 'r1', forfeitBottomSeed: true });

		const r1 = await resolveTournamentRound({
			tournamentId: monthAnchor,
			round: 'r1',
			nowMs: afterAllRounds
		});

		expect(r1.ok).toBe(true);
		expect(r1.matchesResolved).toBe(8);

		// Seed 16 forfeited match 0 to seed 1 despite its perfect accuracy.
		const match0 = await query<{ winner_league_id: string | null; to_acc: number | null }>(
			`select winner_league_id, to_acc from tournament_matches
			 where tournament_id = $1 and round = 'r1' and index = 0`,
			[monthAnchor]
		);

		expect(match0[0]?.winner_league_id).toBe(leagueIds[0] ?? '');
		expect(match0[0]?.to_acc).toBeNull();

		// Idempotent re-run: nothing left to resolve, nothing overwritten.
		const r1Again = await resolveTournamentRound({
			tournamentId: monthAnchor,
			round: 'r1',
			nowMs: afterAllRounds
		});

		expect(r1Again.matchesResolved).toBe(0);

		for (const round of ['quarter', 'semifinal', 'final'] as const) {
			settleRoundForAll({ monthStartMs: startMs, round, forfeitBottomSeed: false });

			const result = await resolveTournamentRound({
				tournamentId: monthAnchor,
				round,
				nowMs: afterAllRounds
			});

			expect(result.ok).toBe(true);
		}

		// Bracket arithmetic: winners 1..8 out of r1; quarters 1,3,5,7; semis
		// 1 and 5; final winner seed 1; semifinal losers seeds 3 and 7.
		const finalRows = await query<{ winner_league_id: string | null; state: string }>(
			`select m.winner_league_id, t.state from tournament_matches m
			 join tournaments t on t.id = m.tournament_id
			 where m.tournament_id = $1 and m.round = 'final'`,
			[monthAnchor]
		);

		expect(finalRows[0]?.winner_league_id).toBe(leagueIds[0] ?? '');
		expect(finalRows[0]?.state).toBe('concluded');

		// Prize claims: gold for a member of the winner, silver for the other
		// finalist (seed 5), bronze for a semifinal loser (seed 3); an
		// outsider gets nothing; a re-claim collides. Each claimant is the
		// league's owner, whose calls settled in every round window.
		const memberOf = (index: number): Promise<string> => Promise.resolve(ownerIds[index] ?? '');

		const gold = await claimTournamentPrize({
			tournamentId: monthAnchor,
			userId: await memberOf(0)
		});

		expect(gold.ok).toBe(true);
		expect(gold.awardsCreated).toBe(1);
		expect(gold.totalVxpCredited).toBe(5000);

		const goldAgain = await claimTournamentPrize({
			tournamentId: monthAnchor,
			userId: await memberOf(0)
		});

		expect(goldAgain.awardsAlreadyClaimed).toBe(1);

		const silver = await claimTournamentPrize({
			tournamentId: monthAnchor,
			userId: await memberOf(4)
		});

		expect(silver.totalVxpCredited).toBe(2500);

		const bronze = await claimTournamentPrize({
			tournamentId: monthAnchor,
			userId: await memberOf(2)
		});

		expect(bronze.totalVxpCredited).toBe(1000);

		const outsider = await query<{ id: string }>(
			`insert into users (role) values ('user') returning id`
		);
		const none = await claimTournamentPrize({
			tournamentId: monthAnchor,
			userId: outsider[0]?.id ?? ''
		});

		expect(none.ok).toBe(false);
		expect(none.reason).toBe('not_member_of_top_league');
	});
});
