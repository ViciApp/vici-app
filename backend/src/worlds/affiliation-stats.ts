// Worlds standings. Two windows per affiliation, both recomputed on read
// over the CURRENT opted-in roster: the lifetime window from each member's
// profile totals (a joining member brings their full record; a leaver takes
// it away) and the monthly window from user_monthly_stats. Both are views.
// A CLOSED month is different: its ranking is computed from settled history
// (each member's settled calls over the month, read from the clearing
// canister, never a client-written counter) and frozen once as immutable
// snapshot rows (write-once by primary key plus the all-or-nothing month
// gate), so podium awards and champion cups can never drift as the roster
// later churns.

import { isNullish, nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import { settlementPrincipalsByUser } from '../auth/identity';
import { query, tx } from '../db/client';
import { settledTotalsByPrincipal } from '../engine/clearing';
import { logger } from '../lib/logger';
import {
	MONTH_ANCHOR_RE,
	monthAnchorFromMs,
	monthEndMs,
	monthStartMs,
	previousMonthAnchor
} from '../lib/time';
import { AFFILIATION_KINDS, type AffiliationKind } from './affiliations';

export class AffiliationStatsError extends Error {}

/**
 * The roster filter on `profiles p`: only a stored JSON `false` opts a member
 * out, the same reading `sanitizePreferences` gives the profile, and a
 * missing profile counts as opted in. It compares jsonb instead of casting
 * the text, so a malformed stored value can never fail the query.
 */
const WORLDS_OPTED_IN = `(p.preferences #> '{sharing,worldsOptIn}') is distinct from 'false'::jsonb`;

/** Minimum resolved calls before an affiliation can rank; below this the
 * accuracy is too noisy to compare. */
export const MIN_CALLS_FOR_RANK = 50;

export interface AffiliationStats {
	affiliationIdentifier: string;
	kind: AffiliationKind;
	totalCalls: number;
	wins: number;
	monthAnchor: string;
	monthTotalCalls: number;
	monthWins: number;
	updatedAtMs: number;
}

/**
 * Shared rank comparator: accuracy desc, calls desc (rewards depth),
 * identifier asc as the deterministic tie-break. The leaderboard, the podium
 * and the champion history all rank through this so they can never diverge.
 */
const compareAffiliationRank =
	({
		accuracyOf,
		callsOf
	}: {
		accuracyOf: (doc: AffiliationStats) => number;
		callsOf: (doc: AffiliationStats) => number;
	}) =>
	(a: AffiliationStats, b: AffiliationStats): number => {
		const accuracyDelta = accuracyOf(b) - accuracyOf(a);

		if (accuracyDelta !== 0) {
			return accuracyDelta;
		}

		const callsDelta = callsOf(b) - callsOf(a);

		if (callsDelta !== 0) {
			return callsDelta;
		}

		return a.affiliationIdentifier < b.affiliationIdentifier
			? -1
			: a.affiliationIdentifier > b.affiliationIdentifier
				? 1
				: 0;
	};

const monthlyComparator = compareAffiliationRank({
	accuracyOf: (doc) => (doc.monthTotalCalls > 0 ? doc.monthWins / doc.monthTotalCalls : 0),
	callsOf: (doc) => doc.monthTotalCalls
});

/**
 * Lifetime tally per affiliation of a kind over the current opted-in roster:
 * each member contributes their profile's totalTrades plus the derived win
 * count (round(trades x winRate / 100), capped at the trade count). Members
 * who opted out of Worlds sharing (preferences.sharing.worldsOptIn === false)
 * or have no activity contribute nothing.
 */
const aggregateMembersLifetime = async ({
	kind,
	affiliationIdentifier
}: {
	kind: AffiliationKind;
	affiliationIdentifier?: string;
}): Promise<Map<string, { totalCalls: number; wins: number }>> => {
	const rows = await query<{ affiliation_identifier: string; total_calls: string; wins: string }>(
		`select a.affiliation_identifier,
		        sum(p.total_trades)::text as total_calls,
		        sum(least(p.total_trades, round(p.total_trades * p.win_rate / 100)))::text as wins
		 from affiliations a
		 join profiles p on p.user_id = a.member_user_id
		 where a.kind = $1
		   and ($2::text is null or a.affiliation_identifier = $2)
		   and p.total_trades > 0
		   and ${WORLDS_OPTED_IN}
		 group by a.affiliation_identifier`,
		[kind, affiliationIdentifier ?? null]
	);

	return new Map(
		rows.map((row) => [
			row.affiliation_identifier,
			{ totalCalls: Number(row.total_calls), wins: Number(row.wins) }
		])
	);
};

/**
 * Display per-month tally per affiliation of a kind over the current
 * opted-in roster, folded from each member's user_monthly_stats row for the
 * month. Those rows are not server-derived, so this never ranks a payout:
 * the podium reads {@link settledMonthlyRows}.
 */
const aggregateMembersForMonth = async ({
	kind,
	monthAnchor,
	affiliationIdentifier
}: {
	kind: AffiliationKind;
	monthAnchor: string;
	affiliationIdentifier?: string;
}): Promise<Map<string, { monthTotalCalls: number; monthWins: number }>> => {
	const rows = await query<{
		affiliation_identifier: string;
		month_total_calls: string;
		month_wins: string;
	}>(
		`select a.affiliation_identifier,
		        sum(ms.month_calls)::text as month_total_calls,
		        sum(ms.month_wins)::text as month_wins
		 from affiliations a
		 join user_monthly_stats ms
		   on ms.user_id = a.member_user_id and ms.month_anchor = $2
		 left join profiles p on p.user_id = a.member_user_id
		 where a.kind = $1
		   and ($3::text is null or a.affiliation_identifier = $3)
		   and ${WORLDS_OPTED_IN}
		 group by a.affiliation_identifier`,
		[kind, monthAnchor, affiliationIdentifier ?? null]
	);

	return new Map(
		rows.map((row) => [
			row.affiliation_identifier,
			{ monthTotalCalls: Number(row.month_total_calls), monthWins: Number(row.month_wins) }
		])
	);
};

/**
 * Single-affiliation stats for the detail page: both windows recomputed live
 * over the current opted-in roster. Undefined when the affiliation has
 * neither lifetime nor current-month activity ("unranked / no data").
 */
export const getAffiliationStats = async ({
	kind,
	affiliationIdentifier,
	nowMs = Date.now()
}: {
	kind: AffiliationKind;
	affiliationIdentifier: string;
	nowMs?: number;
}): Promise<AffiliationStats | undefined> => {
	const anchor = monthAnchorFromMs(nowMs);
	const lifetime = (await aggregateMembersLifetime({ kind, affiliationIdentifier })).get(
		affiliationIdentifier
	);
	const month = (
		await aggregateMembersForMonth({ kind, monthAnchor: anchor, affiliationIdentifier })
	).get(affiliationIdentifier);

	if (isNullish(lifetime) && isNullish(month)) {
		return;
	}

	return {
		kind,
		affiliationIdentifier,
		totalCalls: lifetime?.totalCalls ?? 0,
		wins: lifetime?.wins ?? 0,
		monthAnchor: anchor,
		monthTotalCalls: month?.monthTotalCalls ?? 0,
		monthWins: month?.monthWins ?? 0,
		updatedAtMs: nowMs
	};
};

/**
 * Ranked all-time leaderboard for a kind over the current opted-in roster;
 * an affiliation surfaces once its roster's combined lifetime clears
 * MIN_CALLS_FOR_RANK. Sort: lifetime accuracy desc, calls desc, id asc.
 */
export const listAffiliationStats = async ({
	kind,
	limit,
	nowMs = Date.now()
}: {
	kind: AffiliationKind;
	limit?: number;
	nowMs?: number;
}): Promise<AffiliationStats[]> => {
	const anchor = monthAnchorFromMs(nowMs);
	const lifetime = await aggregateMembersLifetime({ kind });
	const monthly = await aggregateMembersForMonth({ kind, monthAnchor: anchor });

	const stats: AffiliationStats[] = [];

	for (const [affiliationIdentifier, life] of lifetime) {
		if (life.totalCalls >= MIN_CALLS_FOR_RANK) {
			const month = monthly.get(affiliationIdentifier);

			stats.push({
				kind,
				affiliationIdentifier,
				totalCalls: life.totalCalls,
				wins: life.wins,
				monthAnchor: anchor,
				monthTotalCalls: month?.monthTotalCalls ?? 0,
				monthWins: month?.monthWins ?? 0,
				updatedAtMs: nowMs
			});
		}
	}

	stats.sort(
		compareAffiliationRank({
			accuracyOf: (doc) => (doc.totalCalls > 0 ? doc.wins / doc.totalCalls : 0),
			callsOf: (doc) => doc.totalCalls
		})
	);

	return nonNullish(limit) && limit > 0 ? stats.slice(0, limit) : stats;
};

/** Month-scoped rows for the affiliations clearing MIN_CALLS_FOR_RANK. The
 * lifetime fields mirror the monthly window (the podium reads only that). */
const rankEligibleMonthlyRows = ({
	kind,
	monthAnchor,
	nowMs,
	monthly
}: {
	kind: AffiliationKind;
	monthAnchor: string;
	nowMs: number;
	monthly: Map<string, { monthTotalCalls: number; monthWins: number }>;
}): AffiliationStats[] => {
	const rows: AffiliationStats[] = [];

	for (const [affiliationIdentifier, m] of monthly) {
		if (m.monthTotalCalls >= MIN_CALLS_FOR_RANK) {
			rows.push({
				kind,
				affiliationIdentifier,
				totalCalls: m.monthTotalCalls,
				wins: m.monthWins,
				monthAnchor,
				monthTotalCalls: m.monthTotalCalls,
				monthWins: m.monthWins,
				updatedAtMs: nowMs
			});
		}
	}

	return rows;
};

/**
 * The rank-eligible rows of a closed month computed from settled history:
 * what the freeze captures and the podium pays from. Each affiliation's
 * tally is its members' settled calls and wins over [month start, month
 * close), read from the clearing canister through the helper league battles
 * are scored with. A member counts when opted in to Worlds sharing and
 * holding a slot joined before the month closed, so a join after close can
 * neither collect the prize nor lift the ranking.
 */
export const settledMonthlyRows = async ({
	kind,
	monthAnchor,
	nowMs
}: {
	kind: AffiliationKind;
	monthAnchor: string;
	nowMs: number;
}): Promise<AffiliationStats[]> => {
	const closeMs = monthEndMs(monthAnchor);
	const members = await query<{ member_user_id: string; affiliation_identifier: string }>(
		`select a.member_user_id, a.affiliation_identifier
		 from affiliations a
		 left join profiles p on p.user_id = a.member_user_id
		 where a.kind = $1
		   and a.joined_at_ms < $2
		   and ${WORLDS_OPTED_IN}`,
		[kind, closeMs]
	);
	const byUser = await settlementPrincipalsByUser(members.map((m) => m.member_user_id));
	const affiliationOfPrincipal = new Map<string, string>();

	for (const { member_user_id, affiliation_identifier } of members) {
		for (const principal of byUser.get(member_user_id) ?? []) {
			affiliationOfPrincipal.set(principal, affiliation_identifier);
		}
	}

	const settled = await settledTotalsByPrincipal({
		members: [...affiliationOfPrincipal.keys()].map((text) => Principal.fromText(text)),
		fromMs: monthStartMs(monthAnchor),
		toMs: closeMs
	});
	const monthly = new Map<string, { monthTotalCalls: number; monthWins: number }>();

	for (const [principal, { calls, wins }] of settled) {
		const affiliationIdentifier = affiliationOfPrincipal.get(principal);

		if (nonNullish(affiliationIdentifier)) {
			const bucket = monthly.get(affiliationIdentifier) ?? { monthTotalCalls: 0, monthWins: 0 };

			bucket.monthTotalCalls += calls;
			bucket.monthWins += wins;
			monthly.set(affiliationIdentifier, bucket);
		}
	}

	return rankEligibleMonthlyRows({ kind, monthAnchor, nowMs, monthly });
};

interface AffiliationStatsRow {
	kind: AffiliationKind;
	affiliation_identifier: string;
	month_anchor: string;
	total_calls: number;
	wins: number;
	month_total_calls: number;
	month_wins: number;
	updated_at_ms: string;
}

const shapeSnapshot = (row: AffiliationStatsRow): AffiliationStats => ({
	kind: row.kind,
	affiliationIdentifier: row.affiliation_identifier,
	monthAnchor: row.month_anchor,
	totalCalls: row.total_calls,
	wins: row.wins,
	monthTotalCalls: row.month_total_calls,
	monthWins: row.month_wins,
	updatedAtMs: Number(row.updated_at_ms)
});

/** Whether a closed month already carries frozen snapshots for a kind: the
 * all-or-nothing gate the freeze checks before writing. */
export const hasFrozenMonthlySnapshot = async ({
	kind,
	monthAnchor
}: {
	kind: AffiliationKind;
	monthAnchor: string;
}): Promise<boolean> => {
	const rows = await query<{ ok: number }>(
		`select 1 as ok from affiliation_stats where kind = $1 and month_anchor = $2 limit 1`,
		[kind, monthAnchor]
	);

	return nonNullish(rows[0]);
};

/**
 * Freeze a closed month's ranking for a kind. The first freeze writes the
 * whole rank-eligible set as immutable rows; every later call sees the month
 * frozen and leaves it untouched, so the frozen ranking never grows or
 * drifts. Only closed months can freeze.
 */
export const freezeMonthlySnapshots = async ({
	kind,
	monthAnchor,
	nowMs = Date.now()
}: {
	kind: AffiliationKind;
	monthAnchor: string;
	nowMs?: number;
}): Promise<{ frozen: number; alreadyFrozen: boolean }> => {
	if (!MONTH_ANCHOR_RE.test(monthAnchor)) {
		throw new AffiliationStatsError(`invalid monthAnchor "${monthAnchor}" (expected YYYY-MM).`);
	}

	if (monthAnchor >= monthAnchorFromMs(nowMs)) {
		throw new AffiliationStatsError(`month ${monthAnchor} is not yet closed.`);
	}

	if (await hasFrozenMonthlySnapshot({ kind, monthAnchor })) {
		return { frozen: 0, alreadyFrozen: true };
	}

	const rows = await settledMonthlyRows({ kind, monthAnchor, nowMs });

	// One transaction for the whole set; the do-nothing conflict clause makes
	// a racing freeze idempotent (whoever commits first owns the month).
	return await tx(async (q) => {
		let frozen = 0;

		for (const row of rows) {
			const inserted = await q<{ ok: number }>(
				`insert into affiliation_stats (kind, affiliation_identifier, month_anchor,
				   total_calls, wins, month_total_calls, month_wins, updated_at_ms)
				 values ($1, $2, $3, $4, $5, $6, $7, $8)
				 on conflict (kind, affiliation_identifier, month_anchor) do nothing
				 returning 1 as ok`,
				[
					kind,
					row.affiliationIdentifier,
					monthAnchor,
					row.totalCalls,
					row.wins,
					row.monthTotalCalls,
					row.monthWins,
					nowMs
				]
			);

			frozen += inserted.length;
		}

		return { frozen, alreadyFrozen: false };
	});
};

/** A closed month's frozen ranking: the immutable rows the freeze wrote from
 * settled history, ranked by the leaderboard's rule. Empty until the month
 * is frozen; the podium pays from this and nothing else. */
export const frozenMonthlyRanking = async ({
	kind,
	monthAnchor
}: {
	kind: AffiliationKind;
	monthAnchor: string;
}): Promise<AffiliationStats[]> => {
	const rows = await query<AffiliationStatsRow>(
		`select kind, affiliation_identifier, month_anchor, total_calls, wins,
		        month_total_calls, month_wins, updated_at_ms::text
		 from affiliation_stats
		 where kind = $1 and month_anchor = $2 and month_total_calls >= $3`,
		[kind, monthAnchor, MIN_CALLS_FOR_RANK]
	);

	return rows.map(shapeSnapshot).sort(monthlyComparator);
};

/**
 * Ranked rows for a specific month, for display: the frozen ranking once the
 * month is frozen, else a provisional live recompute over the current
 * opted-in roster from user_monthly_stats. Sort matches the leaderboard.
 */
export const listAffiliationStatsForMonth = async ({
	kind,
	monthAnchor,
	nowMs = Date.now()
}: {
	kind: AffiliationKind;
	monthAnchor: string;
	nowMs?: number;
}): Promise<AffiliationStats[]> => {
	const frozen = await frozenMonthlyRanking({ kind, monthAnchor });

	if (frozen.length > 0) {
		return frozen;
	}

	const live = rankEligibleMonthlyRows({
		kind,
		monthAnchor,
		nowMs,
		monthly: await aggregateMembersForMonth({ kind, monthAnchor })
	});

	return live.sort(monthlyComparator);
};

export interface AffiliationChampionship {
	monthAnchor: string;
	accuracy: number;
	monthTotalCalls: number;
}

/**
 * Champion history for one affiliation: every frozen month in which it
 * finished first in its kind's ranking. Only frozen months confer a cup; a
 * month with no freeze yet contributes nothing.
 */
export const listAffiliationChampionships = async ({
	kind,
	affiliationIdentifier
}: {
	kind: AffiliationKind;
	affiliationIdentifier: string;
}): Promise<AffiliationChampionship[]> => {
	const rows = await query<AffiliationStatsRow>(
		`select kind, affiliation_identifier, month_anchor, total_calls, wins,
		        month_total_calls, month_wins, updated_at_ms::text
		 from affiliation_stats
		 where kind = $1 and month_total_calls >= $2`,
		[kind, MIN_CALLS_FOR_RANK]
	);

	const byMonth = new Map<string, AffiliationStats[]>();

	for (const row of rows) {
		const doc = shapeSnapshot(row);
		const bucket = byMonth.get(doc.monthAnchor);

		if (nonNullish(bucket)) {
			bucket.push(doc);
		} else {
			byMonth.set(doc.monthAnchor, [doc]);
		}
	}

	const championships: AffiliationChampionship[] = [];

	for (const [monthAnchor, bucket] of byMonth) {
		bucket.sort(monthlyComparator);

		const [winner] = bucket;

		if (nonNullish(winner) && winner.affiliationIdentifier === affiliationIdentifier) {
			championships.push({
				monthAnchor,
				accuracy: winner.monthWins / winner.monthTotalCalls,
				monthTotalCalls: winner.monthTotalCalls
			});
		}
	}

	return championships.sort((a, b) =>
		a.monthAnchor < b.monthAnchor ? 1 : a.monthAnchor > b.monthAnchor ? -1 : 0
	);
};

/**
 * Worker job: freeze the just-closed month for both kinds. Real scheduling
 * replaces the lazy claim-time freeze, but stays idempotent with it (both
 * paths share the all-or-nothing month gate), so whichever runs first owns
 * the month and the other is a no-op. Each kind freezes on its own: one that
 * fails is logged and reported, retried on the next run, and never keeps the
 * other kind from freezing.
 */
export const freezeClosedMonth = async (
	nowMs = Date.now()
): Promise<{ monthAnchor: string; frozen: number; failedKinds: AffiliationKind[] }> => {
	const monthAnchor = previousMonthAnchor(nowMs);
	const failedKinds: AffiliationKind[] = [];
	let frozen = 0;

	for (const kind of AFFILIATION_KINDS) {
		try {
			const result = await freezeMonthlySnapshots({ kind, monthAnchor, nowMs });

			frozen += result.frozen;
		} catch (err) {
			logger.error(`worlds month ${monthAnchor} freeze failed for ${kind}:`, err);
			failedKinds.push(kind);
		}
	}

	return { monthAnchor, frozen, failedKinds };
};
