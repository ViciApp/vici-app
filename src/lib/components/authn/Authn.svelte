<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { onAuthStateChange, signOut, type User } from '@junobuild/core';
	import { onMount, type Snippet } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import MovedToNewApp from '$lib/components/authn/MovedToNewApp.svelte';
	import { SIGNED_IN_FLAG_KEY } from '$lib/constants/app.constants';
	import { NEW_ACCOUNT_MOVED_SESSION_KEY } from '$lib/constants/claim.constants';
	import { PublicPath } from '$lib/constants/routes.constants';
	import { balanceDomain } from '$lib/derived/balance-domain.derived';
	import { trackLoginSyncSettled } from '$lib/dev/e2e-reset';
	import { reconcileIdentityScopedStorage } from '$lib/services/identity-storage.services';
	import { safeGetIdentityOnce } from '$lib/services/identity.services';
	import {
		ensureProfile,
		calculateAndSyncStats,
		forgetBootstrappedThisSession,
		loadWeb2ProfileShell
	} from '$lib/services/profile.services';
	import { receivedReactionsStore } from '$lib/stores/activity-reactions.store';
	import { clearAffiliations } from '$lib/stores/affiliations.store';
	import { followingStore } from '$lib/stores/following.store';
	import { clearFriendRelations } from '$lib/stores/friends.store';
	import { clearLeagues } from '$lib/stores/leagues.store';
	import { clearMyMenagerieSignals } from '$lib/stores/menagerie.store';
	import { positionsStore } from '$lib/stores/positions.store';
	import { setCachedProfile } from '$lib/stores/profiles.store';
	import { clearMyReferrals } from '$lib/stores/referrals.store';
	import { tradeHistoryStore } from '$lib/stores/trade-history.store';
	import { userStore } from '$lib/stores/user.store';
	import { isWeb2Backend } from '$lib/web2/backend-mode';
	import type { Web2Me } from '$lib/web2/client';
	import { loadWeb2Session, web2SessionStore } from '$lib/web2/session';

	/**
	 * Write (or clear) the `SIGNED_IN_FLAG_KEY` hint that this device has an
	 * authenticated session. Read by the root gate (`src/routes/+page.svelte`)
	 * on a cold load of `/`: while the auth handshake is still unresolved, a
	 * device carrying this hint is almost certainly resuming a session, so the
	 * gate holds a branded spinner (instead of the blank brand shell) until it
	 * bounces to `/flow` via a client-side `goto`. Wrapped in try/catch for SSR
	 * / private-mode safety — a missing flag just means the gate shows the
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
			// disabled. Silently degrade — the no-flash hint is purely
			// an optimisation.
		}
	};

	/**
	 * Ask the browser to keep this origin's storage persistent. The Internet
	 * Identity delegation lives in IndexedDB (`auth-client-db`); on iOS WebKit,
	 * script-writable storage is evicted after ~7 days of no interaction (ITP),
	 * which lands on the same horizon as the delegation TTL and silently logs
	 * the user out. A granted persist() request exempts the delegation store
	 * from that eviction. Idempotent and a no-op once persisted, so requesting
	 * once per established session is fine. Fire-and-forget: never block or
	 * throw on the auth path, and skip when the API is unavailable.
	 */
	const requestPersistentStorage = (): void => {
		if (
			!browser ||
			typeof navigator.storage?.persist !== 'function' ||
			typeof navigator.storage?.persisted !== 'function'
		) {
			return;
		}

		void (async () => {
			try {
				await navigator.storage.persist();
			} catch (e: unknown) {
				console.warn('Persistent storage request failed', e);
			}
		})();
	};

	interface Props {
		children: Snippet;
	}

	const { children }: Props = $props();

	/**
	 * Persist (or drop) the "turned away as a new account" marker. Juno's auth
	 * worker can follow our reload-free sign-out with its own reloading one, so
	 * the in-memory flag alone would lose the message on that reload.
	 * Best-effort: without storage the message still shows until a reload.
	 */
	const setNewAccountMovedMarker = (moved: boolean): void => {
		if (!browser) {
			return;
		}

		try {
			if (moved) {
				sessionStorage.setItem(NEW_ACCOUNT_MOVED_SESSION_KEY, '1');
			} else {
				sessionStorage.removeItem(NEW_ACCOUNT_MOVED_SESSION_KEY);
			}
		} catch {
			// Storage unavailable (private mode / disabled): see above.
		}
	};

	const readNewAccountMovedMarker = (): boolean => {
		if (!browser) {
			return false;
		}

		try {
			return sessionStorage.getItem(NEW_ACCOUNT_MOVED_SESSION_KEY) === '1';
		} catch {
			return false;
		}
	};

	// Set when a sign-in is turned away as a new account (see `ensureProfile`).
	// Lives here rather than on a route so the message survives whatever
	// navigation the provider that just resolved kicks off.
	let newAccountMoved = $state(readNewAccountMovedMarker());

	const setNewAccountMoved = (moved: boolean): void => {
		newAccountMoved = moved;
		setNewAccountMovedMarker(moved);
	};

	const dismissNewAccountMoved = (): void => {
		setNewAccountMoved(false);

		void goto(resolve(PublicPath.SignIn));
	};

	const updateUserStore = async (user: User | null) => {
		userStore.update((data) => ({ ...data, authBusy: true }));

		// Drop the previous principal's user-scoped caches on every auth
		// transition (sign-out, user switch, initial bootstrap). The next
		// `<Loaders />` cycle repopulates them for the new identity; this
		// just prevents user A's friends / positions / trade history from
		// briefly bleeding into user B's UI. Public caches (markets,
		// leaderboard, categories) intentionally stay populated.
		clearFriendRelations();
		clearAffiliations();
		clearLeagues();
		clearMyMenagerieSignals();
		clearMyReferrals();
		followingStore.set(undefined);
		positionsStore.set(undefined);
		tradeHistoryStore.set(undefined);
		receivedReactionsStore.set(undefined);

		// Same idea for the identity-scoped localStorage caches, except
		// those are local-authoritative (not server-backed) — see
		// `reconcileIdentityScopedStorage`.
		reconcileIdentityScopedStorage({ ownerKey: user?.owner });

		try {
			if (isNullish(user)) {
				setSignedInFlag(false);

				// Drop the new-user capture: the next sign-in (even same principal,
				// same tab) must be judged fresh, so a returning user isn't re-run
				// through the onboarding drain's new-user branch.
				forgetBootstrappedThisSession();

				userStore.set({
					user: undefined,
					profile: undefined,
					email: '',
					authBusy: false,
					profileExisted: false
				});

				return;
			}

			const { key: userText } = user;

			if (isNullish(userText)) {
				setSignedInFlag(false);

				forgetBootstrappedThisSession();

				userStore.set({
					user: undefined,
					profile: undefined,
					email: '',
					authBusy: false,
					profileExisted: false
				});

				return;
			}

			const ensured = await ensureProfile(user);

			if ('newAccountMoved' in ensured) {
				// A principal with no account here on a build that sends new
				// accounts to the new app: nothing was written, so drop the
				// session before any post-sign-in writer (stats sync, onboarding
				// drain, referral redeem) can run, and explain why.
				setSignedInFlag(false);
				forgetBootstrappedThisSession();

				userStore.set({
					user: undefined,
					profile: undefined,
					email: '',
					authBusy: false,
					profileExisted: false
				});

				setNewAccountMoved(true);

				try {
					// No reload of our own; if the auth worker still reloads, the
					// session marker brings the moved screen back.
					await signOut({ windowReload: false });
				} catch (e: unknown) {
					console.error('Failed to sign out a new account on the legacy build', e);
				}

				return;
			}

			const { profile, existed, email } = ensured;

			// An existing account got in, so any earlier turn-away no longer applies.
			setNewAccountMoved(false);
			setSignedInFlag(true);
			requestPersistentStorage();

			userStore.set({ user, profile, email, authBusy: false, profileExisted: existed });

			const syncRun = (async () => {
				const identity = await safeGetIdentityOnce();

				await calculateAndSyncStats({ identity, domain: $balanceDomain });
			})();

			// Register the sync (dev-only no-op in prod) so the e2e reset hook can
			// wait for it to settle before deleting the profile — otherwise this
			// sync's trailing profile write would resurrect the deleted doc.
			trackLoginSyncSettled(syncRun);

			try {
				await syncRun;
			} catch (e: unknown) {
				console.error('Failed to sync stats on login', e);
			}
		} finally {
			userStore.update((data) => ({ ...data, authBusy: false }));
		}
	};

	/**
	 * Web2 app-shell hydration: mirror the cookie session into `userStore` so the
	 * authenticated app renders for a web2 user exactly as it does on-chain. The
	 * on-chain path fills the same store via `ensureProfile`; here the identity is
	 * the account id (no principal), the profile comes from the HTTP API, and the
	 * email rides the auth identity rather than a private profile doc. A freshly
	 * created account with no stored profile hydrates the default shell with
	 * `profileExisted: false` so the onboarding drain runs identically.
	 *
	 * The stats sync (`calculateAndSyncStats`) is intentionally not run: it reads
	 * the on-chain clearing history, which stays on the engine backend until the
	 * custody / engine bridge lands.
	 */
	const hydrateWeb2AppShell = async (me: Web2Me): Promise<boolean> => {
		userStore.update((data) => ({ ...data, authBusy: true }));

		try {
			const user: User = { key: me.id, owner: me.id, data: {} };
			const email = me.identities.find((identity) => (identity.email ?? '') !== '')?.email ?? '';
			const { profile, existed } = await loadWeb2ProfileShell(me.id);

			setSignedInFlag(true);

			userStore.set({ user, profile, email, authBusy: false, profileExisted: existed });

			return true;
		} catch (e: unknown) {
			console.error('web2 app-shell hydration failed', e);

			userStore.update((data) => ({ ...data, authBusy: false }));

			return false;
		}
	};

	const clearWeb2AppShell = (): void => {
		setSignedInFlag(false);
		forgetBootstrappedThisSession();

		userStore.set({
			user: undefined,
			profile: undefined,
			email: '',
			authBusy: false,
			profileExisted: false
		});
	};

	onMount(() => {
		// Web2 mode has no on-chain identity to observe: the session is a cookie,
		// so "signed in" is a `/me` probe mirrored into `web2SessionStore`, not a
		// Juno auth transition. The on-chain path below is left exactly as is and
		// runs whenever the flag is off (the default).
		if (isWeb2Backend()) {
			// The root gate (src/routes/+page.svelte) keys off `userStore.authBusy`,
			// which boots `true`, so the probe must resolve it in BOTH outcomes or
			// a web2 visitor hangs on the brand shell forever. `loadWeb2Session`
			// never rejects: any failure resolves to signed-out.
			void loadWeb2Session().then((user) => {
				if (isNullish(user)) {
					setSignedInFlag(false);

					// Explicit signed-out state, mirroring the on-chain reset above.
					userStore.set({
						user: undefined,
						profile: undefined,
						email: '',
						authBusy: false,
						profileExisted: false
					});

					return;
				}

				// A live cookie session only releases the gate here; hydrating the
				// user/profile into `userStore` belongs to the profiles domain swap.
				userStore.update((data) => ({ ...data, authBusy: false }));
			});

			return;
		}

		const unsubscribe = onAuthStateChange(updateUserStore);

		return () => {
			unsubscribe();
		};
	});

	// Web2 only: drive `userStore` off the cookie-session store. This covers both
	// sign-in entry points (the OTP verify that seeds the store in place and the
	// Google redirect that re-runs the mount probe) and sign-out, and settles the
	// signed-out steady state so the shell never hangs on `authBusy`. Guarded by
	// the last-hydrated id so a redundant store emission never re-fetches.
	let web2ShellUserId: string | undefined;
	let web2ShellSettled = false;

	$effect(() => {
		if (!isWeb2Backend()) {
			return;
		}

		const { user, authBusy } = $web2SessionStore;

		if (authBusy) {
			return;
		}

		if (isNullish(user)) {
			if (nonNullish(web2ShellUserId) || !web2ShellSettled) {
				web2ShellUserId = undefined;
				web2ShellSettled = true;

				clearWeb2AppShell();
			}

			return;
		}

		if (web2ShellUserId === user.id) {
			return;
		}

		web2ShellUserId = user.id;
		web2ShellSettled = true;

		// A failed hydration must not burn the guard: clearing it lets the next
		// store emission for the same session retry instead of stranding the
		// shell unhydrated until a reload.
		void hydrateWeb2AppShell(user).then((hydrated) => {
			if (!hydrated && web2ShellUserId === user.id) {
				web2ShellUserId = undefined;
			}
		});
	});

	// Mirror the current user's profile into `profilesStore` so every
	// surface that resolves a counterpart's display name via that cache
	// (activity feed, market recent trades, market discussion, …) renders
	// the viewer's own latest nickname/avatar instead of whatever the
	// satellite-side public read most recently returned. Without this,
	// editing the nickname in this session leaves a stale entry in the
	// cache until the next page reload.
	$effect(() => {
		const { user, profile } = $userStore;

		if (!user?.owner || !profile) {
			return;
		}

		setCachedProfile({ principal: user.owner, profile });
	});

	// No-op: the auth-timer event clears the session via the auth state
	// change above; nothing extra to do here.
	const automaticSignOut = (): void => {};
</script>

<svelte:window onjunoSignOutAuthTimer={automaticSignOut} />

{@render children()}

{#if newAccountMoved}
	<MovedToNewApp onSignIn={dismissNewAccountMoved} reason="new_account" />
{/if}
