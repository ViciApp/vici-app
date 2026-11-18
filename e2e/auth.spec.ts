import { expect, test } from '@playwright/test';
import { HomePage } from './pages/home.page';

/**
 * Sign-in flow against the Juno emulator using the dev-only mock identity
 * (`signIn({ dev: {} })`), the same path Juno's official E2E guide
 * recommends. Real Internet Identity flows can be added in a follow-up;
 * the dev provider exercises the same `onAuthStateChange` pipeline, which
 * is what makes a sign-in / sign-out test useful.
 *
 * A fresh dev principal has no profile, so signing in routes the new user
 * through the `/signup` onboarding beats before the app shell; that's the
 * canonical new-user flow, driven end-to-end by `signInAsDevUser`. Sign-out
 * lives on the Settings page and returns the user to `/signin`.
 */
test.describe('authentication (dev sign-in)', () => {
	test('signs in via the dev mock identity and signs back out', async ({ page }) => {
		const home = new HomePage(page);

		await home.signInAsDevUser();

		await expect(home.userMenu).toBeVisible();

		// Land on the signed-in markets board and snapshot it. The feed may
		// be empty depending on the World-Cup release schedule, so we assert
		// the board container rather than a card count; the snapshot still
		// catches any structural drift.
		await home.gotoMarkets();

		await expect(home.marketFeed).toBeVisible();

		await page.waitForLoadState('networkidle');

		await home.stabilizeForSnapshot();

		// Mask the account control only: dev sign-in mints a fresh principal
		// each run, so the derived handle genuinely differs. Time-remaining
		// chips and principal text are handled by `stabilizeForSnapshot`.
		await expect(page).toHaveScreenshot('homepage-logged-in.png', {
			fullPage: true,
			mask: [home.userMenu]
		});

		await home.logout();

		// Sign-out routes the user back through the auth gate to /signin.
		await page.waitForURL('**/signin');

		await expect(home.signInDevButton).toBeVisible();
		await expect(home.userMenu).not.toBeVisible();
	});
});
