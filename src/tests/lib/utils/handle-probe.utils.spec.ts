import {
	handleProbeFailure,
	handleProbeRoute,
	latchesPublicProbe
} from '#lib/utils/handle-probe.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('handleProbeRoute', () => {
	it('sends a signed-out web2 visitor to the public probe', () => {
		assert.equal(handleProbeRoute({ web2Backend: true, signedIn: false }), 'public');
	});

	// The session probe excludes the caller's own handle; the public one cannot.
	it('keeps a signed-in web2 user on the session probe', () => {
		assert.equal(handleProbeRoute({ web2Backend: true, signedIn: true }), 'session');
	});

	it('keeps the default backend on its one probe whoever is signed in', () => {
		assert.equal(handleProbeRoute({ web2Backend: false, signedIn: false }), 'session');
		assert.equal(handleProbeRoute({ web2Backend: false, signedIn: true }), 'session');
	});
});

describe('handleProbeFailure', () => {
	it('tells a throttled probe apart', () => {
		assert.equal(handleProbeFailure('rate_limited'), 'rate_limited');
	});

	it('folds every other refusal into unverified', () => {
		for (const code of [
			'human_proof_required',
			'turnstile_failed',
			'turnstile_unavailable',
			'turnstile_unconfigured',
			'unauthenticated',
			'internal_error'
		]) {
			assert.equal(handleProbeFailure(code), 'unverified');
		}
	});

	it('reads a failure without a code as unverified', () => {
		assert.equal(handleProbeFailure(undefined), 'unverified');
	});
});

describe('latchesPublicProbe', () => {
	it('latches when the API cannot run the bot check', () => {
		assert.equal(latchesPublicProbe('turnstile_unconfigured'), true);
	});

	// Each of these can clear on a later probe, so the probe must keep trying.
	it('leaves transient and per-request refusals unlatched', () => {
		for (const code of [
			'turnstile_unavailable',
			'turnstile_failed',
			'human_proof_required',
			'rate_limited',
			undefined
		]) {
			assert.equal(latchesPublicProbe(code), false);
		}
	});

	it('still reads a latched refusal as unverified', () => {
		assert.equal(handleProbeFailure('turnstile_unconfigured'), 'unverified');
	});
});
