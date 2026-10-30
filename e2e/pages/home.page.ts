import { expect, type Locator, type Page } from '@playwright/test';
import { TestId } from '../../src/lib/constants/test-ids.constants';

/**
 * The Arena referral link (`FriendsTab`). Rendered only once the invite code
 * resolves, which makes it both the thing to pin (see
 * {@link PINNED_SNAPSHOT_TEXT}) and the signal that the tab's profile-derived
 * content has hydrated — see {@link HomePage.arenaInviteLink}.
 */
const ARENA_INVITE_LINK_SELECTOR = '.invite-copyurl';

/**
 * The Menagerie trophy reveal (`MenagerieReveal`), a full-screen takeover the
 * app-shell celebration host mounts when the owner crosses a new trophy tier.
 * `mr-in` is the reveal on screen; `mr-flying` is the badge flying into the
 * nav after a dismiss, which ends by unmounting it (or swapping in the next
 * queued reveal). See {@link HomePage.dismissMenagerieReveals}.
 */
const MENAGERIE_REVEAL_OPEN_SELECTOR = '.mr-root.mr-in';
const MENAGERIE_REVEAL_FLYING_SELECTOR = '.mr-root.mr-flying';

/** How long the DOM must stay unmutated to count as settled. */
const DOM_QUIET_MS = 500;
/** Upper bound on the quiet wait — see {@link HomePage.waitForRenderSettled}. */
const DOM_QUIET_TIMEOUT_MS = 10_000;

/**
 * Text that is genuinely different on every CI run and therefore rewrites its
 * own baseline whenever it lands in a screenshot. Pinned (not masked) for the
 * reason spelled out in {@link HomePage.stabilizeForSnapshot}: a mask is sized
 * from the element box, so variable-width text drifts even behind one.
 *
 * Each entry was confirmed by diffing the baselines two consecutive CI runs of
 * the same commit produced:
 *
 * - `.profile-hero-handle` — the signed-in principal's handle. Every run signs
 *   in as a fresh dev principal, and the handle is either its shortened
 *   principal default or a handle an earlier spec claimed for it, so it reads
 *   e.g. `@e2ems32iwxz` then `@e2ems33k1re`.
 * - `.invite-copyurl` — the referral link. Its code is minted per profile by
 *   the satellite hook, so a fresh principal always gets a new one
 *   (`/i/JH3T2JAF` then `/i/5PBJ6STF`).
 * - `.portfolio-hero-stat dd.num` — the Portfolio hero stat figures (unrealized
 *   PnL, accuracy, rank). Accuracy is the observed offender: it reads `0.0%`
 *   until the profile hydrates and `100.0%` after, because `displayAccuracyPct`
 *   shows an optimistic 100% for a user with no settled predictions — so it
 *   flips on a hydration race. Its siblings are pinned with it because they
 *   derive from the same per-run trading state and would drift the same way
 *   once the seeded state stops being empty.
 *
 * Pinning trades away pixel-level regression cover on these specific values.
 * That cover was never real: the values are non-deterministic in CI, which is
 * exactly why the gate could not stay green.
 */
const PINNED_SNAPSHOT_TEXT: { selector: string; text: string }[] = [
	{ selector: '.profile-hero-handle', text: '@xxxxxxxxxxx' },
	{ selector: ARENA_INVITE_LINK_SELECTOR, text: 'xxxxxxxxxxxxxxxxx/i/XXXXXXXX' },
	{ selector: '.portfolio-hero-stat dd.num', text: '000' }
];

/**
 * Page object for the Vici signed-in surfaces and the auth / onboarding
 * flow that reaches them.
 *
 * The (app) layout gates every route on a resolved session — anonymous
 * visits to `/app`, `/portfolio`, etc. redirect to `/signin`. Sign-in
 * itself routes a brand-new principal through the `/signup` one-screen
 * onboarding before the app shell, so the helpers below drive that flow
 * end-to-end rather than expecting a bare sign-in to land in the app.
 *
 * Tests should prefer this object over reaching into selectors so that
 * structural changes only have to be reflected in one place.
 */
