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
