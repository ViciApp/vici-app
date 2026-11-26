// The members a monthly tournament counts outside match scoring: the draw
// seeds by members with a settled call in the calendar month before it, and
// the prize claim pays a pre-draw member of a placed league only with a call
// settled inside the tournament window.

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
	installSatelliteHost,
	type MockSettlement,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { assertDeleteDoc, assertSetDoc } from '#satellite/index.ts';
import {
	claimTournamentPrizeFn,
	triggerTournamentDrawFn
} from '#satellite/services/tournament.services.ts';
import { candidMethod } from '#satellite/utils/candid.utils.ts';
import { Principal } from '@icp-sdk/core/principal';
import { IcrcLedgerIdl } from '@junobuild/functions/canisters/ledger/icrc';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const user = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));

const octoberStartMs = Date.UTC(2026, 9, 1);
const tournamentEndMs = octoberStartMs + 4 * TOURNAMENT_ROUND_DURATION_MS;

const tournament: TournamentDoc = {
	id: '2026-10',
	monthStartMs: octoberStartMs,
	monthEndMs: tournamentEndMs,
	bracketSize: TOURNAMENT_BRACKET_SIZE,
	state: 'in_flight',
	seededLeagueIds: Array.from({ length: TOURNAMENT_BRACKET_SIZE }, (_, i) => `league-${i}`),
	createdAtMs: octoberStartMs + 1_000
};

const finalWindow = roundWindow({ tournamentMonthStartMs: octoberStartMs, round: 'final' });

const finalMatch: TournamentMatchDoc = {
	tournamentId: tournament.id,
	round: 'final',
	index: 0,
	fromLeagueId: 'league-0',
	toLeagueId: 'league-1',
	fromStartCalls: null,
	fromStartWins: null,
	toStartCalls: null,
	toStartWins: null,
	fromAcc: null,
	toAcc: null,
	winnerLeagueId: null,
	startMs: finalWindow.startMs,
	endMs: finalWindow.endMs
};

describe('triggerTournamentDrawFn', () => {
	const monthAnchorNow = '2026-12';
	const decemberStartMs = Date.UTC(2026, 11, 1);
	const drawMs = decemberStartMs + DAY_IN_MS;
	const leagueIds = Array.from({ length: TOURNAMENT_BRACKET_SIZE }, (_, i) => `seed-${i}`);

	let host: SatelliteHost;
	let settlements: MockSettlement[];

	/** The `index`-th member principal of seed league `seed`. */
	const memberOf = ({ seed, index }: { seed: number; index: number }): Principal =>
		Principal.fromUint8Array(new Uint8Array([9, seed, index]));

	beforeEach(() => {
		settlements = [];
		host = installSatelliteHost();
		host.setCaller(user);
		host.setNowMs(drawMs);
		answerSettlementAccuracy({ host, settlements });

		// Seed league i has 32 - i members, so raw member count ranks them in id order.
		leagueIds.forEach((leagueId, seed) => {
			host.putDoc({
				collection: Collection.LEAGUES,
				key: leagueId,
				data: { id: leagueId, name: leagueId },
				owner: controller
			});

			for (let index = 0; index < 32 - seed; index += 1) {
				const member = memberOf({ seed, index });
				const doc: LeagueMemberDoc = {
					leagueId,
					member: member.toText(),
					role: 'member',
					joinedAtMs: decemberStartMs - 60 * DAY_IN_MS
				};

				host.putDoc({
					collection: Collection.LEAGUE_MEMBERS,
					key: `${leagueId}/${member.toText()}`,
					data: doc,
					owner: member
				});
			}
		});
	});

	afterEach(() => {
		host.restore();
	});

	it('seeds by members with a settled call in the month before the draw, not by member count', async () => {
		// Seed i has i + 1 members who settled in November: the reverse of its size.
		leagueIds.forEach((_, seed) => {
			for (let index = 0; index <= seed; index += 1) {
				settlements.push({
					principal: memberOf({ seed, index }),
					atMs: decemberStartMs - DAY_IN_MS,
					calls: 1,
					wins: 0
				});
			}
		});

		// Settled history outside November lifts nobody.
		for (let index = 0; index < 32; index += 1) {
			for (const atMs of [decemberStartMs, decemberStartMs - 40 * DAY_IN_MS]) {
				settlements.push({ principal: memberOf({ seed: 0, index }), atMs, calls: 1, wins: 0 });
			}
		}

		const result = await triggerTournamentDrawFn({ monthAnchor: monthAnchorNow });

		assert.deepEqual(result, { ok: true, tournamentId: monthAnchorNow });
		assert.deepEqual(
			host.readDoc<TournamentDoc>({ collection: Collection.TOURNAMENTS, key: monthAnchorNow })
				?.seededLeagueIds,
			[...leagueIds].reverse()
		);
	});

	it('writes nothing when another draw lands during the clearing read', async () => {
		const { argTypes, result } = candidMethod({
			canister: 'clearing',
			method: 'aggregate_settlement_accuracy'
		});

		host.onCall({
			method: 'aggregate_settlement_accuracy',
			argTypes,
			result,
			handler: () => {
				host.putDoc({
					collection: Collection.TOURNAMENTS,
					key: monthAnchorNow,
					data: { ...tournament, id: monthAnchorNow },
					owner: controller
				});

				return [];
			}
		});

		const drawn = await triggerTournamentDrawFn({ monthAnchor: monthAnchorNow });

		assert.deepEqual(drawn, { ok: false, reason: 'already_drawn', tournamentId: monthAnchorNow });
		assert.deepEqual(host.keys(Collection.TOURNAMENT_MATCHES), []);
	});
});

