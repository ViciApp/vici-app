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
		host = installSatelliteHost({ docs: { [Collection.LEAGUES]: { [league.id]: league } } });
	});

	afterEach(() => host.restore());

	describe('assertSetLeagueMember', () => {
		it('rejects a self-join that grants admin', () => {
			assert.throws(
				() => assertSetLeagueMember(join({ caller: joiner, role: 'admin' })),
				/joinLeagueByInvite/
			);
		});

		it('rejects a user joining without the invite code', () => {
			assert.throws(
				() => assertSetLeagueMember(join({ caller: joiner, role: 'member' })),
				/joinLeagueByInvite/
			);
		});

		it('lets the satellite add a member who joined with the invite code', () => {
			assert.doesNotThrow(() =>
				assertSetLeagueMember(join({ caller: controller, role: 'member' }))
			);
			assert.throws(
				() => assertSetLeagueMember(join({ caller: controller, role: 'admin' })),
				/role="member"/
			);
		});

		it('lets the owner write their own row when the league is created', () => {
			assert.doesNotThrow(() =>
				assertSetLeagueMember(
					setContext({
						caller: owner,
						collection: Collection.LEAGUE_MEMBERS,
						key: leagueMemberKey({ leagueId: league.id, memberPrincipal: owner.toText() }),
						proposed: membership({ member: owner, role: 'owner' })
					})
				)
			);
		});

		it('rejects the owner creating a row for someone who has not joined', () => {
			assert.throws(
				() => assertSetLeagueMember(join({ caller: owner, role: 'member' })),
				/joinLeagueByInvite/
			);
			assert.throws(
				() => assertSetLeagueMember(join({ caller: owner, role: 'admin' })),
				/joinLeagueByInvite/
			);
		});

		it('lets the owner change the role of an existing member', () => {
			assert.doesNotThrow(() =>
				assertSetLeagueMember(
					setContext({
						caller: owner,
						collection: Collection.LEAGUE_MEMBERS,
						key: leagueMemberKey({ leagueId: league.id, memberPrincipal: joiner.toText() }),
						current: membership({ member: joiner, role: 'member' }),
						currentOwner: joiner,
						proposed: membership({ member: joiner, role: 'admin' })
					})
				)
			);
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
