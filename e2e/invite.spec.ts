import { expect, test } from '@playwright/test';
import { PENDING_ONBOARDING_STORAGE_KEY } from '../src/lib/constants/profile.constants';

/**
 * Invite-link landing smoke tests.
 *
 * `/join/[code]` and `/i/[code]` are twin entrypoints that render the same
 * `InviteLanding`. These guard against `/join/{slug}` losing its route and
 * 404ing.
 *
 * Both branches run anonymously and deterministically, with NO referral
 * fixtures required:
 *
 * - A malformed slug is rejected by `REFERRAL_CODE_REGEX`, toasts, and routes
 *   home (`AppPath.Home` = `/app`); the (app) auth gate then sends the
 *   anonymous visitor to the markets they can see, the landing's Markets
 *   view (`/?view=markets`).
 * - A well-formed code is stashed for attribution and the visitor is sent to
 *   the landing's claim capsule (`/?claim=1`), the one signed-out funnel;
 *   the code needn't exist, since the signed-out branch stashes blindly and
 *   lets the drain validate it. (This suite opens sign-ups; where they have
 *   moved to the new app the destination is `/signup`, pinned by
 *   `moved-to-new-app.spec.ts`.)
 *
 * A genuine 404 renders SvelteKit's error page and
 * reaches no landing URL, so either assertion fails loud.
 */

const ROUTES = ['/join', '/i'] as const;

// 8-char Crockford-base32, passes `REFERRAL_CODE_REGEX`. Needn't map to a real
// referrer: the anonymous branch stashes the code and routes to the capsule
// before any lookup.
const VALID_CODE = 'ABCDEF12';

// Wrong length + out-of-alphabet chars (`-`) → fails the code regex.
const INVALID_CODE = 'not-a-code';

test.describe('invite landing (anonymous)', () => {
	for (const route of ROUTES) {
		test(`${route}/{invalid-code} is rejected and lands on the landing's Markets`, async ({
			page
		}) => {
			await page.goto(`${route}/${INVALID_CODE}`);

			// Route exists → the landing mounts, rejects the malformed slug, and
			// routes home; the (app) gate then redirects the anonymous visitor.
			await page.waitForURL('**/?view=markets');

			expect(new URL(page.url()).searchParams.get('view')).toBe('markets');
		});

		test(`${route}/{code} stashes the code and opens the claim capsule`, async ({ page }) => {
			await page.goto(`${route}/${VALID_CODE}`);

			await page.waitForURL('**/?claim=1');

			expect(new URL(page.url()).searchParams.get('claim')).toBe('1');
			expect(
				JSON.parse(
					(await page.evaluate(
						(key) => localStorage.getItem(key),
						PENDING_ONBOARDING_STORAGE_KEY
					)) ?? '{}'
				)
			).toMatchObject({ referralCode: VALID_CODE });
		});
	}
});
