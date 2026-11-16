import { Collection } from '#lib/constants/collections.constants.ts';
import type { LeagueDoc } from '#lib/types/league.ts';
import {
	controller,
	deleteContext,
	installSatelliteHost,
	setContext,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { assertDeleteLeague, assertSetLeague } from '#satellite/services/league.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const owner = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));
const member = Principal.fromUint8Array(new Uint8Array([3, 3, 3]));
const stranger = Principal.fromUint8Array(new Uint8Array([4, 4, 4]));

const league: LeagueDoc = {
	id: 'the-league-1',
	name: 'The League',
	inviteCode: 'ABC123',
	owner: owner.toText(),
	createdAtMs: 1_700_000_000_000
};

describe('league.services', () => {
	let host: SatelliteHost;

	beforeEach(() => {
		host = installSatelliteHost();
	});

	afterEach(() => host.restore());

	describe('assertDeleteLeague', () => {
		const remove = (caller: Principal) =>
			deleteContext({
				caller,
				collection: Collection.LEAGUES,
				key: league.id,
				current: league,
				currentOwner: owner
			});

		it("rejects deleting another user's league", () => {
			assert.throws(() => assertDeleteLeague(remove(stranger)), /only the owner or the satellite/);
		});

		it('lets the owner and a satellite controller delete the league', () => {
			assert.doesNotThrow(() => assertDeleteLeague(remove(owner)));
			assert.doesNotThrow(() => assertDeleteLeague(remove(controller)));
		});
	});

	describe('assertSetLeague', () => {
		const handOver = (caller: Principal) =>
			setContext({
				caller,
				collection: Collection.LEAGUES,
				key: league.id,
				current: league,
				currentOwner: owner,
				proposed: { ...league, owner: member.toText() }
			});

		it('rejects a non-owner handing the league over', () => {
			assert.throws(() => assertSetLeague(handOver(stranger)), /current owner/);
		});

		it('lets a satellite controller hand the league over', () => {
			assert.doesNotThrow(() => assertSetLeague(handOver(controller)));
		});

		it('still holds a controller to the immutable fields', () => {
			assert.throws(
				() =>
					assertSetLeague(
						setContext({
							caller: controller,
							collection: Collection.LEAGUES,
							key: league.id,
							current: league,
							proposed: { ...league, inviteCode: 'XYZ789' }
						})
					),
				/immutable/
			);
		});
	});
});
