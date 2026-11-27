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
	claimTournamentPrizeFn,
	getCurrentTournamentFn,
	triggerTournamentDrawFn
} from '#satellite/services/tournament.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import type { AssertSetDocContext, Doc, ListParams, ListResults } from '@junobuild/functions';
import { IcrcLedgerIdl } from '@junobuild/functions/canisters/ledger/icrc';
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

	it('finishes a bracket begun before Round 1 closed once the window has closed', async () => {
		const roundOne = roundWindow({ tournamentMonthStartMs: monthStartMs, round: 'r1' });

		host.setNowMs(roundOne.endMs - 1);
		assert.deepEqual(await triggerTournamentDrawFn({ monthAnchor }), {
			ok: true,
			tournamentId: monthAnchor
		});

		host.setNowMs(roundOne.endMs);
		let result = await triggerTournamentDrawFn({ monthAnchor });

		while (result.ok) {
			result = await triggerTournamentDrawFn({ monthAnchor });
		}

		assert.deepEqual(result, { ok: false, reason: 'already_drawn', tournamentId: monthAnchor });
		assert.equal(bracketDocs(), TOURNAMENT_BRACKET_SIZE);
	});

	it('refuses a new draw once Round 1 closed, writing nothing', async () => {
		host.setNowMs(roundWindow({ tournamentMonthStartMs: monthStartMs, round: 'r1' }).endMs);

		assert.deepEqual(await triggerTournamentDrawFn({ monthAnchor }), {
			ok: false,
			reason: 'invalid_input'
		});
		assert.equal(bracketDocs(), 0);
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

describe('tournament reads', () => {
	const member = Principal.fromUint8Array(new Uint8Array([6, 6, 6]));
	const other = Principal.fromUint8Array(new Uint8Array([7, 7, 7]));
	const winner = 'league-w';
	const previousMonth = '2026-10';
	const previousFinalKey = tournamentMatchKey({
		tournamentId: previousMonth,
		round: 'final',
		index: 0
	});
	const memberRowKey = `${winner}/${member.toText()}`;

	let host: SatelliteHost;
	let listedKeys: Map<string, string[]>;

	type ListDocs = (reader: Uint8Array, name: string, params: ListParams) => ListResults<Doc>;

	/** Records every key a `listDocsStore` call returned, by collection. */
	const recordListedKeys = (): void => {
		const name = '__juno_satellite_datastore_list_docs_store';
		const listDocs: ListDocs = Reflect.get(globalThis, name);

		const spy = (...args: Parameters<ListDocs>): ListResults<Doc> => {
			const [, collection] = args;
			const result = listDocs(...args);
			const keys = result.items.map(([key]) => key);

			listedKeys.set(collection, [...(listedKeys.get(collection) ?? []), ...keys]);

			return result;
		};

		Reflect.set(globalThis, name, spy);
	};

	const put = ({ collection, key, data }: { collection: string; key: string; data: object }) =>
		host.putDoc({ collection, key, data, owner: controller, createdAtMs: tournament.createdAtMs });

	beforeEach(() => {
		const settlements: MockSettlement[] = [
			{ principal: member, atMs: tournament.monthEndMs - 1, calls: 1, wins: 0 }
		];

		host = installSatelliteHost();
		host.setCaller(member);
		host.setNowMs(tournament.monthEndMs + DAY_IN_MS);
		answerSettlementAccuracy({ host, settlements });
		host.onCall({
			method: 'icrc1_transfer',
			argTypes: [IcrcLedgerIdl.TransferArg],
			result: IcrcLedgerIdl.TransferResult,
			handler: () => ({ Ok: BigInt(7) })
		});

		for (const id of [previousMonth, monthAnchor]) {
			put({
				collection: Collection.TOURNAMENTS,
				key: id,
				data: { ...tournament, id, state: 'concluded' }
			});
		}

		put({
			collection: Collection.TOURNAMENT_MATCHES,
			key: finalMatchKey,
			data: { ...finalMatch, fromLeagueId: winner, winnerLeagueId: winner }
		});
		put({
			collection: Collection.TOURNAMENT_MATCHES,
			key: previousFinalKey,
			data: { ...finalMatch, tournamentId: previousMonth, winnerLeagueId: 'league-1' }
		});

		for (const [leagueId, principal] of [
			[winner, member],
			[winner, other],
			['league-1', other]
		] as const) {
			const doc: LeagueMemberDoc = {
				leagueId,
				member: principal.toText(),
				role: 'member',
				joinedAtMs: tournament.createdAtMs - 1
			};

			host.putDoc({
				collection: Collection.LEAGUE_MEMBERS,
				key: `${leagueId}/${principal.toText()}`,
				data: doc,
				owner: principal,
				createdAtMs: tournament.createdAtMs - 1
			});
		}

		listedKeys = new Map();
		recordListedKeys();
	});

	afterEach(() => host.restore());

	it("claims the prize from the caller's memberships and this tournament's matches alone", async () => {
		assert.deepEqual(await claimTournamentPrizeFn({ tournamentId: monthAnchor }), {
			ok: true,
			awardsCreated: 1,
			awardsAlreadyClaimed: 0,
			totalVxpCredited: 5000
		});
		assert.deepEqual(listedKeys.get(Collection.LEAGUE_MEMBERS), [memberRowKey, memberRowKey]);
		assert.deepEqual(listedKeys.get(Collection.TOURNAMENT_MATCHES), [finalMatchKey]);
	});

	it("returns the latest tournament's matches, listing no other month's", () => {
		const { tournament: latest, matches } = getCurrentTournamentFn();

		assert.equal(latest?.id, monthAnchor);
		assert.deepEqual(
			matches.map(({ tournamentId, round }) => `${tournamentId}/${round}`),
			[`${monthAnchor}/final`]
		);
		assert.deepEqual(listedKeys.get(Collection.TOURNAMENT_MATCHES), [finalMatchKey]);
	});
});
