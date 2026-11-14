import type { PrincipalText } from '@junobuild/schema';

/**
 * Product analytics event taxonomy: the typed contract every captured
 * event is validated against (cockpit spec DQ-1, "versioned event
 * taxonomy"). This is the source-of-truth TS half of a dual-source pair:
 * the runtime Zod mirror lives in `lib/schema/analytics-event.schema.ts`
 * and MUST be kept in sync (svelte-check only catches the union; an enum
 * mismatch fails at runtime).
 *
 * Design rules:
 *  - Events are **behavioural**, never personal data. Names + a bounded
 *    dimensional `props` vocabulary only: no free-form text, no PII.
 *  - Events are written to YOUR satellite (the `events` collection), not
 *    to any third party. Nothing leaves your infrastructure.
 *  - Identity is the pseudonymous `principal`, optional (absent before
 *    sign-in; stitched from `sessionId` on auth: cockpit ENG-1).
 *
 * Names are snake_case string literals by convention (matches the
 * cockpit's DQ taxonomy + general analytics norms), not TS identifiers.
 */
export type AnalyticsEventName =
	// ── Session & auth ────────────────────────────────────────────────
	/** A new (possibly anonymous) browsing session began. */
	| 'session_started'
	/** A brand-new account was created. */
	| 'signed_up'
	/** An existing user authenticated. */
	| 'signed_in'
	/** A user signed out. */
	| 'signed_out'
	/** A sign-in provider was linked (Google / Apple / Passkey / II). */
	| 'provider_linked'
	// ── Onboarding ────────────────────────────────────────────────────
	/** Onboarding flow opened. */
	| 'onboarding_started'
	/** A single onboarding step advanced (`step` carries the index). */
	| 'onboarding_step'
	/** A handle-availability check ran (custom-handle mode). */
	| 'handle_checked'
	/** Onboarding finished: the activation milestone. */
	| 'onboarding_completed'
	// ── Flow (the swipe deck: hero feature, "the swipe is the funnel") ─
	/** A Flow swipe session began. */
	| 'flow_session_started'
	/** A single card swipe (cockpit's `flow_swipe`). */
	| 'flow_swipe'
	/** A Flow card was expanded for detail. */
	| 'flow_card_expanded'
	/** The user reached FlowEnd (completed the deck). */
	| 'flow_completed'
	/** The user left mid-deck without finishing. */
	| 'flow_abandoned'
	/** Sound toggled in Flow (the "reward feel" signal). */
	| 'sound_toggled'
	// ── Markets ───────────────────────────────────────────────────────
	/** A market detail surface was viewed (cockpit's `market_viewed`). */
	| 'market_viewed'
	/** A market search was run. */
	| 'market_searched'
	/** A market was shared out. */
	| 'market_shared'
	/** A market was added to the watchlist. */
	| 'watchlist_added'
	/** A market was removed from the watchlist. */
	| 'watchlist_removed'
	/** The order book was opened for a market. */
	| 'orderbook_viewed'
	/**
	 * The market-detail metadata language was toggled; `label` carries the
	 * target view (`original | translated`).
	 */
	| 'market_translation_toggled'
	/**
	 * A market-board category chip was selected; `label` carries the bounded
	 * selection: the taxonomy macro id, or `macro:micro` when the viewer
	 * drilled into a subcategory. Closed vocab (taxonomy ids), no PII. (The
	 * dimension rides `label` rather than dedicated `macro`/`micro` fields
	 * because the props vocabulary is a closed schema shared with the
	 * satellite: new dimensions need a satellite regen; `label` is free here.)
	 */
	| 'market_category_filter'
	// ── Trading ───────────────────────────────────────────────────────
	/** A position was taken (cockpit's `position_taken`). */
	| 'position_taken'
	/** A position was closed. */
	| 'position_closed'
	/** A new market/prediction was created (cockpit's `prediction_created`). */
	| 'prediction_created'
	/** A limit order was placed. */
	| 'order_placed'
	/** A resting order was cancelled. */
	| 'order_cancelled'
	// ── Resolution & payout ───────────────────────────────────────────
	/** A resolution was proposed (cockpit's `resolution_proposed`). */
	| 'resolution_proposed'
	/** A resolution was confirmed (cockpit's `resolution_confirmed`). */
	| 'resolution_confirmed'
	/** A resolution was disputed. */
	| 'resolution_disputed'
	/** A payout settled to a user (cockpit's `payout_settled`). */
	| 'payout_settled'
	// ── Referral ──────────────────────────────────────────────────────
	/** A referral invite was sent (cockpit's `referral_sent`). */
	| 'referral_sent'
	/** A referral link was copied. */
	| 'referral_link_copied'
	/** A referral code was redeemed by a referee. */
	| 'referral_redeemed'
	/** A referee converted: completed onboarding (cockpit's `referral_converted`). */
	| 'referral_converted'
	// ── VXP & economy ─────────────────────────────────────────────────
	/** A server VXP award was credited. */
	| 'vxp_awarded'
	/** A daily-call streak hit a milestone. */
	| 'streak_milestone'
	/** The recovery faucet was claimed. */
	| 'faucet_claimed'
	/**
	 * The transaction-history page was opened; `source` carries the entry
	 * point (`dash_sheet | direct`), `count` the rows loaded.
	 */
	| 'transactions_viewed'
	/** A transaction-history filter chip was applied (`label` = filter). */
	| 'transactions_filtered'
	// ── Social & leagues ──────────────────────────────────────────────
	/**
	 * An add-friend attempt ran; `label` carries the outcome
	 * (`sent | auto_accepted | already_friends | already_pending |
	 * rejected_cooldown | not_found | self | error`), `source` the surface.
	 */
	| 'friend_request_sent'
	/**
	 * A like on a friend-feed activity was toggled; `label` is the action
	 * (`like | unlike`), `source` the surface (`arena`).
	 */
	| 'friend_feed_reaction'
	/**
	 * A friend results-digest row was tapped through; `source` the surface
	 * (`arena`), `marketId` the standout market when the tap targets one
	 * (omitted otherwise). Behavioural only, no W-L, net VXP, or handle.
	 */
	| 'friend_digest_opened'
	/** A league was created. */
	| 'league_created'
	/** A user joined a league. */
	| 'league_joined'
	/** A league invite was sent. */
	| 'league_invite_sent'
	/** A battle (league or duel) was proposed. */
	| 'battle_proposed'
	/** A battle was accepted. */
	| 'battle_accepted'
	/** A battle proposal was declined by the challenged side. */
	| 'battle_declined'
	/** A battle proposal lapsed unanswered past its respond-by deadline. */
	| 'battle_expired'
	/** A battle resolved. */
	| 'battle_resolved'
	/** A battle detail surface was viewed (live standings / face-off). */
	| 'battle_viewed'
	/** A comment was posted. */
	| 'comment_posted'
	/** A chat message was sent. */
	| 'chat_sent'
	/**
	 * The global leaderboard was viewed (a window load or tab switch). `label`
	 * carries the window (`week | month | all`), `count` the ranked rows shown,
	 * `ok` whether the viewer is qualified/ranked (vs provisional/absent), and
	 * `value` the viewer's own settled-call count: so the gate's effect on
	 * real viewers is measurable.
	 */
	| 'leaderboard_viewed'
	// ── Worlds (affiliations) ─────────────────────────────────────────
	/** A school / country affiliation was set. */
	| 'affiliation_set'
	/** An affiliation was removed (after the 90-day lock). */
	| 'affiliation_removed'
	// ── Settings / privacy ────────────────────────────────────────────
	/**
	 * A sharing opt-out toggle was flipped in Settings → Privacy. `source`
	 * carries which control (`leaderboard | worlds`), `label` the new state
	 * (`on | off`): so opt-out rates per surface are measurable.
	 */
	| 'privacy_sharing_toggled'
	// ── School verification ───────────────────────────────────────────
	/** The school picker was opened. */
	| 'school_picker_opened'
	/** A school was picked. */
	| 'school_picked'
	/** A school-verification email was submitted. */
	| 'school_verify_email_submitted'
	/** A school-verification code was submitted. */
	| 'school_verify_code_submitted'
	// ── Churn (delete flow) ───────────────────────────────────────────
	/** The delete-account flow was opened. */
	| 'delete_flow_opened'
	/** Delete was confirmed (type-to-confirm passed). */
	| 'delete_confirmed'
	/** Account deletion completed. */
	| 'delete_succeeded'
	/** An exit-signal reason was captured (pairs with the existing `exit_signals` collection). */
	| 'exit_signal'
	// ── Notifications ─────────────────────────────────────────────────
	/**
	 * An inbox notification was opened: tapped on the Notifications page or
	 * its arrival toast. `label` carries the notification `kind`
	 * (`resolve | streak | social | challenge | level | market | friend_request`),
	 * so engagement can be sliced by notification type.
	 */
	| 'notification_opened'
	// ── PWA install (add-to-home-screen) ──────────────────────────────
	/**
	 * The install sheet opened. `source`: `settings | flow_end`; `label`:
	 * the install `platform` (`ios | android | desktop | other`).
	 */
	| 'pwa_install_prompted'
	/**
	 * The native prompt was accepted, or `appinstalled` fired. `label`: the
	 * install `platform`.
	 */
	| 'pwa_install_accepted'
	/**
	 * The install sheet was dismissed ("Not now") or the native prompt was
	 * declined. `source`; `label`: the install `platform`.
	 */
	| 'pwa_install_dismissed'
	// ── Health ────────────────────────────────────────────────────────
	/** A client-side error surfaced (no PII: message is omitted/coarse). */
	| 'app_error'
	/** A performance sample (e.g. a load duration in `durationMs`). */
	| 'perf_metric';

