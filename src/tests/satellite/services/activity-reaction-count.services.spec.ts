import { Collection } from '#lib/constants/collections.constants.ts';
import { ActivityType } from '#lib/enums/social.ts';
import { UserRole } from '#lib/enums/user.ts';
import type { ActivityReactionCount } from '#lib/types/social.ts';
import {
	controller,
	installSatelliteHost,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { recomputeActivityReactionCountsFn } from '#satellite/services/activity-reaction-count.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const actor = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));
const liker = Principal.fromUint8Array(new Uint8Array([3, 3, 3]));

const activityKeys = Array.from(
	{ length: 7 },
	(_, index) => `${actor.toText()}#${1_700_000_000_000 + index}#${ActivityType.TRADE}`
);

describe('recomputeActivityReactionCountsFn', () => {
	let host: SatelliteHost;

	const count = (activityKey: string): number | undefined =>
		host.readDoc<ActivityReactionCount>({
			collection: Collection.ACTIVITY_REACTION_COUNTS,
			key: activityKey
		})?.count;

	beforeEach(() => {
		host = installSatelliteHost();

		host.putDoc({
			collection: Collection.ROLES,
			key: controller.toText(),
			data: { role: UserRole.ADMIN },
			owner: controller
		});

		for (const activityKey of activityKeys) {
			host.putDoc({
				collection: Collection.ACTIVITY_REACTIONS,
				key: `${activityKey}#${liker.toText()}`,
				data: { activityKey },
				owner: liker
			});
		}
	});

	afterEach(() => host.restore());

	it('rewrites the off-target counters a bounded batch per call until all are exact', () => {
		assert.deepEqual(recomputeActivityReactionCountsFn(), { recomputed: 5 });
		assert.deepEqual(recomputeActivityReactionCountsFn(), { recomputed: 2 });
		assert.deepEqual(recomputeActivityReactionCountsFn(), { recomputed: 0 });
		assert.deepEqual(
			activityKeys.map((activityKey) => count(activityKey)),
			activityKeys.map(() => 1)
		);
	});

	it('corrects a counter that drifted above its likes', () => {
		const [activityKey] = activityKeys;

		host.putDoc({
			collection: Collection.ACTIVITY_REACTION_COUNTS,
			key: activityKey,
			data: { activityKey, count: 4, updatedAtMs: 1 },
			owner: controller
		});

		while (recomputeActivityReactionCountsFn().recomputed > 0) {
			// Each round repairs a bounded batch; the loop ends once every counter is exact.
		}

		assert.equal(count(activityKey), 1);
	});

	it('refuses a caller who is not an admin', () => {
		host.setCaller(liker);

		assert.throws(() => recomputeActivityReactionCountsFn(), /Only an admin/);
	});
});
