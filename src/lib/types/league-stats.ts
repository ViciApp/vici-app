import type { MacroId } from '#lib/constants/market-taxonomy.constants.ts';
import type { CategoryStatsBucket } from '#lib/types/user-stats.ts';
import { isNullish } from '@dfinity/utils';

/**
 * Per-league rolling stats. One doc per league under the
 * `LEAGUE_STATS` collection, keyed by `leagueId`.
 *
 * The doc tracks lifetime counters only, as a display cache: any
 * member may write their league's row, so nothing that decides an
 * award reads it. Tournament matches and league battles are scored
 * from the members' settled history over their window, read from the
 * clearing canister.
 *
 * Writes are gated by `assertSetLeagueStats`: the caller must be a
 * member of the league, counters only move forward and wins never
 * exceed calls. The stats hook (signing as the user whose profile just
 * updated) is the intended writer, but the assert cannot tell it from
 * a member's own write.
 */
export interface LeagueStatsDoc {
	/** Parent league id: matches the doc key. */
	leagueId: string;
	/** Lifetime resolved-call count summed over all members; the `'all'` scope aggregate. */
	totalCalls: number;
	/** Lifetime correct calls (the numerator for accuracy); the `'all'` scope aggregate. */
	wins: number;
	/**
	 * Per market-category counters, keyed by macro category id. Mirror of
	 * the aggregate above split by category so a battle scoped to one category
	 * can read just that bucket. Sourced exactly from
	 * `UserStatsDoc.categoryStats` deltas; absent on legacy rows written
	 * before the picker shipped: callers fall back to a zero bucket. Typed as
	 * an open `string` map: the hook only ever writes macro ids (validated by
	 * `assertSetLeagueStats`), but legacy rows may still carry the old flat tag
	 * keys until a data migration rewrites them.
	 */
	categories?: Partial<Record<string, CategoryStatsBucket>>;
	/** Last hook-write timestamp (ms). */
	updatedAtMs: number;
}

/**
 * Canonical key builder. Single-segment key by leagueId: mirrors
 * the league doc's own key, so a `getDocStore` lookup against the
 * stats collection is a direct lookup, no scan.
 */
export const leagueStatsKey = ({ leagueId }: { leagueId: string }): string => leagueId;

/** A zero bucket: the default for a league/category with no resolved calls yet. */
const EMPTY_LEAGUE_STATS_BUCKET: CategoryStatsBucket = { calls: 0, wins: 0 };

/**
 * Resolve the `(calls, wins)` bucket a battle scope reads from a stats
 * doc: `'all'` → the lifetime aggregate; a {@link MacroId} → that
 * category's bucket (zero when the league has never called in it).
 * `undefined` doc (no stats yet) → a zero bucket.
 */
export const leagueStatsBucket = ({
	doc,
	scope
}: {
	doc: LeagueStatsDoc | undefined;
	scope: 'all' | MacroId;
}): CategoryStatsBucket => {
	if (isNullish(doc)) {
		return { ...EMPTY_LEAGUE_STATS_BUCKET };
	}

	if (scope === 'all') {
		return { calls: doc.totalCalls, wins: doc.wins };
	}

	return { ...EMPTY_LEAGUE_STATS_BUCKET, ...doc.categories?.[scope] };
};
