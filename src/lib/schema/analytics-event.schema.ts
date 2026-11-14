import { j, PrincipalTextSchema } from '@junobuild/schema';

/**
 * Runtime mirror of `lib/types/analytics-event.ts`. The two MUST stay in
 * sync: svelte-check validates the TS union, but only this Zod enum
 * guards values at write time (a missing entry fails at runtime, not at
 * type-check). Mirror order matches the type for easy diffing.
 */
export const AnalyticsEventNameSchema = j.enum([
	// Session & auth
	'session_started',
	'signed_up',
	'signed_in',
	'signed_out',
	'provider_linked',
	// Onboarding
	'onboarding_started',
	'onboarding_step',
	'handle_checked',
	'onboarding_completed',
	// Flow
	'flow_session_started',
	'flow_swipe',
	'flow_card_expanded',
	'flow_completed',
	'flow_abandoned',
	'sound_toggled',
	// Markets
	'market_viewed',
	'market_searched',
	'market_shared',
	'watchlist_added',
	'watchlist_removed',
	'orderbook_viewed',
	'market_translation_toggled',
	'market_category_filter',
	// Trading
	'position_taken',
	'position_closed',
	'prediction_created',
	'order_placed',
	'order_cancelled',
	// Resolution & payout
	'resolution_proposed',
	'resolution_confirmed',
	'resolution_disputed',
	'payout_settled',
	// Referral
	'referral_sent',
	'referral_link_copied',
	'referral_redeemed',
	'referral_converted',
	// VXP & economy
	'vxp_awarded',
	'streak_milestone',
	'faucet_claimed',
	'transactions_viewed',
	'transactions_filtered',
	// Social & leagues
	'friend_request_sent',
	'friend_feed_reaction',
	'friend_digest_opened',
	'league_created',
	'league_joined',
	'league_invite_sent',
	'battle_proposed',
	'battle_accepted',
	'battle_declined',
	'battle_expired',
	'battle_resolved',
	'battle_viewed',
	'comment_posted',
	'chat_sent',
	'leaderboard_viewed',
	// Worlds
	'affiliation_set',
	'affiliation_removed',
	// Settings / privacy
	'privacy_sharing_toggled',
	// School verification
	'school_picker_opened',
	'school_picked',
	'school_verify_email_submitted',
	'school_verify_code_submitted',
	// Churn
	'delete_flow_opened',
	'delete_confirmed',
	'delete_succeeded',
	'exit_signal',
	// Notifications
	'notification_opened',
	// PWA install (add-to-home-screen)
	'pwa_install_prompted',
	'pwa_install_accepted',
	'pwa_install_dismissed',
	// Health
	'app_error',
	'perf_metric'
]);

/**
 * Bounded dimensional vocabulary: mirrors `AnalyticsEventProps`. Fixed,
 * primitive, optional fields only; never widen to an open record (keeps
 * "no PII" structural).
 */
export const AnalyticsEventPropsSchema = j.strictObject({
	marketId: j.optional(j.string()),
	seriesId: j.optional(j.string()),
	leagueId: j.optional(j.string()),
	battleId: j.optional(j.string()),
	source: j.optional(j.string()),
	label: j.optional(j.string()),
	step: j.optional(j.number()),
	value: j.optional(j.number()),
	count: j.optional(j.number()),
	durationMs: j.optional(j.number()),
	ok: j.optional(j.boolean()),
	country: j.optional(j.string()),
	locale: j.optional(j.string())
});

/**
 * Persisted shape for entries in the `events` collection. Mirrors
 * `AnalyticsEventDoc`. Written server-side after validation.
 *
 * NB: `principal` is one of `@junobuild/schema`'s reserved field names;
 * fine here because this schema is decoded/encoded by hand and is NOT a
 * `defineQuery` / `defineUpdate` signature (the codegen never sees it).
 */
export const AnalyticsEventSchema = j.strictObject({
	name: AnalyticsEventNameSchema,
	tsMs: j.number(),
	sessionId: j.string(),
	principal: j.optional(PrincipalTextSchema),
	path: j.optional(j.string()),
	props: j.optional(AnalyticsEventPropsSchema)
});

/**
 * Args for the `trackEvents` update endpoint: a batch of client events.
 * The server derives identity + timestamp, so the input carries neither.
 *
 * The `AnalyticsEventProps` dimensions are **flattened** onto the input
 * rather than nested: the Sputnik codegen rejects a nested optional object
 * inside an array element ("Error generating API"), so the wire shape stays
 * one level deep. The satellite re-nests these into `props` before storage.
 */
export const TrackEventInputSchema = j.strictObject({
	name: AnalyticsEventNameSchema,
	sessionId: j.string(),
	path: j.optional(j.string()),
	marketId: j.optional(j.string()),
	seriesId: j.optional(j.string()),
	leagueId: j.optional(j.string()),
	battleId: j.optional(j.string()),
	source: j.optional(j.string()),
	// `label`, not `variant`: `variant` is a Candid reserved keyword and
	// breaks the Sputnik API codegen ("Error generating API").
	label: j.optional(j.string()),
	step: j.optional(j.number()),
	value: j.optional(j.number()),
	count: j.optional(j.number()),
	durationMs: j.optional(j.number()),
	ok: j.optional(j.boolean()),
	country: j.optional(j.string()),
	locale: j.optional(j.string()),
	occurredAtMs: j.optional(j.number())
});

