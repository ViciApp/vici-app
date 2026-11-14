// Monthly tournament: deterministic seeding (member count desc, league id as
// the tie-break; the same roster always draws the same bracket), the
// idempotent draw, round resolution with the forfeit floor and write-once
// winner propagation, and the prize claim in record-only mode: the tiers,
// eligibility from memberships that predate the draw, and one prize per user
// per tournament.

import { isNullish } from '@dfinity/utils';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { query } from '../src/db/client';
import {
	claimTournamentPrize,
	resolveTournamentRound,
	TOURNAMENT_BRACKET_SIZE,
	TOURNAMENT_MIN_CALLS_PER_MATCH,
	TOURNAMENT_ROUND_DURATION_MS,
	TOURNAMENT_ROUNDS,
	triggerTournamentDraw
} from '../src/tournaments/tournaments';
import { grantAward, setVxpTreasuryDisabled } from '../src/vxp/awards';
import { grantTournamentPrize } from '../src/vxp/prizes';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

const uniqueLeagueId = (): string => `tlg-${randomBytes(6).toString('hex')}`;

// Month anchors reserved per suite so concurrent files never share one:
// worlds-podium 2000 to 2099, monthly-stats 2100 to 2899, tournaments 2900 to
// 2999, affiliation-stats 3000 and up.
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

/** A league with `memberCount` synthetic members, bulk-inserted. */
const seedLeagueWithMembers = async (memberCount: number): Promise<string> => {
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

	return leagueId;
};

