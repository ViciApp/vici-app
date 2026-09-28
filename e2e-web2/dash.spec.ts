import { E2E_LIVE_SERIES } from '../backend/e2e/fixtures';
import { enMessages } from '../src/lib/constants/messages/en';
import { Web2AppPage, uniqueEmail, uniqueHandle } from './pages/web2-app.page';
import { apiUrl, expect, test } from './support/fixtures';

interface AccountBody {
	account: {
		assets: unknown[];
		total_equity_usd: string;
		available_margin_usd: string;
		state: { balances: unknown[] };
	};
}

/**
 * The Dash of a brand-new account: its custodial principal has never
 * deposited, so the engine holds no account for it. The API must answer that
 * as an empty account (not an error), and the Dash must render its starter
 * state from it. A failing engine read here once blanked the whole Dash; the
 * suite-wide stack health check fails this test on any engine error, API 5xx
 * or uncaught page error along the way.
 */
test.describe('dash', () => {
	test('renders the empty engine account of a new user without errors', async ({
		page,
		backend
	}) => {
		const app = new Web2AppPage(page);

		await app.signUp({ email: uniqueEmail('dash'), handle: uniqueHandle(), backend });

		const account = page.waitForResponse(
			(response) => response.url() === apiUrl('/api/v1/engine/account')
		);

		await page.goto('/dash');

		const accountResponse = await account;

		expect(accountResponse.status()).toBe(200);
		expect(((await accountResponse.json()) as AccountBody).account).toMatchObject({
			assets: [],
			total_equity_usd: '0',
			available_margin_usd: '0',
			state: { balances: [] }
		});

		await expect(page.getByRole('heading', { name: enMessages['dash.title'] })).toBeAttached();

		await app.waitForLoaded();

		// The starter picks come from the engine catalog through the API.
		for (const { title } of E2E_LIVE_SERIES) {
			await expect(app.appMain.getByText(title)).toBeVisible();
		}
	});
});
