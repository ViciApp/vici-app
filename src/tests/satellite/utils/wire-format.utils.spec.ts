import { defaultPreferences } from '#lib/constants/settings.constants.ts';
import { UserProfileWireSchema } from '#satellite/utils/wire-format.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('UserProfileWireSchema preferences defaults', () => {
	const preferences = UserProfileWireSchema.shape.preferences.unwrap();

	it('never shares the default amount between decodes of a partial shape', () => {
		const first = preferences.parse({});

		first.defaultAmount.flow = '5';

		assert.deepEqual(preferences.parse({}).defaultAmount, defaultPreferences().defaultAmount);
	});
});
