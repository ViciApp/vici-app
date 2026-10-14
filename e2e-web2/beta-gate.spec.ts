import { E2E_ADMIN_EMAIL, E2E_LEGACY_PENDING } from '../backend/e2e/fixtures';
import { Web2AppPage, uniqueEmail } from './pages/web2-app.page';
import { expect, test } from './support/fixtures';

/**
 * The beta access gate as an operator drives it (the admin settings API) and
 * as a visitor meets it (the sign-in screen). The `admin` fixture clears the
 * gate on teardown, so every other spec runs with it open.
 */
test.describe('beta access gate', () => {
	test('the allowlist-only gate refuses an unknown email with the beta message', async ({
		page,
		admin
	}) => {
		const app = new Web2AppPage(page);

		await admin.setBetaGate({ enabled: true, emails: [E2E_ADMIN_EMAIL] });

		await page.goto('/signin');
		await app.requestCode(uniqueEmail('closed'));

		await expect(app.betaClosedMessage).toBeVisible();
		// Refused before any code is issued: the screen never advances.
		await expect(app.codeInput).toBeHidden();
	});

	test('allowNewUsers admits a new email and holds a legacy one on the legacy app', async ({
		page,
		admin,
		backend
	}) => {
		const app = new Web2AppPage(page);

		await admin.setBetaGate({ enabled: true, emails: [E2E_ADMIN_EMAIL], allowNewUsers: true });

		// A new person gets a code and a session.
		const newcomer = uniqueEmail('newcomer');

		await page.goto('/signin');
		await app.requestCode(newcomer);
		await app.enterCode({ email: newcomer, backend });
		await app.waitForSignedInShell();

		// An address with a legacy account is told to stay on the legacy app.
		await page.context().clearCookies();
		await page.goto('/signin');
		await app.requestCode(E2E_LEGACY_PENDING.email);

		await expect(app.legacyPendingMessage).toBeVisible();
		await expect(app.legacyAppLink).toHaveAttribute('href', 'https://vici.market');
		await expect(app.codeInput).toBeHidden();
	});

	test('the OAuth refusal marker renders the legacy message and is stripped', async ({ page }) => {
		const app = new Web2AppPage(page);

		await page.goto('/signin?e=legacy');

		await expect(app.legacyPendingMessage).toBeVisible();
		await expect(app.legacyAppLink).toBeVisible();
		await expect(page).toHaveURL(/\/signin$/);
	});
});
