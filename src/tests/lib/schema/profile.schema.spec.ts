import { defaultPreferences } from '#lib/constants/settings.constants.ts';
import { UserProfileSchema } from '#lib/schema/profile.schema.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('UserProfileSchema preferences defaults', () => {
	const { preferences } = UserProfileSchema.shape;

	it('decodes a profile without preferences to the stored defaults', () => {
		assert.deepEqual(preferences.parse(undefined), defaultPreferences());
	});

	it('fills every missing leaf of a partial legacy shape from the stored defaults', () => {
		const defaults = defaultPreferences();

		assert.deepEqual(preferences.parse({}), defaults);
		assert.deepEqual(
			preferences.parse({ notify: { friendActivity: true }, sharing: { callsPublic: false } }),
			{
				...defaults,
				notify: { ...defaults.notify, friendActivity: true },
				sharing: { ...defaults.sharing, callsPublic: false }
			}
		);
	});

	it('never hands two decodes the same arrays or objects', () => {
		const first = preferences.parse(undefined);
		const second = preferences.parse(undefined);

		assert.notEqual(first.savedMarketIds, second.savedMarketIds);
		assert.notEqual(first.notify, second.notify);
	});

	it('never shares a nested default between decodes of a partial shape', () => {
		const first = preferences.parse({});

		first.defaultAmount.flow = '5';
		first.notify.weeklyDigest = false;
		first.sharing.callsPublic = false;
		first.flowTags.push('sports');
		first.savedMarketIds.push('market-1');

		assert.deepEqual(preferences.parse({}), defaultPreferences());
	});
});
