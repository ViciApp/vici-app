import { Collection } from '#lib/constants/collections.constants.ts';
import {
	controller,
	installSatelliteHost,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { hardDeleteAccountFn } from '#satellite/services/account.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const purged = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));
const other = Principal.fromUint8Array(new Uint8Array([3, 3, 3]));

const purgedText = purged.toText();
const otherText = other.toText();

const otherActivityKey = `${otherText}#1700000000000#trade`;
const ownActivityKey = `${purgedText}#1700000000001#trade`;

describe('account.services', () => {
	let host: SatelliteHost;

	beforeEach(() => {
		host = installSatelliteHost();

		const put = ({ collection, key, data }: { collection: string; key: string; data: object }) =>
			host.putDoc({ collection, key, data, owner: controller });

		for (const text of [purgedText, otherText]) {
			put({ collection: Collection.PROFILES, key: text, data: { owner: text, nickname: 'n' } });
			put({ collection: Collection.USER_STATS, key: text, data: { owner: text } });
			put({
				collection: Collection.USER_MONTHLY_STATS,
				key: `${text}/2026-10`,
				data: { owner: text }
			});
			put({
				collection: Collection.RESOLVED_RESULTS,
				key: `${text}#market-1`,
				data: { owner: text }
			});
			put({ collection: Collection.SCHOOL_SUBMISSIONS, key: `${text}/1`, data: { email: text } });
		}

		for (const [activityKey, liker] of [
			[otherActivityKey, purgedText],
			[otherActivityKey, otherText],
			[ownActivityKey, otherText]
		]) {
			put({
				collection: Collection.ACTIVITY_REACTIONS,
				key: `${activityKey}#${liker}`,
				data: { activityKey }
			});
		}

		put({
			collection: Collection.ACTIVITY_REACTION_COUNTS,
			key: otherActivityKey,
			data: { activityKey: otherActivityKey, count: 2, updatedAtMs: 1 }
		});
	});

	afterEach(() => host.restore());

	describe('hardDeleteAccountFn', () => {
		it("removes the account's stats, results, school submissions and reactions, and only those", () => {
			hardDeleteAccountFn({ callerText: purgedText, callerBytes: purged.toUint8Array() });

			assert.deepEqual(host.keys(Collection.USER_STATS), [otherText]);
			assert.deepEqual(host.keys(Collection.USER_MONTHLY_STATS), [`${otherText}/2026-10`]);
			assert.deepEqual(host.keys(Collection.RESOLVED_RESULTS), [`${otherText}#market-1`]);
			assert.deepEqual(host.keys(Collection.SCHOOL_SUBMISSIONS), [`${otherText}/1`]);
			assert.deepEqual(
				host.keys(Collection.ACTIVITY_REACTIONS).sort(),
				[`${otherActivityKey}#${otherText}`, `${ownActivityKey}#${otherText}`].sort()
			);
			assert.equal(
				host.readDoc<{ count: number }>({
					collection: Collection.ACTIVITY_REACTION_COUNTS,
					key: otherActivityKey
				})?.count,
				1
			);
		});

		it('changes nothing when run twice', () => {
			const args = { callerText: purgedText, callerBytes: purged.toUint8Array() };

			hardDeleteAccountFn(args);

			assert.equal(hardDeleteAccountFn(args), 0);
			assert.equal(
				host.readDoc<{ count: number }>({
					collection: Collection.ACTIVITY_REACTION_COUNTS,
					key: otherActivityKey
				})?.count,
				1
			);
		});
	});
});
