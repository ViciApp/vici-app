// Tournament prize claim in record-only mode on a concluded bracket written
// straight to the database: eligibility from memberships that predate the
// draw plus a call settled inside the tournament window, and one prize per
// user per tournament whatever the place.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { query } from '../src/db/client';
import { DAY_IN_MS } from '../src/lib/time';
import {
	claimTournamentPrize,
	TOURNAMENT_BRACKET_SIZE,
	TOURNAMENT_ROUND_DURATION_MS,
	TOURNAMENT_ROUNDS
} from '../src/tournaments/tournaments';
import { grantAward, setVxpTreasuryDisabled } from '../src/vxp/awards';
import { grantTournamentPrize } from '../src/vxp/prizes';
import { createTestUser, ensureMigrated, linkUnparseablePrincipal } from './helpers/auth';
import { stubSettledHistory, type SettledHistoryStub } from './helpers/settlements';
import { dbAvailable } from './helpers/setup';

// Month anchors of the tournaments table reserved per suite: tournaments 2900
// to 2999, tournament-prize 3900 to 3999, tournament-scoring 4000 and up.
const FIRST_TEST_YEAR = 3900;
const FIRST_TEST_ANCHOR = `${FIRST_TEST_YEAR}-`;
const PAST_LAST_TEST_ANCHOR = `${FIRST_TEST_YEAR + 100}-`;

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

const seedLeague = async (): Promise<string> => {
	const leagueId = `tpz-${randomBytes(6).toString('hex')}`;
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

	return leagueId;
};

