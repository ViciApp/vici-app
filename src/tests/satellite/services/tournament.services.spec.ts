import { Collection } from '#lib/constants/collections.constants.ts';
import { DAY_IN_MS } from '#lib/constants/time.constants.ts';
import type { LeagueMemberDoc } from '#lib/types/league-member.ts';
import {
	roundWindow,
	TOURNAMENT_BRACKET_SIZE,
	TOURNAMENT_ROUND_DURATION_MS,
	tournamentMatchKey,
	type TournamentDoc,
	type TournamentMatchDoc
} from '#lib/types/tournament.ts';
import {
	answerSettlementAccuracy,
	controller,
	deleteContext,
	installSatelliteHost,
	setContext,
	type MockSettlement,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { assertSetDoc } from '#satellite/index.ts';
import {
	assertDeleteTournamentDoc,
	assertSetTournament,
	assertSetTournamentMatch,
	resolveTournamentRoundFn,
	triggerTournamentDrawFn
} from '#satellite/services/tournament.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import type { AssertSetDocContext } from '@junobuild/functions';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const user = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));

const monthAnchor = '2026-11';
const monthStartMs = Date.UTC(2026, 10, 1);

const tournament: TournamentDoc = {
	id: monthAnchor,
	monthStartMs,
	monthEndMs: monthStartMs + 4 * TOURNAMENT_ROUND_DURATION_MS,
	bracketSize: TOURNAMENT_BRACKET_SIZE,
	state: 'in_flight',
	seededLeagueIds: Array.from({ length: TOURNAMENT_BRACKET_SIZE }, (_, i) => `league-${i}`),
	createdAtMs: monthStartMs + 1_000
};

const finalWindow = roundWindow({ tournamentMonthStartMs: monthStartMs, round: 'final' });

const finalMatch: TournamentMatchDoc = {
	tournamentId: monthAnchor,
	round: 'final',
	index: 0,
	fromLeagueId: 'league-0',
	toLeagueId: 'league-1',
	fromStartCalls: 100,
	fromStartWins: 60,
	toStartCalls: 100,
	toStartWins: 50,
	fromAcc: null,
	toAcc: null,
	winnerLeagueId: null,
	startMs: finalWindow.startMs,
	endMs: finalWindow.endMs
};

const finalMatchKey = tournamentMatchKey({ tournamentId: monthAnchor, round: 'final', index: 0 });

describe('tournament.services', () => {
	let host: SatelliteHost;

	beforeEach(() => {
		host = installSatelliteHost();
	});

	afterEach(() => host.restore());

	describe('assertSetTournament', () => {
		const create = (caller: Principal): AssertSetDocContext =>
			setContext({
				caller,
				collection: Collection.TOURNAMENTS,
				key: monthAnchor,
				proposed: tournament
			});

		const conclude = (caller: Principal): AssertSetDocContext =>
			setContext({
				caller,
				collection: Collection.TOURNAMENTS,
				key: monthAnchor,
				current: tournament,
				proposed: { ...tournament, state: 'concluded' }
			});

		it('rejects a user creating a tournament', () => {
			assert.throws(() => assertSetTournament(create(user)), /only the satellite writes/);
		});

		it('rejects a user concluding a tournament', () => {
			assert.throws(() => assertSetTournament(conclude(user)), /only the satellite writes/);
		});

		it('lets a satellite controller create a tournament', () => {
			assert.doesNotThrow(() => assertSetTournament(create(controller)));
		});

		it('lets a satellite controller conclude a tournament', () => {
			assert.doesNotThrow(() => assertSetTournament(conclude(controller)));
		});

		it('still holds a controller to the state machine', () => {
			assert.throws(
				() =>
					assertSetTournament(
						setContext({
							caller: controller,
							collection: Collection.TOURNAMENTS,
							key: monthAnchor,
							proposed: { ...tournament, state: 'concluded' }
						})
					),
				/must start in "in_flight"/
			);
		});

		it('ignores other collections', () => {
			assert.doesNotThrow(() =>
				assertSetTournament(
					setContext({
						caller: user,
						collection: Collection.TOURNAMENT_MATCHES,
						key: monthAnchor,
						proposed: tournament
					})
				)
			);
		});
	});

	describe('assertSetTournamentMatch', () => {
		const create = (caller: Principal): AssertSetDocContext =>
			setContext({
				caller,
				collection: Collection.TOURNAMENT_MATCHES,
				key: finalMatchKey,
				proposed: finalMatch
			});

		const resolve = (caller: Principal): AssertSetDocContext =>
			setContext({
				caller,
				collection: Collection.TOURNAMENT_MATCHES,
				key: finalMatchKey,
				current: finalMatch,
				proposed: { ...finalMatch, fromAcc: 0.6, toAcc: 0.5, winnerLeagueId: 'league-0' }
			});

		it('rejects a user creating a match', () => {
			assert.throws(() => assertSetTournamentMatch(create(user)), /only the satellite writes/);
		});

		it('rejects a user writing a match winner', () => {
			assert.throws(() => assertSetTournamentMatch(resolve(user)), /only the satellite writes/);
		});

		it('lets a satellite controller create a match', () => {
			assert.doesNotThrow(() => assertSetTournamentMatch(create(controller)));
		});

		it('lets a satellite controller write a match winner', () => {
			assert.doesNotThrow(() => assertSetTournamentMatch(resolve(controller)));
		});

		it('ignores other collections', () => {
			assert.doesNotThrow(() =>
				assertSetTournamentMatch(
					setContext({
						caller: user,
						collection: Collection.TOURNAMENTS,
						key: finalMatchKey,
						proposed: finalMatch
					})
				)
			);
		});
	});

	describe('assertDeleteTournamentDoc', () => {
		const cases = [
			{ collection: Collection.TOURNAMENTS, key: monthAnchor },
			{ collection: Collection.TOURNAMENT_MATCHES, key: finalMatchKey }
		];

		for (const { collection, key } of cases) {
			it(`rejects a user deleting a ${collection} doc`, () => {
				assert.throws(
					() =>
						assertDeleteTournamentDoc(
							deleteContext({ caller: user, collection, key, current: {} })
						),
					/only the satellite writes/
				);
			});

			it(`lets a satellite controller delete a ${collection} doc`, () => {
				assert.doesNotThrow(() =>
					assertDeleteTournamentDoc(
						deleteContext({ caller: controller, collection, key, current: {} })
					)
				);
			});
		}

		it('ignores other collections', () => {
			assert.doesNotThrow(() =>
				assertDeleteTournamentDoc(
					deleteContext({
						caller: user,
						collection: Collection.LEAGUE_MEMBERS,
						key: 'x',
						current: {}
					})
				)
			);
		});
	});
});

describe('triggerTournamentDrawFn', () => {
	const leagueIds = Array.from(
		{ length: TOURNAMENT_BRACKET_SIZE },
		(_, i) => `league-${i.toString().padStart(2, '0')}`
	);

	let host: SatelliteHost;

	const bracketDocs = (): number =>
		host.keys(Collection.TOURNAMENTS).length + host.keys(Collection.TOURNAMENT_MATCHES).length;

	const match = ({ round, index }: Pick<TournamentMatchDoc, 'round' | 'index'>) =>
		host.readDoc<TournamentMatchDoc>({
			collection: Collection.TOURNAMENT_MATCHES,
			key: tournamentMatchKey({ tournamentId: monthAnchor, round, index })
		});

	beforeEach(() => {
		// The real asserts run on every serverless write, as on the satellite.
		host = installSatelliteHost({ asserts: { set: assertSetDoc.assert } });
		host.setCaller(user);
		host.setNowMs(monthStartMs + DAY_IN_MS);
		// The one member of every league settled a call in the month before the draw.
		answerSettlementAccuracy({
			host,
			settlements: [{ principal: user, atMs: monthStartMs - DAY_IN_MS, calls: 1, wins: 0 }]
		});

		for (const leagueId of leagueIds) {
			host.putDoc({
				collection: Collection.LEAGUES,
				key: leagueId,
				data: { id: leagueId, name: leagueId, owner: user.toText(), createdAtMs: 1 },
				owner: user
			});
			host.putDoc({
				collection: Collection.LEAGUE_MEMBERS,
				key: `${leagueId}/${user.toText()}`,
				data: { leagueId, member: user.toText(), role: 'owner', joinedAtMs: 1 },
				owner: user
			});
		}
	});

	afterEach(() => host.restore());

	it('writes the bracket a few docs per call until it reports it drawn', async () => {
		const writesPerCall: number[] = [];
		let result = await triggerTournamentDrawFn({ monthAnchor });

		while (result.ok) {
			writesPerCall.push(bracketDocs() - writesPerCall.reduce((sum, n) => sum + n, 0));
			result = await triggerTournamentDrawFn({ monthAnchor });
		}

		assert.deepEqual(result, { ok: false, reason: 'already_drawn', tournamentId: monthAnchor });
		assert.deepEqual(writesPerCall, [4, 4, 4, 4]);
		assert.equal(bracketDocs(), TOURNAMENT_BRACKET_SIZE);
		assert.equal(match({ round: 'r1', index: 0 })?.fromLeagueId, 'league-00');
		assert.equal(match({ round: 'r1', index: 0 })?.toLeagueId, 'league-15');
		assert.equal(match({ round: 'final', index: 0 })?.fromLeagueId, null);
		assert.deepEqual(
			host.readDoc<TournamentDoc>({ collection: Collection.TOURNAMENTS, key: monthAnchor })
				?.seededLeagueIds,
			leagueIds
		);
	});

	it('refuses a bracket with fewer leagues than its size, writing nothing', async () => {
		host.restore();
		host = installSatelliteHost();
		host.setNowMs(monthStartMs + DAY_IN_MS);
		answerSettlementAccuracy({ host, settlements: [] });

		assert.deepEqual(await triggerTournamentDrawFn({ monthAnchor }), {
			ok: false,
			reason: 'insufficient_leagues',
			availableLeagues: 0
		});
		assert.equal(bracketDocs(), 0);
	});
});

describe('resolveTournamentRoundFn', () => {
	const leagueA = 'league-a';
	const leagueB = 'league-b';
	const memberA = Principal.fromUint8Array(new Uint8Array([3, 3, 3]));
	const memberB = Principal.fromUint8Array(new Uint8Array([4, 4, 4]));
	const latecomer = Principal.fromUint8Array(new Uint8Array([5, 5, 5]));

	const octoberStartMs = Date.UTC(2026, 9, 1);
	const r1 = roundWindow({ tournamentMonthStartMs: octoberStartMs, round: 'r1' });
	const tournamentId = '2026-10';

	let host: SatelliteHost;
	let settlements: MockSettlement[];

	const joinLeague = ({
		leagueId,
		member,
		joinedAtMs
	}: {
		leagueId: string;
		member: Principal;
		joinedAtMs: number;
	}): void => {
		const doc: LeagueMemberDoc = {
			leagueId,
			member: member.toText(),
			role: 'member',
			joinedAtMs
		};

		host.putDoc({
			collection: Collection.LEAGUE_MEMBERS,
			key: `${leagueId}/${member.toText()}`,
			data: doc,
			owner: member,
			createdAtMs: joinedAtMs
		});
	};

	const r1Match = (): TournamentMatchDoc | undefined =>
		host.readDoc<TournamentMatchDoc>({
			collection: Collection.TOURNAMENT_MATCHES,
			key: tournamentMatchKey({ tournamentId, round: 'r1', index: 0 })
		});

	beforeEach(() => {
		settlements = [];
		host = installSatelliteHost();
		host.setCaller(user);
		host.setNowMs(r1.endMs + DAY_IN_MS);
		answerSettlementAccuracy({ host, settlements });

		host.putDoc({
			collection: Collection.TOURNAMENTS,
			key: tournamentId,
			data: {
				...tournament,
				id: tournamentId,
				monthStartMs: octoberStartMs,
				monthEndMs: octoberStartMs + 4 * TOURNAMENT_ROUND_DURATION_MS
			},
			owner: controller,
			createdAtMs: octoberStartMs
		});

		const match: TournamentMatchDoc = {
			...finalMatch,
			tournamentId,
			round: 'r1',
			fromLeagueId: leagueA,
			toLeagueId: leagueB,
			fromStartCalls: 0,
			fromStartWins: 0,
			toStartCalls: 0,
			toStartWins: 0,
			startMs: r1.startMs,
			endMs: r1.endMs
		};

		host.putDoc({
			collection: Collection.TOURNAMENT_MATCHES,
			key: tournamentMatchKey({ tournamentId, round: 'r1', index: 0 }),
			data: match,
			owner: controller,
			createdAtMs: octoberStartMs
		});

		joinLeague({ leagueId: leagueA, member: memberA, joinedAtMs: octoberStartMs - DAY_IN_MS });
		joinLeague({ leagueId: leagueB, member: memberB, joinedAtMs: octoberStartMs - DAY_IN_MS });
	});

	afterEach(() => {
		host.restore();
	});

	it('scores a match from settled history, not the member-written league stats', async () => {
		// League A's members wrote themselves a perfect window; only league B
		// has calls that settled in it.
		host.putDoc({
			collection: Collection.LEAGUE_STATS,
			key: leagueA,
			data: { leagueId: leagueA, totalCalls: 1_000, wins: 1_000, updatedAtMs: r1.startMs },
			owner: memberA
		});
		settlements.push({ principal: memberB, atMs: r1.startMs + DAY_IN_MS, calls: 60, wins: 40 });

		const result = await resolveTournamentRoundFn({ tournamentId, round: 'r1' });

		assert.equal(result.ok, true);
		assert.equal(result.matchesResolved, 1);
		assert.equal(r1Match()?.winnerLeagueId, leagueB);
		assert.equal(r1Match()?.fromAcc, null);
		assert.equal(r1Match()?.toAcc, 40 / 60);
	});

	it('counts only settlements inside the round window', async () => {
		settlements.push({ principal: memberA, atMs: r1.startMs + DAY_IN_MS, calls: 60, wins: 30 });
		settlements.push({ principal: memberB, atMs: r1.startMs - 1, calls: 60, wins: 60 });
		settlements.push({ principal: memberB, atMs: r1.endMs, calls: 60, wins: 60 });

		await resolveTournamentRoundFn({ tournamentId, round: 'r1' });

		assert.equal(r1Match()?.winnerLeagueId, leagueA);
		assert.equal(r1Match()?.toAcc, null);
	});

	it('does not let a member who joined after the draw lift the score, even inside the window', async () => {
		settlements.push({ principal: memberA, atMs: r1.startMs + DAY_IN_MS, calls: 60, wins: 30 });
		settlements.push({ principal: latecomer, atMs: r1.startMs + DAY_IN_MS, calls: 60, wins: 60 });
		// The tournament doc was stored at the month start: the draw.
		joinLeague({ leagueId: leagueB, member: latecomer, joinedAtMs: octoberStartMs + 1 });

		await resolveTournamentRoundFn({ tournamentId, round: 'r1' });

		assert.equal(r1Match()?.winnerLeagueId, leagueA);
	});

	it('does not let a member who joined after the window lift the score', async () => {
		settlements.push({ principal: memberA, atMs: r1.startMs + DAY_IN_MS, calls: 60, wins: 30 });
		settlements.push({ principal: latecomer, atMs: r1.startMs + DAY_IN_MS, calls: 60, wins: 60 });
		joinLeague({ leagueId: leagueB, member: latecomer, joinedAtMs: r1.endMs });

		await resolveTournamentRoundFn({ tournamentId, round: 'r1' });

		assert.equal(r1Match()?.winnerLeagueId, leagueA);
	});

	it('fills both slots of a quarter-final fed by two first-round matches', async () => {
		const leagueC = 'league-c';
		const leagueD = 'league-d';
		const quarter = roundWindow({ tournamentMonthStartMs: octoberStartMs, round: 'quarter' });
		const quarterKey = tournamentMatchKey({ tournamentId, round: 'quarter', index: 0 });
		const emptyMatch: TournamentMatchDoc = {
			...finalMatch,
			tournamentId,
			fromStartCalls: null,
			fromStartWins: null,
			toStartCalls: null,
			toStartWins: null
		};

		host.putDoc({
			collection: Collection.TOURNAMENT_MATCHES,
			key: tournamentMatchKey({ tournamentId, round: 'r1', index: 1 }),
			data: {
				...emptyMatch,
				round: 'r1',
				index: 1,
				fromLeagueId: leagueC,
				toLeagueId: leagueD,
				startMs: r1.startMs,
				endMs: r1.endMs
			},
			owner: controller,
			createdAtMs: octoberStartMs
		});
		host.putDoc({
			collection: Collection.TOURNAMENT_MATCHES,
			key: quarterKey,
			data: {
				...emptyMatch,
				round: 'quarter',
				index: 0,
				fromLeagueId: null,
				toLeagueId: null,
				startMs: quarter.startMs,
				endMs: quarter.endMs
			},
			owner: controller,
			createdAtMs: octoberStartMs
		});
		settlements.push({ principal: memberB, atMs: r1.startMs + DAY_IN_MS, calls: 60, wins: 40 });

		const result = await resolveTournamentRoundFn({ tournamentId, round: 'r1' });

		assert.deepEqual(result, { ok: true, matchesResolved: 2, tournamentConcluded: false });

		const quarterMatch = host.readDoc<TournamentMatchDoc>({
			collection: Collection.TOURNAMENT_MATCHES,
			key: quarterKey
		});

		assert.equal(quarterMatch?.fromLeagueId, leagueB);
		assert.equal(quarterMatch?.toLeagueId, leagueC);
	});

	it('refuses a round whose window has not closed', async () => {
		host.setNowMs(r1.endMs - 1);

		const result = await resolveTournamentRoundFn({ tournamentId, round: 'r1' });

		assert.deepEqual(result, { ok: false, reason: 'round_not_yet_closed' });
		assert.equal(r1Match()?.winnerLeagueId, null);
	});
});
