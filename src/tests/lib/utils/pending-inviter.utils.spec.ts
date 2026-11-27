import {
	hasPendingReferralCode,
	pendingPayloadOf,
	withPendingInviter
} from '#lib/utils/pending-inviter.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// Between an invite and a challenge link the last touch wins: the payload
// credits one of them, never both, and keeps everything else.

describe('withPendingInviter', () => {
	it('a challenge link replaces a stashed referral code and its retries', () => {
		assert.deepEqual(
			withPendingInviter({
				payload: {
					handle: 'leo',
					referralCode: 'GFTBCWTH',
					referralAttempts: 1,
					leagueInvite: 'X'
				},
				inviter: { challengeId: 'ABCDEFGHJKMNPQRS' }
			}),
			{ handle: 'leo', leagueInvite: 'X', challengeId: 'ABCDEFGHJKMNPQRS' }
		);
	});

	it('a referral code replaces a stashed challenge link', () => {
		assert.deepEqual(
			withPendingInviter({
				payload: { challengeId: 'ABCDEFGHJKMNPQRS', interests: ['sport'] },
				inviter: { referralCode: 'GFTBCWTH' }
			}),
			{ interests: ['sport'], referralCode: 'GFTBCWTH' }
		);
	});

	it('only a referral code counts as one already pending', () => {
		assert.equal(hasPendingReferralCode({ referralCode: 'GFTBCWTH' }), true);
		assert.equal(hasPendingReferralCode({ challengeId: 'ABCDEFGHJKMNPQRS' }), false);
		assert.equal(hasPendingReferralCode({ referralCode: '' }), false);
	});
});

describe('pendingPayloadOf', () => {
	it('reads an object and treats anything else as empty', () => {
		assert.deepEqual(pendingPayloadOf('{"referralCode":"GFTBCWTH"}'), { referralCode: 'GFTBCWTH' });
		assert.deepEqual(pendingPayloadOf(null), {});
		assert.deepEqual(pendingPayloadOf('not json'), {});
		assert.deepEqual(pendingPayloadOf('"a string"'), {});
		assert.deepEqual(pendingPayloadOf('null'), {});
	});
});
