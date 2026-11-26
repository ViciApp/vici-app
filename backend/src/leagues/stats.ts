// Rolling per-league counters, fanned out from member profile / stats writes
// in the SAME transaction as the source write (the profile upsert calls the
// aggregate fanout, the user_stats upsert calls the category fanout), so a
// crash can never leave the league counters half-applied. Counters only move
// forward, wins never exceed calls, and category keys are bounded to the
// closed macro taxonomy. They follow the client's own profile figures, so
// they are a display cache: tournament matches and battles are scored from
// settled history, never from these rows.

import { isNullish, nonNullish } from '@dfinity/utils';
import { query, type TxQuery } from '../db/client';
import { PG_INT_MAX } from '../lib/constants';
import { MACRO_IDS, type MacroId } from '../markets/taxonomy';

export interface CategoryBucket {
	calls: number;
	wins: number;
}

export interface LeagueStats {
	leagueId: string;
	totalCalls: number;
	wins: number;
	categories: Partial<Record<string, CategoryBucket>>;
	updatedAtMs: number;
}

interface LeagueStatsRow {
	league_id: string;
	total_calls: number;
	wins: number;
	categories: Partial<Record<string, CategoryBucket>>;
	updated_at_ms: string;
}

const shapeStats = (row: LeagueStatsRow): LeagueStats => ({
	leagueId: row.league_id,
	totalCalls: row.total_calls,
	wins: row.wins,
	categories: row.categories ?? {},
	updatedAtMs: Number(row.updated_at_ms)
});

export type BattleScope = 'all' | MacroId;

export const isBattleScope = (value: string): value is BattleScope =>
	value === 'all' || (MACRO_IDS as readonly string[]).includes(value);

export const getLeagueStats = async (
	leagueId: string,
	q: TxQuery = query
): Promise<LeagueStats | undefined> => {
	const rows = await q<LeagueStatsRow>(
		`select league_id, total_calls, wins, categories, updated_at_ms::text
		 from league_stats where league_id = $1`,
		[leagueId]
	);

	return nonNullish(rows[0]) ? shapeStats(rows[0]) : undefined;
};

/** The `(calls, wins)` bucket a battle scope reads: 'all' is the lifetime
 * aggregate, a macro id its category bucket, zero when absent. */
export const leagueStatsBucket = ({
	stats,
	scope
}: {
	stats: LeagueStats | undefined;
	scope: BattleScope;
}): CategoryBucket => {
	if (isNullish(stats)) {
		return { calls: 0, wins: 0 };
	}

	if (scope === 'all') {
		return { calls: stats.totalCalls, wins: stats.wins };
	}

	const bucket = stats.categories[scope];

	return { calls: bucket?.calls ?? 0, wins: bucket?.wins ?? 0 };
};

/** Derived win count from the profile's totalTrades and winRate percentage,
 * the same lossy-but-consistent arithmetic the aggregate fanout always used. */
export const winsFromProfileCounters = ({
	totalTrades,
	winRate
}: {
	totalTrades: number;
	winRate: number;
}): number => Math.round((totalTrades * winRate) / 100);

/** Apply an aggregate `(deltaTrades, deltaWins)` increment to every league
 * the user belongs to. Runs on the caller-provided transaction. The sums
 * saturate at the `int` ceiling: a display counter that is full must never
 * fail the member's profile save that carries the increment. */
const incrementAggregate = async ({
	q,
	userId,
	deltaTrades,
	deltaWins,
	nowMs
}: {
	q: TxQuery;
	userId: string;
	deltaTrades: number;
	deltaWins: number;
	nowMs: number;
}): Promise<void> => {
	await q(
		`insert into league_stats (league_id, total_calls, wins, updated_at_ms)
		 select m.league_id, $2::int, $3::int, $4::bigint
		 from league_members m where m.member_user_id = $1
		 on conflict (league_id) do update set
		   total_calls = least(league_stats.total_calls::bigint + excluded.total_calls, $5)::int,
		   wins = least(league_stats.wins::bigint + excluded.wins, $5)::int,
		   updated_at_ms = excluded.updated_at_ms`,
		[userId, deltaTrades, deltaWins, nowMs, PG_INT_MAX]
	);
};

