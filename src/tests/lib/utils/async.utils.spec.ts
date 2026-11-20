import { createLoadEpoch, startPolling } from '#lib/utils/async.utils.ts';
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

		it('passes a failed run to onError and keeps polling', async () => {
			const failure = new Error('boom');
			const onLoad = mock.fn(() => Promise.reject(failure));
			const onError = mock.fn((_err: unknown) => undefined);

			stop = startPolling({
				onLoad,
				onError,
				onShouldUseSlowInterval: () => Promise.resolve(false),
				fastIntervalMs: FAST_INTERVAL_MS,
				slowIntervalMs: SLOW_INTERVAL_MS,
				runImmediately: true
			});
			await flush();

			assert.equal(onError.mock.callCount(), 1);
			assert.equal(onError.mock.calls[0].arguments[0], failure);

			mock.timers.tick(FAST_INTERVAL_MS);
			await flush();

			assert.equal(onLoad.mock.callCount(), 2);
		});

		it('falls back to the slow interval when the interval probe fails', async () => {
			const onLoad = mock.fn(() => Promise.resolve());

			stop = startPolling({
				onLoad,
				onShouldUseSlowInterval: () => Promise.reject(new Error('probe failed')),
				fastIntervalMs: FAST_INTERVAL_MS,
				slowIntervalMs: SLOW_INTERVAL_MS,
				runImmediately: true
			});
			await flush();

			mock.timers.tick(FAST_INTERVAL_MS);
			await flush();

			assert.equal(onLoad.mock.callCount(), 1);

			mock.timers.tick(SLOW_INTERVAL_MS - FAST_INTERVAL_MS);
			await flush();

			assert.equal(onLoad.mock.callCount(), 2);
		});

		it('schedules nothing when stopped while the interval probe is pending', async () => {
			const onLoad = mock.fn(() => Promise.resolve());
			let answerProbe: ((slow: boolean) => void) | undefined;

			stop = startPolling({
				onLoad,
				onShouldUseSlowInterval: () =>
					new Promise<boolean>((resolve) => {
						answerProbe = resolve;
					}),
				fastIntervalMs: FAST_INTERVAL_MS,
				slowIntervalMs: SLOW_INTERVAL_MS,
				runImmediately: true
			});
			await flush();

			stop();
			answerProbe?.(false);
			await flush();

			mock.timers.tick(SLOW_INTERVAL_MS);
			await flush();

			assert.equal(onLoad.mock.callCount(), 1);
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

	describe('createLoadEpoch', () => {
		it('keeps a load current while nothing invalidated it', () => {
			const epoch = createLoadEpoch();
			const isCurrent = epoch.start();

			assert.equal(isCurrent(), true);
		});

		it('drops a load started before an invalidation', () => {
			const epoch = createLoadEpoch();
			const isCurrent = epoch.start();

			epoch.invalidate();

			assert.equal(isCurrent(), false);
		});

		it('keeps a load started after the invalidation current', () => {
			const epoch = createLoadEpoch();

			epoch.invalidate();
			const isCurrent = epoch.start();

			assert.equal(isCurrent(), true);
		});

		it('keeps separate epochs apart', () => {
			const first = createLoadEpoch();
			const second = createLoadEpoch();
			const isCurrent = first.start();

			second.invalidate();

			assert.equal(isCurrent(), true);
		});
	});
});
