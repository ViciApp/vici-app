import { writable } from 'svelte/store';

/**
 * `true` while the satellite is confirmed unreachable because a deploy is
 * swapping its wasm: drives the full-screen `MaintenanceOverlay`. Set by
 * `maintenance.services.ts` only after a reachability probe confirms the
 * outage; never set it directly from feature code.
 */
export const maintenanceStore = writable<boolean>(false);
