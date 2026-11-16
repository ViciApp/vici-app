import collections from '#root/juno.collections.json';
import config from '#root/juno.config.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// juno.config.ts spells the datastore collection names a second time instead of
// importing juno.collections.json (its own comment says why), so the two are
// pinned here: every collection the app names is one the satellite deploys,
// and the other way round.
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
});
