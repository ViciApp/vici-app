import { SIGNED_IN_FLAG_KEY } from '#lib/constants/app.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import { isDev } from '#lib/env/app.env.ts';
import { userStore } from '#lib/stores/user.store.ts';
import type { ProfilePrivate, UserProfile } from '#lib/types/profile.ts';
import { sleep } from '#lib/utils/async.utils.ts';
import { browser } from '$app/env';
import { isNullish, nonNullish } from '@dfinity/utils';
import { deleteDoc, getDoc } from '@junobuild/core';
import { get } from 'svelte/store';

/**
 * Global handle the dev-only e2e reset hook is exposed under. Typed here (not
 * `any`) so callers and the Playwright `page.evaluate` stay checked.
 */
export interface E2eHooks {
	/** Hard-delete the signed-in principal's profile doc. Resolves once gone. */
	resetMyProfile: () => Promise<void>;
	/**
	 * DURABLY clear the persisted authenticated identity so the next full page
	 * load is signed-out. Call this while still on an `(app)` route (this hook
	 * only exists inside the `(app)` layout) and then cold-load the target page.
	 *
	 * Deliberately paired with a plain navigation rather than Juno `signOut()`:
	 * `signOut()` re-saves the dev identity Juno keeps in `juno-dev-identifiers`,
	 * so the next load auto-restores the session and /signup bounces to /flow.
	 * Runs while signed-in (in-memory identity untouched), so the shell keeps
	 * working until the caller navigates away. Idempotent.
	 */
	clearSession: () => Promise<void>;
}

declare global {
	interface Window {
		__viciE2E?: E2eHooks;
	}
}

/**
 * Tail of the in-flight post-sign-in stats syncs (`calculateAndSyncStats`),
 * chained so a single await covers every sync registered so far. DEV ONLY;
 * stays `Promise.resolve()` in production because {@link trackLoginSyncSettled}
 * no-ops there.
 *
 * Why this exists: `calculateAndSyncStats` ends by writing the profile through
 * `patchProfile` → `upsertProfile`, a versionless `setDoc` that CREATES the doc
 * when it reads as absent. So if {@link resetMyProfile} deletes the doc while
 * that sync is still running, the sync's trailing write re-creates it and the
 * next sign-in wrongly looks like a returning user. The sync is a long async
 * chain (trade history + leagues + battles + rank + monthly stats before the
 * write), so its write can land well after any fixed post-delete watch window,
 * which is why watching for resurrection alone was flaky. The deterministic fix
 * is to wait for the sync to fully settle BEFORE deleting.
 */
let loginSyncChain: Promise<void> = Promise.resolve();

/**
 * Register a post-sign-in stats sync so {@link resetMyProfile} can await it
 * before deleting the profile. Called by the auth boundary (`Authn.svelte`) as
 * each sync starts. DEV ONLY (and browser-only): a no-op elsewhere, so it never
 * adds bookkeeping to a real session. Never rejects; a failed sync still
 * settles the chain (a delete after a failed sync is safe).
 */
export const trackLoginSyncSettled = (run: Promise<unknown>): void => {
	if (!browser || !isDev()) {
		return;
	}

	const settled = run.then(
		() => undefined,
		() => undefined
	);

	loginSyncChain = Promise.all([loginSyncChain, settled]).then(() => undefined);
};

/**
 * Upper bound on the pre-delete sync wait. The wait is an optimisation (it lets
 * the delete run cleanly instead of relying on the resurrection watch), so it
 * must never be able to hang the Playwright run: if `calculateAndSyncStats` (or
 * anything it awaits) stalls, we time out and fall through to the delete +
 * bounded resurrection watch below. Comfortably above the normal sync time on
 * the emulator (a handful of sequential canister reads).
 */
const LOGIN_SYNC_SETTLE_TIMEOUT_MS = 15_000;

/**
 * Resolve once no tracked login sync is in flight, OR the timeout elapses,
 * whichever comes first. Re-awaits until the chain reference stops changing, so
 * a sync registered by a second `onAuthStateChange` pass mid-await (the
 * double-fire race) is covered too. The post-sign-in write storm is finite, so
 * the settle path converges; the timeout is the safety valve for a hung sync.
 */
const waitForLoginSyncSettled = async (): Promise<void> => {
	const settled = (async () => {
		let awaited: Promise<void> | undefined;

		while (awaited !== loginSyncChain) {
			awaited = loginSyncChain;

			await awaited;
		}
	})();

	await Promise.race([settled, sleep(LOGIN_SYNC_SETTLE_TIMEOUT_MS)]);
};

