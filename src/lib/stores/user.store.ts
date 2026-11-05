import type { UserProfile } from '#lib/types/profile.ts';
import type { User } from '@junobuild/core';
import { writable } from 'svelte/store';

export interface UserStoreData {
	user: User | undefined;
	profile: UserProfile | undefined;
	/**
	 * The signed-in user's own on-file email, hydrated from the
	 * owner-private `profile_private` doc at sign-in (`ensureProfile`).
	 * Never sourced from the public profile doc — the address must not
	 * exist there. Empty string = no address on file.
	 */
	email: string;
	/**
	 * True while we are resolving the authentication state (initial session
	 * check on load, sign-in in progress, sign-out in progress, or profile
	 * hydration). Consumers should treat this as "we don't know yet" and
	 * avoid rendering signed-out UI.
	 */
	authBusy: boolean;
	/**
	 * True when the satellite already held a profile doc for this principal
	 * at sign-in time (a returning user). False when the profile was just
	 * created during the current session bootstrap. Consumed by the post-
	 * sign-in pending-onboarding handoff to avoid overwriting an existing
	 * account's nickname/interests/email with values picked pre-auth.
	 */
	profileExisted: boolean;
}

export const userStore = writable<UserStoreData>({
	user: undefined,
	profile: undefined,
	email: '',
	authBusy: true,
	profileExisted: false
});

/**
 * Flag the auth state as being resolved. Use this right before triggering
 * a sign-in / sign-out so that the UI does not flash the wrong state
 * between the action and the `onAuthStateChange` callback firing.
 */
export const setAuthBusy = (authBusy: boolean): void => {
	userStore.update((data) => ({ ...data, authBusy }));
};
