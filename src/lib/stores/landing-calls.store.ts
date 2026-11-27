import { LANDING_CALLS_STORAGE_KEY } from '#lib/constants/landing-page.constants.ts';
import type { LandingCall } from '#lib/types/landing-call.ts';
import { keepRecentLandingCalls, parseLandingCalls } from '#lib/utils/landing-page.utils.ts';
import { get as getStored, set as setStored } from '#lib/utils/storage.utils.ts';
import { writable, type Readable } from 'svelte/store';

const readStored = (): LandingCall[] =>
	keepRecentLandingCalls({
		calls: parseLandingCalls(getStored<unknown>({ key: LANDING_CALLS_STORAGE_KEY })),
		nowMs: Date.now()
	});

const store = writable<LandingCall[]>(readStored());

/**
 * The calls a signed-out visitor made on the landing (the deck and Markets),
 * so the claim that follows can carry them. Held in memory and mirrored to
 * browser storage, best effort: the latest few, none older than a week. They
 * place no order.
 */
export const landingCallsStore: Readable<LandingCall[]> & {
	add: (call: LandingCall) => void;
} = {
	subscribe: store.subscribe,
	add: (call: LandingCall) =>
		store.update((calls) => {
			const next = keepRecentLandingCalls({ calls: [...calls, call], nowMs: call.atMs });

			setStored({ key: LANDING_CALLS_STORAGE_KEY, value: next });

			return next;
		})
};
