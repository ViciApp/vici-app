import type { MenagerieCrossing } from '#lib/utils/menagerie.utils.ts';
import { isNullish } from '@dfinity/utils';
import { writable } from 'svelte/store';

/**
 * Achievement celebration queue. A freshly-crossed Menagerie tier is enqueued
 * here; the celebration host shows them one at a time (springs the badge in,
 * flies it into the Profile nav), advancing only when the reveal finishes, and
 * never while a Flow character beat is on screen (see `flow-beat.store`).
 *
 * Multiple same-tick crossings queue in catalogue (reveal-cadence) order.
 */
interface CelebrationState {
	/** The reveal currently on screen, or `null` when idle. */
	current: MenagerieCrossing | null;
	/** Pending reveals waiting their turn. */
	queue: MenagerieCrossing[];
}

const { subscribe, update, set } = writable<CelebrationState>({ current: null, queue: [] });

export const menagerieCelebrationStore = { subscribe };

/** Enqueue crossings; the first one shows immediately if nothing is on screen. */
export const enqueueMenagerieCelebrations = (crossings: MenagerieCrossing[]): void => {
	if (crossings.length === 0) {
		return;
	}

	update((state) => {
		if (isNullish(state.current)) {
			const [first, ...rest] = crossings;

			return { current: first, queue: [...state.queue, ...rest] };
		}

		return { ...state, queue: [...state.queue, ...crossings] };
	});
};

/** Advance to the next queued reveal (called when the current one finishes). */
export const advanceMenagerieCelebration = (): void => {
	update((state) => {
		const [next, ...rest] = state.queue;

		return { current: next ?? null, queue: rest };
	});
};

/** Clear the queue entirely (e.g. on sign-out). */
export const resetMenagerieCelebrations = (): void => {
	set({ current: null, queue: [] });
};
