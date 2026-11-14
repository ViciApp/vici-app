import { maintenanceStore } from '#lib/stores/maintenance.store.ts';
import { isCanisterStoppedError } from '#lib/utils/maintenance.utils.ts';
import { browser } from '$app/env';

/**
 * Maintenance-window detection for satellite deploys.
 *
 * `juno functions upgrade` stops the satellite while the wasm is swapped, so
 * for that window every satellite call rejects with "Canister … is stopped".
 * Errors that smell like that are funnelled here (global listeners via
 * {@link initMaintenanceWatch} catch the rejections the polling loaders let
 * bubble); a reachability probe against our own origin: served by the same
 * canister: confirms the outage before the overlay shows, then polls until
 * the satellite answers again and reloads to pick up the freshly deployed
 * frontend.
 */

const PROBE_INTERVAL_MS = 5_000;

/** Re-entrancy latch: one probe/poll chain at a time, reset only on a false alarm. */
let watching = false;

const satelliteReachable = async (): Promise<boolean> => {
	try {
		const response = await fetch('/', { cache: 'no-store', method: 'HEAD' });

		// The gateway answers 503 precisely while the canister is stopped; any
		// other status (2xx, but also 3xx/304) means the satellite is serving
		// again: don't let an unrelated non-2xx trap users in the overlay.
		return response.status !== 503;
	} catch {
		return false;
	}
};

const poll = async (): Promise<void> => {
	if (await satelliteReachable()) {
		// Reload instead of just dismissing the overlay: the deploy that
		// stopped the satellite usually shipped new frontend assets too.
		window.location.reload();

		return;
	}

	window.setTimeout(() => void poll(), PROBE_INTERVAL_MS);
};

export const reportMaintenanceCandidate = async (err: unknown): Promise<void> => {
	if (!browser || watching || !isCanisterStoppedError(err)) {
		return;
	}

	watching = true;

	if (await satelliteReachable()) {
		// False alarm: the satellite answered, so this was a transient error.
		watching = false;

		return;
	}

	maintenanceStore.set(true);

	window.setTimeout(() => void poll(), PROBE_INTERVAL_MS);
};

/**
 * Registers the global error listeners. Mount once from the root layout;
 * returns the cleanup for `onMount`.
 */
export const initMaintenanceWatch = (): (() => void) => {
	const onRejection = ({ reason }: PromiseRejectionEvent) =>
		void reportMaintenanceCandidate(reason);
	const onError = ({ error }: ErrorEvent) => void reportMaintenanceCandidate(error);

	window.addEventListener('unhandledrejection', onRejection);
	window.addEventListener('error', onError);

	return () => {
		window.removeEventListener('unhandledrejection', onRejection);
		window.removeEventListener('error', onError);
	};
};
