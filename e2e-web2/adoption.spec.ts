import { E2E_LEGACY_ADOPT } from '../backend/e2e/fixtures';
import { Web2AppPage } from './pages/web2-app.page';
import { apiUrl, expect, test, type MeBody } from './support/fixtures';

/**
 * A legacy user whose data the importer parked on a provisional account signs
 * in with the matching email: the login adopts that account instead of
 * creating an empty twin, so the imported profile is theirs from the first
 * screen. Re-runs stay green: once adopted, the same address resolves to the
 * same account.
 */
test.describe('legacy account adoption', () => {
	test('signing in with the legacy email lands in the imported account', async ({
		page,
		backend
	}) => {
		const app = new Web2AppPage(page);

		await app.signIn({ email: E2E_LEGACY_ADOPT.email, backend });

		const me = (await (await page.request.get(apiUrl('/api/v1/me'))).json()) as MeBody;

		expect(me.user.legacyPrincipals.map(({ principal }) => principal)).toContain(
			E2E_LEGACY_ADOPT.principal
		);

		await page.goto('/profile');

		await expect(app.profileHandle).toHaveText(`@${E2E_LEGACY_ADOPT.nickname}`);
	});
});
