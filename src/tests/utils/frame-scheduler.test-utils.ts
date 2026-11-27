import type { FrameScheduler } from '#lib/utils/spring.utils.ts';

export const TEST_FRAME_MS = 16;

/**
 * A hand-cranked display for spring-driven code: frames run only when the
 * spec asks, on a clock the spec owns.
 */
export const createFrameScheduler = () => {
	let now_ms = 0;
	let nextHandle = 1;
	const pending = new Map<number, (now_ms: number) => void>();

	const scheduler: FrameScheduler = {
		now: () => now_ms,
		request: (callback) => {
			const handle = nextHandle++;
			pending.set(handle, callback);

			return handle;
		},
		cancel: (handle) => {
			pending.delete(handle);
		}
	};

	/** Advance one frame. */
	const frame = (): void => {
		now_ms += TEST_FRAME_MS;

		const callbacks = [...pending.values()];
		pending.clear();
		callbacks.forEach((callback) => callback(now_ms));
	};

	/** Run frames until nothing is scheduled; returns how many ran. */
	const run = (maxFrames = 2000): number => {
		let frames = 0;

		while (pending.size > 0 && frames < maxFrames) {
			frame();
			frames += 1;
		}

		return frames;
	};

	return { scheduler, frame, run, pendingCount: () => pending.size };
};