/**
 * Aggregate fanout for a profile write: when `totalTrades` advanced, the
 * trade/win delta is attributed to every league the user is a member of.
 * The stored count never decreases (`upsertMyProfile`), so only a new high
 * is ever attributed.
 * First writes carry no attributable delta; hibernated accounts never move
 * shared stats; identical before/after is a no-op.
 */
export const fanoutProfileDeltaToLeagueStats = async ({
	q,
	userId,
	before,
	after,
	afterHibernated,
	nowMs = Date.now()
}: {
	q: TxQuery;
	userId: string;
	before: { totalTrades: number; winRate: number } | undefined;
	after: { totalTrades: number; winRate: number };
	afterHibernated: boolean;
	nowMs?: number;
}): Promise<void> => {
	if (isNullish(before) || afterHibernated) {
		return;
	}

	const deltaTrades = after.totalTrades - before.totalTrades;

	if (deltaTrades <= 0) {
		return;
	}

	const deltaWins = Math.max(
		0,
		Math.min(deltaTrades, winsFromProfileCounters(after) - winsFromProfileCounters(before))
	);

	await incrementAggregate({ q, userId, deltaTrades, deltaWins, nowMs });
};

/** Per-macro rise from `before` to `after`, with wins clamped to calls: a
 * re-aggregation can shift bucket composition so the raw win delta exceeds
 * the call delta, which would break the wins-cannot-exceed-calls invariant
 * on the league row. Macros that did not rise are left out. */
const categoryDeltas = ({
	before,
	after
}: {
	before: Partial<Record<string, CategoryBucket>> | undefined;
	after: Partial<Record<string, CategoryBucket>>;
}): Partial<Record<MacroId, CategoryBucket>> => {
	const deltas: Partial<Record<MacroId, CategoryBucket>> = {};

	for (const tag of MACRO_IDS) {
		const afterBucket = after[tag];
		const beforeBucket = before?.[tag];
		const calls = Math.max(0, (afterBucket?.calls ?? 0) - (beforeBucket?.calls ?? 0));
		const wins = Math.min(calls, Math.max(0, (afterBucket?.wins ?? 0) - (beforeBucket?.wins ?? 0)));

		if (calls > 0 || wins > 0) {
			deltas[tag] = { calls, wins };
		}
	}

	return deltas;
};

/**
 * Category fanout for a user_stats write: per-macro deltas of the user's
 * `categoryStats`, folded into each of the user's league rows. The aggregate
 * counters stay owned by the profile fanout; this touches only `categories`.
 * The sum happens inside the upsert, on the row it has locked, so two members
 * saving at once both land; each bucket saturates at the `int` ceiling like
 * the aggregate. Rows are locked in league id order, so two writers sharing
 * several leagues cannot deadlock on each other.
 */
export const fanoutCategoryDeltasToLeagueStats = async ({
	q,
	userId,
	before,
	after,
	hibernated,
	nowMs = Date.now()
}: {
	q: TxQuery;
	userId: string;
	before: Partial<Record<string, CategoryBucket>> | undefined;
	after: Partial<Record<string, CategoryBucket>>;
	hibernated: boolean;
	nowMs?: number;
}): Promise<void> => {
	if (hibernated) {
		return;
	}

	const deltas = categoryDeltas({ before, after });

	if (Object.keys(deltas).length === 0) {
		return;
	}

	await q(
		`insert into league_stats (league_id, total_calls, wins, categories, updated_at_ms)
		 select m.league_id, 0, 0, $2::jsonb, $3::bigint
		 from league_members m where m.member_user_id = $1
		 order by m.league_id
		 on conflict (league_id) do update set
		   categories = league_stats.categories || (
		     select jsonb_object_agg(d.key, jsonb_build_object(
		       'calls', least(coalesce((league_stats.categories -> d.key ->> 'calls')::numeric, 0)
		         + (d.value ->> 'calls')::numeric, $4),
		       'wins', least(coalesce((league_stats.categories -> d.key ->> 'wins')::numeric, 0)
		         + (d.value ->> 'wins')::numeric, $4)
		     ))
		     from jsonb_each(excluded.categories) d
		   ),
		   updated_at_ms = excluded.updated_at_ms`,
		[userId, JSON.stringify(deltas), nowMs, PG_INT_MAX]
	);
};
