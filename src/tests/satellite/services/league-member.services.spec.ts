import { Collection } from '#lib/constants/collections.constants.ts';
import { leagueMemberKey, type LeagueMemberDoc } from '#lib/types/league-member.ts';
import type { LeagueDoc } from '#lib/types/league.ts';
import {
	controller,
	deleteContext,
	installSatelliteHost,
	setContext,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import {
	assertDeleteLeagueMember,
	assertSetLeagueMember
} from '#satellite/services/league-member.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const owner = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));
const joiner = Principal.fromUint8Array(new Uint8Array([3, 3, 3]));

const league: LeagueDoc = {
	id: 'the-league-1',
	name: 'The League',
	inviteCode: 'ABC123',
	owner: owner.toText(),
	createdAtMs: 1_700_000_000_000
};

const membership = ({
	member,
	role
}: {
	member: Principal;
	role: LeagueMemberDoc['role'];
}): LeagueMemberDoc => ({
	leagueId: league.id,
	member: member.toText(),
	joinedAtMs: 1_700_000_000_000,
	role
});

const join = ({ caller, role }: { caller: Principal; role: LeagueMemberDoc['role'] }) =>
	setContext({
		caller,
		collection: Collection.LEAGUE_MEMBERS,
		key: leagueMemberKey({ leagueId: league.id, memberPrincipal: joiner.toText() }),
		proposed: membership({ member: joiner, role })
	});

describe('league-member.services', () => {
	let host: SatelliteHost;

	beforeEach(() => {
		host = installSatelliteHost({ [Collection.LEAGUES]: { [league.id]: league } });
	});

	afterEach(() => host.restore());

	describe('assertSetLeagueMember', () => {
		it('rejects a self-join that grants admin', () => {
			assert.throws(
				() => assertSetLeagueMember(join({ caller: joiner, role: 'admin' })),
				/self-join/
			);
		});

		it('lets a user join as a member', () => {
			assert.doesNotThrow(() => assertSetLeagueMember(join({ caller: joiner, role: 'member' })));
		});

		it('lets the league owner add someone as an admin', () => {
			assert.doesNotThrow(() => assertSetLeagueMember(join({ caller: owner, role: 'admin' })));
		});
	});

	describe('assertDeleteLeagueMember', () => {
		const removeOwnerRow = (caller: Principal) =>
			deleteContext({
				caller,
				collection: Collection.LEAGUE_MEMBERS,
				key: leagueMemberKey({ leagueId: league.id, memberPrincipal: owner.toText() }),
				current: membership({ member: owner, role: 'owner' }),
				currentOwner: owner
			});

		it('rejects a member removing the owner row', () => {
			assert.throws(() => assertDeleteLeagueMember(removeOwnerRow(owner)), /owner row/);
		});

		it('lets a satellite controller remove the owner row when it disbands the league', () => {
			assert.doesNotThrow(() => assertDeleteLeagueMember(removeOwnerRow(controller)));
		});
	});
});
