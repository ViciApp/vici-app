// Product-analytics event taxonomy, mirrored from the app's shared contract.
// Events are behavioural only: names plus a bounded dimensional vocabulary,
// no free-form text and no PII. Identity is the pseudonymous session user
// link (absent before sign-in).

export const ANALYTICS_EVENT_NAMES = [
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
	// Worlds (affiliations)
	'affiliation_set',
	'affiliation_removed',
	// Settings / privacy
	'privacy_sharing_toggled',
	// School verification
	'school_picker_opened',
	'school_picked',
	'school_verify_email_submitted',
	'school_verify_code_submitted',
	// Churn (delete flow)
	'delete_flow_opened',
	'delete_confirmed',
	'delete_succeeded',
	'exit_signal',
	// Notifications
	'notification_opened',
	// PWA install
	'pwa_install_prompted',
	'pwa_install_accepted',
	'pwa_install_dismissed',
	// Health
	'app_error',
	'perf_metric'
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

const NAME_SET: ReadonlySet<string> = new Set(ANALYTICS_EVENT_NAMES);

export const isAnalyticsEventName = (value: string): value is AnalyticsEventName =>
	NAME_SET.has(value);

/**
 * Bounded dimensional vocabulary for an event's context. Intentionally a
 * fixed set of optional primitive fields rather than a free-form bag: it
 * keeps the warehouse queryable and makes "no PII" structural.
 */
export interface AnalyticsEventProps {
	marketId?: string;
	seriesId?: string;
	leagueId?: string;
	battleId?: string;
	source?: string;
	label?: string;
	step?: number;
	value?: number;
	count?: number;
	durationMs?: number;
	ok?: boolean;
	country?: string;
	locale?: string;
}

/** The dimension keys, used to re-nest the flat wire input into `props`. */
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

const STRING_PROP_KEYS: ReadonlySet<string> = new Set([
	'marketId',
	'seriesId',
	'leagueId',
	'battleId',
	'source',
	'label',
	'country',
	'locale'
]);

const NUMBER_PROP_KEYS: ReadonlySet<string> = new Set(['step', 'value', 'count', 'durationMs']);

/** Whether a flat wire dimension value has the type its key declares. */
export const isValidPropValue = <K extends keyof AnalyticsEventProps>(
	key: K,
	value: unknown
): value is NonNullable<AnalyticsEventProps[K]> => {
	if (STRING_PROP_KEYS.has(key)) {
		return typeof value === 'string';
	}

	if (NUMBER_PROP_KEYS.has(key)) {
		return typeof value === 'number' && Number.isFinite(value);
	}

	return key === 'ok' && typeof value === 'boolean';
};