/**
 * Bounded dimensional vocabulary for an event's context. Intentionally a
 * **fixed set of optional, primitive fields** rather than a free-form bag:
 * it keeps the schema simple, the warehouse queryable, and, critically,
 * makes "no PII" structural (there is nowhere to stuff personal data).
 *
 * Add a new dimension here AND in the schema mirror when a real metric
 * needs it; never widen this to an open record.
 */
export interface AnalyticsEventProps {
	/** Market / series identifier the event concerns. */
	marketId?: string;
	/** Resolved-market series id (calibration, settlement). */
	seriesId?: string;
	/** League id (social surfaces). */
	leagueId?: string;
	/** Battle / duel id. */
	battleId?: string;
	/** Where the action originated (e.g. 'flow' | 'profile' | 'onboarding'). */
	source?: string;
	/**
	 * A small categorical label: A/B variant, swipe direction, etc.
	 * Named `label` (not `variant`) because `variant` is a Candid reserved
	 * keyword that breaks the satellite API codegen.
	 */
	label?: string;
	/** Ordinal index: e.g. onboarding step, deck position. */
	step?: number;
	/** Generic numeric value tied to the event (e.g. price bucket, %). */
	value?: number;
	/** A count (e.g. results returned, swipes in a session). */
	count?: number;
	/** A duration in milliseconds (perf samples, time-to-X). */
	durationMs?: number;
	/** Boolean outcome (e.g. handle available, verification ok). */
	ok?: boolean;
	/**
	 * ISO-3166 alpha-2 country (uppercase), best-effort from the browser
	 * locale's region subtag (`en-US` → `US`). Coarse geo for aggregate
	 * regional analytics only: never precise location, never PII.
	 */
	country?: string;
	/** BCP-47 primary language subtag (`en-US` → `en`): localization analytics. */
	locale?: string;
}

