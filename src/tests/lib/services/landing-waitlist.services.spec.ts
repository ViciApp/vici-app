import {
	LANDING_WAITLIST_UNAVAILABLE,
	landingWaitlistSubmit
} from '#lib/services/landing-waitlist.services.ts';
import { landingClaimRefusalOf } from '#lib/utils/landing-claim.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('landing-waitlist.services', () => {
	it('refuses to send a code: nothing pretends a handle is held', async () => {
		assert.deepEqual(
			await landingWaitlistSubmit.requestCode({ handle: 'zeno', email: 'zeno@example.com' }),
			{ error: LANDING_WAITLIST_UNAVAILABLE }
		);
	});

	it('refuses to confirm a code', async () => {
		assert.deepEqual(
			await landingWaitlistSubmit.confirm({ email: 'zeno@example.com', code: '123456' }),
			{ error: LANDING_WAITLIST_UNAVAILABLE }
		);
	});

	it('answers with a code the capsule reads as a plain failure', () => {
		assert.equal(landingClaimRefusalOf(LANDING_WAITLIST_UNAVAILABLE), 'failed');
	});
});
