import { pendingInviteOf, referralCodeFromSearch } from '#lib/utils/pending-invite.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('pending-invite.utils', () => {
	describe('referralCodeFromSearch', () => {
		it('reads and normalizes a referral code', () => {
			assert.equal(referralCodeFromSearch('?ref=ABCD2345'), 'ABCD2345');
			assert.equal(referralCodeFromSearch('?m=x~3fa9c21b&ref=abcd2345'), 'ABCD2345');
			assert.equal(referralCodeFromSearch('?ref=%20abcd2345%20'), 'ABCD2345');
		});

		it('ignores a missing param or a value that is not a code', () => {
			assert.equal(referralCodeFromSearch(''), undefined);
			assert.equal(referralCodeFromSearch('?ref='), undefined);
			// A share link falls back to the sharer's handle while the code loads.
			assert.equal(referralCodeFromSearch('?ref=antonio'), undefined);
			// `I`, `L`, `O`, `U` are outside the code alphabet.
			assert.equal(referralCodeFromSearch('?ref=ABCDILOU'), undefined);
		});
	});

	describe('pendingInviteOf', () => {
		it('keeps the well-formed codes of a stash', () => {
			assert.deepEqual(
				pendingInviteOf({ referralCode: 'ABCD2345', leagueInvite: 'ABC123', handle: 'x' }),
				{ referralCode: 'ABCD2345', leagueInvite: 'ABC123' }
			);
		});

		it('drops absent, malformed or foreign values', () => {
			assert.deepEqual(pendingInviteOf({}), {});
			assert.deepEqual(pendingInviteOf({ referralCode: 'nope', leagueInvite: 42 }), {});
		});
	});
});