describe.if(dbAvailable)('tournament', () => {
	// Record-only mode: prize claims must not attempt real treasury
	// transfers from the test suite.
	const restoreTreasury = setVxpTreasuryDisabled(true);

	// Seeded once for the whole suite: 16 leagues with strictly decreasing
	// member counts (60 down to 45) so they deterministically outrank any
	// league other suites create.
	const leagueIds: string[] = [];

	// Cumulative counters mirrored into league_stats; each "window" adds a
	// qualifying, seed-graded delta so the higher seed wins every match it
	// plays (except the deliberately forfeiting bottom seed).
	const calls: number[] = [];
	const wins: number[] = [];

	const writeStats = async (index: number): Promise<void> => {
		await query(
			`insert into league_stats (league_id, total_calls, wins, updated_at_ms)
			 values ($1, $2, $3, $4)
			 on conflict (league_id) do update set
			   total_calls = excluded.total_calls, wins = excluded.wins,
			   updated_at_ms = excluded.updated_at_ms`,
			[leagueIds[index] ?? '', calls[index] ?? 0, wins[index] ?? 0, Date.now()]
		);
	};

	/** One activity window for every league: seed i gains 500 calls at a
	 * strictly seed-graded accuracy; the bottom seed stays under the forfeit
	 * floor when `forfeitBottomSeed` is set. */
	const addWindowForAll = async ({ forfeitBottomSeed }: { forfeitBottomSeed: boolean }) => {
		for (let i = 0; i < leagueIds.length; i += 1) {
			const bottomSeed = i === leagueIds.length - 1;

			if (bottomSeed && forfeitBottomSeed) {
				calls[i] = (calls[i] ?? 0) + TOURNAMENT_MIN_CALLS_PER_MATCH - 1;
				wins[i] = (wins[i] ?? 0) + TOURNAMENT_MIN_CALLS_PER_MATCH - 1;
			} else {
				calls[i] = (calls[i] ?? 0) + 500;
				wins[i] = (wins[i] ?? 0) + 500 - i * 10;
			}

			await writeStats(i);
		}
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
			leagueIds.push(await seedLeagueWithMembers(60 - i));
			calls.push(0);
			wins.push(0);
			await writeStats(i);
		}
	});

	afterAll(() => {
		restoreTreasury();
	});

	test('the draw is deterministic and idempotent', async () => {
		const { monthAnchor, startMs } = uniqueMonth();
		const nowMs = startMs + 1000;

		const early = await triggerTournamentDraw({ monthAnchor, nowMs: startMs - 1000 });

		expect(early.reason).toBe('month_not_started');

		const drawn = await triggerTournamentDraw({ monthAnchor, nowMs });

		expect(drawn.ok).toBe(true);

		const again = await triggerTournamentDraw({ monthAnchor, nowMs });

		expect(again.reason).toBe('already_drawn');

		const rows = await query<{ seeded_league_ids: string[] }>(
			`select seeded_league_ids from tournaments where id = $1`,
			[monthAnchor]
		);

		// Member-count ranking: exactly the 16 seeded leagues, biggest first.
		expect(rows[0]?.seeded_league_ids).toEqual(leagueIds);

		// A second draw over the same roster (different month) produces the
		// identical seeding: the bracket is a pure function of the data.
		const second = uniqueMonth();

		await triggerTournamentDraw({ monthAnchor: second.monthAnchor, nowMs: second.startMs + 1000 });

		const secondRows = await query<{ seeded_league_ids: string[] }>(
			`select seeded_league_ids from tournaments where id = $1`,
			[second.monthAnchor]
		);

		expect(secondRows[0]?.seeded_league_ids).toEqual(leagueIds);
	});

	test('two concurrent draws of the same month: one draws, the other reports already_drawn', async () => {
		const { monthAnchor, startMs } = uniqueMonth();
		const nowMs = startMs + 1000;

		// Both callers pass the pre-check before either commits; the insert's
		// conflict clause must hand exactly one of them the draw.
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

	test('round 1 pairs seed 1 with seed 16 and stamps start snapshots; later rounds are TBD', async () => {
		const { monthAnchor, startMs } = uniqueMonth();

		await triggerTournamentDraw({ monthAnchor, nowMs: startMs + 1000 });

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
		expect(r1.find((m) => m.index === 0)?.from_start_calls).toBe(calls[0] ?? -1);

		const quarters = matches.filter((m) => m.round === 'quarter');

		expect(quarters.length).toBe(4);
		expect(quarters.every((m) => isNullish(m.from_league_id) && isNullish(m.to_league_id))).toBe(
			true
		);
	});

	test('resolution applies the forfeit floor, propagates write-once, concludes, and pays the prize tiers', async () => {
		const { monthAnchor, startMs } = uniqueMonth();

		await triggerTournamentDraw({ monthAnchor, nowMs: startMs + 1000 });

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

		// Resolve round by round, adding one qualifying seed-graded activity
		// window before each so every window delta orders by seed. The bottom
		// seed stays under the floor in round 1 and forfeits.
		const afterAllRounds = startMs + TOURNAMENT_ROUNDS.length * TOURNAMENT_ROUND_DURATION_MS + 1000;

		await addWindowForAll({ forfeitBottomSeed: true });

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
			await addWindowForAll({ forfeitBottomSeed: false });

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
		// outsider gets nothing; a re-claim collides.
		const memberOf = async (index: number): Promise<string> => {
			const rows = await query<{ member_user_id: string }>(
				`select member_user_id from league_members where league_id = $1 limit 1`,
				[leagueIds[index] ?? '']
			);

			return rows[0]?.member_user_id ?? '';
		};

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

	/** Draws a fresh month and resolves every round, one qualifying window
	 * each, the same way the full-bracket test does. Reads the placed leagues
	 * back from the bracket: the memberships later tests add move member
	 * counts, so the seeding of a later draw is not pinned to leagueIds. */
	const concludeTournament = async (): Promise<{
		monthAnchor: string;
		drawnAtMs: number;
		afterAllRoundsMs: number;
		placeOneLeague: string;
		placeTwoLeague: string;
	}> => {
		const { monthAnchor, startMs } = uniqueMonth();
		const drawnAtMs = startMs + 1000;
		const afterAllRoundsMs =
			startMs + TOURNAMENT_ROUNDS.length * TOURNAMENT_ROUND_DURATION_MS + 1000;

		await triggerTournamentDraw({ monthAnchor, nowMs: drawnAtMs });

		for (const round of TOURNAMENT_ROUNDS) {
			await addWindowForAll({ forfeitBottomSeed: false });
			await resolveTournamentRound({ tournamentId: monthAnchor, round, nowMs: afterAllRoundsMs });
		}

		const finalRows = await query<{
			from_league_id: string;
			to_league_id: string;
			winner_league_id: string;
		}>(
			`select from_league_id, to_league_id, winner_league_id from tournament_matches
			 where tournament_id = $1 and round = 'final'`,
			[monthAnchor]
		);
		const [final] = finalRows;

		if (isNullish(final)) {
			throw new Error(`tournament ${monthAnchor} has no final`);
		}

		return {
			monthAnchor,
			drawnAtMs,
			afterAllRoundsMs,
			placeOneLeague: final.winner_league_id,
			placeTwoLeague:
				final.winner_league_id === final.from_league_id ? final.to_league_id : final.from_league_id
		};
	};

	const addMember = async ({
		leagueId,
		userId,
		joinedAtMs
	}: {
		leagueId: string;
		userId: string;
		joinedAtMs: number;
	}): Promise<void> => {
		await query(
			`insert into league_members (league_id, member_user_id, joined_at_ms, role)
			 values ($1, $2, $3, 'member')`,
			[leagueId, userId, joinedAtMs]
		);
	};

	const prizeKeysOf = async ({
		userId,
		tournamentId
	}: {
		userId: string;
		tournamentId: string;
	}): Promise<string[]> => {
		const rows = await query<{ award_key: string }>(
			`select award_key from vxp_awards
			 where user_id = $1 and award_type = 'tournament_prize' and award_key like $2
			 order by award_key`,
			[userId, `${tournamentId}_place_%`]
		);

		return rows.map(({ award_key }) => award_key);
	};

	test('only memberships that predate the draw earn a prize', async () => {
		const { monthAnchor, drawnAtMs, afterAllRoundsMs, placeOneLeague, placeTwoLeague } =
			await concludeTournament();

		// Joined the winner after the tournament concluded.
		const lateJoiner = await createTestUser();

		await addMember({ leagueId: placeOneLeague, userId: lateJoiner, joinedAtMs: afterAllRoundsMs });

		const late = await claimTournamentPrize({ tournamentId: monthAnchor, userId: lateJoiner });

		expect(late.ok).toBe(false);
		expect(late.reason).toBe('not_member_of_top_league');
		expect(await prizeKeysOf({ userId: lateJoiner, tournamentId: monthAnchor })).toEqual([]);

		// Joined one millisecond after the draw, while the bracket was running.
		const midJoiner = await createTestUser();

		await addMember({ leagueId: placeOneLeague, userId: midJoiner, joinedAtMs: drawnAtMs + 1 });

		expect(
			(await claimTournamentPrize({ tournamentId: monthAnchor, userId: midJoiner })).reason
		).toBe('not_member_of_top_league');

		// A runner-up member from before the draw takes silver, then joins the
		// winner and claims again: the late membership adds nothing.
		const runnerUp = await createTestUser();

		await addMember({ leagueId: placeTwoLeague, userId: runnerUp, joinedAtMs: drawnAtMs - 1 });

		const silver = await claimTournamentPrize({ tournamentId: monthAnchor, userId: runnerUp });

		expect(silver.totalVxpCredited).toBe(2500);

		await addMember({ leagueId: placeOneLeague, userId: runnerUp, joinedAtMs: afterAllRoundsMs });

		const again = await claimTournamentPrize({ tournamentId: monthAnchor, userId: runnerUp });

		expect(again).toEqual({
			ok: true,
			awardsCreated: 0,
			awardsAlreadyClaimed: 1,
			totalVxpCredited: 0
		});
		expect(await prizeKeysOf({ userId: runnerUp, tournamentId: monthAnchor })).toEqual([
			`${monthAnchor}_place_2`
		]);

		// A winner member from before the draw still takes gold, once.
		const honest = await createTestUser();

		await addMember({ leagueId: placeOneLeague, userId: honest, joinedAtMs: drawnAtMs - 1 });

		expect(
			(await claimTournamentPrize({ tournamentId: monthAnchor, userId: honest })).totalVxpCredited
		).toBe(5000);
		expect(
			(await claimTournamentPrize({ tournamentId: monthAnchor, userId: honest }))
				.awardsAlreadyClaimed
		).toBe(1);
	});

	test('a member of both finalists gets one prize, the best place, however often they claim', async () => {
		const { monthAnchor, drawnAtMs, placeOneLeague, placeTwoLeague } = await concludeTournament();

		const both = await createTestUser();

		await addMember({ leagueId: placeOneLeague, userId: both, joinedAtMs: drawnAtMs - 1 });
		await addMember({ leagueId: placeTwoLeague, userId: both, joinedAtMs: drawnAtMs - 1 });

		const first = await claimTournamentPrize({ tournamentId: monthAnchor, userId: both });

		expect(first.totalVxpCredited).toBe(5000);

		const second = await claimTournamentPrize({ tournamentId: monthAnchor, userId: both });

		expect(second.awardsCreated).toBe(0);
		expect(await prizeKeysOf({ userId: both, tournamentId: monthAnchor })).toEqual([
			`${monthAnchor}_place_1`
		]);

		// Two concurrent first claims: exactly one award between them.
		const racer = await createTestUser();

		await addMember({ leagueId: placeOneLeague, userId: racer, joinedAtMs: drawnAtMs - 1 });
		await addMember({ leagueId: placeTwoLeague, userId: racer, joinedAtMs: drawnAtMs - 1 });

		const racing = await Promise.all([
			claimTournamentPrize({ tournamentId: monthAnchor, userId: racer }),
			claimTournamentPrize({ tournamentId: monthAnchor, userId: racer })
		]);

		expect(racing.map((r) => r.awardsCreated ?? 0).reduce((a, b) => a + b, 0)).toBe(1);
		expect(await prizeKeysOf({ userId: racer, tournamentId: monthAnchor })).toEqual([
			`${monthAnchor}_place_1`
		]);
	});

	test('a prize already held for another place blocks the claim', async () => {
		const { monthAnchor, drawnAtMs, placeOneLeague, placeTwoLeague } = await concludeTournament();

		// Holds silver (granted while only the runner-up counted for them) and
		// is also a pre-draw member of the winner: gold must not stack on top.
		const holder = await createTestUser();

		await addMember({ leagueId: placeOneLeague, userId: holder, joinedAtMs: drawnAtMs - 1 });
		await addMember({ leagueId: placeTwoLeague, userId: holder, joinedAtMs: drawnAtMs - 1 });

		expect(
			(await grantTournamentPrize({ userId: holder, tournamentId: monthAnchor, place: 2 })).outcome
		).toBe('recorded');

		const claim = await claimTournamentPrize({ tournamentId: monthAnchor, userId: holder });

		expect(claim.awardsCreated).toBe(0);
		expect(claim.awardsAlreadyClaimed).toBe(1);
		expect(await prizeKeysOf({ userId: holder, tournamentId: monthAnchor })).toEqual([
			`${monthAnchor}_place_2`
		]);

		// A prize imported from the legacy app counts the same way.
		const imported = await createTestUser();

		await addMember({ leagueId: placeOneLeague, userId: imported, joinedAtMs: drawnAtMs - 1 });
		await query(
			`insert into vxp_awards (user_id, award_type, award_key, amount_base_units, status,
			   earned_at_ms, origin)
			 values ($1, 'tournament_prize', $2, 1, 'paid', $3, 'etl')`,
			[imported, `${monthAnchor}_place_3`, Date.now()]
		);

		expect(
			(await claimTournamentPrize({ tournamentId: monthAnchor, userId: imported })).awardsCreated
		).toBe(0);
		expect(await prizeKeysOf({ userId: imported, tournamentId: monthAnchor })).toEqual([
			`${monthAnchor}_place_3`
		]);
	});

	test('concurrent grants for different places of one tournament pay once', async () => {
		const { monthAnchor } = uniqueMonth();
		const userId = await createTestUser();

		const outcomes = await Promise.all(
			([1, 2, 3] as const).map((place) =>
				grantTournamentPrize({ userId, tournamentId: monthAnchor, place })
			)
		);

		expect(outcomes.filter(({ outcome }) => outcome === 'recorded').length).toBe(1);
		expect(outcomes.filter(({ outcome }) => outcome === 'already').length).toBe(2);
		expect((await prizeKeysOf({ userId, tournamentId: monthAnchor })).length).toBe(1);

		// The index holds even for a grant that skips the read: the ledger
		// core turns the collision into 'already' instead of raising.
		const [held] = await prizeKeysOf({ userId, tournamentId: monthAnchor });
		const otherPlace = held === `${monthAnchor}_place_1` ? 2 : 1;

		expect(
			(
				await grantAward({
					userId,
					awardType: 'tournament_prize',
					awardKey: `${monthAnchor}_place_${otherPlace}`,
					amountBaseUnits: BigInt(1)
				})
			).outcome
		).toBe('already');
		expect((await prizeKeysOf({ userId, tournamentId: monthAnchor })).length).toBe(1);
	});
});
