import { Collection } from '#lib/constants/collections.constants.ts';
import {
	controller,
	installSatelliteHost,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import {
	KEYSET_WALK_MAX_LIMIT,
	walkKeysetPage,
	type KeysetWalkStep
} from '#satellite/services/keyset-walk.services.ts';
import { deleteDocStore } from '@junobuild/functions/sdk';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const collection = Collection.RESOLVED_RESULTS;

describe('keyset-walk.services', () => {
	let host: SatelliteHost;

	const seed = (keys: string[]) => {
		for (const key of keys) {
			host.putDoc({ collection, key, data: { key }, owner: controller });
		}
	};

	const walk = ({
		afterKey,
		limit,
		step = () => 'kept'
	}: {
		afterKey?: string;
		limit?: number;
		step?: (key: string) => KeysetWalkStep;
	}) => {
		const visited: string[] = [];

		const result = walkKeysetPage({
			collection,
			caller: controller.toUint8Array(),
			afterKey,
			limit,
			visit: ([key]) => {
				visited.push(key);

				return step(key);
			}
		});

		return { ...result, visited };
	};

	beforeEach(() => {
		host = installSatelliteHost();
	});

	afterEach(() => {
		host.restore();
	});

	it('reads `limit` docs per call in key order and resumes after the last one', () => {
		seed(['c', 'a', 'e', 'b', 'd']);

		const first = walk({ limit: 2 });

		assert.deepEqual(first, { visited: ['a', 'b'], nextAfterKey: 'b', done: false });

		const second = walk({ afterKey: first.nextAfterKey, limit: 2 });

		assert.deepEqual(second, { visited: ['c', 'd'], nextAfterKey: 'd', done: false });

		const third = walk({ afterKey: second.nextAfterKey, limit: 2 });

		assert.deepEqual(third, { visited: ['e'], nextAfterKey: 'e', done: true });
	});

	it('never resumes after a removed doc', () => {
		seed(['a', 'b', 'c']);

		const removeB = (key: string): KeysetWalkStep => {
			if (key !== 'b') {
				return 'kept';
			}

			deleteDocStore({
				collection,
				key,
				caller: controller.toUint8Array(),
				doc: { version: 1n }
			});

			return 'removed';
		};

		const first = walk({ limit: 2, step: removeB });

		assert.deepEqual(first, { visited: ['a', 'b'], nextAfterKey: 'a', done: false });

		const second = walk({ afterKey: first.nextAfterKey, limit: 2 });

		assert.deepEqual(second, { visited: ['c'], nextAfterKey: 'c', done: true });
	});

	it('leaves the doc it stopped at for the next call', () => {
		seed(['a', 'b', 'c']);

		const first = walk({ step: (key) => (key === 'b' ? 'stop' : 'kept') });

		assert.deepEqual(first, { visited: ['a', 'b'], nextAfterKey: 'a', done: false });

		const second = walk({ afterKey: first.nextAfterKey });

		assert.deepEqual(second, { visited: ['b', 'c'], nextAfterKey: 'c', done: true });
	});

	it('starts from the first doc again when the cursor is no longer stored', () => {
		seed(['a', 'b']);

		assert.deepEqual(walk({ afterKey: 'gone' }), {
			visited: ['a', 'b'],
			nextAfterKey: 'b',
			done: true
		});
	});

	it('reads at most the page cap, whatever limit is asked', () => {
		seed(
			Array.from({ length: KEYSET_WALK_MAX_LIMIT + 1 }, (_, i) => `k${`${i}`.padStart(3, '0')}`)
		);

		assert.equal(walk({}).visited.length, KEYSET_WALK_MAX_LIMIT);
		assert.equal(walk({ limit: 10_000 }).visited.length, KEYSET_WALK_MAX_LIMIT);
		assert.equal(walk({ limit: 0 }).visited.length, 1);
		assert.equal(walk({ limit: Number.NaN }).visited.length, KEYSET_WALK_MAX_LIMIT);
	});

	it('is done on an empty collection', () => {
		assert.deepEqual(walk({}), { visited: [], nextAfterKey: undefined, done: true });
	});
});
