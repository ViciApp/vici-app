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

	const recomputeUntilDone = (limit?: number) => {
		const calls = [recomputeActivityReactionCountsFn({ limit })];
		let [last] = calls;

		while (!last.done) {
			assert.ok(calls.length < 30, 'the repair ends');

			last = recomputeActivityReactionCountsFn({ afterKey: last.nextAfterKey, limit });
			calls.push(last);
		}

		return calls;
	};

	it('backfills the missing counters a bounded batch per call, resuming after the cursor', () => {
		const calls = recomputeUntilDone();

		assert.ok(calls.every(({ recomputed }) => recomputed <= 5));
		assert.equal(
			calls.reduce((sum, { recomputed }) => sum + recomputed, 0),
			7
		);
		assert.deepEqual(
			activityKeys.map((activityKey) => count(activityKey)),
			activityKeys.map(() => 1)
		);
		assert.ok(
			recomputeUntilDone().every(({ recomputed }) => recomputed === 0),
			'a second repair finds every counter exact'
		);
	});

	it('corrects counters that drifted above and below their likes', () => {
		const [activityKey] = activityKeys;
		const unliked = `${actor.toText()}#1600000000000#${ActivityType.TRADE}`;

		for (const [key, drifted] of [
			[activityKey, 4],
			[unliked, 2]
		] as const) {
			host.putDoc({
				collection: Collection.ACTIVITY_REACTION_COUNTS,
				key,
				data: { activityKey: key, count: drifted, updatedAtMs: 1 },
				owner: controller
			});
		}

		recomputeUntilDone();

		assert.equal(count(activityKey), 1);
		assert.equal(count(unliked), 0);
	});

	it('reads one page of `limit` docs per call', () => {
		const calls = recomputeUntilDone(1);

		assert.ok(calls.every(({ recomputed }) => recomputed <= 1));
		assert.ok(calls.length > activityKeys.length);
		assert.deepEqual(
			activityKeys.map((activityKey) => count(activityKey)),
			activityKeys.map(() => 1)
		);
	});

	it('refuses a caller who is not an admin', () => {
		host.setCaller(liker);

		assert.throws(() => recomputeActivityReactionCountsFn(), /Only an admin/);
	});
});
