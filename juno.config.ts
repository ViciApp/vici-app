import { defineConfig } from '@junobuild/config';

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
	REFERRAL_CODES = 'referral_codes',
	REFERRALS = 'referrals',
	LEAGUES = 'leagues',
	LEAGUE_MEMBERS = 'league_members',
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
	EVENT_ROLLUPS = 'event_rollups'
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

export default defineConfig(({ mode }) => ({
	satellite: {
		ids: {
			development: isEmulator ? EMULATOR_SATELLITE_ID : 'auamu-4x777-77775-aaaaa-cai',
			production: '7scay-7yaaa-aaaal-asxqa-cai'
		},
		hosting: {
			source: 'build',
			// `seo:assets` rewrites the built shell into per-market crawler pages
			// (+ sitemap); see `scripts/build/generate-seo-assets.ts`. It must run
			// on EVERY hosting deploy: `--prune` deletes any asset missing from
			// `build/`, so skipping it would wipe the deployed SEO surface.
			predeploy: ['npm run build', 'npm run seo:assets']
		},
		authentication: {
			google: {
				clientId:
					mode === 'production'
						? '215111139647-7hat1jefroe7tkgu5kds4s8sv4dgf3fu.apps.googleusercontent.com'
						: '794351932143-em7c7j4rko2ok5fhk4crhv6f44ifmpqv.apps.googleusercontent.com',
				delegation
			}
		},
		collections: {
			datastore: [
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
				// like. `assertSetActivityReaction` binds each write to its
				// caller (liker === caller, key shape), and Juno's owner-scoped
				// delete keeps an unlike to the liker's own doc.
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
				// results feed. Public read (the friend-scoped digest reads
				// them); controllers write so only the satellite resolution hook
				// (writing as admin, derived from the clearing settlement plan)
				// can record a result; a client can't forge a win. Rows past the
				// retention horizon are pruned by the controllers-only cleanup.
				{
					collection: JunoDatastoreCollection.RESOLVED_RESULTS,
					memory: 'stable',
					read: 'public',
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
				{
					collection: JunoDatastoreCollection.REFERRAL_CODES,
					memory: 'stable',
					read: 'public',
					write: 'public'
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
				{
					collection: JunoDatastoreCollection.EXIT_SIGNALS,
					memory: 'stable',
					read: 'public',
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
				}
			],
			// Owner-uploaded league cover images. Public read so every
			// surface can render the cover; write is public so the owning
			// principal can upload (the FE only offers the control to the
			// league owner, and the doc-side `assertSetLeague` is what
			// authorises which `imageUrl` lands on the league record).
			storage: [
				{
					collection: JunoStorageCollection.LEAGUE_IMAGES,
					memory: 'stable',
					read: 'public',
					write: 'public'
				}
			]
		}
	},
	emulator: {
		runner: {
			type: 'docker'
		},
		// `satellite` profile boots the minimal single-satellite emulator
		// (`junobuild/satellite:latest`). The `skylab` profile boots the
		// full Juno suite (`junobuild/skylab:latest`) with the dev Console,
		// but `juno functions build` exits silently with code 1 against it
		// (see commit 693c6a6 for the same revert we did earlier). Stick to
		// `satellite` until juno-cli fixes the skylab build path.
		satellite: {}
	}
}));
