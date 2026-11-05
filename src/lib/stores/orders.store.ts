import type { ClearingDid } from '#declarations';
import { writable } from 'svelte/store';

export const ordersStore = writable<ClearingDid.LimitOrder[] | undefined>(undefined);
