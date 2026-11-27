import { Web2AppPage, uniqueEmail, uniqueHandle } from './pages/web2-app.page';
import { apiUrl, expect, test, type MeBody } from './support/fixtures';

/**
 * A brand-new team member signs in with an email one-time code on `/team`: the
 * API mints the account on the verified address, and the `/signup` handle step
 * the app sends a handle-less account to writes the claimed handle onto the
 * new profile.
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

	test('the handle is cleaned to the rule as it is typed and claimed cleaned', async ({
		page,
		backend
	}) => {
		const app = new Web2AppPage(page);
		const handle = uniqueHandle();
		const typed = `${handle.slice(0, 3).toUpperCase()}.${handle.slice(3)}`;

		await app.signUp({ email: uniqueEmail('signupclean'), handle: typed, backend });

		await page.goto('/profile');

		await expect(app.profileHandle).toHaveText(`@${handle}`);
	});
});
