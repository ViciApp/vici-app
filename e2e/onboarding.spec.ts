import { expect, test } from '@playwright/test';
import { HomePage } from './pages/home.page';

/**
 * Pre-sign-in onboarding (`/signup`), the one-screen flow:
 *
 *   claim a handle (typed or the pool placeholder) and sign up on a single
 *   surface; the provider stack ungates once the handle is claimable.
 *
 * Types a handle, signs in via the dev mock identity, and asserts the
 * claimed handle survives the handoff onto the new profile.
 *
 * The dev provider resolves `signIn({ dev: {} })` synchronously and fires
 * `onSuccess` before the new profile hydrates, so `/signup`'s
 * `handleCompleteAuthenticated` can't upsert the picks immediately; it
 * falls back to the pending-onboarding stash, which the `(app)` layout
 * drain applies once the profile lands. The handle is also stashed
 * synchronously on the auth-surface pointer-down, so a redirect provider
 * would carry it through too. This test guards that path: the profile hero
 * must show the claimed handle, not the bootstrapped principal default.
 *
 * The dev mock identity is ONE principal for the whole CI run, and every
 * earlier `signInAsDevUser` auto-claims the handle field's pool suggestion
 * and completes onboarding for it, so without a reset this principal is a
 * fully-onboarded returning user and the handoff is (correctly) a no-op. We
 * therefore sign in, hard-delete its profile via the dev-only reset hook, wipe
 * the persisted session in place, then cold-load `/signup`, so the run below
 * exercises a genuine new user.
 */
test.describe('pre-sign-in onboarding', () => {
	test('claims a handle and applies it after dev sign-in', async ({ page }) => {
		const home = new HomePage(page);

		// Restore the pristine, pre-onboarding state for the shared dev principal
		// (see the file header) so the handle handoff runs its new-user path.
		//
		// Ordering is load-bearing: the profile delete must be the LAST signed-in
		// action, and no signed-in page LOAD may happen before the signed-out
		// `/signup`. So we delete, then wipe the persisted session in place
		// (`clearDevSession`) while still on `/flow`, then cold-load `/signup`.
		// We deliberately do NOT call Juno `signOut()`: it re-saves the dev
		// identity Juno persists in `juno-dev-identifiers`, which would auto-
		// restore on the next load and bounce `/signup` back to `/flow` (see
		// `clearDevSession`). The full `goto` below tears down the in-memory
		// session and the wiped storage makes the fresh load signed-out.
		await home.signInAsDevUser();
		await home.resetDevProfile();
		await home.clearDevSession();

		await page.goto('/signup');

		await expect(home.onboarding).toBeVisible();

		// Type a unique handle (collision-proof across runs) and let the live
		// availability probe clear it: the dev provider button stays disabled
		// until the handle is claimable, so its enabled state is the signal.
		const pickedHandle = `e2e${Date.now().toString(36)}`;

		await home.onboardingHandleInput.fill(pickedHandle);

		await expect(home.signInDevButton).toBeEnabled();

		// Sign in with the dev mock identity. The pointer-down stashes the
		// claimed handle before the provider runs; success drains the handoff.
		await home.signInDevButton.click();

		await home.waitForSignedInShell();

		// The handle handoff is applied asynchronously by the `(app)` layout
		// drain once the profile hydrates (see the file header): it upserts the
		// claimed handle to the satellite, then clears the pre-auth stash under
		// `vici:pending-onboarding`. Wait for that slot to drain before
		// navigating: a full page load to `/profile` re-bootstraps from the
		// satellite, and doing it mid-drain would read the not-yet-persisted
		// profile (and flip the drain onto its returning-user branch), racing
		// the handoff. Waiting on the slot can't mask a real failure: every
		// drain outcome clears it, so a failed upsert still fails the handle
		// assertion below.
		//
		// Generous timeout: the drain's profile write is serialized behind this
		// finishing login's `calculateAndSyncStats` on the shared patch queue, and
		// that sync fans out to many canister reads/writes; on the low-end mobile
		// project against the CI emulator it can take a while to drain.
		await expect
			.poll(() => page.evaluate(() => localStorage.getItem('vici:pending-onboarding')), {
				timeout: 60_000
			})
			.toBeNull();

		// The handle-claim path completed and reached the signed-in app.
		await page.goto('/profile');

		await expect(home.appMain).toBeVisible();
		await expect(home.userMenu).toBeVisible();

		// The claimed handle survived the dev-provider handoff: the profile
		// hero shows `@{handle}`, not the bootstrapped principal default. The
		// hero handle is an editable button (`.profile-hero-handle`) on one's
		// own profile and an `<h1>` on others'; both carry that class, so
		// target it directly rather than the element type.
		await expect(
			home.appMain.locator('.profile-hero-handle').filter({ hasText: `@${pickedHandle}` })
		).toBeVisible();
	});
});
