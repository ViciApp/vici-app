import { LANDING_CLAIM_CODE_LENGTH } from '#lib/constants/landing-claim.constants.ts';
import { MAX_HANDLE_LENGTH, MIN_HANDLE_LENGTH } from '#lib/constants/profile.constants.ts';
import type { LandingClaimCheck, LandingClaimNotice } from '#lib/types/landing-claim.ts';
import {
	claimHandleIssue,
	cleanClaimCode,
	cleanClaimHandle,
	isLikelyEmail,
	landingClaimLine,
	landingClaimRefusalOf,
	localClaimCheck,
	readClaimedHandle,
	rememberClaimedHandle
} from '#lib/utils/landing-claim.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const NONE: LandingClaimNotice = { kind: 'none' };
const IDLE: LandingClaimCheck = { kind: 'idle' };

const line = (overrides: Partial<Parameters<typeof landingClaimLine>[0]> = {}) =>
	landingClaimLine({
		step: 'handle',
		handle: 'anna',
		email: '',
		check: IDLE,
		notice: NONE,
		...overrides
	});

describe('landingClaimRefusalOf', () => {
	it('keeps the codes the capsule has words for', () => {
		for (const code of [
			'handle_taken',
			'invalid_code',
			'expired_code',
			'rate_limited',
			'email_invalid'
		] as const) {
			assert.equal(landingClaimRefusalOf(code), code);
		}
	});

	it('reads any other code as a generic failure', () => {
		assert.equal(landingClaimRefusalOf('internal'), 'failed');
		assert.equal(landingClaimRefusalOf(''), 'failed');
	});
});

describe('isLikelyEmail', () => {
	it('accepts an address with a dotted domain, surrounding spaces ignored', () => {
		assert.equal(isLikelyEmail('a@b.co'), true);
		assert.equal(isLikelyEmail('  anna@example.com '), true);
	});

	it('refuses what cannot be an address', () => {
		for (const email of ['', 'anna', 'anna@', 'anna@example', 'an na@example.com']) {
			assert.equal(isLikelyEmail(email), false);
		}
	});
});

describe('cleanClaimCode', () => {
	it('keeps digits only, up to the code length', () => {
		assert.equal(cleanClaimCode('12 34-56'), '123456');
		assert.equal(cleanClaimCode('1234567890').length, LANDING_CLAIM_CODE_LENGTH);
		assert.equal(cleanClaimCode('abc'), '');
	});
});

describe('claimHandleIssue', () => {
	it('holds a claimed handle to the handle editor length bounds', () => {
		assert.equal(MIN_HANDLE_LENGTH, 3);
		assert.equal(MAX_HANDLE_LENGTH, 15);
		assert.equal(claimHandleIssue(''), 'required');
		assert.equal(claimHandleIssue('ab'), 'too_short');
		assert.equal(claimHandleIssue('a'.repeat(MIN_HANDLE_LENGTH)), undefined);
		assert.equal(claimHandleIssue('a'.repeat(MAX_HANDLE_LENGTH)), undefined);
		assert.equal(claimHandleIssue('a'.repeat(MAX_HANDLE_LENGTH + 1)), 'too_long');
	});

	it('keeps the shared charset and reserved check', () => {
		assert.equal(claimHandleIssue('bad name'), 'invalid');
		assert.equal(claimHandleIssue('José_99'), undefined);
		assert.equal(claimHandleIssue('admin'), 'reserved');
	});
});

describe('cleanClaimHandle', () => {
	it('strips what the rule refuses, then caps the length', () => {
		assert.equal(cleanClaimHandle('@anna!'), 'anna');
		assert.equal(cleanClaimHandle('a'.repeat(MAX_HANDLE_LENGTH + 4)).length, MAX_HANDLE_LENGTH);
		assert.equal(
			cleanClaimHandle(`@${'b'.repeat(MAX_HANDLE_LENGTH)}`),
			'b'.repeat(MAX_HANDLE_LENGTH)
		);
	});
});