describe.if(dbAvailable)('tournament prize', () => {
	// Record-only mode: prize claims must not attempt real treasury
	// transfers from the test suite.
	const restoreTreasury = setVxpTreasuryDisabled(true);

	let settled: SettledHistoryStub | undefined;

	beforeAll(async () => {
		await ensureMigrated();
		await query(`delete from tournaments where id >= $1 and id < $2`, [
			FIRST_TEST_ANCHOR,
			PAST_LAST_TEST_ANCHOR
		]);
	});

	afterAll(() => {
		restoreTreasury();
	});

	beforeEach(() => {
		settled = stubSettledHistory();
	});

	afterEach(() => {
		settled?.restore();
		settled = undefined;
	});

	/** A concluded tournament drawn one second into its month: the first
	 * finalist won the final, the other finalist took second, and two more
	 * leagues lost the semifinals. */
	const concludeTournament = async (): Promise<{
		monthAnchor: string;
		startMs: number;
		drawnAtMs: number;
		afterAllRoundsMs: number;
		placeOneLeague: string;
		placeTwoLeague: string;
	}> => {
		const { monthAnchor, startMs } = uniqueMonth();
		const drawnAtMs = startMs + 1000;
		const endMs = startMs + TOURNAMENT_ROUNDS.length * TOURNAMENT_ROUND_DURATION_MS;
		const [placeOneLeague, placeTwoLeague, semiOne, semiTwo] = await Promise.all(
			[0, 1, 2, 3].map(() => seedLeague())
		);

		await query(
			`insert into tournaments (id, month_start_ms, month_end_ms, bracket_size, state,
			   seeded_league_ids, created_at_ms)
			 values ($1, $2, $3, $4, 'concluded', $5, $6)`,
			[
				monthAnchor,
				startMs,
				endMs,
				TOURNAMENT_BRACKET_SIZE,
				JSON.stringify([placeOneLeague, placeTwoLeague, semiOne, semiTwo]),
				drawnAtMs
			]
		);

		for (const [round, index, from, to] of [
			['semifinal', 0, placeOneLeague, semiOne],
			['semifinal', 1, placeTwoLeague, semiTwo],
			['final', 0, placeOneLeague, placeTwoLeague]
		] as const) {
			await query(
				`insert into tournament_matches (tournament_id, round, index, from_league_id,
				   to_league_id, winner_league_id, start_ms, end_ms)
				 values ($1, $2, $3, $4, $5, $4, $6, $7)`,
				[monthAnchor, round, index, from, to, startMs, endMs]
			);
		}

		return {
			monthAnchor,
			startMs,
			drawnAtMs,
			afterAllRoundsMs: endMs + 1000,
			placeOneLeague: placeOneLeague ?? '',
			placeTwoLeague: placeTwoLeague ?? ''
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

	/** One settled call for `userId` inside the tournament window that opens at `startMs`. */
	const settleInTournament = ({ userId, startMs }: { userId: string; startMs: number }): void => {
		settled?.settle({ userId, atMs: startMs + DAY_IN_MS, calls: 1, wins: 1 });
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
		const { monthAnchor, startMs, drawnAtMs, afterAllRoundsMs, placeOneLeague, placeTwoLeague } =
			await concludeTournament();

		// Joined the winner after the tournament concluded.
		const lateJoiner = await createTestUser();

		settleInTournament({ userId: lateJoiner, startMs });
		await addMember({ leagueId: placeOneLeague, userId: lateJoiner, joinedAtMs: afterAllRoundsMs });

		const late = await claimTournamentPrize({ tournamentId: monthAnchor, userId: lateJoiner });

		expect(late.ok).toBe(false);
		expect(late.reason).toBe('not_member_of_top_league');
		expect(await prizeKeysOf({ userId: lateJoiner, tournamentId: monthAnchor })).toEqual([]);

		// Joined one millisecond after the draw, while the bracket was running.
		const midJoiner = await createTestUser();

		settleInTournament({ userId: midJoiner, startMs });
		await addMember({ leagueId: placeOneLeague, userId: midJoiner, joinedAtMs: drawnAtMs + 1 });

		expect(
			(await claimTournamentPrize({ tournamentId: monthAnchor, userId: midJoiner })).reason
		).toBe('not_member_of_top_league');

		// A runner-up member from before the draw takes silver, then joins the
		// winner and claims again: the late membership adds nothing.
		const runnerUp = await createTestUser();

		settleInTournament({ userId: runnerUp, startMs });
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

		settleInTournament({ userId: honest, startMs });
		await addMember({ leagueId: placeOneLeague, userId: honest, joinedAtMs: drawnAtMs - 1 });

		expect(
			(await claimTournamentPrize({ tournamentId: monthAnchor, userId: honest })).totalVxpCredited
		).toBe(5000);
		expect(
			(await claimTournamentPrize({ tournamentId: monthAnchor, userId: honest }))
				.awardsAlreadyClaimed
		).toBe(1);
	});

	test('a pre-draw member earns a prize only with a call settled inside the tournament window', async () => {
		const { monthAnchor, startMs, drawnAtMs, placeOneLeague } = await concludeTournament();
		const tournamentEndMs = startMs + TOURNAMENT_ROUNDS.length * TOURNAMENT_ROUND_DURATION_MS;

		// Settled just before the window opened and right as it closed: neither counts.
		const idle = await createTestUser();

		await addMember({ leagueId: placeOneLeague, userId: idle, joinedAtMs: drawnAtMs - 1 });
		settled?.settle({ userId: idle, atMs: startMs - 1, calls: 5, wins: 5 });
		settled?.settle({ userId: idle, atMs: tournamentEndMs, calls: 5, wins: 5 });

		expect(await claimTournamentPrize({ tournamentId: monthAnchor, userId: idle })).toEqual({
			ok: false,
			reason: 'not_member_of_top_league'
		});
		expect(await prizeKeysOf({ userId: idle, tournamentId: monthAnchor })).toEqual([]);

		// One settled call on the window's last instant is enough.
		const active = await createTestUser();

		await addMember({ leagueId: placeOneLeague, userId: active, joinedAtMs: drawnAtMs - 1 });
		settled?.settle({ userId: active, atMs: tournamentEndMs - 1, calls: 1, wins: 0 });

		expect(
			(await claimTournamentPrize({ tournamentId: monthAnchor, userId: active })).totalVxpCredited
		).toBe(5000);
	});

	test('a linked principal that does not parse does not stop the claim', async () => {
		const { monthAnchor, startMs, drawnAtMs, placeOneLeague } = await concludeTournament();
		const linked = await createTestUser();

		await linkUnparseablePrincipal(linked);
		settleInTournament({ userId: linked, startMs });
		await addMember({ leagueId: placeOneLeague, userId: linked, joinedAtMs: drawnAtMs - 1 });

		expect(
			(await claimTournamentPrize({ tournamentId: monthAnchor, userId: linked })).totalVxpCredited
		).toBe(5000);
	});

	test('a member of both finalists gets one prize, the best place, however often they claim', async () => {
		const { monthAnchor, startMs, drawnAtMs, placeOneLeague, placeTwoLeague } =
			await concludeTournament();

		const both = await createTestUser();

		settleInTournament({ userId: both, startMs });

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

		settleInTournament({ userId: racer, startMs });

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
		const { monthAnchor, startMs, drawnAtMs, placeOneLeague, placeTwoLeague } =
			await concludeTournament();

		// Holds silver (granted while only the runner-up counted for them) and
		// is also a pre-draw member of the winner: gold must not stack on top.
		const holder = await createTestUser();

		settleInTournament({ userId: holder, startMs });

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

		settleInTournament({ userId: imported, startMs });

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

	test('a failed prize imported from the legacy app still blocks the tournament', async () => {
		const { monthAnchor } = uniqueMonth();
		const userId = await createTestUser();

		await query(
			`insert into vxp_awards (user_id, award_type, award_key, amount_base_units, status,
			   earned_at_ms, origin)
			 values ($1, 'tournament_prize', $2, 1, 'failed', $3, 'etl')`,
			[userId, `${monthAnchor}_place_1`, Date.now()]
		);

		expect(
			(await grantTournamentPrize({ userId, tournamentId: monthAnchor, place: 2 })).outcome
		).toBe('already');
		expect(await prizeKeysOf({ userId, tournamentId: monthAnchor })).toEqual([
			`${monthAnchor}_place_1`
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