describe('claimTournamentPrizeFn', () => {
	const tournamentId = tournament.id;
	const drawnAtMs = tournament.createdAtMs;
	const winner = 'league-w';
	const member = Principal.fromUint8Array(new Uint8Array([6, 6, 6]));

	let host: SatelliteHost;
	let settlements: MockSettlement[];

	beforeEach(() => {
		settlements = [];
		host = installSatelliteHost({
			asserts: { set: assertSetDoc.assert, remove: assertDeleteDoc.assert }
		});
		host.setCaller(member);
		host.setNowMs(tournamentEndMs + DAY_IN_MS);
		answerSettlementAccuracy({ host, settlements });
		host.onCall({
			method: 'icrc1_transfer',
			argTypes: [IcrcLedgerIdl.TransferArg],
			result: IcrcLedgerIdl.TransferResult,
			handler: () => ({ Ok: BigInt(7) })
		});

		host.putDoc({
			collection: Collection.TOURNAMENTS,
			key: tournamentId,
			data: { ...tournament, state: 'concluded' },
			owner: controller,
			createdAtMs: drawnAtMs
		});
		host.putDoc({
			collection: Collection.TOURNAMENT_MATCHES,
			key: tournamentMatchKey({ tournamentId, round: 'final', index: 0 }),
			data: { ...finalMatch, fromLeagueId: winner, winnerLeagueId: winner },
			owner: controller,
			createdAtMs: drawnAtMs
		});

		const doc: LeagueMemberDoc = {
			leagueId: winner,
			member: member.toText(),
			role: 'member',
			joinedAtMs: drawnAtMs - 1
		};

		host.putDoc({
			collection: Collection.LEAGUE_MEMBERS,
			key: `${winner}/${member.toText()}`,
			data: doc,
			owner: member,
			createdAtMs: drawnAtMs - 1
		});
	});

	afterEach(() => {
		host.restore();
	});

	it('pays nothing to a pre-draw member with no call settled inside the tournament window', async () => {
		settlements.push({ principal: member, atMs: octoberStartMs - 1, calls: 5, wins: 5 });
		settlements.push({ principal: member, atMs: tournamentEndMs, calls: 5, wins: 5 });

		const result = await claimTournamentPrizeFn({ tournamentId });

		assert.deepEqual(result, { ok: false, reason: 'not_member_of_top_league' });
		assert.ok(!host.calls().includes('icrc1_transfer'));
		assert.deepEqual(host.keys(Collection.VXP_AWARDS), []);
	});

	it('pays a pre-draw member with one call settled inside the tournament window', async () => {
		settlements.push({ principal: member, atMs: tournamentEndMs - 1, calls: 1, wins: 0 });

		const result = await claimTournamentPrizeFn({ tournamentId });

		assert.deepEqual(result, {
			ok: true,
			awardsCreated: 1,
			awardsAlreadyClaimed: 0,
			totalVxpCredited: 5000
		});
		assert.ok(host.calls().includes('icrc1_transfer'));
	});

	it('pays nothing to a member who joined the winner after the draw', async () => {
		settlements.push({ principal: member, atMs: tournamentEndMs - 1, calls: 1, wins: 0 });
		host.putDoc({
			collection: Collection.LEAGUE_MEMBERS,
			key: `${winner}/${member.toText()}`,
			data: { leagueId: winner, member: member.toText(), role: 'member', joinedAtMs: 1 },
			owner: member,
			createdAtMs: drawnAtMs + 1
		});

		const result = await claimTournamentPrizeFn({ tournamentId });

		assert.deepEqual(result, { ok: false, reason: 'not_member_of_top_league' });
		assert.deepEqual(host.calls(), []);
		assert.deepEqual(host.keys(Collection.VXP_AWARDS), []);
	});

	it('pays nothing to an active pre-draw member of a league that did not place', async () => {
		const outsider = Principal.fromUint8Array(new Uint8Array([6, 6, 7]));

		settlements.push({ principal: outsider, atMs: tournamentEndMs - 1, calls: 1, wins: 0 });
		host.putDoc({
			collection: Collection.LEAGUE_MEMBERS,
			key: `league-5/${outsider.toText()}`,
			data: { leagueId: 'league-5', member: outsider.toText(), role: 'member', joinedAtMs: 1 },
			owner: outsider,
			createdAtMs: drawnAtMs - 1
		});
		host.setCaller(outsider);

		const result = await claimTournamentPrizeFn({ tournamentId });

		assert.deepEqual(result, { ok: false, reason: 'not_member_of_top_league' });
		assert.deepEqual(host.calls(), []);
		assert.deepEqual(host.keys(Collection.VXP_AWARDS), []);
	});
});
