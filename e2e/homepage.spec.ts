import { expect, test } from '@playwright/test';
import { HomePage } from './pages/home.page';

// Match every API version (v2/v3/v4 — the SDK uses v3 for `query` /
// `read_state` and v4 for `call`) and any path under the Registry canister.
// A v3-only glob lets v4 update calls leak through and quietly populate the
// feed before the screenshot, which is exactly what made this test flaky.
const REGISTRY_GLOB = '**/api/*/canister/g5pxl-pyaaa-aaaaj-qqhoq-cai/**';

/**
 * The markets board lives at `/app` (`AppPath.Home`) and is auth-gated;
 * sign-in routes a fresh principal through onboarding before landing in
 * the app, so both tests sign in first and then navigate to the board.
 */
test.describe('homepage (signed in)', () => {
	test.beforeEach(async ({ page }) => {
		const home = new HomePage(page);
		await home.signInAsDevUser();

		await expect(home.userMenu).toBeVisible();
	});

	test('renders the loading skeletons while markets are still being fetched', async ({ page }) => {
		const home = new HomePage(page);

		// Stall every Registry call so the board stays in its loading state
		// long enough for a deterministic screenshot. We hold the route
		// handler on a deferred promise we explicitly release in `finally`
		// — this avoids a long-lived `setTimeout` that could outlive the
		// test and keep the Playwright worker process alive.
		let releaseStall!: () => void;
		const stalled = new Promise<void>((resolve) => {
			releaseStall = resolve;
		});

		await page.route(REGISTRY_GLOB, async (route) => {
			await stalled;
			await route.abort();
		});

		try {
			// `gotoMarkets` is a full navigation, so it re-runs app init with
			// the stall in place: the markets store never initializes and
			// `MarketsPage` renders its dashed loading placeholders rather than
			// the loaded board.
			await home.gotoMarkets();

			await expect(home.marketFeed).toBeVisible();

			// While loading, the board shows skeleton placeholders and zero
			// real rows. If anything leaked past the route stall, the card
			// assertion fails before we write a polluted baseline.
			await expect(home.marketCardSkeleton.first()).toBeVisible();
			await expect(home.marketCard).toHaveCount(0);

			// The rank query that can trigger a trophy reveal is a satellite
			// call, not a Registry one, so the stall above does not hold it.
			await home.dismissMenagerieReveals();

			await expect(page).toHaveScreenshot('homepage-loading.png', {
				fullPage: true,
				mask: [home.userMenu]
			});
		} finally {
			releaseStall();
		}
	});

	test('renders the markets board once data is loaded', async ({ page }) => {
		const home = new HomePage(page);

		await home.gotoMarkets();

		await expect(home.marketFeed).toBeVisible();

		// Wait for the network to go idle so the snapshot captures the
		// fully-loaded board deterministically. The available list can be
		// empty depending on the World-Cup release schedule, so we assert
		// the board container rather than a card count.
		await page.waitForLoadState('networkidle');

		await home.stabilizeForSnapshot();

		await expect(page).toHaveScreenshot('homepage-with-markets.png', {
			fullPage: true,
			mask: [home.userMenu]
		});
	});
});
