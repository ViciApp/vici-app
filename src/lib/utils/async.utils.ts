/**
 * Race a promise against a hard timeout. Resolves/rejects with the
 * operation if it settles first; otherwise rejects with a labelled
 * `Error` after `timeoutMs`.
 *
 * Use this to bound any IC call (read or update) whose UI shows a
 * spinner: a call that never resolves *and* never rejects leaves the
 * spinner stuck and the caller's `finally` cleanup unreachable. The
 * `label` flows into the error message so the failure is attributable in
 * logs.
 *
 * Note: this does not cancel the underlying `operation` (promises aren't
 * cancellable): it only stops the caller waiting on it. The timeout
 * timer is always cleared once the race settles, so a winning operation
 * doesn't leave a dangling `setTimeout` keeping the event loop alive
 * (matters in SSR / tests).
 */
export const withTimeout = <T>({
	operation,
	timeoutMs,
	label
}: {
	operation: Promise<T>;
	timeoutMs: number;
	label: string;
}): Promise<T> => {
	let timer: ReturnType<typeof setTimeout>;

	const timeout = new Promise<T>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
			timeoutMs
		);
	});

	return Promise.race<T>([operation, timeout]).finally(() => clearTimeout(timer));
};

/**
 * Resolve after `durationMs`. A tiny promisified `setTimeout` for the
 * "hold a beat before dismissing" pattern: e.g. letting a success
 * confirmation stay on screen for a moment before a sheet auto-closes.
 */
export const sleep = (durationMs: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, durationMs));

/**
 * Run `onLoad` on a self-rescheduling timer: `fastIntervalMs` between runs
 * until `onShouldUseSlowInterval` answers true, `slowIntervalMs` after that.
 * Runs never overlap. A failed run goes to `onError` (logged when none is
 * given) and the next one is scheduled anyway: one transient error must not
 * stop a loader for the rest of the session. A failed interval probe falls
 * back to the slow interval, so a probe that keeps failing cannot speed the
 * loop up. Returns the stop function, which cancels any scheduled run.
 */
export const startPolling = ({
	onLoad,
	onError = (err: unknown) =>
		console.error('Polled load failed; retrying on the next interval', err),
	onShouldUseSlowInterval,
	fastIntervalMs,
	slowIntervalMs,
	runImmediately
}: {
	onLoad: () => Promise<void>;
	onError?: (err: unknown) => void;
	onShouldUseSlowInterval: () => Promise<boolean>;
	fastIntervalMs: number;
	slowIntervalMs: number;
	runImmediately: boolean;
}): (() => void) => {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;
	let running = false;

	const clearScheduled = () => {
		clearTimeout(timeout);
		timeout = undefined;
	};

	const scheduleNext = async () => {
		if (stopped) {
			return;
		}

		const useSlow = await onShouldUseSlowInterval().catch(() => true);
		const delayMs = useSlow ? slowIntervalMs : fastIntervalMs;

		if (stopped) {
			return;
		}

		timeout = setTimeout(() => void tick(), delayMs);
	};

	const tick = async () => {
		if (stopped || running) {
			return;
		}

		running = true;
		clearScheduled();

		try {
			await onLoad();
		} catch (err: unknown) {
			onError(err);
		} finally {
			running = false;
		}

		await scheduleNext();
	};

	void (runImmediately ? tick() : scheduleNext());

	return () => {
		stopped = true;
		clearScheduled();
	};
};

export interface LoadEpoch {
	/** Marks a load as started; the returned check stays true until the next `invalidate`. */
	start: () => () => boolean;
	/** Drops every load started before this call. */
	invalidate: () => void;
}

/**
 * Epoch guard for a user-scoped cache: a refresh captures the epoch when it
 * starts and commits only while the check it got is still true; the cache's
 * clear bumps the epoch. A fetch in flight across a sign-out / sign-in then
 * cannot repopulate the cache (or flip its `loaded` flag) for the next account.
 */
export const createLoadEpoch = (): LoadEpoch => {
	let epoch = 0;

	return {
		start: () => {
			const startedAt = epoch;

			return () => epoch === startedAt;
		},
		invalidate: () => {
			epoch += 1;
		}
	};
};
