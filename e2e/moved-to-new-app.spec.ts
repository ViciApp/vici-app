import { expect, test } from '@playwright/test';
import { E2E_OPEN_SIGNUPS_STORAGE_KEY } from '../src/lib/constants/e2e.constants';
import { TestId } from '../src/lib/constants/test-ids.constants';
import { HomePage } from './pages/home.page';

/**
 * The legacy build sends new accounts to the new app. The suite-wide opt-in
 * (`playwright.config.ts`) keeps sign-ups open for every other spec, so these
 * run without it.
 *
 * The destination is asserted on the link's `href` only: CI has no route to
 * the new app, and the link is the contract (it carries any invite or
 * referral code captured on the way in).
 */
const NEW_APP_ORIGIN = 'https://vici.app';

// Well-formed codes; they needn't exist, the signed-out landings stash them
// blindly.
const REFERRAL_CODE = 'ABCDEF12';
const LEAGUE_CODE = 'ABC123';

test.describe('moved to the new app (signed out)', () => {
	test.use({ storageState: { cookies: [], origins: [] } });

	test('/signup shows the moved screen instead of onboarding', async ({ page }) => {
		const home = new HomePage(page);

		await page.goto('/signup');

		await expect(page.getByTestId(TestId.MovedToNewApp)).toBeVisible();
		await expect(home.onboarding).toHaveCount(0);
		await expect(page.getByTestId(TestId.MovedToNewAppCta)).toHaveAttribute(
			'href',
			`${NEW_APP_ORIGIN}/signup`
		);

		// Existing accounts keep their way in.
		await page.getByTestId(TestId.MovedToNewAppSignIn).click();

		await page.waitForURL('**/signin');

		await expect(home.signInDevButton).toBeVisible();
	});

	test('an invite link carries its referral code to the new app', async ({ page }) => {
		await page.goto(`/i/${REFERRAL_CODE}`);

		await page.waitForURL('**/signup');

		await expect(page.getByTestId(TestId.MovedToNewAppCta)).toHaveAttribute(
			'href',
			`${NEW_APP_ORIGIN}/i/${REFERRAL_CODE}`
		);
	});

	test('a league invite carries its codes to the new app', async ({ page }) => {
		await page.goto(`/league/${LEAGUE_CODE}?ref=${REFERRAL_CODE}`);

		await page.waitForURL('**/signup');

		await expect(page.getByTestId(TestId.MovedToNewAppCta)).toHaveAttribute(
			'href',
			`${NEW_APP_ORIGIN}/league/${LEAGUE_CODE}?ref=${REFERRAL_CODE}`
		);
	});
});

test.describe('moved to the new app (sign-in with no account)', () => {
	test('a sign-in with no profile is signed back out and never creates one', async ({ page }) => {
		const home = new HomePage(page);

		// Give the shared dev principal the "no account here" state: sign in
		// with sign-ups open, delete its profile, and drop the persisted session
		// without a signed-in reload in between (see `resetDevProfile`).
		await home.signInAsDevUser();
		await home.resetDevProfile();
		await home.clearDevSession();

		await page.evaluate((key) => localStorage.removeItem(key), E2E_OPEN_SIGNUPS_STORAGE_KEY);

		await home.gotoSignIn();

		const moved = page.getByTestId(TestId.MovedToNewApp);

		await home.signInDevButton.click();

		await expect(moved).toBeVisible();
		await expect(page.getByTestId(TestId.MovedToNewAppCta)).toHaveAttribute(
			'href',
			`${NEW_APP_ORIGIN}/signup`
		);
		await expect(home.userMenu).toHaveCount(0);

		await page.getByTestId(TestId.MovedToNewAppSignIn).click();

		await expect(moved).toHaveCount(0);

		await page.waitForURL('**/signin');

		// A second attempt is turned away the same way, which it could not be if
		// the first one had left a profile behind.
		await home.signInDevButton.click();

		await expect(moved).toBeVisible();
		await expect(home.userMenu).toHaveCount(0);
	});
});
