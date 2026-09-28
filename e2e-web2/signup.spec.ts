import { Web2AppPage, uniqueEmail, uniqueHandle } from './pages/web2-app.page';
import { apiUrl, expect, test, type MeBody } from './support/fixtures';

/**
 * A brand-new person signs up with an email one-time code: the `/signup`
 * onboarding claims a handle, the API mints the account on the verified
 * address, and the onboarding handoff writes the claimed handle onto the new
 * profile once the app shell hydrates the session.
 */
test.describe('email sign-up', () => {
	test('a new user signs up with a code and lands in the app with the claimed handle', async ({
		page,
		backend
	}) => {
		const app = new Web2AppPage(page);
		const email = uniqueEmail('signup');
		const handle = uniqueHandle();

		await app.signUp({ email, handle, backend });

		await expect(page).toHaveURL(/\/flow$/);

		// The session is the cookie the verify response set, and it resolves to
		// an account holding exactly this email identity.
		const me = await page.request.get(apiUrl('/api/v1/me'));

		expect(me.status()).toBe(200);
		expect(((await me.json()) as MeBody).user.identities).toEqual([{ provider: 'email', email }]);

		await page.goto('/profile');

		await expect(app.profileHandle).toHaveText(`@${handle}`);
	});
});
