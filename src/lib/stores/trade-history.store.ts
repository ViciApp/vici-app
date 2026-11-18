import type { ClearingDid } from '#declarations';
import { writable } from 'svelte/store';

/**
 * User trade / settlement events for the currently selected balance domain.
 * Reset to `undefined` by the loader whenever the domain switches.
 */
export const tradeHistoryStore = writable<ClearingDid.Event[] | undefined>(undefined);
