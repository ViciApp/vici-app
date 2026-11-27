import { CHALLENGE_CONTEXT_TTL_MS } from '#lib/constants/challenge.constants.ts';
import { parseChallengeContext } from '#lib/utils/challenge-context.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const NOW_MS = 1_800_000_000_000;
const stored = { id: 'ABCDEFGHJKMNPQRS', seriesId: 'series-1', atMs: NOW_MS - 1_000 };

describe('parseChallengeContext', () => {
	it('keeps a live context, the id normalised', () => {
		assert.deepEqual(parseChallengeContext({ value: stored, nowMs: NOW_MS }), stored);
		assert.deepEqual(
			parseChallengeContext({ value: { ...stored, id: 'abcdefghjkmnpqrs' }, nowMs: NOW_MS }),
			stored
		);
	});

	it('lapses at the expiry, never before', () => {
		const atMs = NOW_MS - CHALLENGE_CONTEXT_TTL_MS;

		assert.equal(parseChallengeContext({ value: { ...stored, atMs }, nowMs: NOW_MS }), undefined);
		assert.notEqual(
			parseChallengeContext({ value: { ...stored, atMs: atMs + 1 }, nowMs: NOW_MS }),
			undefined
		);
	});

	it('drops anything malformed or from the future', () => {
		for (const value of [
			null,
			'ABCDEFGHJKMNPQRS',
			{ ...stored, id: 'not-an-id' },
			{ ...stored, seriesId: '' },
			{ ...stored, atMs: Number.NaN },
			{ ...stored, atMs: NOW_MS + 1 }
		]) {
			assert.equal(parseChallengeContext({ value, nowMs: NOW_MS }), undefined);
		}
	});
});
