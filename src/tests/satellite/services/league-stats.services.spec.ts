import { Collection } from '#lib/constants/collections.constants.ts';
import { leagueMemberKey } from '#lib/types/league-member.ts';
import type { LeagueStatsDoc } from '#lib/types/league-stats.ts';
import {
	controller,
	installSatelliteHost,
	setContext,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { assertSetLeagueStats } from '#satellite/services/league-stats.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const member = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));

const leagueId = 'the-league-1';

const stats: LeagueStatsDoc = {
	leagueId,
	totalCalls: 10,
	wins: 5,
	updatedAtMs: 1_700_000_000_000
};

describe('league-stats.services', () => {
	let host: SatelliteHost;

	beforeEach(() => {
		host = installSatelliteHost({
			docs: {
				[Collection.LEAGUE_MEMBERS]: {
					[leagueMemberKey({ leagueId, memberPrincipal: member.toText() })]: {
						leagueId,
						member: member.toText(),
						joinedAtMs: 1,
						role: 'member'
					}
				}
			}
		});
	});

	afterEach(() => host.restore());

	describe('assertSetLeagueStats', () => {
		const inflate = (caller: Principal) =>
			setContext({
				caller,
				collection: Collection.LEAGUE_STATS,
				key: leagueId,
				current: stats,
				currentOwner: member,
				proposed: { ...stats, totalCalls: 100, wins: 100 }
			});

		it("rejects a member writing their league's counters directly", () => {
			assert.throws(() => assertSetLeagueStats(inflate(member)), /only the satellite writes/);
		});

		it('lets a satellite controller move the counters', () => {
			assert.doesNotThrow(() => assertSetLeagueStats(inflate(controller)));
		});
	});
});