export class HomePage {
	readonly page: Page;
	readonly appMain: Locator;
	readonly marketFeed: Locator;
	readonly marketCard: Locator;
	readonly marketCardSkeleton: Locator;
	readonly marketTimeRemaining: Locator;
	readonly signInDevButton: Locator;
	/**
	 * The signed-in account control. The desktop top-nav profile handle and
	 * the mobile pillnav profile tab both carry `data-tid="user-menu"`, and
	 * exactly one is visible per viewport (the other is `display:none` at
	 * its breakpoint), so the `:visible` filter resolves to a single match
	 * on both the `chromium` (desktop) and `Galaxy *` (mobile) projects.
	 */
	readonly userMenu: Locator;
	readonly signOutButton: Locator;
	readonly logoutButton: Locator;
	/**
	 * The Arena referral link. Present only after the invite code resolves, so
	 * awaiting it is how an Arena snapshot avoids capturing the tab
	 * mid-hydration — the state where the whole invite copyfield (and the
	 * friends-rank row beneath it) is still missing, which is what made the
	 * Arena baseline rewrite itself on consecutive runs.
	 */
	readonly arenaInviteLink: Locator;
	readonly menagerieRevealOpen: Locator;
	readonly menagerieRevealFlying: Locator;
	readonly onboarding: Locator;
	readonly onboardingHandleInput: Locator;
	readonly onboardingHandleSkip: Locator;
	readonly onboardingPrimary: Locator;

	constructor(page: Page) {
		this.page = page;
		this.appMain = page.getByTestId(TestId.AppMain);
		this.marketFeed = page.getByTestId(TestId.MarketFeed);
		this.marketCard = page.getByTestId(TestId.MarketCard);
		this.marketCardSkeleton = page.getByTestId(TestId.MarketCardSkeleton);
		this.marketTimeRemaining = page.getByTestId(TestId.MarketTimeRemaining);
		this.signInDevButton = page.getByTestId(TestId.SignInDev);
		this.userMenu = page.locator(`[data-tid="${TestId.UserMenu}"]:visible`);
		this.signOutButton = page.getByTestId(TestId.SignOutButton);
		this.logoutButton = page.getByTestId(TestId.Logout);
		this.arenaInviteLink = page.locator(ARENA_INVITE_LINK_SELECTOR);
		this.menagerieRevealOpen = page.locator(MENAGERIE_REVEAL_OPEN_SELECTOR);
		this.menagerieRevealFlying = page.locator(MENAGERIE_REVEAL_FLYING_SELECTOR);
		this.onboarding = page.getByTestId(TestId.Onboarding);
		this.onboardingHandleInput = page.getByTestId(TestId.OnboardingHandleInput);
		this.onboardingHandleSkip = page.getByTestId(TestId.OnboardingHandleSkip);
		this.onboardingPrimary = page.getByTestId(TestId.OnboardingPrimary);
	}

	async goto(): Promise<void> {
		await this.page.goto('/');
	}

	/**
	 * Wait until the page has stopped rendering, so a screenshot can't catch a
	 * surface mid-hydration.
	 *
	 * `networkidle` is not sufficient on the signed-in pages: several sections
	 * (Arena's friends-rank list, the Portfolio positions list, the Profile
	 * header) paint from state that resolves after the last response lands, so
	 * consecutive runs captured different mixes of skeleton / loaded / absent
	 * blocks and each rewrote the baseline. Two conditions close that window:
	 *
	 * 1. No placeholder is left in the DOM. This is the load-bearing one: a page
	 *    waiting on a response is perfectly quiet, so condition 2 alone happily
	 *    photographs a half-loaded screen. Placeholder class names are
	 *    per-component and abbreviate inconsistently — `portfolio-skeleton` and
	 *    `detail-skeleton-block`, but `ar-skel-block` on the Arena hero — so the
	 *    match is on `skel`, the longest shared prefix. Matching only `skeleton`
	 *    silently skipped the Arena hero and left it drifting.
	 * 2. No DOM mutation for {@link DOM_QUIET_MS}, which catches blocks that
	 *    have no placeholder at all and simply appear late. Naming each one
	 *    would be endless and would rot as the UI changes.
	 *
	 * The quiet wait is bounded and its timeout swallowed: a surface with a
	 * permanent ticker (a countdown, a poll) would never go quiet, and hanging
	 * the spec is worse than the drift this reduces. The placeholder check is a
	 * real assertion — one still present after the wait means the page genuinely
	 * never finished loading, which should fail loudly.
	 */
	async waitForRenderSettled(): Promise<void> {
		await expect(this.page.locator('[class*="skel"]')).toHaveCount(0);

		try {
			await this.page.waitForFunction(
				(quietMs) => {
					const marker = window as unknown as {
						__viciDomSettleLast?: number;
						__viciDomSettleObserver?: MutationObserver;
					};

					if (!marker.__viciDomSettleObserver) {
						marker.__viciDomSettleLast = performance.now();
						marker.__viciDomSettleObserver = new MutationObserver(() => {
							marker.__viciDomSettleLast = performance.now();
						});
						marker.__viciDomSettleObserver.observe(document.body, {
							attributes: true,
							characterData: true,
							childList: true,
							subtree: true
						});
					}

					return performance.now() - (marker.__viciDomSettleLast ?? 0) >= quietMs;
				},
				DOM_QUIET_MS,
				{ timeout: DOM_QUIET_TIMEOUT_MS }
			);
		} catch (err: unknown) {
			if (!(err instanceof Error) || err.name !== 'TimeoutError') {
				throw err;
			}
		}
	}

