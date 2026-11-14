import { expect, test } from '@playwright/test';
import { HomePage } from './pages/home.page';

/**
 * Friend-request inbox deep-link → Friends tab.
 *
 * A `friend_request` inbox notification routes to
 * `/arena?request=<relationId>` (`inbox.store.ts`). `ArenaPage` must force
 * the Friends tab when that param is present so the recipient lands on the
 * Accept affordance instead of whichever Arena tab the URL would otherwise
 * resolve: the iOS "I tapped it and nothing happened" report (#803 / #809).
 *
 * Arena no longer persists the last-viewed tab across sessions (#1038): a
 * plain `/arena` entry always opens Friends, and a back-nav can target a
 * specific tab via `?tab=` (`focusTabKey`). `?request=` outranks `?tab=`, so
 * this seeds an explicit `?tab=leagues` as the non-Friends baseline and
 * asserts `?request=` still wins; that makes the override meaningful rather
 * than coinciding with the Friends default.
 *
 * The dev mock identity mints a fresh principal per run, so seeding a real
 * incoming request between two users isn't deterministic here; this guards
 * the routing the fix adds. The full send→accept path is a manual repro in
 * the PR body (see docs/ai/frontend/testing.md).
 */

// The relation id carries a `#`; it needn't match a real request: tab
// activation keys only on the param's presence, not on a found row.
const REQUEST_KEY = 'aaaaa-aa#bbbbb-bb';

test.describe('arena friend-request deep-link (signed in)', () => {
	test('the ?request= param forces the Friends tab over an explicit ?tab=', async ({ page }) => {
		const home = new HomePage(page);

		await home.signInAsDevUser();

		// Establish a non-Friends baseline via the explicit back-nav tab
		// selector so a plain Friends-default landing can't make the override
		// below pass by coincidence: `/arena?tab=leagues` resolves to Leagues.
		await page.goto('/arena?tab=leagues');

		await expect(page.getByRole('tab', { name: 'Leagues' })).toHaveAttribute(
			'aria-selected',
			'true'
		);

		// `?request=` outranks `?tab=`: even with `?tab=leagues` still present,
		// the friend-request deep link forces Friends.
		await page.goto(`/arena?tab=leagues&request=${encodeURIComponent(REQUEST_KEY)}`);

		await expect(page.getByRole('tab', { name: 'Friends' })).toHaveAttribute(
			'aria-selected',
			'true'
		);
	});
});
