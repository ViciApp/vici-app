import { startPolling } from '#lib/utils/async.utils.ts';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

const FAST_INTERVAL_MS = 1_000;
const SLOW_INTERVAL_MS = 30_000;

/** Lets the poller's awaited callbacks settle between timer ticks. */
const flush = async (): Promise<void> => {
	for (let i = 0; i < 10; i++) {
		await Promise.resolve();
	}
};

describe('async.utils', () => {
	describe('startPolling', () => {
		let stop: (() => void) | undefined;

		beforeEach(() => {
			mock.timers.enable({ apis: ['setTimeout'] });
		});

		afterEach(() => {
			stop?.();
			stop = undefined;
			mock.timers.reset();
			mock.restoreAll();
		});

		const start = ({
			onLoad,
			slow = false,
			runImmediately = true
		}: {
			onLoad: () => Promise<void>;
			slow?: boolean;
			runImmediately?: boolean;
		}): void => {
			stop = startPolling({
				onLoad,
				onShouldUseSlowInterval: () => Promise.resolve(slow),
				fastIntervalMs: FAST_INTERVAL_MS,
				slowIntervalMs: SLOW_INTERVAL_MS,
				runImmediately
			});
		};

		it('loads immediately, then again after the fast interval', async () => {
			const onLoad = mock.fn(() => Promise.resolve());

			start({ onLoad });
			await flush();

			assert.equal(onLoad.mock.callCount(), 1);

			mock.timers.tick(FAST_INTERVAL_MS);
			await flush();

			assert.equal(onLoad.mock.callCount(), 2);
		});

		it('waits the slow interval once the caller asks for it', async () => {
			const onLoad = mock.fn(() => Promise.resolve());

			start({ onLoad, slow: true });
			await flush();

			mock.timers.tick(SLOW_INTERVAL_MS - 1);
			await flush();

			assert.equal(onLoad.mock.callCount(), 1);

			mock.timers.tick(1);
			await flush();

			assert.equal(onLoad.mock.callCount(), 2);
		});

		it('waits for the first interval when not run immediately', async () => {
			const onLoad = mock.fn(() => Promise.resolve());

			start({ onLoad, runImmediately: false });
			await flush();

			assert.equal(onLoad.mock.callCount(), 0);

			mock.timers.tick(FAST_INTERVAL_MS);
			await flush();

			assert.equal(onLoad.mock.callCount(), 1);
		});

		it('keeps polling after a load fails, and logs the failure', async () => {
			const error = new Error('load failed');
			const onLoad = mock.fn(() => Promise.reject(error));
			const consoleError = mock.method(console, 'error', () => undefined);

			start({ onLoad });
			await flush();

			assert.equal(onLoad.mock.callCount(), 1);
			assert.equal(consoleError.mock.callCount(), 1);
			assert.equal(consoleError.mock.calls[0].arguments.at(-1), error);

			mock.timers.tick(FAST_INTERVAL_MS);
			await flush();

			assert.equal(onLoad.mock.callCount(), 2);
		});

		it('stops scheduling once stopped', async () => {
			const onLoad = mock.fn(() => Promise.resolve());

			start({ onLoad });
			await flush();

			stop?.();

			mock.timers.tick(SLOW_INTERVAL_MS);
			await flush();

			assert.equal(onLoad.mock.callCount(), 1);
		});
	});
});
