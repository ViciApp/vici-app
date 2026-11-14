export enum AppPath {
	/**
	 * Canonical signed-in entry. Cold-load on `/` redirects here once the
	 * auth handshake resolves a session; in-app nav links to "Home"
	 * (Markets tab) target this path directly to avoid a `/ → /app`
	 * double-bounce flicker.
	 */
	App = '/app',
	/**
	 * Alias for the home-tab destination. Currently routes to `/app`
	 * (which renders the markets listing). Kept distinct from
	 * `AppPath.App` so we can re-aim the home tab without churning every
	 * call-site.
	 */
	// eslint-disable-next-line @typescript-eslint/no-duplicate-enum-values
	Home = '/app',
	Markets = '/markets',
	Profile = '/profile',
	Album = '/profile/album',
	Wallet = '/wallet',
	Admin = '/admin',
	AdminAccess = '/admin/access',
	AdminMarkets = '/admin/markets',
	AdminResolutions = '/admin/resolutions',
	AdminVxp = '/admin/vxp',
	AdminHaptics = '/admin/haptics',
	Dash = '/dash',
	DashTransactions = '/dash/transactions',
	Portfolio = '/portfolio',
	Arena = '/arena',
	Flow = '/flow',
	Calibration = '/calibration',
	Settings = '/settings',
	AccountSettings = '/settings/account',
	Notifications = '/notifications'
}

/**
 * Public surfaces: accessible without an authenticated session.
 * The (app) layout gate redirects unauthenticated users to `/signin`
 * unless they're already on a path in this set.
 *
 * `SignIn` is the canonical landing surface for unauthenticated users;
 * `SignUp` hosts the pre-sign-in onboarding flow (). `/auth/...`
 * is the OAuth callback path used by `signInWithGoogle` and friends.
 */
export enum PublicPath {
	SignIn = '/signin',
	SignUp = '/signup',
	/**
	 * Canonical share-able marketing URL. Signed-in users can visit
	 * `/about` without being bounced to `/app`, so the marketing site
	 * stays linkable from anywhere.
	 */
	About = '/about',
	/**
	 * Legacy marketing path. Retained for backward-compat: the route
	 * itself just redirects to `PublicPath.About`.
	 */
	Welcome = '/welcome',
	Info = '/info'
}
