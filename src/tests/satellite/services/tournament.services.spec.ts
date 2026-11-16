import { Collection } from '#lib/constants/collections.constants.ts';
import {
	roundWindow,
	TOURNAMENT_BRACKET_SIZE,
	TOURNAMENT_ROUND_DURATION_MS,
	tournamentMatchKey,
	type TournamentDoc,
	type TournamentMatchDoc
} from '#lib/types/tournament.ts';
import {
	assertDeleteTournamentDoc,
	assertSetTournament,
	assertSetTournamentMatch
} from '#satellite/services/tournament.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import type { AssertDeleteDocContext, AssertSetDocContext } from '@junobuild/functions';
import type { AccessKeys } from '@junobuild/functions/sdk';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const controller = Principal.fromUint8Array(new Uint8Array([1, 1, 1]));
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

const bytes = (doc: object): Uint8Array<ArrayBuffer> =>
	new TextEncoder().encode(JSON.stringify(doc));

const setContext = ({
	caller,
	collection,
	key,
	proposed,
	current
}: {
	caller: Principal;
	collection: string;
	key: string;
	proposed: object;
	current?: object;
}): AssertSetDocContext => ({
	caller: caller.toUint8Array(),
	data: {
		collection,
		key,
		data: {
			current: current && {
				owner: controller.toUint8Array(),
				data: bytes(current),
				created_at: 1n,
				updated_at: 1n,
				version: 1n
			},
			proposed: { data: bytes(proposed), version: current && 1n }
		}
	}
});

const deleteContext = ({
	caller,
	collection,
	key
}: {
	caller: Principal;
	collection: string;
	key: string;
}): AssertDeleteDocContext => ({
	caller: caller.toUint8Array(),
	data: {
		collection,
		key,
		data: {
			current: {
				owner: controller.toUint8Array(),
				data: bytes({}),
				created_at: 1n,
				updated_at: 1n,
				version: 1n
			},
			proposed: { version: 1n }
		}
	}
});

// The satellite host bindings `getAdminAccessKeys()` and `decodeDocData()`
// read; Node has no host.
const hostGlobals = {
	__juno_satellite_get_admin_access_keys: (): AccessKeys => [
		[controller.toUint8Array(), { metadata: [], created_at: 1n, updated_at: 1n, scope: 'admin' }]
	],
	__juno_satellite_datastore_raw_data_to_text: (data: Uint8Array): string =>
		new TextDecoder().decode(data)
};

describe('tournament.services', () => {
	beforeEach(() => {
		for (const [name, value] of Object.entries(hostGlobals)) {
			Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
		}
	});

	afterEach(() => {
		for (const name of Object.keys(hostGlobals)) {
			Reflect.deleteProperty(globalThis, name);
		}
	});

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
					() => assertDeleteTournamentDoc(deleteContext({ caller: user, collection, key })),
					/only the satellite writes/
				);
			});

			it(`lets a satellite controller delete a ${collection} doc`, () => {
				assert.doesNotThrow(() =>
					assertDeleteTournamentDoc(deleteContext({ caller: controller, collection, key }))
				);
			});
		}

		it('ignores other collections', () => {
			assert.doesNotThrow(() =>
				assertDeleteTournamentDoc(
					deleteContext({ caller: user, collection: Collection.LEAGUE_MEMBERS, key: 'x' })
				)
			);
		});
	});
});
