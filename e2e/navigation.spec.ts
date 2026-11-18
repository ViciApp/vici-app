import { expect, test, type Page } from '@playwright/test';
import { HomePage } from './pages/home.page';

/**
 * Top-level navigation smoke tests.
 *
 * Every (app) path is auth-gated. Anonymous navigation to a gated path
 * bounces to `/signin`; signed-in users see the page chrome. We exercise:
 *
 * - One redirect-from-anonymous test per gated path, so a regression in
 *   the gate (e.g. the redirect getting deleted) fails loud.
 * - The signed-in variant for each page, snapshotted so a structural
 *   drift on the page surfaces in CI.
 *
 * Markets / home is covered by `homepage.spec.ts`.
 */
const PAGES = [
	{ name: 'arena', path: '/arena' },
	{ name: 'portfolio', path: '/portfolio' },
	{ name: 'profile', path: '/profile' },
	{ name: 'wallet', path: '/wallet' }
] as const;

/**
 * "This surface has finished hydrating" gate, awaited after
 * {@link waitForSignedInPage} and before the screenshot.
 *
 * `networkidle` alone proved insufficient: these pages paint several blocks
 * from state that resolves after the last response, so consecutive runs
 * captured different mixes of skeleton / loaded / absent content and each
 * rewrote its baseline. {@link HomePage.waitForRenderSettled} closes that
 * window generically; Arena additionally waits on its invite copyfield, whose
 * code arrives from a profile-derived fetch and which anchors the block the
 * friends-rank list renders beneath.
 */
const settleForSnapshot = async ({
	home,
	name
}: {
	home: HomePage;
	name: (typeof PAGES)[number]['name'];
}): Promise<void> => {
	if (name === 'arena') {
		await expect(home.arenaInviteLink).toBeVisible();
	}

	await home.waitForRenderSettled();
};

/**
 * Wait for the page chrome AND every initial data fetch to settle before
 * screenshotting:
 *
 * 1. The routed container (`data-tid="app-main"`, set on the
 *    `{#key page.url.pathname}` div in `(app)/+layout.svelte`) has
 *    `in:fade={{ duration: 100, delay: 100 }}` on it. Playwright's
 *    `toBeVisible()` propagates parent opacity, so until we wait for
 *    `opacity: '1'`, every descendant is considered hidden.
 * 2. The account control (`user-menu`) confirms we landed in the signed-in
 *    auth state (and, on the desktop project, that the nav chrome rendered).
 * 3. `networkidle` waits until there's been no network activity for 500ms,
 *    which lets every page's `onMount` data fetch finish rendering before
 *    the screenshot; without this, the snapshot races the data fetch and
 *    ping-pongs between spinners and the loaded view. Treated as best-effort
 *    with a bounded timeout: if a page introduces a sub-500ms recurring
 *    fetch (e.g. a status poll), `networkidle` can never fire, and the
 *    default 30s wait would then turn every signed-in nav test into a 30s+
 *    failure even though the chrome above is already visible and stable.
 *    Bounding the wait lets the snapshot still benefit from the common case
 *    (fetches settle in <5s) without making the suite hostage to any future
 *    always-on background traffic.
 */
const NETWORK_IDLE_BEST_EFFORT_MS = 5_000;

const waitForSignedInPage = async ({ page }: { page: Page }): Promise<void> => {
	const home = new HomePage(page);

	await expect(home.appMain).toBeVisible();
	await expect(home.appMain).toHaveCSS('opacity', '1');
	await expect(home.userMenu).toBeVisible();

	try {
		await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_BEST_EFFORT_MS });
	} catch (err) {
		// Best-effort: only the bounded `networkidle` timeout is expected and
		// safe to swallow (see the comment block above). Anything else (page
		// closed, browser crash, navigation aborted) is a real failure that
		// must surface here rather than resurface as a confusing error at the
		// later assertion / screenshot step.
		if (!(err instanceof Error) || err.name !== 'TimeoutError') {
			throw err;
		}
	}
};

test.describe('navigation (anonymous → redirected to signin)', () => {
	for (const { path } of PAGES) {
		test(`anonymous visit to ${path} redirects to /signin`, async ({ page }) => {
			await page.goto(path);

			// The auth gate fires once `userSignedOutResolved` flips true,
			// which can take a tick after the initial mount. `waitForURL`
			// gives it room to settle.
			await page.waitForURL('**/signin');

			expect(new URL(page.url()).pathname).toBe('/signin');
		});
	}
});

test.describe('navigation (signed in)', () => {
	test.beforeEach(async ({ page }) => {
		const home = new HomePage(page);
		await home.signInAsDevUser();

		await expect(home.userMenu).toBeVisible();
	});

	for (const { name, path } of PAGES) {
		test(`renders ${path}`, async ({ page }) => {
			const home = new HomePage(page);

			await page.goto(path);
			await waitForSignedInPage({ page });
			await settleForSnapshot({ home, name });

			// Mask only the account control: dev sign-in mints a fresh
			// principal per run, so the derived handle genuinely differs.
			await home.stabilizeForSnapshot();

			await expect(page).toHaveScreenshot(`navigation-${name}-logged-in.png`, {
				fullPage: true,
				mask: [home.userMenu]
			});
		});
	}
});