describe('localClaimCheck', () => {
	it('waits for the network on a well-formed handle', () => {
		assert.deepEqual(localClaimCheck('anna'), { kind: 'checking' });
	});

	it('answers the format rules locally', () => {
		assert.deepEqual(localClaimCheck(''), { kind: 'idle' });
		assert.deepEqual(localClaimCheck('ab'), { kind: 'format', issue: 'too_short' });
	});
});

describe('landingClaimLine', () => {
	it('prompts for a handle, or shows the opener line until something is typed', () => {
		assert.deepEqual(line({ handle: '' }), { key: 'landing.claim.intro', tone: 'quiet' });
		assert.deepEqual(line({ handle: '', ack: 'You called Yes.' }), {
			text: 'You called Yes.',
			tone: 'quiet'
		});
	});

	it('follows the live check of the handle', () => {
		assert.deepEqual(line({ check: { kind: 'checking' } }), {
			key: 'landing.claim.checking',
			params: { handle: 'anna' },
			tone: 'quiet'
		});
		assert.equal(line({ check: { kind: 'free' } }).tone, 'yes');
		assert.equal(line({ check: { kind: 'taken' } }).tone, 'no');
		assert.deepEqual(line({ check: { kind: 'failed' } }), {
			key: 'landing.claim.check_failed',
			tone: 'no'
		});
	});

	it('names the minimum length from the app rule', () => {
		assert.deepEqual(line({ handle: 'ab', check: { kind: 'format', issue: 'too_short' } }), {
			key: 'landing.claim.too_short',
			params: { min: MIN_HANDLE_LENGTH },
			tone: 'quiet'
		});
	});

	it('reads a reserved handle as taken', () => {
		assert.deepEqual(line({ check: { kind: 'format', issue: 'reserved' } }), {
			key: 'landing.claim.taken',
			params: { handle: 'anna' },
			tone: 'no'
		});
	});

	it('gives each later step its own prompt', () => {
		assert.deepEqual(line({ step: 'email' }), {
			key: 'landing.claim.email_prompt',
			params: { handle: 'anna' },
			tone: 'quiet'
		});
		assert.deepEqual(line({ step: 'code', email: ' anna@example.com ' }), {
			key: 'landing.claim.code_prompt',
			params: { email: 'anna@example.com', digits: LANDING_CLAIM_CODE_LENGTH },
			tone: 'quiet'
		});
		assert.deepEqual(line({ step: 'done' }), { key: 'landing.claim.done', tone: 'yes' });
	});

	it('lets a notice win over the step line', () => {
		assert.deepEqual(line({ step: 'email', notice: { kind: 'busy' } }), {
			key: 'landing.claim.sending',
			tone: 'quiet'
		});
		assert.deepEqual(line({ step: 'code', notice: { kind: 'refused', refusal: 'expired_code' } }), {
			key: 'landing.claim.code_expired',
			params: { handle: 'anna' },
			tone: 'no'
		});
		assert.deepEqual(
			line({ step: 'handle', notice: { kind: 'refused', refusal: 'handle_taken' } }),
			{
				key: 'landing.claim.taken_meanwhile',
				params: { handle: 'anna' },
				tone: 'no'
			}
		);
	});

	it('words a generic failure by the step it happened in', () => {
		const failed: LandingClaimNotice = { kind: 'refused', refusal: 'failed' };

		assert.deepEqual(line({ step: 'email', notice: failed }), {
			key: 'landing.claim.send_failed',
			tone: 'no'
		});
		assert.deepEqual(line({ step: 'code', notice: failed }), {
			key: 'landing.claim.confirm_failed',
			tone: 'no'
		});
	});
});

describe('claimed handle cache', () => {
	it('never throws where storage is unavailable', () => {
		assert.doesNotThrow(() => rememberClaimedHandle('anna'));
		assert.doesNotThrow(() => readClaimedHandle());
	});
});