/**
 * Hard-delete the signed-in principal's profile doc so the NEXT sign-in is
 * seen as a brand-new user: `ensureProfile` finds no versioned doc and
 * bootstraps fresh.
 *
 * Exists only to let the Playwright onboarding spec escape the shared dev
 * mock identity: `signIn({ dev: {} })` resolves to ONE principal for the
 * whole CI run, and earlier specs (every `signInAsDevUser`) auto-claim the
 * handle field's pool suggestion and complete onboarding for it, so by the
 * time the onboarding spec runs, that principal is a fully-onboarded
 * returning user and the new-user handle handoff can't be exercised. Deleting
 * the profile first restores the pristine pre-onboarding state.
 *
 * The `profiles` collection is public-write and carries no delete assert, so
 * the owner can remove their own doc.
 *
 * The chief resurrector is the finishing login's `calculateAndSyncStats`: it
 * fetches trade history (and leagues / battles / rank / monthly stats) before
 * writing the profile through `upsertProfile`'s versionless `setDoc` (absent
 * doc → create). If that write lands after our delete, the doc resurrects and
 * the next sign-in wrongly looks like a returning user. Because its write can
 * come well after any fixed post-delete watch window, we first
 * {@link waitForLoginSyncSettled}: the sync is tracked by `Authn.svelte` via
 * {@link trackLoginSyncSettled}, so the delete has nothing racing it.
 *
 * Two further races can still leave the doc present after a naive delete:
 *
 *  1. A concurrent write bumps the version between our read and our delete, so
 *     `deleteDoc` traps `juno.error.version_outdated_or_future`. Re-read fresh
 *     and retry until the version is current.
 *
 *  2. A stray write re-creates the doc just after our delete. Belt-and-braces
 *     for anything the sync-settle wait didn't cover, we watch for a
 *     resurrecting write across a settle window and re-delete if the doc
 *     reappears.
 *
 * The post-sign-in write storm is finite, so this converges once it drains.
 * The caller must then reach the signed-out surface WITHOUT a signed-in page
 * load in between (use {@link E2eHooks.clearSession} in place + a cold nav, not
 * a navigation to the Settings sign-out surface); a signed-in navigation would
 * re-run `ensureProfile` and bootstrap a fresh doc, which no watching here can
 * prevent.
 */
const DELETE_ATTEMPTS = 10;
const DELETE_RETRY_DELAY_MS = 250;
/** How long the doc must stay absent after a delete to be considered settled. */
const RESURRECTION_WATCH_MS = 2_000;
const RESURRECTION_POLL_MS = 250;

const readProfileDoc = (principal: string) =>
	getDoc<UserProfile>({ collection: Collection.PROFILES, key: principal });

/**
 * Drop the shared dev principal's owner-private `profile_private` doc so a
 * later spec's "new user" doesn't inherit an email persisted by an earlier
 * one. Single-writer (no post-sign-in storm touches this collection), so a
 * plain read-then-delete suffices: no retry / resurrection watch needed.
 */
const resetMyPrivateProfile = async (principal: string): Promise<void> => {
	const existing = await getDoc<ProfilePrivate>({
		collection: Collection.PROFILE_PRIVATE,
		key: principal
	});

	if (nonNullish(existing)) {
		await deleteDoc({ collection: Collection.PROFILE_PRIVATE, doc: existing });
	}
};

const resetMyProfile = async (): Promise<void> => {
	const principal = get(userStore).user?.key;

	if (isNullish(principal)) {
		return;
	}

	// Let the post-sign-in stats sync finish its profile write FIRST, so it
	// can't resurrect the doc we're about to delete (see the header). Bounded:
	// on a hung sync this times out and the resurrection watch below takes over,
	// so the reset can never hang the Playwright run.
	await waitForLoginSyncSettled();

	await resetMyPrivateProfile(principal);

	for (let attempt = 0; attempt < DELETE_ATTEMPTS; attempt += 1) {
		const existing = await readProfileDoc(principal);

		let deleted = true;

		if (nonNullish(existing)) {
			try {
				await deleteDoc({ collection: Collection.PROFILES, doc: existing });
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);

				if (!message.includes('version_outdated_or_future') || attempt === DELETE_ATTEMPTS - 1) {
					throw err;
				}

				// A concurrent write bumped the version between the read and the
				// delete; wait for it to land, then re-read and retry on the next
				// loop pass.
				await sleep(DELETE_RETRY_DELAY_MS);

				deleted = false;
			}
		}

		if (deleted) {
			// The doc is gone. Confirm it STAYS gone; a trailing post-sign-in
			// write can re-create it (see the header). If it reappears within the
			// window, loop and delete the resurrected doc; otherwise the reset is
			// settled.
			let resurrected = false;

			for (let waited = 0; waited < RESURRECTION_WATCH_MS; waited += RESURRECTION_POLL_MS) {
				await sleep(RESURRECTION_POLL_MS);

				if (nonNullish(await readProfileDoc(principal))) {
					resurrected = true;

					break;
				}
			}

			if (!resurrected) {
				return;
			}
		}
	}

	throw new Error(
		'resetMyProfile: profile doc kept being re-created after delete; the post-sign-in write storm never settled.'
	);
};

