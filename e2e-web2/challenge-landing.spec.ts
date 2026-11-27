import type { Browser, Page } from '@playwright/test';
import { E2E_LIVE_SERIES } from '../backend/e2e/fixtures';
import { LANDING_DECK_SERIES } from '../src/lib/constants/landing.constants';
import { Web2AppPage, uniqueEmail, uniqueHandle } from './pages/web2-app.page';
import { apiUrl, expect, test, type E2eBackend, type MeBody } from './support/fixtures';

/**
 * The receiving end of a challenge link, `/c/<id>`, for a signed-out
 * visitor: the landing opens on the challenged market with the challenger's
 * current call as the server reads it. Positions come from fills recorded in the
 * fake engine; links are issued through the real API. The stack has no order
 * book, so no deck card is priced and the deck hands over to Markets: the
 * specs read the line and the stash, not the card.
 */

const [MARKET] = E2E_LIVE_SERIES;

interface Challenger {
	page: Page;
	handle: string;
	/** Issues (or returns) the link for the market at 38% Yes. */
	link: (params?: { showIdentity?: boolean }) => Promise<string>;
}

/** A signed-up account in its own browser, holding Yes at 38% on the market. */
const newChallenger = async ({
	browser,
	backend
}: {
	browser: Browser;
	backend: E2eBackend;
}): Promise<Challenger> => {
	const page = await (await browser.newContext()).newPage();
	const handle = uniqueHandle();

	await new Web2AppPage(page).signUp({ email: uniqueEmail('maya'), handle, backend });

	const me = (await (await page.request.get(apiUrl('/api/v1/me'))).json()) as MeBody;

	await backend.fill({ userId: me.user.id, seriesId: MARKET.seriesId, qty: 10, priceCents: 38 });

	return {
		page,
		handle,
		link: async ({ showIdentity = true } = {}) => {
			const res = await page.request.post(apiUrl('/api/v1/challenges/'), {
				data: { seriesId: MARKET.seriesId, showIdentity }
			});

			expect(res.status(), await res.text()).toBe(200);

			const { challenge } = (await res.json()) as { challenge: { id: string } };

			if (!showIdentity) {
				const consent = await page.request.patch(apiUrl(`/api/v1/challenges/${challenge.id}`), {
					data: { showIdentity: false }
				});

				expect(consent.ok()).toBe(true);
			}

			return challenge.id;
		}
	};
};

const challengeLine = (page: Page) => page.locator('.challenge-line');

/** The curated deck names mainnet series the fake engine does not serve. */
const CURATED_SERIES_READ = new RegExp(
	`/api/v1/engine/.*(${LANDING_DECK_SERIES.map(({ seriesId }) => seriesId).join('|')})`
);

test.describe('challenge link landing', () => {
	test.beforeEach(async ({ context }) => {
		await context.route(CURATED_SERIES_READ, (route) => route.abort('blockedbyclient'));
	});

	test('signed out, the line comes from the server whatever the URL adds', async ({
		page,
		browser,
		backend
	}) => {
		const maya = await newChallenger({ browser, backend });
		const id = await maya.link();

		await page.goto(`/c/${id}?handle=impostor&side=NO&price=99&m=other`);

		await expect(challengeLine(page)).toContainText(
			`@${maya.handle} called Yes at 38%. Think they’re wrong?`
		);
		await expect(page.getByText('impostor')).toHaveCount(0);
		// No introduction: the visitor came for this card.
		await expect(page.locator('.landing-deck .hand')).toHaveCount(0);
	});

	test('without consent the line says "A friend"', async ({ page, browser, backend }) => {
		const maya = await newChallenger({ browser, backend });
		const id = await maya.link({ showIdentity: false });

		await page.goto(`/c/${id}`);

		await expect(challengeLine(page)).toContainText(
			'A friend called Yes at 38%. Think they’re wrong?'
		);
		await expect(page.getByText(`@${maya.handle}`)).toHaveCount(0);
	});

	test('a revoked or unknown link opens the standard landing', async ({
		page,
		browser,
		backend
	}) => {
		const maya = await newChallenger({ browser, backend });
		const id = await maya.link();

		expect((await maya.page.request.delete(apiUrl(`/api/v1/challenges/${id}`))).ok()).toBe(true);

		for (const path of [`/c/${id}`, '/c/ZZZZZZZZZZZZZZZZ', '/c/not-a-link']) {
			await page.goto(path);

			await expect(page.locator('.lp')).toBeVisible();
			await expect(challengeLine(page)).toHaveCount(0);
		}
	});
});
