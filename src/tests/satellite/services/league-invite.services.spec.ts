import { Collection } from '#lib/constants/collections.constants.ts';
import { LeaguePrivacy } from '#lib/enums/league.ts';
import { UserRole } from '#lib/enums/user.ts';
import { leagueMemberKey, type LeagueMemberDoc } from '#lib/types/league-member.ts';
import type { LeagueDoc } from '#lib/types/league.ts';
import {
	installSatelliteHost,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { assertDeleteDoc, assertSetDoc } from '#satellite/index.ts';
import { listMyLeaguesFn, lookupLeagueByInviteFn } from '#satellite/services/cohort.services.ts';
import {
	createLeagueFn,
	joinLeagueByInviteFn,
	migrateLeagueInviteCodesFn
} from '#satellite/services/league.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import { IcrcLedgerIdl } from '@junobuild/functions/canisters/ledger/icrc';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const owner = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));
const joiner = Principal.fromUint8Array(new Uint8Array([3, 3, 3]));
const admin = Principal.fromUint8Array(new Uint8Array([4, 4, 4]));

const leagueId = 'the-league-1700000000000';
const inviteCode = 'ABC123';

describe('league invites', () => {
	let host: SatelliteHost;

	const create = async ({ id = leagueId }: { id?: string } = {}) => {
		host.setCaller(owner);

		return await createLeagueFn({
			id,
			name: 'The League',
			privacy: LeaguePrivacy.PRIVATE,
			inviteCode
		});
	};

	const join = ({ principal, code }: { principal: Principal; code: string }) => {
		host.setCaller(principal);

		return joinLeagueByInviteFn({ inviteCode: code });
	};

	const migrate = (principal: Principal) => {
		host.setCaller(principal);

		return migrateLeagueInviteCodesFn();
	};

	const membership = (member: Principal): LeagueMemberDoc | undefined =>
		host.readDoc<LeagueMemberDoc>({
			collection: Collection.LEAGUE_MEMBERS,
			key: leagueMemberKey({ leagueId, memberPrincipal: member.toText() })
		});

	const storedCode = (): string | undefined =>
		host.readDoc<LeagueDoc>({ collection: Collection.LEAGUES, key: leagueId })?.inviteCode;

	beforeEach(() => {
		// The real asserts run on every serverless write, as on the satellite.
		host = installSatelliteHost({
			asserts: { set: assertSetDoc.assert, remove: assertDeleteDoc.assert }
		});
		host.onCall({
			method: 'icrc1_transfer',
			argTypes: [IcrcLedgerIdl.TransferArg],
			result: IcrcLedgerIdl.TransferResult,
			handler: () => ({ Ok: BigInt(7) })
		});
	});

	afterEach(() => host.restore());

	it('keeps the invite code off the public league doc and its public reads', async () => {
		const created = await create();

		assert.equal(created.reason, undefined);
		assert.equal(created.league?.inviteCode, inviteCode);
		assert.equal(storedCode(), undefined);
		assert.equal(membership(owner)?.role, 'owner');

		host.setCaller(joiner);
		assert.equal(lookupLeagueByInviteFn({ inviteCode })?.inviteCode, undefined);

		host.setCaller(owner);
		assert.equal(listMyLeaguesFn()[0]?.league.inviteCode, inviteCode);
	});

	it('lets a user into a private league only with its invite code', async () => {
		await create();

		assert.equal(join({ principal: joiner, code: 'ZZZ999' }).reason, 'not_found');
		assert.equal(membership(joiner), undefined);

		assert.equal(join({ principal: joiner, code: inviteCode }).league?.id, leagueId);
		assert.equal(membership(joiner)?.role, 'member');
		assert.equal(join({ principal: joiner, code: inviteCode }).reason, 'already_member');
	});

	it('refuses an invite code another league already holds', async () => {
		await create();

		const second = await create({ id: 'another-1700000000001' });

		assert.equal(second.reason, 'invite_code_taken');
		assert.equal(
			host.readDoc({ collection: Collection.LEAGUES, key: 'another-1700000000001' }),
			undefined
		);
	});

	it('moves a legacy invite code off the public doc without breaking its joins', () => {
		host.putDoc({
			collection: Collection.LEAGUES,
			key: leagueId,
			data: { id: leagueId, name: 'Legacy', inviteCode, owner: owner.toText(), createdAtMs: 1 },
			owner
		});
		host.putDoc({
			collection: Collection.ROLES,
			key: admin.toText(),
			data: { role: UserRole.ADMIN },
			owner: admin
		});

		assert.equal(join({ principal: joiner, code: inviteCode }).league?.id, leagueId);
		assert.throws(() => migrate(joiner), /admin/);
		assert.equal(migrate(admin).migrated, 1);
		assert.equal(storedCode(), undefined);
		assert.equal(join({ principal: admin, code: inviteCode }).league?.id, leagueId);
		assert.equal(migrate(admin).migrated, 0);
	});

	it('migrates a legacy league stored under the retired invite-only tier', () => {
		host.putDoc({
			collection: Collection.LEAGUES,
			key: leagueId,
			data: {
				id: leagueId,
				name: 'Legacy',
				inviteCode,
				privacy: 'invite',
				owner: owner.toText(),
				createdAtMs: 1
			},
			owner
		});
		host.putDoc({
			collection: Collection.ROLES,
			key: admin.toText(),
			data: { role: UserRole.ADMIN },
			owner: admin
		});

		assert.equal(migrate(admin).migrated, 1);
		assert.equal(storedCode(), undefined);
		assert.equal(
			host.readDoc<LeagueDoc>({ collection: Collection.LEAGUES, key: leagueId })?.privacy,
			LeaguePrivacy.PRIVATE
		);
		assert.equal(join({ principal: joiner, code: inviteCode }).league?.id, leagueId);
	});

	it('migrates in rounds, listing the leagues once per round', () => {
		const legacyIds = Array.from({ length: 7 }, (_, index) => `legacy-${index}-1700000000000`);

		for (const [index, id] of legacyIds.entries()) {
			host.putDoc({
				collection: Collection.LEAGUES,
				key: id,
				data: {
					id,
					name: 'Legacy',
					inviteCode: `CODE0${index}`,
					owner: owner.toText(),
					createdAtMs: 1
				},
				owner
			});
		}

		host.putDoc({
			collection: Collection.ROLES,
			key: admin.toText(),
			data: { role: UserRole.ADMIN },
			owner: admin
		});

		const globals = globalThis as unknown as Record<string, (...args: unknown[]) => unknown>;
		const listDocs = globals.__juno_satellite_datastore_list_docs_store;
		let leagueLists = 0;

		globals.__juno_satellite_datastore_list_docs_store = (...args: unknown[]) => {
			if (args[1] === Collection.LEAGUES) {
				leagueLists += 1;
			}

			return listDocs?.(...args);
		};

		assert.equal(migrate(admin).migrated, 5);
		assert.equal(leagueLists, 1);
		assert.equal(migrate(admin).migrated, 2);
		assert.equal(migrate(admin).migrated, 0);
		assert.deepEqual(
			legacyIds.map(
				(id) => host.readDoc<LeagueDoc>({ collection: Collection.LEAGUES, key: id })?.inviteCode
			),
			legacyIds.map(() => undefined)
		);
		assert.equal(
			join({ principal: joiner, code: 'CODE06' }).league?.id,
			legacyIds[legacyIds.length - 1]
		);
	});
});
