import { expect, test } from '@playwright/test';

/**
 * Invite-link landing smoke tests.
 *
 * `/join/[code]` and `/i/[code]` are twin entrypoints that render the same
 * `InviteLanding`. Before #746, `/join/{slug}` had no route and 404'd: the
 * exact user-facing regression these guard against.
 *
 * Both branches run anonymously and deterministically, with NO referral
 * fixtures required:
 *
 * - A malformed slug is rejected by `REFERRAL_CODE_REGEX`, toasts, and routes
 *   home (`AppPath.Home` = `/app`); the (app) auth gate then bounces the
 *   anonymous visitor to `/signin`.
 * - A well-formed code is stashed for attribution and the visitor is sent to
 *   `/signup`; the code needn't exist, since the signed-out branch stashes
 *   blindly and lets the post-signin drain validate it.
 *
 * A genuine 404 (the pre-#746 behavior) renders SvelteKit's error page and
 * reaches neither `/signin` nor `/signup`, so either assertion fails loud.
 */

const ROUTES = ['/join', '/i'] as const;

// 8-char Crockford-base32, passes `REFERRAL_CODE_REGEX`. Needn't map to a real
// referrer: the anonymous branch stashes the code and routes to signup before
// any lookup.
const VALID_CODE = 'ABCDEF12';

// Wrong length + out-of-alphabet chars (`-`) → fails the code regex.
const INVALID_CODE = 'not-a-code';

test.describe('invite landing (anonymous)', () => {
	for (const route of ROUTES) {
		test(`${route}/{invalid-code} is rejected and bounces to /signin`, async ({ page }) => {
			await page.goto(`${route}/${INVALID_CODE}`);

			// Route exists → the landing mounts, rejects the malformed slug, and
			// routes home; the (app) gate then redirects the anonymous visitor.
			await page.waitForURL('**/signin');

			expect(new URL(page.url()).pathname).toBe('/signin');
		});

		test(`${route}/{code} stashes the code and routes to /signup`, async ({ page }) => {
			await page.goto(`${route}/${VALID_CODE}`);

			await page.waitForURL('**/signup');

			expect(new URL(page.url()).pathname).toBe('/signup');
		});
	}
});
