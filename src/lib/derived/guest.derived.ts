import { guestStore } from '#lib/stores/guest.store.ts';
import { derived, type Readable } from 'svelte/store';

/**
 * `true` while an active guest session is in flight — a signed-out visitor who
 * took the onboarding Skip path and may preview Flow freely. Surfaces gate on
 * this to render the predict control (rather than a sign-in prompt) and to let
 * the route gate pass the guest through to Flow.
 */
export const guestMode: Readable<boolean> = derived(guestStore, ({ isGuest }) => isGuest);

/** The guest's auto-assigned or claimed handle, carried into conversion. */
export const guestHandle: Readable<string | null> = derived(guestStore, ({ handle }) => handle);

/**
 * The session-scoped preview-pick count. Drives the conversion cadence (soft
 * sheet on pick 1, remind every 5th) and the standing inline CTA threshold.
 */
export const guestPickCount: Readable<number> = derived(
	guestStore,
	({ sessionPickCount }) => sessionPickCount
);
