import { test as base, expect, type APIRequestContext } from '@playwright/test';
import { E2E_ADMIN_EMAIL } from '../../backend/e2e/fixtures';
import { E2E_WEB2_API_URL, E2E_WEB2_APP_URL } from './urls';

/**
 * Shared fixtures for the web2 suite.
 *
 * Every test runs sealed off from the network: only the SPA's own assets and
 * the local API are reachable. Everything else is aborted, which covers the
 * reads the web2 build still makes on-chain (order books, the satellite's
 * public listings; see docs/ai/frontend/web2-backend-mode.md) and anything
 * third-party. The app must degrade on those, and the specs assert it does.
 *
 * Every test is also watched for the failure classes this suite exists to
 * catch, and fails at teardown if any occurred, whatever the spec asserted:
 * an uncaught page error, a 5xx from the API, a failed engine read, or a
 * 5xx surfacing through the app's HTTP client.
 */

const APP_ORIGIN = new URL(E2E_WEB2_APP_URL).origin;
const API_ORIGIN = new URL(E2E_WEB2_API_URL).origin;

/** The IC HTTP interface paths; on the app origin they only exist behind the
 * preview server's dev proxy, which has no replica behind it. */
const IC_HTTP_INTERFACE_PREFIX = '/api/';

const ENGINE_PATH_PREFIX = '/api/v1/engine/';

/** The message `Web2ApiError` carries for a server-side failure. */
const WEB2_SERVER_ERROR = /Web2 API error \(5\d\d\)/;

/** Absolute URL of an API path, for `page.request` reads: they share the
 * browser context's cookie jar, so they run as the signed-in user. */
export const apiUrl = (path: string): string => `${API_ORIGIN}${path}`;

/** The `GET /api/v1/me` body, as far as the specs read it. */
export interface MeBody {
	user: {
		id: string;
		identities: { provider: string; email: string | null }[];
		legacyPrincipals: { principal: string; matchedVia: string }[];
	};
}

const isAllowedUrl = (url: URL): boolean =>
	url.origin === API_ORIGIN ||
	(url.origin === APP_ORIGIN && !url.pathname.startsWith(IC_HTTP_INTERFACE_PREFIX));

/** The test-only surface of the E2E API server (backend/e2e/server.ts) plus
 * helpers that drive the real API directly. */
export class E2eBackend {
	constructor(private readonly request: APIRequestContext) {}

	/** The latest sign-in code the API "sent" to this address. */
	async otpFor(email: string): Promise<string> {
		let code: string | undefined;

		await expect
			.poll(
				async () => {
					const res = await this.request.get(`/__e2e/otp/${encodeURIComponent(email)}`);

					code = res.ok() ? ((await res.json()) as { code: string }).code : undefined;

					return code;
				},
				{ message: `no sign-in code was issued for ${email}` }
			)
			.toBeDefined();

		return code as string;
	}

	async resetRateLimits(): Promise<void> {
		expect((await this.request.post('/__e2e/reset-rate-limits')).ok()).toBe(true);
	}

	/** Signs this request context in through the real OTP routes, so it holds
	 * the session cookie for the address. */
	async signIn(email: string): Promise<void> {
		const requested = await this.request.post('/api/v1/auth/otp/request', { data: { email } });

		expect(requested.status(), await requested.text()).toBe(200);

		const code = await this.otpFor(email);
		const verified = await this.request.post('/api/v1/auth/otp/verify', { data: { email, code } });

		expect(verified.status(), await verified.text()).toBe(200);
	}
}

export interface BetaGate {
	enabled: boolean;
	emails: string[];
	allowNewUsers?: boolean;
}

/** The seeded admin, signed in through the OTP flow, driving the admin
 * settings API exactly as an operator would. */
export class E2eAdmin {
	constructor(private readonly request: APIRequestContext) {}

	async setBetaGate(value: BetaGate): Promise<void> {
		const res = await this.request.put('/api/v1/admin/settings/beta_gate', { data: { value } });

		expect(res.status(), await res.text()).toBe(200);
	}

	async clearBetaGate(): Promise<void> {
		const res = await this.request.delete('/api/v1/admin/settings/beta_gate');

		expect(res.ok(), await res.text()).toBe(true);
	}
}

interface Web2Fixtures {
	backend: E2eBackend;
	admin: E2eAdmin;
	stackHealth: void;
}

// Playwright fixes the fixture signature to `(dependencies, use)`.
/* eslint-disable local-rules/prefer-object-params */
export const test = base.extend<Web2Fixtures>({
	backend: async ({ playwright }, use) => {
		const request = await playwright.request.newContext({ baseURL: E2E_WEB2_API_URL });
		const backend = new E2eBackend(request);

		// Every sign-in in the suite shares the limiter's "unknown IP" key.
		await backend.resetRateLimits();

		await use(backend);

		await request.dispose();
	},

	admin: async ({ playwright, backend }, use) => {
		const request = await playwright.request.newContext({ baseURL: E2E_WEB2_API_URL });

		await new E2eBackend(request).signIn(E2E_ADMIN_EMAIL);

		// The gate only guards sign-in, so this established session keeps working
		// whatever a spec sets the gate to.
		const admin = new E2eAdmin(request);

		await use(admin);

		// Leave the gate open for the next spec even when this one failed midway.
		await admin.clearBetaGate();
		await backend.resetRateLimits();
		await request.dispose();
	},

	stackHealth: [
		async ({ context }, use) => {
			const problems: string[] = [];

			await context.route(
				(url) => !isAllowedUrl(url),
				(route) => route.abort('blockedbyclient')
			);

			context.on('weberror', (webError) => {
				problems.push(`uncaught page error: ${webError.error().message}`);
			});

			context.on('response', (response) => {
				const url = new URL(response.url());

				if (url.origin !== API_ORIGIN) {
					return;
				}

				if (response.status() >= 500) {
					problems.push(`API ${response.status()}: ${url.pathname}`);
				} else if (url.pathname.startsWith(ENGINE_PATH_PREFIX) && response.status() >= 400) {
					problems.push(`engine read ${response.status()}: ${url.pathname}`);
				}
			});

			context.on('console', (message) => {
				if (message.type() === 'error' && WEB2_SERVER_ERROR.test(message.text())) {
					problems.push(`console: ${message.text().split('\n')[0]}`);
				}
			});

			await use();

			expect(problems, 'the web2 stack reported failures during this test').toEqual([]);
		},
		{ auto: true }
	]
});
/* eslint-enable local-rules/prefer-object-params */

export { expect };
