import { Collection } from '#lib/constants/collections.constants.ts';
import collections from '#root/juno.collections.json';
import config from '#root/juno.config.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// The collection names live in three places. juno.config.ts spells them a
// second time instead of importing juno.collections.json (its own comment says
// why), and the typed Collection object lists one key per JSON entry by hand,
// so a name added to the JSON alone still typechecks. Both are pinned here:
// every collection the app names is one the satellite deploys and one the code
// can reach, and the other way round.
describe('datastore collections', () => {
	it('juno.config.ts deploys exactly the collections juno.collections.json names', () => {
		const named = Object.values(collections).toSorted();

		for (const mode of ['production', 'development'] as const) {
			const deployed = (config({ mode }).satellite.collections?.datastore ?? []).map(
				({ collection }) => collection
			);

			assert.deepEqual(deployed.toSorted(), named, mode);
		}
	});

	it('the typed Collection has exactly the keys and names of juno.collections.json', () => {
		assert.deepEqual({ ...Collection }, { ...collections });
	});
});
