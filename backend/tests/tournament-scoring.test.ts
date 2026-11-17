// Tournament match scoring: each side is scored from its members' settled
// history over the round window, read from the clearing canister, never from
// the member-writable league_stats; a settlement outside the window and a
// member who joined after it do not count.

import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { query } from '../src/db/client';
import { DAY_IN_MS } from '../src/lib/time';
import {
	resolveTournamentRound,
	roundWindow,
	TOURNAMENT_BRACKET_SIZE,
	TOURNAMENT_ROUND_DURATION_MS,
	TOURNAMENT_ROUNDS
} from '../src/tournaments/tournaments';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { stubSettledHistory, type SettledHistoryStub } from './helpers/settlements';
import { dbAvailable } from './helpers/setup';

// Past every range other suites draw from (worlds-podium 2000 to 2099,
// monthly-stats 2100 to 2899, tournaments 2900 to 2999, affiliation-stats
// 3000 and up on its own tables).
const FIRST_TEST_YEAR = 4000;
const FIRST_TEST_ANCHOR = `${FIRST_TEST_YEAR}-`;

let monthsDrawn = 0;

const uniqueMonth = (): { monthAnchor: string; startMs: number } => {
	const year = FIRST_TEST_YEAR + Math.floor(monthsDrawn / 12);
	const month = (monthsDrawn % 12) + 1;

	monthsDrawn += 1;

	return {
		monthAnchor: `${year}-${String(month).padStart(2, '0')}`,
		startMs: Date.UTC(year, month - 1, 1)
	};
};

/** A one-member league owned by a fresh user; its id and owner. */
const seedLeague = async (): Promise<{ leagueId: string; ownerId: string }> => {
	const leagueId = `tsc-${randomBytes(6).toString('hex')}`;
	const ownerId = await createTestUser();

	await query(
		`insert into leagues (id, name, invite_code, owner_user_id, created_at_ms)
		 values ($1, $2, $3, $4, $5)`,
		[leagueId, `League ${leagueId}`, randomBytes(3).toString('hex').toUpperCase(), ownerId, 0]
	);
	await query(
		`insert into league_members (league_id, member_user_id, joined_at_ms, role)
		 values ($1, $2, 0, 'owner')`,
		[leagueId, ownerId]
	);

	return { leagueId, ownerId };
};

/** A drawn tournament whose round 1 match 0 pits `from` against `to`. */
const seedRoundOne = async ({
	monthAnchor,
	startMs,
	from,
	to
}: {
	monthAnchor: string;
	startMs: number;
	from: string;
	to: string;
}): Promise<void> => {
	const r1 = roundWindow({ tournamentMonthStartMs: startMs, round: 'r1' });

	await query(
		`insert into tournaments (id, month_start_ms, month_end_ms, bracket_size, state,
		   seeded_league_ids, created_at_ms)
		 values ($1, $2, $3, $4, 'in_flight', $5, $2)`,
		[
			monthAnchor,
			startMs,
			startMs + TOURNAMENT_ROUNDS.length * TOURNAMENT_ROUND_DURATION_MS,
			TOURNAMENT_BRACKET_SIZE,
			JSON.stringify([from, to])
		]
	);
	await query(
		`insert into tournament_matches (tournament_id, round, index, from_league_id,
		   to_league_id, start_ms, end_ms)
		 values ($1, 'r1', 0, $2, $3, $4, $5)`,
		[monthAnchor, from, to, r1.startMs, r1.endMs]
	);
};

const readMatch = async (
	monthAnchor: string
): Promise<
	{ winner_league_id: string | null; from_acc: number | null; to_acc: number | null } | undefined
> => {
	const rows = await query<{
		winner_league_id: string | null;
		from_acc: number | null;
		to_acc: number | null;
	}>(
		`select winner_league_id, from_acc, to_acc from tournament_matches
		 where tournament_id = $1 and round = 'r1' and index = 0`,
		[monthAnchor]
	);

	return rows[0];
};

describe.if(dbAvailable)('tournament match scoring', () => {
	let settled: SettledHistoryStub | undefined;

	beforeAll(async () => {
		await ensureMigrated();
		await query(`delete from tournaments where id >= $1`, [FIRST_TEST_ANCHOR]);
	});

	beforeEach(() => {
		settled = stubSettledHistory();
	});

	afterEach(() => {
		settled?.restore();
		settled = undefined;
	});

	test('a league scores from settled history, never its own league_stats', async () => {
		const { monthAnchor, startMs } = uniqueMonth();
		const r1 = roundWindow({ tournamentMonthStartMs: startMs, round: 'r1' });
		const honest = await seedLeague();
		const forger = await seedLeague();

		await seedRoundOne({ monthAnchor, startMs, from: honest.leagueId, to: forger.leagueId });

		// The forger's members write it a perfect window; only the honest
		// league has calls that settled in it.
		await query(
			`insert into league_stats (league_id, total_calls, wins, updated_at_ms)
			 values ($1, 100000, 100000, $2)`,
			[forger.leagueId, Date.now()]
		);
		settled?.settle({
			userId: honest.ownerId,
			atMs: r1.startMs + DAY_IN_MS,
			calls: 60,
			wins: 30
		});

		const result = await resolveTournamentRound({
			tournamentId: monthAnchor,
			round: 'r1',
			nowMs: r1.endMs
		});

		expect(result.matchesResolved).toBe(1);
		expect(await readMatch(monthAnchor)).toEqual({
			winner_league_id: honest.leagueId,
			from_acc: 0.5,
			to_acc: null
		});
	});

	test('settlements outside the window and members who joined after it do not count', async () => {
		const { monthAnchor, startMs } = uniqueMonth();
		const r1 = roundWindow({ tournamentMonthStartMs: startMs, round: 'r1' });
		const weak = await seedLeague();
		const boosted = await seedLeague();
		const latecomer = await createTestUser();

		await seedRoundOne({ monthAnchor, startMs, from: weak.leagueId, to: boosted.leagueId });
		await query(
			`insert into league_members (league_id, member_user_id, joined_at_ms, role)
			 values ($1, $2, $3, 'member')`,
			[boosted.leagueId, latecomer, r1.endMs]
		);
		settled?.settle({ userId: weak.ownerId, atMs: r1.startMs + DAY_IN_MS, calls: 60, wins: 6 });
		settled?.settle({ userId: boosted.ownerId, atMs: r1.startMs - 1, calls: 60, wins: 60 });
		settled?.settle({ userId: boosted.ownerId, atMs: r1.endMs, calls: 60, wins: 60 });
		settled?.settle({ userId: latecomer, atMs: r1.startMs + DAY_IN_MS, calls: 60, wins: 60 });

		await resolveTournamentRound({ tournamentId: monthAnchor, round: 'r1', nowMs: r1.endMs });

		expect(await readMatch(monthAnchor)).toEqual({
			winner_league_id: weak.leagueId,
			from_acc: 0.1,
			to_acc: null
		});
	});
});
