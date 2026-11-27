import { E2E_EMAIL_DOMAIN, E2E_OUTSIDER_EMAIL_DOMAIN } from '../backend/e2e/fixtures';
import { E2eBackend, expect, test } from './support/fixtures';
import { E2E_WEB2_API_URL } from './support/urls';

/**
 * Team-only sign-in as the API enforces it: the E2E stack boots with the
 * fixture domain as the team allowlist, so an address on any other domain
 * gets the neutral refusal and is never mailed a code, while a team address
 * signs in. Driven through the API, so it holds whatever the sign-in screen
 * looks like.
 */
test.describe('team-only sign-in', () => {
	const runTag = (): string => `${Date.now().toString(36)}${Math.floor(Math.random() * 1_000)}`;

	test('an address outside the team is refused and never mailed a code', async ({ playwright }) => {
		const api = await playwright.request.newContext({ baseURL: E2E_WEB2_API_URL });
		const email = `outsider.${runTag()}@${E2E_OUTSIDER_EMAIL_DOMAIN}`;

		try {
			await new E2eBackend(api).resetRateLimits();

			const requested = await api.post('/api/v1/auth/otp/request', {
				data: { email, turnstileToken: '' }
			});

			expect(requested.status()).toBe(403);
			expect(await requested.json()).toEqual({ error: 'beta_closed' });
			expect((await api.get(`/__e2e/otp/${encodeURIComponent(email)}`)).status()).toBe(404);
		} finally {
			await api.dispose();
		}
	});

	test('a team address signs in', async ({ playwright }) => {
		const api = await playwright.request.newContext({ baseURL: E2E_WEB2_API_URL });

		try {
			const backend = new E2eBackend(api);

			await backend.resetRateLimits();
			await backend.signIn(`team.${runTag()}@${E2E_EMAIL_DOMAIN}`);

			expect((await api.get('/api/v1/me')).status()).toBe(200);
		} finally {
			await api.dispose();
		}
	});
});