export const TrackEventsArgsSchema = j.strictObject({
	events: j.array(TrackEventInputSchema)
});

export const TrackEventsResultSchema = j.strictObject({
	accepted: j.number()
});

/** Args for `getAnalyticsSummary`: how many trailing days of rollups to return. */
export const GetAnalyticsSummaryArgsSchema = j.strictObject({
	days: j.number()
});

/**
 * Result of `getAnalyticsSummary`: a **flat** list of `(day, name, count)`
 * rows (the cockpit groups by `day` client-side). Kept single-level: the
 * codegen rejects an array nested inside another array's record. `day` is
 * the epoch-day index and `start` its start-of-day ms.
 */
export const AnalyticsSummarySchema = j.strictObject({
	rows: j.array(
		j.strictObject({
			day: j.number(),
			start: j.number(),
			name: AnalyticsEventNameSchema,
			count: j.number()
		})
	)
});

/** Args for `getAnalyticsEvents`: keyset cursor + page size for the cockpit's
 * warehouse ingest. The cursor is the `(updated_at, key)` pair of the last
 * synced doc: `afterUpdatedAtNs` is the EXCLUSIVE `updated_at` lower bound (as
 * text: nat64 exceeds JS safe-int) and `afterKey` breaks ties between docs that
 * share that `updated_at`. Both absent/empty starts from the beginning. The
 * cockpit advances the cursor from the last returned row's `(updatedAtNs, key)`. */
export const GetAnalyticsEventsArgsSchema = j.strictObject({
	afterUpdatedAtNs: j.optional(j.string()),
	afterKey: j.optional(j.string()),
	limit: j.number()
});

/**
 * One exported event row: the `events` doc envelope (key + ns timestamps +
 * version + owner) plus the FLATTENED behavioural payload. Flattened, not a
 * nested `props`, because the Sputnik codegen rejects a nested optional object
 * inside an array element (same constraint as `TrackEventInputSchema`).
 *
 * Field names avoid the codegen-reserved `principal`/`variant`: identity is
 * `principalText`, the dimension stays `label`, and `owner` → `ownerText`.
 */
export const AnalyticsEventExportRowSchema = j.strictObject({
	key: j.string(),
	createdAtNs: j.string(),
	updatedAtNs: j.string(),
	version: j.optional(j.string()),
	ownerText: j.optional(PrincipalTextSchema),
	name: AnalyticsEventNameSchema,
	tsMs: j.number(),
	sessionId: j.string(),
	principalText: j.optional(PrincipalTextSchema),
	path: j.optional(j.string()),
	marketId: j.optional(j.string()),
	seriesId: j.optional(j.string()),
	leagueId: j.optional(j.string()),
	battleId: j.optional(j.string()),
	source: j.optional(j.string()),
	label: j.optional(j.string()),
	step: j.optional(j.number()),
	value: j.optional(j.number()),
	count: j.optional(j.number()),
	durationMs: j.optional(j.number()),
	ok: j.optional(j.boolean()),
	country: j.optional(j.string()),
	locale: j.optional(j.string())
});

export const GetAnalyticsEventsResultSchema = j.strictObject({
	rows: j.array(AnalyticsEventExportRowSchema),
	hasMore: j.boolean()
});

/** Args for `deleteAnalyticsEvents`: the cockpit's DRAIN step. After a page of
 * events is durably written to the warehouse, the cockpit passes their `keys` back
 * to delete them, keeping the on-chain `events` collection a small buffer (a large
 * collection makes `listDocsStore` blow the query instruction budget: IC0522).
 * Admin-gated; `keys` beyond the export page cap are ignored. */
export const DeleteAnalyticsEventsArgsSchema = j.strictObject({
	keys: j.array(j.string())
});

/** `deleted` is the count actually removed (missing keys are skipped, so a retried
 * page reports fewer than it sent: the call is idempotent). */
export const DeleteAnalyticsEventsResultSchema = j.strictObject({
	deleted: j.number()
});

/** Args for `getAnalyticsProfileCreated`: the cockpit's true-sign-up export.
 * Keyset cursor on the profile doc KEY (principal text); blank = first page. */
export const GetAnalyticsProfileCreatedArgsSchema = j.strictObject({
	afterKey: j.optional(j.string()),
	limit: j.number()
});

/** One profile-created row: the doc key (principal text) + envelope
 * `created_at` in nanoseconds (as text: nat64 exceeds JS safe-int). No profile
 * body field leaves the satellite. */
export const ProfileCreatedExportRowSchema = j.strictObject({
	key: j.string(),
	createdAtNs: j.string()
});

export const GetAnalyticsProfileCreatedResultSchema = j.strictObject({
	rows: j.array(ProfileCreatedExportRowSchema),
	hasMore: j.boolean()
});

/**
 * Result of `getAnalyticsUserStats`: the all-time registered-account
 * count for the cockpit's "Registered" tile. `registered` counts every
 * `profiles` doc, i.e. all accounts ever created including soft-deleted
 * ones (see `getAnalyticsUserStatsFn`). No args: the count is global.
 */
export const AnalyticsUserStatsSchema = j.strictObject({
	registered: j.number()
});
