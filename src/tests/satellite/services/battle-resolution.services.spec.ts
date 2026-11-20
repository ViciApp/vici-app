import { Collection } from '#lib/constants/collections.constants.ts';
import { DAY_IN_MS } from '#lib/constants/time.constants.ts';
import type { BattleDoc } from '#lib/types/battle.ts';
import type { LeagueMemberDoc } from '#lib/types/league-member.ts';
import {
	answerSettlementAccuracy,
	controller,
	installSatelliteHost,
	type MockSettlement,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import {
	readBattleLiveScoreFn,
	resolveBattleFromSettlementsFn
} from '#satellite/services/battle-resolution.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const leagueA = 'league-a';
const leagueB = 'league-b';
const ownerA = Principal.fromUint8Array(new Uint8Array([3, 3, 3]));
const ownerB = Principal.fromUint8Array(new Uint8Array([4, 4, 4]));
const lateJoiner = Principal.fromUint8Array(new Uint8Array([5, 5, 5]));

const kickoffMs = Date.UTC(2026, 9, 5);
const settleMs = kickoffMs + 7 * DAY_IN_MS;
const battleId = 'battle-late-joiner';

describe('league battle scoring', () => {
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

	beforeEach(() => {
		settlements = [];
		host = installSatelliteHost();
		host.setCaller(ownerA);
		answerSettlementAccuracy({ host, settlements });

		const battle: BattleDoc = {
			id: battleId,
			kind: 'league',
			sideA: leagueA,
			sideB: leagueB,
			proposer: ownerA.toText(),
			state: 'in_flight',
			kickoffMs,
			settleMs,
			scope: 'all'
		};

		host.putDoc({
			collection: Collection.BATTLES,
			key: battleId,
			data: battle,
			owner: controller,
			createdAtMs: kickoffMs
		});

		joinLeague({ leagueId: leagueA, member: ownerA, joinedAtMs: kickoffMs - DAY_IN_MS });
		joinLeague({ leagueId: leagueB, member: ownerB, joinedAtMs: kickoffMs - DAY_IN_MS });
		joinLeague({ leagueId: leagueA, member: lateJoiner, joinedAtMs: kickoffMs + DAY_IN_MS });

		settlements.push({ principal: ownerA, atMs: kickoffMs + 1_000, calls: 10, wins: 5 });
		settlements.push({ principal: ownerB, atMs: kickoffMs + 1_000, calls: 10, wins: 6 });
		settlements.push({ principal: lateJoiner, atMs: kickoffMs + 2_000, calls: 50, wins: 50 });
	});

	afterEach(() => {
		host.restore();
	});

	it('leaves a member who joined after kickoff out of the live score', async () => {
		host.setNowMs(kickoffMs + 2 * DAY_IN_MS);

		const live = await readBattleLiveScoreFn({ battleId });

		assert.deepEqual(live, { scoreA: 50, scoreB: 60, callsA: 10, callsB: 10, leader: 'B' });
	});

	it('resolves on the members who joined before kickoff', async () => {
		host.setNowMs(settleMs);

		const resolved = await resolveBattleFromSettlementsFn({ battleId });

		assert.equal(resolved.callsA, 10);
		assert.equal(resolved.callsB, 10);
		assert.equal(resolved.winner, 'B');
	});
});