	/**
	 * The markets board. The root landing (`/`) bounces a signed-in session
	 * to `/flow`; the markets list lives on the canonical home surface at
	 * `/app` (`AppPath.Home`), which is what the feed snapshots target.
	 */
	async gotoMarkets(): Promise<void> {
		await this.page.goto('/app');
	}

	async gotoSignIn(): Promise<void> {
		await this.page.goto('/signin');
	}

	/**
	 * Pin everything that drifts between runs so {@link expect.toHaveScreenshot}
	 * compares apples to apples:
	 *
	 * - Waits for web fonts to load so glyph metrics (and therefore the height
	 *   of every text run) are stable. Without this, snapshots taken before
	 *   `document.fonts.ready` use the system fallback font and any later
	 *   run-with-fonts produces a multi-pixel diff on every character.
	 * - Replaces every `MarketTimeRemaining` chip with a fixed-width placeholder.
	 *   `getTimeRemaining()` is wall-clock-relative (`"7d 14h"`, `"0d 23h"`,
	 *   `"15m remaining"`, …); the strings have different rendered widths,
	 *   and Playwright's `mask` option overlays a magenta rectangle the size
	 *   of the element's bounding box, so even masked the rectangle width
	 *   drifts run-to-run and the diff fires. Owning the text content is the
	 *   only way to make it byte-stable.
	 * - Replaces every `PrincipalDisplay` (the shortened principal text
	 *   rendered by `CopyableAddress`) with a fixed-width placeholder.
	 *   Juno's dev mock identity is deterministic WITHIN a CI run but the
	 *   PocketIC emulator container mints a different principal on every
	 *   fresh boot, so the rendered shortened form (e.g. `aapr-r…dnh-4qe`
	 *   vs `xqzm-i…inh-4qe`) drifts run-to-run wherever a `CopyableAddress`
	 *   appears outside the (already-masked) `userMenu` — most notably on
	 *   the profile page body. Same byte-stability rationale as the time
	 *   chip: pinning the text is the only fix that doesn't trade one
	 *   variable-width drift for another.
	 * - Replaces the remaining per-run identities and figures listed in
	 *   {@link PINNED_SNAPSHOT_TEXT}, each of which was observed rewriting its
	 *   baseline on consecutive CI runs of the same commit.
	 * - Dismisses any Menagerie trophy reveal covering the page (see
	 *   {@link dismissMenagerieReveals}).
	 *
	 * Call this immediately before any `toHaveScreenshot` in a spec that
	 * renders market cards or signed-in profile content.
	 */
	async stabilizeForSnapshot(): Promise<void> {
		await this.dismissMenagerieReveals();

		await this.page.evaluate(async () => {
			await document.fonts.ready;
		});

		await this.page.evaluate(
			({ timeRemainingSel, principalSel, pinned }) => {
				for (const el of document.querySelectorAll<HTMLElement>(timeRemainingSel)) {
					el.textContent = '-- remaining';
				}

				for (const el of document.querySelectorAll<HTMLElement>(principalSel)) {
					el.textContent = 'xxxxxxx…xxxxxxx';
				}

				for (const { selector, text } of pinned) {
					for (const el of document.querySelectorAll<HTMLElement>(selector)) {
						el.textContent = text;
					}
				}
			},
			{
				timeRemainingSel: `[data-tid="${TestId.MarketTimeRemaining}"]`,
				principalSel: `[data-tid="${TestId.PrincipalDisplay}"]`,
				pinned: PINNED_SNAPSHOT_TEXT
			}
		);
	}

