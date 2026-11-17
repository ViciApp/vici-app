import { Collection } from '#lib/constants/collections.constants.ts';
import { ActivityType } from '#lib/enums/social.ts';
import {
	controller,
	deleteContext,
	installSatelliteHost,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { assertDeleteActivity } from '#satellite/services/activity.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const actor = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));
const stranger = Principal.fromUint8Array(new Uint8Array([4, 4, 4]));

const timestamp = 1_700_000_000_000;
const activityKey = `${actor.toText()}#${timestamp}#${ActivityType.TRADE}`;

describe('activity.services', () => {
	let host: SatelliteHost;

	beforeEach(() => {
		host = installSatelliteHost();
	});

	afterEach(() => host.restore());

	describe('assertDeleteActivity', () => {
		const remove = (caller: Principal) =>
			deleteContext({
				caller,
				collection: Collection.ACTIVITIES,
				key: activityKey,
				current: { user: actor.toText(), type: ActivityType.TRADE, timestamp },
				currentOwner: actor
			});

		it("rejects deleting another user's activity", () => {
			assert.throws(
				() => assertDeleteActivity(remove(stranger)),
				/only the owner or the satellite/
			);
		});

		it('lets the actor and a satellite controller delete it', () => {
			assert.doesNotThrow(() => assertDeleteActivity(remove(actor)));
			assert.doesNotThrow(() => assertDeleteActivity(remove(controller)));
		});
	});
});
