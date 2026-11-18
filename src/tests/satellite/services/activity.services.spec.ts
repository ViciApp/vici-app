import { Collection } from '#lib/constants/collections.constants.ts';
import { ActivityType } from '#lib/enums/social.ts';
import { UserRole } from '#lib/enums/user.ts';
import {
	controller,
	deleteContext,
	installSatelliteHost,
	setContext,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { assertDeleteActivity, assertSetActivity } from '#satellite/services/activity.services.ts';
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

	describe('assertSetActivity on a settlement', () => {
		const settlement = (caller: Principal) =>
			setContext({
				caller,
				collection: Collection.ACTIVITIES,
				key: `${caller.toText()}#${timestamp}#${ActivityType.SETTLEMENT}`,
				proposed: {
					user: caller.toText(),
					type: ActivityType.SETTLEMENT,
					marketId: 'series-1',
					title: 'Market Resolved: YES',
					timestamp
				}
			});

		it('rejects a caller whose role cannot settle', () => {
			host.putDoc({
				collection: Collection.ROLES,
				key: stranger.toText(),
				data: { role: UserRole.CREATOR },
				owner: controller
			});

			assert.throws(() => assertSetActivity(settlement(actor)), /settle markets/);
			assert.throws(() => assertSetActivity(settlement(stranger)), /settle markets/);
		});

		it('lets a settling role record it', () => {
			for (const role of [UserRole.ADMIN, UserRole.SOLVER]) {
				host.putDoc({
					collection: Collection.ROLES,
					key: actor.toText(),
					data: { role },
					owner: controller
				});

				assert.doesNotThrow(() => assertSetActivity(settlement(actor)));
			}
		});
	});
});
