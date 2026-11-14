import { writable } from 'svelte/store';

/**
 * `true` while a Flow character beat (a centered character moment between cards,
 * or the session-end takeover) is on screen. The achievement celebration reveal
 * is HELD whenever this is set, so a freshly-crossed Menagerie tier never
 * collides with a character beat: the trophy reveal sequences AFTER it (card →
 * character beat → trophy). FlowMode flips this as its beats open and clear; the
 * celebration host (`MenagerieCelebrationHost`) reads it to gate the reveal.
 */
export const flowBeatActiveStore = writable<boolean>(false);

/** Mark a Flow character beat as on / off screen. */
export const setFlowBeatActive = (active: boolean): void => {
	flowBeatActiveStore.set(active);
};