/**
 * The two IndexedDB databases that persist the AUTHENTICATED IDENTITY, which
 * `onAuthStateChange` rehydrates on every cold load:
 *  - `juno-dev-identifiers`: the Juno `dev` mock identity (the store the
 *    onboarding spec actually needs cleared; the CI e2e matrix signs in with it).
 *  - `auth-client-db`: the IC auth-client delegation store (real II/OpenID
 *    providers); empty for the dev provider but cleared for completeness.
 *
 * We clear ONLY these: NOT the `icp-sdk-*` agent caches (root key / query
 * verification). Wiping those forced a cold agent re-init that made the post-
 * sign-in `calculateAndSyncStats` slow enough on the low-end mobile project for
 * the onboarding-handoff drain (serialized behind it on the profile patch queue)
 * to miss the spec's poll window. Dropping the identity is all that's needed to
 * sign the next cold load out.
 */
const IDENTITY_DB_NAMES = ['juno-dev-identifiers', 'auth-client-db'] as const;

/**
 * Empty every object store in one IndexedDB database, resolving once the
 * transaction commits (or on any error / a missing store). Clearing rather than
 * `deleteDatabase` on purpose: the auth-client keeps its own connection open,
 * which would leave a `deleteDatabase` blocked indefinitely; a `readwrite`
 * transaction on a second connection is serialized normally and completes.
 * Awaiting the commit is what makes the clear durable, unlike a fire-and-forget
 * delete.
 */
const clearDatabaseStores = (dbName: string): Promise<void> =>
	new Promise((resolve) => {
		let settled = false;

		const done = (db?: IDBDatabase): void => {
			db?.close();

			if (!settled) {
				settled = true;

				resolve();
			}
		};

		try {
			const open = indexedDB.open(dbName);

			open.onerror = () => done();

			open.onsuccess = () => {
				const db = open.result;
				const storeNames = Array.from(db.objectStoreNames);

				if (storeNames.length === 0) {
					done(db);

					return;
				}

				try {
					const tx = db.transaction(storeNames, 'readwrite');

					for (const name of storeNames) {
						tx.objectStore(name).clear();
					}

					tx.oncomplete = () => done(db);
					tx.onerror = () => done(db);
					tx.onabort = () => done(db);
				} catch {
					done(db);
				}
			};
		} catch {
			done();
		}
	});

/**
 * Durably clear the persisted authenticated identity so the next full page load
 * is signed-out. Scoped to {@link IDENTITY_DB_NAMES} plus the signed-in localStorage
 * hint: deliberately NOT the `icp-sdk-*` agent caches or datastore caches (see
 * {@link IDENTITY_DB_NAMES} for why: wiping them slowed post-sign-in hydration and
 * broke the handoff drain's poll window).
 *
 * Runs on an `(app)` route (see {@link E2eHooks.clearSession}) while still
 * signed-in; the caller then cold-loads the target page, which reads the wiped
 * identity as signed-out.
 *
 * We do NOT use Juno `signOut()` to reach signed-out: it re-saves the dev
 * identity in `juno-dev-identifiers`, so the next load auto-restores the session
 * and /signup bounces to /flow: the exact flake this defeats. Clearing the
 * identity store and then navigating avoids the re-persist entirely.
 */
const clearSession = async (): Promise<void> => {
	try {
		localStorage.removeItem(SIGNED_IN_FLAG_KEY);
	} catch {
		// localStorage may be unavailable (private mode / disabled); the identity
		// clear below is what actually gates the signed-in state on the next load.
	}

	await Promise.all(IDENTITY_DB_NAMES.map((name) => clearDatabaseStores(name)));
};

/**
 * Install the e2e reset hook on `window`: DEV ONLY. A no-op in production
 * (and any non-browser context), so it never adds a profile-deletion surface
 * to a real build. Called once from the `(app)` layout on mount.
 */
export const installE2eResetHook = (): void => {
	if (!browser || !isDev()) {
		return;
	}

	window.__viciE2E = { resetMyProfile, clearSession };
};
