import { Collection } from '#lib/constants/collections.constants.ts';
import {
	controller,
	deleteContext,
	installSatelliteHost,
	setContext,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { assertProfile, assertProfileOwner } from '#satellite/services/profile.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const owner = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));
const stranger = Principal.fromUint8Array(new Uint8Array([3, 3, 3]));

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
});
