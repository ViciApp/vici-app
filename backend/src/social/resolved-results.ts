// Friend-readable resolved-results digest: one row per (user, market)
// resolved call, written from the clearing settlement plan at resolution
// time (never from a client, so a user cannot forge a result), read
// friend-scoped, and pruned past the retention horizon.

import { isNullish, nonNullish } from '@dfinity/utils';
import { query } from '../db/client';
import { getSettlementPlan } from '../engine/clearing';
import { getSeries } from '../engine/registry';
import { ZERO } from '../lib/constants';
import { logger } from '../lib/logger';
import { DAY_IN_MS } from '../lib/time';

/** How long a resolved-result row stays readable before the pruning job
 * removes it. */
export const RESOLVED_RESULTS_RETENTION_MS = 45 * DAY_IN_MS;

export interface ResolvedResult {
	userId: string;
	marketId: string;
	title: string;
	side: string;
	outcome: 'win' | 'loss';
	netVxp: number;
	resolvedAtMs: number;
}

interface ResolvedResultRow {
	user_id: string;
	market_id: string;
	title: string;
	side: string;
	outcome: 'win' | 'loss';
	net_vxp: string;
	resolved_at_ms: string;
}

const shapeResolvedResult = (row: ResolvedResultRow): ResolvedResult => ({
	userId: row.user_id,
	marketId: row.market_id,
	title: row.title,
	side: row.side,
	outcome: row.outcome,
	netVxp: Number(row.net_vxp),
	resolvedAtMs: Number(row.resolved_at_ms)
});

/**
 * Idempotent upsert of one participant's row: a settlement replayed to the
 * same outcome overwrites the existing (user, market) row instead of
 * duplicating or double-counting it, and keeps the first resolution time so
 * a replay never moves the result back to the top of the digest.
 */
export const upsertResolvedResult = async (result: ResolvedResult): Promise<void> => {
	await query(
		`insert into resolved_results (user_id, market_id, title, side, outcome, net_vxp, resolved_at_ms)
		 values ($1, $2, $3, $4, $5, $6, $7)
		 on conflict (user_id, market_id) do update set
		   title = excluded.title,
		   side = excluded.side,
		   outcome = excluded.outcome,
		   net_vxp = excluded.net_vxp`,
		[
			result.userId,
			result.marketId,
			result.title,
			result.side,
			result.outcome,
			result.netVxp,
			result.resolvedAtMs
		]
	);
};

/**
 * Friend-scoped bulk read for the results digest: the given friends' rows
 * over the active retention window in one bounded query, most recent first
 * with the primary key as tiebreak so the order is deterministic.
 */
export const listFriendResolvedResults = async ({
	friendIds
}: {
	friendIds: string[];
}): Promise<ResolvedResult[]> => {
	if (friendIds.length === 0) {
		return [];
	}

	const cutoffMs = Date.now() - RESOLVED_RESULTS_RETENTION_MS;

	const rows = await query<ResolvedResultRow>(
		`select user_id, market_id, title, side, outcome, net_vxp::text, resolved_at_ms::text
		 from resolved_results
		 where user_id = any($1) and resolved_at_ms >= $2
		 order by resolved_at_ms desc, user_id asc, market_id asc`,
		[friendIds, cutoffMs]
	);

	return rows.map(shapeResolvedResult);
};

/**
 * Retention cleanup job: prunes every row whose resolvedAtMs is older than
 * {@link RESOLVED_RESULTS_RETENTION_MS}. Exposed for the background worker
 * (scheduling lands with the worker loop) and the admin endpoint; returns
 * the number of rows pruned.
 */
export const pruneResolvedResults = async (): Promise<{ pruned: number }> => {
	const cutoffMs = Date.now() - RESOLVED_RESULTS_RETENTION_MS;

	const rows = await query<{ user_id: string }>(
		`delete from resolved_results where resolved_at_ms < $1 returning user_id`,
		[cutoffMs]
	);

	return { pruned: rows.length };
};

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);

/** Whether a cashflow stays exact once narrowed to a JS number; rows past
 * the safe range are dropped (logged) rather than recorded corrupted. */
const isSafeCashflow = (cashflowUsd: bigint): boolean =>
	cashflowUsd <= MAX_SAFE && cashflowUsd >= MIN_SAFE;

/** The side a participant held: the settlement outcome id when present,
 * else YES/NO derived from the sign of their net position. */
const sideForPosition = ({
	outcomeId,
	netQty
}: {
	outcomeId: string | undefined;
	netQty: bigint;
}): string => {
	if (nonNullish(outcomeId) && outcomeId.length > 0) {
		return outcomeId;
	}

	return netQty >= ZERO ? 'YES' : 'NO';
};

/** Maps on-chain principals to user ids: the custodial ic account address
 * for native accounts, the linked legacy principal for imported ones. */
const userIdsForPrincipals = async (principals: string[]): Promise<Map<string, string>> => {
	if (principals.length === 0) {
		return new Map();
	}

	const rows = await query<{ principal: string; user_id: string }>(
		`select address as principal, user_id from custody_accounts
		 where chain = 'ic' and user_id is not null and address = any($1)
		 union
		 select principal, user_id from legacy_principals where principal = any($1)`,
		[principals]
	);

	return new Map(rows.map((row) => [row.principal, row.user_id]));
};

/**
 * Settlement fan-out: one resolved-result row per market participant,
 * derived from the clearing settlement plan (per-participant outcome and
 * signed net VXP are read on-chain, never from the client). Best-effort:
 * any failure is logged and swallowed so it never disrupts the settlement
 * activity write that triggered it. Settlements are rare, so the
 * O(participants) fan-out is a bounded, cold path.
 */
export const fanOutResolvedResults = async ({ marketId }: { marketId: string }): Promise<void> => {
	try {
		const plan = await getSettlementPlan(marketId);
		const positions = plan?.positions;

		if (isNullish(positions) || positions.length === 0) {
			return;
		}

		// The title lands on every participant's row, so it only ever comes
		// from the registry; without one no row is written, and the next
		// settlement post for this market fills them in.
		const title = (await getSeries(marketId))?.title;

		if (isNullish(title) || title.length === 0) {
			logger.error(`resolved-results skipped for ${marketId}: the series has no title`);

			return;
		}

		const resolvedAtMs = Date.now();

		const writable = positions.filter((position) => {
			const safe = isSafeCashflow(position.cashflow_usd);

			if (!safe) {
				logger.error(
					`resolved-results cashflow out of safe range for ${marketId} / ${position.user.toText()}: ${position.cashflow_usd.toString()}`
				);
			}

			return safe;
		});

		const userIds = await userIdsForPrincipals(writable.map((position) => position.user.toText()));

		// A participant with no account here (an on-chain user that never
		// linked) has no row to write; skip rather than fail the fan-out.
		const linked = writable
			.map((position) => ({ position, userId: userIds.get(position.user.toText()) }))
			.filter((entry): entry is typeof entry & { userId: string } => nonNullish(entry.userId));

		for (const { position, userId } of linked) {
			const netVxp = Number(position.cashflow_usd);

			await upsertResolvedResult({
				userId,
				marketId,
				title,
				side: sideForPosition({
					outcomeId: position.outcome_id[0],
					netQty: position.net_qty
				}),
				outcome: netVxp >= 0 ? 'win' : 'loss',
				netVxp,
				resolvedAtMs
			});
		}

		logger.info(`resolved-results written for ${marketId}: ${linked.length} rows`);
	} catch (err) {
		logger.error(`resolved-results write failed for ${marketId}:`, err);
	}
};
