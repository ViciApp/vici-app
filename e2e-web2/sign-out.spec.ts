import { Web2AppPage, uniqueEmail, uniqueHandle } from './pages/web2-app.page';
import { apiUrl, expect, test } from './support/fixtures';

/**
 * Sign-out revokes the session server-side, not just locally: the cookie stops
 * resolving and the app routes back through the auth gate.
 */
test.describe('sign-out', () => {
	test('signing out revokes the session and gates the app again', async ({ page, backend }) => {
		const app = new Web2AppPage(page);

		await app.signUp({ email: uniqueEmail('signout'), handle: uniqueHandle(), backend });

		await app.signOut();

		await expect(page).toHaveURL(/\/signin$/);
		await expect(app.emailInput).toBeVisible();

		expect((await page.request.get(apiUrl('/api/v1/me'))).status()).toBe(401);

		await page.goto('/dash');

		await expect(page).toHaveURL(/\/signin$/);
	});
});
