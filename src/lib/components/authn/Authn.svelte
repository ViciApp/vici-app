<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { onMount, type Snippet } from 'svelte';
	import { SIGNED_IN_FLAG_KEY } from '#lib/constants/app.constants.ts';
	import { resetIdentityScopedState } from '#lib/services/identity-reset.services.ts';
	import { loadProfileShell } from '#lib/services/profile.services.ts';
	import { setCachedProfile } from '#lib/stores/profiles.store.ts';
	import { userStore } from '#lib/stores/user.store.ts';
	import type { User } from '#lib/types/user.ts';
	import type { ApiMe } from '#lib/api-client/client.ts';
	import { loadSession, watchSession, sessionStore } from '#lib/api-client/session.ts';
	import { browser } from '$app/env';

	/**
	 * Write (or clear) the `SIGNED_IN_FLAG_KEY` hint that this device has an
	 * authenticated session. Read by the root gate (`src/routes/+page.svelte`)
	 * on a cold load of `/`: while the auth handshake is still unresolved, a
	 * device carrying this hint is almost certainly resuming a session, so the
	 * gate holds a branded spinner (instead of the blank brand shell) until it
	 * bounces to `/flow` via a client-side `goto`. Wrapped in try/catch for SSR
	 * / private-mode safety: a missing flag just means the gate shows the
	 * blank shell during that window instead.
	 */
	const setSignedInFlag = (signedIn: boolean): void => {
		if (!browser) {
			return;
		}

		try {
			if (signedIn) {
				localStorage.setItem(SIGNED_IN_FLAG_KEY, '1');
			} else {
				localStorage.removeItem(SIGNED_IN_FLAG_KEY);
			}
		} catch {
			// localStorage may throw in private mode or when storage is
			// disabled. Silently degrade; the no-flash hint is purely
			// an optimisation.
		}
	};

	interface Props {
		children: Snippet;
	}

	const { children }: Props = $props();

	/**
	 * App-shell hydration: mirror the cookie session into `userStore`, which the
	 * whole authenticated app reads. The identity is the account id, the profile
	 * comes from the HTTP API, and the email rides the auth identity. A freshly
	 * created account with no stored profile hydrates the default shell with
	 * `profileExisted: false` so the onboarding drain runs for it.
	 */
	const hydrateAppShell = async (me: ApiMe): Promise<boolean> => {
		userStore.update((data) => ({ ...data, authBusy: true }));

		resetIdentityScopedState({ ownerKey: me.id });

		try {
			const user: User = { key: me.id, owner: me.id };
			const email = me.identities.find((identity) => (identity.email ?? '') !== '')?.email ?? '';
			const { profile, existed } = await loadProfileShell(me.id);

			setSignedInFlag(true);

			userStore.set({ user, profile, email, authBusy: false, profileExisted: existed });

			return true;
		} catch (e: unknown) {
			console.error('app-shell hydration failed', e);

			userStore.update((data) => ({ ...data, authBusy: false }));

			return false;
		}
	};

	const clearAppShell = (): void => {
		resetIdentityScopedState({ ownerKey: undefined });
		setSignedInFlag(false);

		userStore.set({
			user: undefined,
			profile: undefined,
			email: '',
			authBusy: false,
			profileExisted: false
		});
	};

	onMount(() => {
		// The root gate (src/routes/+page.svelte) keys off `userStore.authBusy`,
		// which boots `true`, so the probe must resolve it in BOTH outcomes or a
		// visitor hangs on the brand shell forever: the signed-out one here, the
		// live one through the hydration effect below, which releases it together
		// with the user (on success and on failure). Releasing it here for a live
		// session would open a window with no user and no busy flag, which the
		// (app) auth gate reads as signed out, bouncing every cold load of an app
		// route to /signin. `loadSession` never rejects: any failure resolves
		// to signed-out.
		const stopWatchingSession = watchSession();

		void loadSession().then((user) => {
			if (nonNullish(user)) {
				return;
			}

			setSignedInFlag(false);

			userStore.set({
				user: undefined,
				profile: undefined,
				email: '',
				authBusy: false,
				profileExisted: false
			});
		});

		return stopWatchingSession;
	});

	// Drive `userStore` off the cookie-session store. This covers both
	// sign-in entry points (the OTP verify that seeds the store in place and the
	// Google redirect that re-runs the mount probe) and sign-out, and settles the
	// signed-out steady state so the shell never hangs on `authBusy`. Guarded by
	// the last-hydrated id so a redundant store emission never re-fetches.
	let shellUserId: string | undefined;
	let shellSettled = false;

	$effect(() => {
		const { user, authBusy } = $sessionStore;

		if (authBusy) {
			return;
		}

		if (isNullish(user)) {
			if (nonNullish(shellUserId) || !shellSettled) {
				shellUserId = undefined;
				shellSettled = true;

				clearAppShell();
			}

			return;
		}

		if (shellUserId === user.id) {
			return;
		}

		shellUserId = user.id;
		shellSettled = true;

		// A failed hydration must not burn the guard: clearing it lets the next
		// store emission for the same session retry instead of stranding the
		// shell unhydrated until a reload.
		void hydrateAppShell(user).then((hydrated) => {
			if (!hydrated && shellUserId === user.id) {
				shellUserId = undefined;
			}
		});
	});

	// Mirror the current user's profile into `profilesStore` so every
	// surface that resolves a counterpart's display name via that cache
	// (activity feed, market recent trades, market discussion, …) renders
	// the viewer's own latest nickname/avatar instead of whatever the
	// public profile read most recently returned. Without this,
	// editing the nickname in this session leaves a stale entry in the
	// cache until the next page reload.
	$effect(() => {
		const { user, profile } = $userStore;

		if (!user?.owner || !profile) {
			return;
		}

		setCachedProfile({ principal: user.owner, profile });
	});
</script>

{@render children()}
