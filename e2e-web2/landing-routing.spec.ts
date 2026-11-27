import { E2E_LANDING_DECK_SERIES } from '../backend/e2e/fixtures';
import { enMessages } from '../src/lib/constants/messages/en';
import { PENDING_ONBOARDING_STORAGE_KEY } from '../src/lib/constants/profile.constants';
import { marketShareParam } from '../src/lib/utils/market-slug.utils';
import { Web2AppPage, uniqueEmail, uniqueHandle } from './pages/web2-app.page';
import { expect, test } from './support/fixtures';

/**
 * Where a market link or a markets address leads depends on who opens it: a
 * signed-out visitor goes to the landing (its Markets view, or the deck led by
 * the linked market), a signed-in session stays in the app.
 */

// A curated market: the fake engine serves it under a hex id, so a share
// param resolves to it.
const [, SHARED] = E2E_LANDING_DECK_SERIES;
const SHARED_PARAM = marketShareParam({ title: SHARED.title, seriesId: SHARED.seriesId });
// Well formed, but naming no market.
const DEAD_PARAM = 'will-it-rain~3fa9c21b';
const REFERRAL_CODE = 'ABCD2345';

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test.describe('landing routing, signed out', () => {
	for (const path of ['/markets', '/app']) {
		test(`${path} opens the landing's Markets view`, async ({ page }) => {
			await page.goto(path);

			await expect(page).toHaveURL(/\/\?view=markets$/);
			await expect(
				page.getByRole('searchbox', { name: enMessages['landing.markets.search.label'] })
			).toBeVisible();
		});
	}

	// The deck itself is not asserted: the order book is unreachable here, so
	// no card is priced and the landing opens on Markets (led by the market).
	test('a share link opens the landing on its market and keeps the referral', async ({ page }) => {
		await page.goto(`/m/${SHARED_PARAM}?ref=${REFERRAL_CODE}`);

		await expect(page).toHaveURL(new RegExp(`/\\?m=${escape(SHARED_PARAM)}&ref=${REFERRAL_CODE}$`));

		const stash = await page.evaluate(
			(key) => localStorage.getItem(key),
			PENDING_ONBOARDING_STORAGE_KEY
		);

		expect(JSON.parse(stash ?? '{}')).toMatchObject({ referralCode: REFERRAL_CODE });
	});

	test('a share link naming no market opens Markets', async ({ page }) => {
		await page.goto(`/m/${DEAD_PARAM}`);

		await expect(page).toHaveURL(new RegExp(`/\\?m=${escape(DEAD_PARAM)}$`));
		await expect(
			page.getByRole('searchbox', { name: enMessages['landing.markets.search.label'] })
		).toBeVisible();
	});
});

test.describe('landing routing, signed in', () => {
	test.beforeEach(async ({ page, backend }) => {
		await new Web2AppPage(page).signUp({
			email: uniqueEmail('routing'),
			handle: uniqueHandle(),
			backend
		});
	});

	test('/markets opens the app board', async ({ page }) => {
		await page.goto('/markets');

		await expect(page).toHaveURL(/\/app$/);
	});

	test('a share link opens the market page', async ({ page }) => {
		await page.goto(`/m/${SHARED_PARAM}`);

		await expect(page).toHaveURL(new RegExp(`/markets/${SHARED.seriesId}$`));
	});

	test('a /?m= link keeps its market', async ({ page }) => {
		await page.goto(`/?m=${SHARED_PARAM}`);

		await expect(page).toHaveURL(new RegExp(`/markets/${SHARED.seriesId}$`));
	});
});
