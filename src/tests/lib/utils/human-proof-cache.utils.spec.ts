import { createHumanProofCache } from '#lib/utils/human-proof-cache.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// Every bot-check proof costs the visitor a Turnstile solve, so the cache must
// issue one per lifetime however many probes ask, and renew it before the
// server would refuse it.

const TTL_MS = 600_000;
const MARGIN_MS = 30_000;

const setup = () => {
	let now = 1_000;
	let issued = 0;
	const cache = createHumanProofCache({
		issue: () => {
			issued += 1;

			return Promise.resolve({ proof: `p${issued}`, ttlMs: TTL_MS });
		},
		marginMs: MARGIN_MS,
		nowMs: () => now
	});

	return {
		cache,
		issued: () => issued,
		advance: (ms: number) => {
			now += ms;
		}
	};
};

describe('createHumanProofCache', () => {
	it('reuses one proof inside its lifetime', async () => {
		const { cache, issued, advance } = setup();

		assert.equal(await cache.get(), 'p1');
		advance(TTL_MS - MARGIN_MS - 1);
		assert.equal(await cache.get(), 'p1');
		assert.equal(issued(), 1);
	});

	it('renews the margin before the server expiry', async () => {
		const { cache, issued, advance } = setup();

		await cache.get();
		advance(TTL_MS - MARGIN_MS);
		assert.equal(await cache.get(), 'p2');
		assert.equal(issued(), 2);
	});

	it('shares one issue between concurrent callers', async () => {
		const { cache, issued } = setup();

		assert.deepEqual(await Promise.all([cache.get(), cache.get(), cache.get()]), [
			'p1',
			'p1',
			'p1'
		]);
		assert.equal(issued(), 1);
	});

	it('issues again once invalidated', async () => {
		const { cache, issued } = setup();

		await cache.get();
		cache.invalidate();
		assert.equal(await cache.get(), 'p2');
		assert.equal(issued(), 2);
	});

	it('lets a failed issue be retried', async () => {
		let attempts = 0;
		const cache = createHumanProofCache({
			issue: () => {
				attempts += 1;

				return attempts === 1
					? Promise.reject(new Error('challenge failed'))
					: Promise.resolve({ proof: 'ok', ttlMs: TTL_MS });
			},
			marginMs: MARGIN_MS
		});

		await assert.rejects(cache.get(), /challenge failed/);
		assert.equal(await cache.get(), 'ok');
	});
});