	/**
	 * Close every Menagerie trophy reveal on screen, including any queued
	 * behind the first.
	 *
	 * A reveal is never page content, and a baseline captured under one
	 * rewrites itself on the next run. The dev principal is the only profile on
	 * the emulator satellite, so the self-rank query puts it at world #1 of 1,
	 * which earns the iridescent Goat. That one must not reach here at all: the
	 * celebration host holds its silent first-load ledger seed until the rank
	 * has settled, so Goat lands in the seed instead of celebrating later as a
	 * fresh crossing. This pass is the guard for a reveal that is genuinely on
	 * screen; it runs once, so it cannot catch one that mounts after it, and a
	 * snapshot that starts flipping under a reveal again means the seed timing
	 * regressed, not that this needs to wait longer.
	 *
	 * Dismissed through the scrim (the reveal's own tap-to-continue) rather than
	 * hidden, because a hidden reveal still auto-dismisses after a few seconds
	 * and pulses the Profile nav mid-screenshot. Each dismiss is awaited until
	 * the fly-to-nav finishes, which is also when the next queued reveal mounts.
	 * A fly already under way (the reveal's safety auto-dismiss) is awaited
	 * first, since it no longer matches the open selector but still covers the
	 * page.
	 */
	async dismissMenagerieReveals(): Promise<void> {
		await expect(this.menagerieRevealFlying).toHaveCount(0);

		while ((await this.menagerieRevealOpen.count()) > 0) {
			await this.menagerieRevealOpen.locator('.mr-scrim').click();

			await expect(this.menagerieRevealFlying).toHaveCount(0);
		}
	}

	/**
	 * Bring the `/signup` one-screen onboarding to the point where auth can
	 * start. The empty handle field auto-claims its pool suggestion, so the
	 * provider stack ungates (the dev button becomes enabled) without any
	 * interaction — leaving the flow ready for the dev sign-in click. The
	 * "Skip" affordance is deliberately untouched: it starts guest mode, not
	 * the auth path.
	 */
	async advanceOnboardingToAuth(): Promise<void> {
		await this.onboarding.waitFor({ state: 'visible' });

		await expect(this.signInDevButton).toBeEnabled();
	}

	/**
	 * Wait until the signed-in app shell has settled — the account control
	 * is visible and the initial data fetches have gone idle. Useful as the
	 * first await after a sign-in so subsequent assertions see a stable
	 * shell rather than racing hydration.
	 */
	async waitForSignedInShell(): Promise<void> {
		await this.userMenu.waitFor({ state: 'visible' });

		// Best-effort settle: the account control being visible already proves
		// the signed-in shell mounted. `networkidle` is bounded and its
		// timeout swallowed because the landing surface (`/flow`) runs
		// background polling (order books) that can keep the network from ever
		// going fully idle — without the bound this would hang the full
		// `actionTimeout` on every sign-in.
		try {
			await this.page.waitForLoadState('networkidle', { timeout: 5_000 });
		} catch (err) {
			if (!(err instanceof Error) || err.name !== 'TimeoutError') {
				throw err;
			}
		}
	}

	/**
	 * High-level helper: opens `/signup`, brings the one-screen onboarding to
	 * the auth step, signs in via the dev mock identity, and lands on a fully-
	 * interactive signed-in shell (`/flow`). A fresh dev principal has no
	 * profile, so this new-user path is the canonical way into the app — a
	 * bare sign-in on `/signin` would itself bounce here.
	 *
	 * Wrapped in one auto-retry with a page reload between attempts. The
	 * sign-in pipeline rides on `/api/v3|v4/canister/*` calls through the
	 * Vite dev-server proxy, which has been observed to enter a sticky
	 * `socket hang up` / `ECONNRESET` state mid-suite. Top-level Playwright
	 * retries don't help — they share the same dev-server process and the
	 * connection pool stays poisoned. A `page.reload()` re-runs app init
	 * against the proxy and is often enough to shake it loose.
	 *
	 * If the second attempt also fails, throws with the underlying error
	 * wrapped in context so it doesn't get swallowed into a generic
	 * "user-menu not visible".
	 */
	async signInAsDevUser(): Promise<void> {
		const attempt = async (): Promise<void> => {
			await this.page.goto('/signup');

			await this.advanceOnboardingToAuth();

			// The dev provider drives the same `signIn({ dev: {} })` →
			// `onAuthStateChange` pipeline as the /signin gate; on success the
			// onboarding handoff is drained and the app hard-loads `/flow`.
			await this.signInDevButton.click();

			await this.waitForSignedInShell();
		};

		try {
			await attempt();
		} catch (firstError: unknown) {
			// `domcontentloaded`, not `networkidle`: the signed-in surfaces run
			// background polling that can keep the network from ever going
			// idle, which would hang the retry instead of recovering it.
			await this.page.reload({ waitUntil: 'domcontentloaded' });

			try {
				await attempt();
			} catch (secondError: unknown) {
				throw new Error(
					`signInAsDevUser failed twice. ` +
						`First attempt: ${(firstError as Error).message}. ` +
						`Second attempt (after page reload): ${(secondError as Error).message}. ` +
						`This typically indicates the Vite-↔-PocketIC proxy has entered a ` +
						`sticky error state — see docs/ai/frontend/testing.md.`,
					{ cause: secondError }
				);
			}
		}
	}

