/**
 * Test IDs for end-to-end tests.
 *
 * Components that need to be addressable from Playwright should get a
 * `data-tid={TestId.X}` attribute. Playwright is configured with
 * `testIdAttribute: 'data-tid'` (see `playwright.config.ts`), so tests can
 * use `page.getByTestId(TestId.X)`.
 *
 * Keep this enum minimal — only add an entry when an E2E test references it.
 * See `docs/ai/frontend/testing.md` for the broader testing policy.
 */
export enum TestId {
	AppMain = 'app-main',
	SignInDev = 'sign-in-dev',
	// The signed-in account control in the app chrome — the desktop nav
	// profile handle and the mobile pillnav profile tab both carry it, so
	// `[data-tid="user-menu"]:visible` resolves to whichever one the current
	// viewport renders.
	UserMenu = 'user-menu',
	// Settings sign-out: the reveal button, then the destructive confirm.
	SignOutButton = 'sign-out-button',
	Logout = 'logout',
	MarketFeed = 'market-feed',
	MarketCard = 'market-card',
	MarketCardSkeleton = 'market-card-skeleton',
	MarketTimeRemaining = 'market-time-remaining',
	PrincipalDisplay = 'principal-display',
	// Onboarding (`/signup`): the outer wrapper, the handle input, the skip
	// escape, and the primary CTA (claim / finish).
	Onboarding = 'onboarding',
	OnboardingHandleInput = 'onboarding-handle-input',
	OnboardingHandleSkip = 'onboarding-handle-skip',
	OnboardingPrimary = 'onboarding-primary',
	// Legacy-build moved screen: the surface (on `/signup`, or the overlay after
	// a sign-in with no profile), its new-app link, and its sign-in escape.
	MovedToNewApp = 'moved-to-new-app',
	MovedToNewAppCta = 'moved-to-new-app-cta',
	MovedToNewAppSignIn = 'moved-to-new-app-sign-in',
	// Admin resolutions page (`/admin/resolutions`): the pending-list and
	// history sections, the list's search input, each pending market card
	// (also tagged with `data-market-id` so a specific market is
	// addressable), its YES / NO resolve buttons, and the confirm dialog
	// with its cancel / confirm controls.
	AdminResolutionList = 'admin-resolution-list',
	AdminResolutionHistory = 'admin-resolution-history',
	AdminResolutionSearch = 'admin-resolution-search',
	AdminResolutionCard = 'admin-resolution-card',
	AdminResolutionResolveYes = 'admin-resolution-resolve-yes',
	AdminResolutionResolveNo = 'admin-resolution-resolve-no',
	AdminResolutionConfirmDialog = 'admin-resolution-confirm-dialog',
	AdminResolutionConfirmCancel = 'admin-resolution-confirm-cancel',
	AdminResolutionConfirmCta = 'admin-resolution-confirm-cta'
}
