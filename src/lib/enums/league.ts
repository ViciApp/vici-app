/**
 * League privacy: the visibility model an owner picks at creation and
 * can change later (see `updateLeague`). Replaces the legacy
 * `private?: boolean` flag on the league doc (see {@link LeagueDoc}).
 *
 * Privacy controls **discoverability only**, never the join gate: the
 * invite code is the sole way into a league at every tier. What changes
 * across tiers is whether the league surfaces publicly.
 *
 * Two tiers (Facebook-Groups convention):
 *
 * - {@link LeaguePrivacy.PRIVATE}: hidden: reachable only by invite
 *   code, never surfaced in any public list, recommendation, or
 *   challenge pool.
 * - {@link LeaguePrivacy.OPEN}: discoverable: surfaced in search,
 *   lists, recommendations, and challenge pools to anyone. Still joined
 *   by invite code, same as Private (privacy gates discovery, not the
 *   join).
 *
 * The string values match the create surface's option ids so the picker
 * value persists verbatim onto the doc.
 */
export enum LeaguePrivacy {
	PRIVATE = 'private',
	OPEN = 'open'
}
