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
import { assertDeleteDoc, assertSetDoc } from '#satellite/index.ts';
import {
	assertDeleteLeague,
	assertSetLeague,
	transferLeagueOwnershipFn
} from '#satellite/services/league.services.ts';
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
		it('rejects a new league that stores its invite code on the public doc', () => {
			const { inviteCode: _legacyCode, ...withoutCode } = league;

			assert.throws(
				() =>
					assertSetLeague(
						setContext({
							caller: owner,
							collection: Collection.LEAGUES,
							key: league.id,
							proposed: league
						})
					),
				/invite code/
			);
			assert.doesNotThrow(() =>
				assertSetLeague(
					setContext({
						caller: owner,
						collection: Collection.LEAGUES,
						key: league.id,
						proposed: withoutCode
					})
				)
			);
		});

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

		it('rejects the owner handing the league over with a direct write', () => {
			assert.throws(() => assertSetLeague(handOver(owner)), /transferLeagueOwnership/);
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

	describe('transferLeagueOwnershipFn', () => {
		const { inviteCode: _legacyCode, ...current } = league;

		const memberRow = ({
			principal,
			role
		}: {
			principal: Principal;
			role: LeagueMemberDoc['role'];
		}) =>
			host.putDoc({
				collection: Collection.LEAGUE_MEMBERS,
				key: leagueMemberKey({ leagueId: league.id, memberPrincipal: principal.toText() }),
				data: { leagueId: league.id, member: principal.toText(), joinedAtMs: 1, role },
				owner: principal
			});

		const role = (principal: Principal) =>
			host.readDoc<LeagueMemberDoc>({
				collection: Collection.LEAGUE_MEMBERS,
				key: leagueMemberKey({ leagueId: league.id, memberPrincipal: principal.toText() })
			})?.role;

		beforeEach(() => {
			host.restore();
			// The real asserts run on every serverless write, as on the satellite.
			host = installSatelliteHost({
				asserts: { set: assertSetDoc.assert, remove: assertDeleteDoc.assert }
			});
			host.putDoc({ collection: Collection.LEAGUES, key: league.id, data: current, owner });
			memberRow({ principal: owner, role: 'owner' });
			memberRow({ principal: member, role: 'member' });
		});

		it('hands the league to a member and swaps the member roles', () => {
			host.setCaller(owner);

			assert.deepEqual(
				transferLeagueOwnershipFn({ leagueId: league.id, newOwnerPrincipal: member.toText() }),
				{ ok: true }
			);
			assert.equal(
				host.readDoc<LeagueDoc>({ collection: Collection.LEAGUES, key: league.id })?.owner,
				member.toText()
			);
			assert.equal(role(member), 'owner');
			assert.equal(role(owner), 'admin');
		});

		it('refuses a new owner who is not a member', () => {
			host.setCaller(owner);

			assert.deepEqual(
				transferLeagueOwnershipFn({ leagueId: league.id, newOwnerPrincipal: stranger.toText() }),
				{ ok: false, reason: 'new_owner_not_member' }
			);
			assert.equal(
				host.readDoc<LeagueDoc>({ collection: Collection.LEAGUES, key: league.id })?.owner,
				owner.toText()
			);
		});
	});
});
