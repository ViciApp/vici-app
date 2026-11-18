import type { Position } from '#lib/types/position.ts';
import { writable } from 'svelte/store';

/**
 * User positions for the currently selected balance domain. Reset to
 * `undefined` by the loader whenever the domain switches so the UI can
 * distinguish "not yet loaded for this domain" from "loaded and empty".
 */
export const positionsStore = writable<Position[] | undefined>(undefined);
