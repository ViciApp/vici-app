import { enMessages } from '../src/lib/constants/messages/en';
import { Web2AppPage } from './pages/web2-app.page';
import { expect, test } from './support/fixtures';

/**
 * Sign-in is team-only: the public sign-in and sign-up addresses and every app
 * surface send a signed-out visitor to the landing, the landing offers no way
 * in, and the team signs in at the unlinked `/team`.
 */

const SIGN_IN_PATHS = ['/signin', '/signup', '/team'];

test.describe('team-only sign-in, signed out', () => {
	for (const path of ['/signin', '/signup', '/flow', '/dash', '/admin']) {
		test(`${path} lands on the landing`, async ({ page }) => {
			await page.goto(path);

			await expect(page).toHaveURL((url) => url.pathname === '/');
		});
	}

	for (const path of ['/', '/?view=markets']) {
		test(`the landing at ${path} links to no sign-in`, async ({ page }) => {
			await page.goto(path);

			// The claim button is the landing's own call to action: once it is on
			// screen the landing has rendered.
			await expect(
				page.getByRole('button', { name: enMessages['landing.nav.claim'] }).first()
			).toBeVisible();

			for (const signInPath of SIGN_IN_PATHS) {
				await expect(
					page.locator(`a[href="${signInPath}"], a[href^="${signInPath}?"]`)
				).toHaveCount(0);
			}

			await expect(page.getByRole('link', { name: enMessages['nav.signin'] })).toHaveCount(0);
			await expect(page.getByRole('button', { name: enMessages['nav.signin'] })).toHaveCount(0);
		});
	}

	test('/team is the sign-in screen, kept out of search', async ({ page }) => {
		const app = new Web2AppPage(page);

		await app.openSignIn();

		await expect(app.emailInput).toBeVisible();
		await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
	});

	test('/team?e=beta shows the refusal and drops the marker', async ({ page }) => {
		const app = new Web2AppPage(page);

		await app.openSignIn('?e=beta');

		await expect(app.betaClosedMessage).toBeVisible();
		await expect(page).toHaveURL(/\/team$/);
	});

	test('/team?e=google says the sign-in did not complete', async ({ page }) => {
		await new Web2AppPage(page).openSignIn('?e=google');

		await expect(page.getByText(enMessages['signin.oauth_failed'])).toBeVisible();
		await expect(page).toHaveURL(/\/team$/);
	});
});
