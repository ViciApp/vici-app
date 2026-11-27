import type { ChallengeAnswerItem } from '#lib/types/challenge.ts';
import { writable } from 'svelte/store';

/**
 * Answers to the viewer's challenge links, newest first: the source of the "your friend answered"
 * inbox card. Populated by `LoaderChallengeAnswers` with the app shell (web2 only) and reset on
 * every auth transition. `undefined` until the first load settles, which the inbox toast gate keys
 * off so a cold-start backlog of answers does not replay as arrival toasts.
 */
export const challengeAnswersStore = writable<ChallengeAnswerItem[] | undefined>(undefined);
