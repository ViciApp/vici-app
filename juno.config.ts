import {
	defineConfig,
	type AuthenticationConfig,
	type DatastoreCollection,
	type StorageCollection
} from '@junobuild/config';

/**
 * Datastore collection names for `satellite.collections` below.
 *
 * We keep them here instead of importing e.g. `./juno.collections.json`. Juno’s Docker-based
 * emulator/CLI often evaluates this config in an isolated context where extra project files
 * are not available or not bundled; importing external JSON can fail silently or break config load.
 * Track upstream: https://github.com/junobuild/juno-docker/issues/262
 *
 * The app still uses `juno.collections.json` via `Collection` in `src/lib`; keep both in sync when renaming.
 */
enum JunoDatastoreCollection {
	ROLES = 'roles',
	PROFILES = 'profiles',
	PROFILE_PRIVATE = 'profile_private',
	RELATIONS = 'relations',
	CHATS = 'chats',
	COMMENTS = 'comments',
	MARKET_METADATA = 'market_metadata',
	MARKET_TAG_INDEX = 'market_tag_index',
	MARKET_TRANSLATIONS = 'market_translations',
	ACTIVITIES = 'activities',
	ACTIVITY_REACTIONS = 'activity_reactions',
	ACTIVITY_REACTION_COUNTS = 'activity_reaction_counts',
	RESOLVED_RESULTS = 'resolved_results',
	VXP_ONBOARDING = 'vxp_onboarding',
	VXP_AWARDS = 'vxp_awards',
	CALIBRATION_ATTEMPTS = 'calibration_attempts',
	VXP_AWARD_MARKERS = 'vxp_award_markers',
	REFERRAL_CODES = 'referral_codes',
	REFERRALS = 'referrals',
	LEAGUES = 'leagues',
	LEAGUE_MEMBERS = 'league_members',
	LEAGUE_INVITES = 'league_invites',
	LEAGUE_INVITE_ATTEMPTS = 'league_invite_attempts',
	BATTLES = 'battles',
	AFFILIATIONS = 'affiliations',
	AFFILIATION_STATS = 'affiliation_stats',
	EXIT_SIGNALS = 'exit_signals',
	TOURNAMENTS = 'tournaments',
	TOURNAMENT_MATCHES = 'tournament_matches',
	LEAGUE_STATS = 'league_stats',
	USER_STATS = 'user_stats',
	USER_MONTHLY_STATS = 'user_monthly_stats',
	SCHOOL_SUBMISSIONS = 'school_submissions',
	SCHOOLS = 'schools',
	APP_CONFIG = 'app_config',
	EVENTS = 'events',
	EVENT_ROLLUPS = 'event_rollups',
	LEADERBOARD_RANKING = 'leaderboard_ranking'
}

/**
 * Storage collection names for `satellite.collections.storage` below.
 * Storage holds binary assets (not Datastore docs); kept separate from
 * {@link JunoDatastoreCollection} for that reason. Mirrors the
 * `LEAGUE_IMAGES_COLLECTION` constant in `src/lib/types/league.ts`.
 */
enum JunoStorageCollection {
	LEAGUE_IMAGES = 'league_images'
}

/**
 * Per-asset cap of `league_images`. A cover is a 256 px square JPEG of a few
 * tens of KB; the cap leaves room for that and nothing much bigger. Juno
 * enforces it, so it lives only here.
 */
const LEAGUE_IMAGE_MAX_SIZE_BYTES = BigInt(512 * 1024);

const delegation = {
	// Like identities derived by Internet Identity, those derived with OpenID
	// are allowed to interact with any canister on the Internet Computer.
	allowedTargets: null,
	sessionDuration: BigInt(7 * 24 * 60 * 60 * 1000 * 1000 * 1000) // 7 days in nanoseconds
};

/**
 * The Juno CLI's `--emulator` flag is only valid with `--mode development`,
 * so E2E (which runs against the `junobuild/satellite` image) must reuse
 * `mode === 'development'`. To avoid pointing the CLI at the *real* dev
 * satellite, callers (CI + local emulator workflows) export
 * `JUNO_EMULATOR=true`, which swaps `ids.development` to the predictable
 * satellite ID baked into the emulator image. See
 * `docs/ai/frontend/testing.md`.
 */
const isEmulator = process.env.JUNO_EMULATOR === 'true';

