import { Collection } from '#lib/constants/collections.constants.ts';
import { UserRole } from '#lib/enums/user.ts';
import {
	controller,
	deleteContext,
	installSatelliteHost,
	setContext,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import {
	getUserRankAndCountFn,
	listLeaderboard
} from '#satellite/services/leaderboard.services.ts';
import {
	assertProfile,
	assertProfileOwner,
	getProfile
} from '#satellite/services/profile.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const owner = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));
const stranger = Principal.fromUint8Array(new Uint8Array([3, 3, 3]));
const admin = Principal.fromUint8Array(new Uint8Array([4, 4, 4]));

const profile = { owner: owner.toText(), nickname: 'owner', points: 10 };

describe('profile.services', () => {
	let host: SatelliteHost;

	beforeEach(() => {
		host = installSatelliteHost();
	});

	afterEach(() => host.restore());

	describe('assertProfile', () => {
		const update = (caller: Principal) =>
			setContext({
				caller,
				collection: Collection.PROFILES,
				key: owner.toText(),
				current: profile,
				currentOwner: owner,
				proposed: { ...profile, deletedAtMs: 1 }
			});

		it("rejects a write to another user's profile", () => {
			assert.throws(() => assertProfile(update(stranger)), /only the owner or the satellite/);
		});

		it('lets the owner update their profile', () => {
			assert.doesNotThrow(() => assertProfile(update(owner)));
		});

		it('lets a satellite controller update a profile', () => {
			assert.doesNotThrow(() => assertProfile(update(controller)));
		});

		it("rejects a profile whose owner field is not the doc key's principal", () => {
			const forged = (current?: object) =>
				setContext({
					caller: owner,
					collection: Collection.PROFILES,
					key: owner.toText(),
					current,
					currentOwner: owner,
					proposed: { ...profile, owner: admin.toText() }
				});

			assert.throws(() => assertProfile(forged()), /owner must be the doc key/);
			assert.throws(() => assertProfile(forged(profile)), /owner must be the doc key/);
		});
	});

	describe('assertProfile on schoolStatus', () => {
		const write = ({
			caller,
			current,
			schoolStatus
		}: {
			caller: Principal;
			current?: object;
			schoolStatus?: string;
		}) =>
			setContext({
				caller,
				collection: Collection.PROFILES,
				key: owner.toText(),
				current,
				currentOwner: owner,
				proposed: { ...profile, schoolStatus }
			});

		it('rejects the owner setting it on a new profile', () => {
			assert.throws(
				() => assertProfile(write({ caller: owner, schoolStatus: 'verified' })),
				/schoolStatus is set by the satellite/
			);
		});

		it('rejects the owner changing or clearing the stored value', () => {
			assert.throws(
				() => assertProfile(write({ caller: owner, current: profile, schoolStatus: 'verified' })),
				/schoolStatus is set by the satellite/
			);
			assert.throws(
				() =>
					assertProfile(
						write({ caller: owner, current: { ...profile, schoolStatus: 'verified' } })
					),
				/schoolStatus is set by the satellite/
			);
		});

		it('lets the owner keep the stored value', () => {
			assert.doesNotThrow(() =>
				assertProfile(
					write({
						caller: owner,
						current: { ...profile, schoolStatus: 'verified' },
						schoolStatus: 'verified'
					})
				)
			);
		});

		it('lets a satellite controller set it', () => {
			assert.doesNotThrow(() =>
				assertProfile(write({ caller: controller, current: profile, schoolStatus: 'verified' }))
			);
		});
	});

	describe('assertProfileOwner', () => {
		const remove = (caller: Principal) =>
			deleteContext({
				caller,
				collection: Collection.PROFILES,
				key: owner.toText(),
				current: profile,
				currentOwner: owner
			});

		it("rejects deleting another user's profile", () => {
			assert.throws(() => assertProfileOwner(remove(stranger)), /only the owner or the satellite/);
		});

		it('lets the owner and a controller delete the profile', () => {
			assert.doesNotThrow(() => assertProfileOwner(remove(owner)));
			assert.doesNotThrow(() => assertProfileOwner(remove(controller)));
		});
	});

	describe('a stored profile whose owner field names another principal', () => {
		beforeEach(() => {
			host.putDoc({
				collection: Collection.ROLES,
				key: admin.toText(),
				data: { role: UserRole.ADMIN },
				owner: controller
			});
			host.putDoc({
				collection: Collection.PROFILES,
				key: owner.toText(),
				data: { ...profile, owner: admin.toText(), points: 99 },
				owner
			});
			host.setCaller(stranger);
		});

		it("reads as the doc key's principal, without the other principal's role", () => {
			const read = getProfile(owner.toText());

			assert.equal(read?.owner, owner.toText());
			assert.equal(read?.role, undefined);
		});

		it("ranks and lists under the doc key, without the other principal's role", () => {
			const [top] = listLeaderboard();

			assert.equal(top?.owner, owner.toText());
			assert.equal(top?.role, undefined);
			assert.deepEqual(getUserRankAndCountFn({ principal: admin.toText() }), {
				rank: undefined,
				count: 1
			});
		});
	});
});
