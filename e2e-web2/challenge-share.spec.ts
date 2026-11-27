import type { APIRequestContext, Page } from '@playwright/test';
import { E2E_LIVE_SERIES } from '../backend/e2e/fixtures';
import { enMessages } from '../src/lib/constants/messages/en';
import { Web2AppPage, uniqueEmail, uniqueHandle } from './pages/web2-app.page';
import { E2eBackend, type MeBody, apiUrl, expect, test } from './support/fixtures';
import { E2E_WEB2_API_URL } from './support/urls';

/** A fresh request context on the API with its own cookie jar. */
type NewApiContext = () => Promise<APIRequestContext>;

/**
 * "Challenge a friend" on the market detail page, through the real API and the
 * fake engine: the action follows the viewer's position, the sheet previews
 * what the server serves, consent and revocation reach the public read, and a
 * friend's answer lands in the challenger's inbox.
 */

const [SERIES] = E2E_LIVE_SERIES;

const YES_AT_38 = { side: 'YES', entryPriceBps: 3800, qty: 10 } as const;
const NO_AT_44 = { side: 'NO', entryPriceBps: 4400, qty: 10 } as const;

interface ChallengeBody {
	challenge: { challenger: { handle: string } | null };
}

const myUserId = async (request: APIRequestContext): Promise<string> => {
	const res = await request.get(apiUrl('/api/v1/me'));

	expect(res.ok()).toBe(true);

	return ((await res.json()) as MeBody).user.id;
};

/** The id of the viewer's link on the series, from the owner's own list. */
const myChallengeId = async (request: APIRequestContext): Promise<string> => {
	const res = await request.get(apiUrl('/api/v1/challenges/mine'));

	expect(res.ok()).toBe(true);

	const { items } = (await res.json()) as { items: { id: string; seriesId: string }[] };
	const own = items.find(({ seriesId }) => seriesId === SERIES.seriesId);

	expect(own).toBeDefined();

	return own?.id ?? '';
};

/** The public read of a link, as a signed-out visitor sees it. */
const publicRead = async ({
	newApi,
	id
}: {
	newApi: NewApiContext;
	id: string;
}): Promise<{ status: number; body?: ChallengeBody }> => {
	const anonymous = await newApi();
	const res = await anonymous.get(`/api/v1/challenges/${id}`);
	const result = {
		status: res.status(),
		body: res.ok() ? ((await res.json()) as ChallengeBody) : undefined
	};

	await anonymous.dispose();

	return result;
};

const challengeAction = (page: Page) =>
	page.getByRole('button', { name: enMessages['challenge.action.label'] });

const sheet = (page: Page) =>
	page.getByRole('dialog', { name: enMessages['challenge.action.label'] });

const consentSwitch = (page: Page) =>
	sheet(page).getByRole('switch', { name: enMessages['challenge.share.consent_label'] });

const line = ({ key, handle }: { key: 'named' | 'anonymous'; handle?: string }): string =>
	enMessages[`challenge.line.${key}`]
		.replace('{handle}', handle ?? '')
		.replace('{side}', enMessages['challenge.side.yes'])
		.replace('{pct}', '38');

/** A second account that answers through the API: signed in, with a handle
 * and its own call on the series. */
const answerAsFriend = async ({
	newApi,
	backend,
	id
}: {
	newApi: NewApiContext;
	backend: E2eBackend;
	id: string;
}): Promise<string> => {
	const request = await newApi();
	const handle = uniqueHandle();

	await new E2eBackend(request).signIn(uniqueEmail('challenge-friend'));

	const profile = await request.put('/api/v1/profiles/me', { data: { nickname: handle } });

	expect(profile.ok(), await profile.text()).toBe(true);

	const me = await request.get('/api/v1/me');
	const userId = ((await me.json()) as MeBody).user.id;

	await backend.seedFill({ userId, seriesId: SERIES.seriesId, ...NO_AT_44 });

	const answered = await request.post(`/api/v1/challenges/${id}/answer`);

	expect(answered.status(), await answered.text()).toBe(200);

	await request.dispose();

	return handle;
};

