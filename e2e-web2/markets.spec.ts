import { E2E_LIVE_SERIES, E2E_SETTLED_SERIES } from '../backend/e2e/fixtures';
import { enMessages } from '../src/lib/constants/messages/en';
import { Web2AppPage, uniqueEmail, uniqueHandle } from './pages/web2-app.page';
import { expect, test } from './support/fixtures';

/**
 * The market catalog and detail pages, served from the fake engine through
 * the API's public engine bridge. The order book is the one read these pages
 * still make on-chain; it is unreachable here, so the specs also pin that a
 * missing book prices a market as unknown instead of blanking the page.
 */
test.describe('markets', () => {
	test.beforeEach(async ({ page, backend }) => {
		await new Web2AppPage(page).signUp({
			email: uniqueEmail('markets'),
			handle: uniqueHandle(),
			backend
		});
	});

	test('the list shows every live market and opens its detail page', async ({ page }) => {
		const app = new Web2AppPage(page);

		await page.goto('/app');

		await expect(app.marketFeed).toBeVisible();

		for (const { title } of E2E_LIVE_SERIES) {
			await expect(app.marketCard.filter({ hasText: title }).first()).toBeVisible();
		}

		const [first] = E2E_LIVE_SERIES;

		await app.marketCard.filter({ hasText: first.title }).first().click();

		await expect(page).toHaveURL(new RegExp(`/markets/${first.seriesId}$`));
		await expect(app.appMain.getByText(first.title).first()).toBeVisible();
		await expect(app.appMain.getByText(first.description).first()).toBeVisible();

		await app.waitForLoaded();
	});

	test('a settled market shows its outcome', async ({ page }) => {
		const app = new Web2AppPage(page);

		await page.goto(`/markets/${E2E_SETTLED_SERIES.seriesId}`);

		await expect(app.appMain.getByText(E2E_SETTLED_SERIES.title).first()).toBeVisible();
		await expect(
			app.appMain.getByText(
				`${enMessages['market.detail.settled.resolved_prefix']} ${E2E_SETTLED_SERIES.settledOutcome}`
			)
		).toBeVisible();
	});
});
