import type { Page } from '@playwright/test';
import { E2E_LANDING_DECK_SERIES } from '../backend/e2e/fixtures';
import { enMessages } from '../src/lib/constants/messages/en';
import { PENDING_ONBOARDING_STORAGE_KEY } from '../src/lib/constants/profile.constants';
import { TestId } from '../src/lib/constants/test-ids.constants';
import { marketShareParam } from '../src/lib/utils/market-slug.utils';
import { expect, test } from './support/fixtures';

/**
 * One funnel for a signed-out visitor: a call from a market page and every
 * invite or league link lead to the landing's claim capsule, and the invite
 * is kept in the pending-onboarding stash the claim reads. There is no
 * account-less Flow any more.
 */

const REFERRAL_CODE = 'ABCD2345';
const LEAGUE_CODE = 'ABC123';
const [MARKET] = E2E_LANDING_DECK_SERIES;

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const capsule = (page: Page) =>
	page.getByRole('dialog', { name: enMessages['landing.claim.dialog'] });

const stash = async (page: Page): Promise<unknown> =>
	JSON.parse(
		(await page.evaluate((key) => localStorage.getItem(key), PENDING_ONBOARDING_STORAGE_KEY)) ??
			'{}'
	);

test.describe('signed-out funnel', () => {
	for (const route of ['/i', '/join']) {
		test(`${route}/{code} opens the capsule and keeps the invite`, async ({ page }) => {
			await page.goto(`${route}/${REFERRAL_CODE}`);

			await expect(page).toHaveURL(/\/\?claim=1$/);
			await expect(capsule(page)).toBeVisible();
			expect(await stash(page)).toMatchObject({ referralCode: REFERRAL_CODE });
		});
	}

	test('a league link opens the capsule and keeps the league and the referral', async ({
		page
	}) => {
		await page.goto(`/league/${LEAGUE_CODE}?ref=${REFERRAL_CODE}`);

		await expect(page).toHaveURL(/\/\?claim=1$/);
		await expect(capsule(page)).toBeVisible();
		expect(await stash(page)).toMatchObject({
			leagueInvite: LEAGUE_CODE,
			referralCode: REFERRAL_CODE
		});
	});

	test("a market page's call to action opens the capsule on that market", async ({ page }) => {
		await page.goto(`/markets/${MARKET.seriesId}`);

		await page
			.getByRole('main')
			.getByRole('button', { name: enMessages['landing.nav.claim'] })
			.click();

		const param = marketShareParam({ title: MARKET.title, seriesId: MARKET.seriesId });

		await expect(page).toHaveURL(new RegExp(`/\\?m=${escape(param)}&claim=1$`));
		await expect(capsule(page)).toBeVisible();
	});

	// Where the visitor is sent is the auth gate's business; this pins only
	// that there is no Flow without an account.
	test('Flow needs an account', async ({ page }) => {
		await page.goto('/flow');

		await expect(page).not.toHaveURL(/\/flow$/);
		await expect(page.getByTestId(TestId.FlowMode)).toHaveCount(0);
	});
});