/**
 * Persisted shape stored in the `events` collection (one doc per event,
 * random doc key, append-only). Written server-side by the satellite
 * `track` endpoint after validation, so timestamps and identity are
 * authoritative.
 */
export interface AnalyticsEventDoc {
	/** Event name from the taxonomy. */
	name: AnalyticsEventName;
	/** Server-stamped capture time (ms since epoch). Authoritative. */
	tsMs: number;
	/**
	 * Anonymous session id: groups events within a single visit and is the
	 * stitch key for attaching a `principal` retroactively on sign-in.
	 */
	sessionId: string;
	/**
	 * Pseudonymous on-chain identity. Absent before sign-in. Never an
	 * email / name: the principal is not PII. Typed `PrincipalText` (the
	 * codebase's validated principal-string type) so it can't be mixed with
	 * arbitrary strings; mirrors `AnalyticsEventSchema`'s `PrincipalTextSchema`.
	 */
	principal?: PrincipalText;
	/** Route / screen the event fired on, for funnels. No query strings, no PII. */
	path?: string;
	/** Bounded behavioural context. */
	props?: AnalyticsEventProps;
}

/**
 * Client → satellite wire shape sent to the `trackEvents` endpoint. The
 * server stamps `tsMs` and derives `principal` from the caller (never
 * trusted from the client), so neither appears here.
 *
 * The {@link AnalyticsEventProps} dimensions are flattened onto this input
 * (it `extends` them) rather than nested under a `props` key, because the
 * Sputnik codegen rejects a nested optional object inside an array element.
 * The satellite re-nests them into `props` for storage; the FE `track()`
 * helper flattens an ergonomic `props` object into this shape.
 */
export interface TrackEventInput extends AnalyticsEventProps {
	/** Event name from the taxonomy. */
	name: AnalyticsEventName;
	/** Anonymous per-visit session id (stitch key for the principal). */
	sessionId: string;
	/** Route / screen the event fired on. */
	path?: string;
	/** Client-side event time (ms): advisory only; the server time wins. */
	occurredAtMs?: number;
}

/** The {@link AnalyticsEventProps} dimension keys: used to re-nest the flat wire input. */
export const ANALYTICS_PROP_KEYS = [
	'marketId',
	'seriesId',
	'leagueId',
	'battleId',
	'source',
	'label',
	'step',
	'value',
	'count',
	'durationMs',
	'ok',
	'country',
	'locale'
] as const satisfies readonly (keyof AnalyticsEventProps)[];

/** One event-name → count pair within a daily rollup. */
export interface EventCount {
	name: AnalyticsEventName;
	count: number;
}

/**
 * Per-day rollup doc (collection `event_rollups`, keyed by epoch-day =
 * `floor(tsMs / 86_400_000)`). Bumped inline by the `trackEvents` endpoint
 * as events land; read by `getAnalyticsSummary` so the cockpit gets cheap
 * aggregates without scanning the raw log.
 */
export interface EventRollupDoc {
	/** Epoch-day index: `floor(tsMs / 86_400_000)`. Also the doc key. */
	epochDay: number;
	/** Start-of-day in ms (`epochDay * 86_400_000`) for easy display. */
	dayStartMs: number;
	/** Per-event-name counts accumulated for the day. */
	counts: EventCount[];
	/** Last bump time (ms). */
	updatedAtMs: number;
}