const EMULATOR_SATELLITE_ID = 'jx5yt-yyaaa-aaaal-abzbq-cai';

/**
 * Legacy shutdown for the cutover to vici.app, switched on only by
 * `VITE_LEGACY_SHUTDOWN=true juno config apply` (see
 * `.agents/workflows/cutover.md`), so merging a change here never alters the
 * live satellite. It turns every collection writable by controllers only:
 * no user write lands after the final ETL export, while the satellite's own
 * admin writes and every read keep working, which that export needs. Rules
 * change through `set_rule` alone, without a functions upgrade, and stay
 * reversible: applying again without the flag restores today's rules.
 *
 * The same apply also locks sign-in ({@link legacySignInLock}), and the same
 * variable builds the frontend's moved screen (`isLegacyShutDown` in
 * `new-app-redirect.services.ts`), so one switch covers all three. A hosting
 * redirect is not used: the satellite serves an existing asset before any
 * redirect, puts the configured location in `Location` verbatim (no path),
 * and certifies a redirect only at its literal source path, so a `**`
 * redirect would not cover the app's routes.
 *
 * Read when the config is evaluated, not when the module loads, so a test can
 * evaluate both states.
 */
const isLegacyShutdown = (): boolean => process.env.VITE_LEGACY_SHUTDOWN === 'true';

const legacyWriteFreeze = <T extends DatastoreCollection | StorageCollection>(rules: T[]): T[] =>
	isLegacyShutdown() ? rules.map((rule) => ({ ...rule, write: 'controllers' })) : rules;

const SATELLITE_IDS = {
	development: isEmulator ? EMULATOR_SATELLITE_ID : 'auamu-4x777-77775-aaaaa-cai',
	production: '7scay-7yaaa-aaaal-asxqa-cai'
};

/**
 * Nobody signs in on the legacy app after the shutdown, existing accounts
 * included, and the satellite enforces it, so a tab still running the old
 * bundle or a direct call cannot open a session either:
 *
 * - `allowedCallers` makes the satellite refuse every Datastore and Storage
 *   call from a caller not listed, reads included. Juno reads an empty list as
 *   "everyone", so the list holds only the satellite ids, principals no user
 *   identity can have. Juno-js sign-in reads or creates the caller's `#user`
 *   doc, so it fails for everyone; controllers and admin access keys are exempt
 *   (the ETL and the Console keep working), and hosting is served by
 *   `http_request`, which this rule does not gate, so the moved screen loads.
 * - Google is left out, so the satellite stops minting OpenID delegations,
 *   whose `allowedTargets: null` would otherwise let a new session call other
 *   canisters. Internet Identity delegations come from II, not from here: the
 *   allowlist is what refuses them.
 *
 * Not covered: the custom `defineQuery` / `defineUpdate` endpoints in
 * `src/satellite/index.ts`. Juno does not run this rule for them, and they
 * already answer anonymous callers, so they are not a sign-in path; the
 * public ones (the leaderboard read, analytics `trackEvents`, ...) keep
 * answering a direct call. Closing them needs a functions upgrade, which the
 * cutover runbook lists as a known gap.
 *
 * Applying again without the flag restores Google and drops the allowlist.
 */
const legacySignInLock = (): AuthenticationConfig => ({
	rules: { allowedCallers: Object.values(SATELLITE_IDS) }
});