test.describe('challenge share', () => {
	test('a challenger shares, hides and turns off a verified link', async ({
		page,
		backend,
		playwright
	}) => {
		// The sheet falls back to the channel links and "Copy link" without the
		// native share sheet, which headless browsers expose unevenly.
		await page.addInitScript(() => {
			Object.defineProperty(Navigator.prototype, 'share', { value: undefined });
		});
		await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

		const newApi: NewApiContext = () =>
			playwright.request.newContext({ baseURL: E2E_WEB2_API_URL });
		const app = new Web2AppPage(page);
		const handle = uniqueHandle();

		await app.signUp({ email: uniqueEmail('challenge'), handle, backend });

		await page.goto(`/markets/${SERIES.seriesId}`);

		await expect(page.getByText(SERIES.title).first()).toBeVisible();

		await app.waitForLoaded();

		await expect(challengeAction(page)).toHaveCount(0);

		await backend.seedFill({
			userId: await myUserId(page.request),
			seriesId: SERIES.seriesId,
			...YES_AT_38
		});

		await page.reload();
		await challengeAction(page).click();

		// The preview is the server's view, and so is the public read.
		await expect(sheet(page).getByText(line({ key: 'named', handle }))).toBeVisible();
		await expect(consentSwitch(page)).toHaveAttribute('aria-checked', 'true');

		const id = await myChallengeId(page.request);

		expect((await publicRead({ newApi, id })).body?.challenge.challenger?.handle).toBe(handle);

		// Turning consent off changes the preview and the public read before any share.
		await consentSwitch(page).click();

		await expect(sheet(page).getByText(line({ key: 'anonymous' }))).toBeVisible();
		await expect(consentSwitch(page)).toHaveAttribute('aria-checked', 'false');
		expect((await publicRead({ newApi, id })).body?.challenge.challenger).toBeNull();

		await sheet(page).getByRole('button', { name: enMessages['challenge.share.copy'] }).click();

		const copied = await page.evaluate(() => navigator.clipboard.readText());

		expect(new URL(copied).pathname).toBe(`/c/${id}`);

		// Reopening returns the same link with the consent the owner left.
		await page.keyboard.press('Escape');

		await expect(sheet(page)).toHaveCount(0);

		await challengeAction(page).click();

		await expect(consentSwitch(page)).toHaveAttribute('aria-checked', 'false');
		await expect(
			sheet(page).getByRole('link', { name: enMessages['flow.share.telegram'] })
		).toHaveAttribute('href', new RegExp(encodeURIComponent(`/c/${id}`)));

		// A friend's answer becomes one inbox card that opens the market.
		await page.keyboard.press('Escape');

		const friend = await answerAsFriend({ newApi, backend, id });

		await page.goto('/notifications');

		const card = page.getByRole('button').filter({
			hasText: enMessages['inbox.challenge_answer.body']
				.replace('{handle}', friend)
				.replace('{side}', enMessages['challenge.side.no'])
				.replace('{pct}', '44')
				.replace('{mySide}', enMessages['challenge.side.yes'])
				.replace('{myPct}', '38')
		});

		await expect(card).toHaveCount(1);

		await card.press('Enter');

		await expect(page).toHaveURL(new RegExp(`/markets/${SERIES.seriesId}$`));

		// Turning the link off makes the public read answer not found.
		await challengeAction(page).click();
		await sheet(page).getByRole('button', { name: enMessages['challenge.share.revoke'] }).click();
		await sheet(page)
			.getByRole('button', { name: enMessages['challenge.share.revoke_confirm_cta'] })
			.click();

		await expect(sheet(page)).toHaveCount(0);
		expect((await publicRead({ newApi, id })).status).toBe(404);
	});
});