	/**
	 * Hard-delete the signed-in dev principal's profile via the dev-only
	 * reset hook (`window.__viciE2E.resetMyProfile`, installed by the `(app)`
	 * layout when `isDev()`).
	 *
	 * The dev mock identity resolves to ONE principal for the whole CI run,
	 * and every prior `signInAsDevUser` auto-claims the handle field's pool
	 * suggestion and completes onboarding for it — so by the time a spec needs
	 * a brand-new user, that principal is already a fully-onboarded returning
	 * user. Delete its profile so the next sign-in bootstraps fresh, restoring
	 * the genuine new-user path.
	 *
	 * IMPORTANT: follow this with {@link signOutDev}, NOT {@link logout}. The
	 * delete must be the last signed-in action before sign-out — a signed-in
	 * page load in between (navigating to the Settings sign-out surface) re-runs
	 * `ensureProfile`, which finds no doc and immediately re-bootstraps one,
	 * resurrecting exactly what this deleted. `signOutDev` signs out in place
	 * with no navigation, so nothing re-bootstraps it.
	 */
	async resetDevProfile(): Promise<void> {
		await this.page.evaluate(async () => {
			const hooks = (window as unknown as { __viciE2E?: { resetMyProfile: () => Promise<void> } })
				.__viciE2E;

			if (!hooks) {
				throw new Error(
					'Dev-only e2e reset hook (window.__viciE2E) is not installed — expected isDev() on the dev server.'
				);
			}

			await hooks.resetMyProfile();
		});
	}

	/**
	 * Durably wipe the persisted session via the dev-only hook so the NEXT full
	 * page load is signed-out. Deliberately does NOT call Juno `signOut()`.
	 *
	 * Juno persists the dev mock identity in `juno-dev-identifiers`, and its
	 * `signOut()` RE-SAVES that identity (for next-time convenience) — so clearing
	 * and then signing out just puts the identity back, and the following
	 * `/signin` reload auto-restores the session and bounces to `/flow`, racing
	 * the caller's `goto('/signup')`. Skipping `signOut()` avoids that re-persist
	 * entirely: we wipe every persisted store while still on `/flow` (where the
	 * hook, installed by the `(app)` layout, exists and the page is stable), and
	 * the caller's full `goto('/signup')` then tears down the in-memory session
	 * and cold-loads signed-out.
	 *
	 * Pairs with {@link resetDevProfile}: no signed-in page LOAD happens between
	 * the delete and the signed-out `/signup`, so `ensureProfile` can't
	 * re-bootstrap the deleted profile.
	 */
	async clearDevSession(): Promise<void> {
		await this.page.evaluate(async () => {
			const hooks = (window as unknown as { __viciE2E?: { clearSession: () => Promise<void> } })
				.__viciE2E;

			if (!hooks) {
				throw new Error(
					'Dev-only e2e reset hook (window.__viciE2E) is not installed — expected isDev() on the dev server.'
				);
			}

			await hooks.clearSession();
		});
	}

	/**
	 * Sign out via the Settings page — the only sign-out surface in the
	 * current app (the old account dropdown is gone). The reveal button
	 * arms an in-page confirm; the destructive confirm calls `signOut()`,
	 * after which the (app) gate routes back to `/signin`.
	 */
	async logout(): Promise<void> {
		await this.page.goto('/settings');
		await this.signOutButton.click();
		await this.logoutButton.click();
	}
}