export default defineConfig(({ mode }) => ({
	satellite: {
		ids: SATELLITE_IDS,
		hosting: {
			source: 'build',
			// `seo:assets` rewrites the built shell into per-market crawler pages
			// (+ sitemap); see `scripts/build/generate-seo-assets.ts`. It must run
			// on EVERY hosting deploy: `--prune` deletes any asset missing from
			// `build/`, so skipping it would wipe the deployed SEO surface.
			predeploy: ['npm run build', 'npm run seo:assets']
		},
		authentication: isLegacyShutdown()
			? legacySignInLock()
			: {
					google: {
						clientId:
							mode === 'production'
								? '215111139647-7hat1jefroe7tkgu5kds4s8sv4dgf3fu.apps.googleusercontent.com'
								: '794351932143-em7c7j4rko2ok5fhk4crhv6f44ifmpqv.apps.googleusercontent.com',
						delegation
					}
				},
		collections: {
			// `write: 'public'` lets any caller create, update or delete any doc:
			// Juno does no owner check. Each such collection has a set and a
			// delete assert in `src/satellite/index.ts` that admits only the doc's
			// owner, a satellite controller, or a named cross-user rule (see
			// `docs/ai/satellite/patterns.md`).
			datastore: legacyWriteFreeze([
				{
					collection: JunoDatastoreCollection.ROLES,
					memory: 'stable',
					read: 'public',
					write: 'public'
				},
				{
					collection: JunoDatastoreCollection.PROFILES,
					memory: 'stable',
					read: 'public',
					write: 'public'
				},
				// Owner-private profile data (the account email). `managed` on
				// both sides: the owner reads/writes their own doc, controllers
				// (satellite endpoints, admin tooling) can read for server-side
				// flows, but the doc is NEVER publicly readable, unlike the
				// `profiles` doc it splits from. `assertSetProfilePrivate`
				// additionally binds key + embedded owner to the caller so
				// another user can't squat or forge someone else's doc.
				{
					collection: JunoDatastoreCollection.PROFILE_PRIVATE,
					memory: 'stable',
					read: 'managed',
					write: 'managed'
				},
				{
					collection: JunoDatastoreCollection.RELATIONS,
					memory: 'stable',
					read: 'public',
					write: 'public'
				},
				// `chats` and `comments` are dormant: nothing in the app reads or
				// writes them (the web2 export still drains them), so their set
				// and delete asserts accept only a controller.
				{
					collection: JunoDatastoreCollection.CHATS,
					memory: 'stable',
					read: 'public',
					write: 'public'
				},
				{
					collection: JunoDatastoreCollection.COMMENTS,
					memory: 'stable',
					read: 'public',
					write: 'public'
				},
				{
					collection: JunoDatastoreCollection.MARKET_METADATA,
					memory: 'stable',
					read: 'public',
					write: 'public'
				},
				// Reverse index `market tag → seriesId[]` (one doc per tag).
				// Maintained inline by `upsertMarketMetadata` so battle scoping
				// reads a single bucket instead of scanning `market_metadata`.
				// Public read (battle resolution reads it as the caller);
				// controllers-only write: only the satellite upsert / rebuild
				// endpoints write it (as admin), so a client can't forge a tag set.
				{
					collection: JunoDatastoreCollection.MARKET_TAG_INDEX,
					memory: 'stable',
					read: 'public',
					write: 'controllers'
				},
				{
					collection: JunoDatastoreCollection.MARKET_TRANSLATIONS,
					memory: 'stable',
					read: 'public',
					write: 'public'
				},
				{
					collection: JunoDatastoreCollection.ACTIVITIES,
					memory: 'stable',
					read: 'public',
					write: 'public'
				},
				// Per-liker reaction docs for the friend activity feed (one doc
				// per activity-per-liker). Public read so counts + my-likes
				// hydrate on load; public write so a user persists their own
				// like. Juno does no owner check on a public collection, so
				// `assertSetActivityReaction` binds each write to its caller
				// (liker === caller, key shape) and
				// `assertDeleteActivityReaction` keeps an unlike to the liker.
				{
					collection: JunoDatastoreCollection.ACTIVITY_REACTIONS,
					memory: 'stable',
					read: 'public',
					write: 'public'
				},
				// Per-activity like-count rollup. Public read (the feed renders
				// counts); controllers write so only the satellite hooks
				// (onActivityReactionSet / onActivityReactionDelete, writing as
				// admin) can move a count; a client can't forge one. Maintained
				// server-side; the admin recompute endpoint re-derives exact
				// counts from `activity_reactions` on demand.
				{
					collection: JunoDatastoreCollection.ACTIVITY_REACTION_COUNTS,
					memory: 'stable',
					read: 'public',
					write: 'controllers'
				},
				// Per-participant resolved-result rows for the friend-readable
				// results feed. Controllers read: a client reads them only through
				// `listFriendResolvedResults`, which answers the caller's own rows
				// and their active, visible friends'. Controllers write so only the
				// satellite resolution hook (writing as admin, derived from the
				// clearing settlement plan) can record a result; a client can't
				// forge a win. Rows past the retention horizon are pruned by the
				// controllers-only cleanup.
				{
					collection: JunoDatastoreCollection.RESOLVED_RESULTS,
					memory: 'stable',
					read: 'controllers',
					write: 'controllers'
				},
				{
					collection: JunoDatastoreCollection.VXP_ONBOARDING,
					memory: 'stable',
					read: 'public',
					write: 'public'
				},
				{
					collection: JunoDatastoreCollection.VXP_AWARDS,
					memory: 'stable',
					read: 'public',
					write: 'public'
				},
				// The first side each user called on each finalised market for a
				// calibration reward, so a miss cannot be called again on the
				// other side. Controllers-only: the `claimCalibrationReward`
				// endpoint is the sole reader and writer (as a controller).
				{
					collection: JunoDatastoreCollection.CALIBRATION_ATTEMPTS,
					memory: 'stable',
					read: 'controllers',
					write: 'controllers'
				},
				// An anonymous marker per one-time award a purged account was paid:
				// a digest of the principal, the award type and key, nothing else.
				// The award asserts and payouts refuse an award whose marker
				// exists, so signing up again never pays it twice. Controllers-only:
				// the account purge writes them and the award paths read them.
				{
					collection: JunoDatastoreCollection.VXP_AWARD_MARKERS,
					memory: 'stable',
					read: 'controllers',
					write: 'controllers'
				},
				// Each user's referral code, keyed by the code. Controllers-only:
				// the satellite assigns a code when a profile is created and
				// resolves one through `lookupReferralCode`, `getMyReferralCode`,
				// the redeem and the friendship claim, so no client lists the
				// codes or reads who owns them.
				{
					collection: JunoDatastoreCollection.REFERRAL_CODES,
					memory: 'stable',
					read: 'controllers',
					write: 'controllers'
				},
				{
					collection: JunoDatastoreCollection.REFERRALS,
					memory: 'stable',
					read: 'public',
					write: 'public'
				},
				{
					collection: JunoDatastoreCollection.LEAGUES,
					memory: 'stable',
					read: 'public',
					write: 'public'
				},
				{
					collection: JunoDatastoreCollection.LEAGUE_MEMBERS,
					memory: 'stable',
					read: 'public',
					write: 'public'
				},
				// Each league's invite code, the one way into a league.
				// Controllers-only so no client can read it: the satellite's
				// `createLeague`, `joinLeagueByInvite` and `listMyLeagues` are
				// the only readers and writers.
				{
					collection: JunoDatastoreCollection.LEAGUE_INVITES,
					memory: 'stable',
					read: 'controllers',
					write: 'controllers'
				},
				// The invite codes each account looked up or joined with in the
				// last hour that opened no league, one doc per account keyed by
				// the principal. Controllers-only: `lookupLeagueByInvite` and
				// `joinLeagueByInvite` read it to refuse an account past its
				// hourly cap and write each miss; the account purge drops it.
				{
					collection: JunoDatastoreCollection.LEAGUE_INVITE_ATTEMPTS,
					memory: 'stable',
					read: 'controllers',
					write: 'controllers'
				},
				{
					collection: JunoDatastoreCollection.BATTLES,
					memory: 'stable',
					read: 'public',
					write: 'public'
				},
				{
					collection: JunoDatastoreCollection.AFFILIATIONS,
					memory: 'stable',
					read: 'public',
					write: 'public'
				},
				// Frozen monthly Worlds snapshots only: one immutable doc per
				// `${kind}/${affiliationIdentifier}/${monthAnchor}`, written by the
				// podium freeze (writing as a controller) the first time a closed
				// month is claimed. Public read (standings surfaces render them);
				// controllers write so a client can't forge a frozen ranking. The
				// live windows (all-time, current month) are recomputed on read from
				// the roster and never persisted here. `assertSetAffiliationStats`
				// enforces snapshot-key-only + write-once as defence in depth.
				{
					collection: JunoDatastoreCollection.AFFILIATION_STATS,
					memory: 'stable',
					read: 'public',
					write: 'controllers'
				},
				// Controllers read the churn log: a doc's Juno timestamps are
				// those of the soft-delete written in the same call, so a public
				// read would let anyone tie a reason and note to the profile.
				{
					collection: JunoDatastoreCollection.EXIT_SIGNALS,
					memory: 'stable',
					read: 'controllers',
					write: 'public'
				},
				{
					collection: JunoDatastoreCollection.TOURNAMENTS,
					memory: 'stable',
					read: 'public',
					write: 'public'
				},
				{
					collection: JunoDatastoreCollection.TOURNAMENT_MATCHES,
					memory: 'stable',
					read: 'public',
					write: 'public'
				},
				{
					collection: JunoDatastoreCollection.LEAGUE_STATS,
					memory: 'stable',
					read: 'public',
					write: 'public'
				},
				{
					collection: JunoDatastoreCollection.USER_STATS,
					memory: 'stable',
					read: 'public',
					write: 'public'
				},
				{
					collection: JunoDatastoreCollection.USER_MONTHLY_STATS,
					memory: 'stable',
					read: 'public',
					write: 'public'
				},
				// School-email verification submissions (B.1). Controllers-only:
				// the satellite's submit/verify endpoints are the sole reader and
				// writer (via the privileged *DocStore APIs), so a client can
				// neither read a stored code digest nor tamper with an attempt
				// counter / expiry.
				{
					collection: JunoDatastoreCollection.SCHOOL_SUBMISSIONS,
					memory: 'stable',
					read: 'controllers',
					write: 'controllers'
				},
				// Verified-school registry (B.1). Public read so picker surfaces
				// can list public schools; controllers-only write so the running
				// verified-member count + public gate are server-authoritative.
				{
					collection: JunoDatastoreCollection.SCHOOLS,
					memory: 'stable',
					read: 'public',
					write: 'controllers'
				},
				// Server runtime config (B.1): e.g. the vici-courier relay URL +
				// bearer token, set by a controller after deploy. Controllers-only
				// so it never needs to live in the repo.
				{
					collection: JunoDatastoreCollection.APP_CONFIG,
					memory: 'stable',
					read: 'controllers',
					write: 'controllers'
				},
				// Product-analytics raw event log (cockpit DQ-1). Append-only,
				// principal-keyed-but-pseudonymous. Controllers-only: the
				// `trackEvents` endpoint is the sole writer (via the privileged
				// *DocStore APIs as an admin) so clients can neither read other
				// users' behaviour nor forge events; the cockpit reads aggregates
				// through `getAnalyticsSummary`, never the raw collection.
				{
					collection: JunoDatastoreCollection.EVENTS,
					memory: 'stable',
					read: 'controllers',
					write: 'controllers'
				},
				// Per-UTC-day rollup of event counts (one doc per epoch-day),
				// bumped inline by `trackEvents`. Controllers-only; `getAnalyticsSummary`
				// reads these so the cockpit never scans the raw event log.
				{
					collection: JunoDatastoreCollection.EVENT_ROLLUPS,
					memory: 'stable',
					read: 'controllers',
					write: 'controllers'
				},
				// The global ranking computed from settled history by
				// `refreshLeaderboardRanking`. Controllers-only: the satellite
				// writes it and its leaderboard, rank and rival queries read it.
				{
					collection: JunoDatastoreCollection.LEADERBOARD_RANKING,
					memory: 'stable',
					read: 'controllers',
					write: 'controllers'
				}
			]),
			// Owner-uploaded league cover images. Public read so every
			// surface can render the cover; write is public so the owning
			// principal can upload. Juno does no owner check here either:
			// `assertUploadAsset` / `assertDeleteAsset` in
			// `src/satellite/index.ts` admit only the owner of the league the
			// path names (or a controller) and a JPEG, and `maxSize` caps each
			// asset.
			storage: legacyWriteFreeze([
				{
					collection: JunoStorageCollection.LEAGUE_IMAGES,
					memory: 'stable',
					read: 'public',
					write: 'public',
					maxSize: LEAGUE_IMAGE_MAX_SIZE_BYTES
				}
			])
		}
	},
	emulator: {
		runner: {
			type: 'docker',
			// Juno is deprecated and its images get no more fixes, so the
			// emulator stays on the last release we tested against, by digest:
			// a final push to `latest` cannot change CI under us.
			image:
				'junobuild/satellite:0.6.13@sha256:8dce05a2b276f8de8607747a3e72e3fb8d140fa1bf8a31c09d8c896c4b3d4f68'
		},
		// `satellite` profile boots the minimal single-satellite emulator.
		// The `skylab` profile boots the full Juno suite with the dev
		// Console, but `juno functions build` exits silently with code 1
		// against it (see commit 693c6a6 for the same revert we did earlier),
		// and juno-cli will not fix that any more.
		satellite: {}
	}
}));
