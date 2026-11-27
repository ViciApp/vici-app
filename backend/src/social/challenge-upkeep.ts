// Keeping challenge links current and bounded: the trade trigger rewrites the
// position each active link shows from the history it already loaded, and the
// retention job deletes links (and their answers) once their market has been
// closed, or they have been revoked, for longer than the retention window.

import { query } from '../db/client';
import type { ClearingDid } from '../declarations';
import { DAY_IN_MS } from '../lib/time';
import { heldBinaryPosition } from '../vxp/predictions';
import { openSeriesIds, toStoredPosition } from './challenges';

/** How long a link and its answers are kept once its market closed or it
 * was revoked; the prune job deletes them after that. */
export const CHALLENGE_LINK_RETENTION_MS = 90 * DAY_IN_MS;

/** The prune deletes in batches so one tick never holds a long lock, and
 * stops after a bounded number of them; the next tick takes the rest. */
export const CHALLENGE_PRUNE_BATCH_SIZE = 500;
const CHALLENGE_PRUNE_MAX_BATCHES = 20;

/**
 * Rewrites the caller's active links from a trade history the trade trigger
 * already loaded: side, entry price and time from the held position, all
 * cleared when it is flat (the link stays active). One indexed select, one
 * pass over the history and one update, no engine call.
 */
export const syncChallengesForUser = async ({
	userId,
	events
}: {
	userId: string;
	events: readonly ClearingDid.Event[];
}): Promise<void> => {
	const links = await query<{ id: string; series_id: string }>(
		`select id, series_id from challenge_links
		 where challenger_user_id = $1 and status = 'active'`,
		[userId]
	);

	if (links.length === 0) {
		return;
	}

	// One pass over the history, keeping only the linked series' rows, so
	// each position below scans its own fills and not the whole history.
	const eventsBySeries = new Map<string, ClearingDid.Event[]>(
		links.map(({ series_id }) => [series_id, []])
	);

	for (const event of events) {
		eventsBySeries.get(event.series_id)?.push(event);
	}

	const positions = links.map(({ series_id }) =>
		toStoredPosition(
			heldBinaryPosition({ events: eventsBySeries.get(series_id) ?? [], seriesId: series_id })
		)
	);

	await query(
		`update challenge_links l
		 set side = s.side, entry_price_bps = s.entry_price_bps, called_at_ms = s.called_at_ms,
		     position_synced_at_ms = $6
		 from unnest($1::text[], $2::text[], $3::int[], $4::bigint[])
		   as s (id, side, entry_price_bps, called_at_ms)
		 where l.id = s.id and l.challenger_user_id = $5 and l.status = 'active'`,
		[
			links.map(({ id }) => id),
			positions.map(({ side }) => side),
			positions.map(({ entryPriceBps }) => entryPriceBps),
			positions.map(({ calledAtMs }) => calledAtMs),
			userId,
			Date.now()
		]
	);
};

/** How many not-yet-closed series one prune tick checks for a settlement
 * (one engine read per 100); the next tick resumes after the last one. */
export const CHALLENGE_STAMP_SERIES_PER_TICK = 1000;

// Where the settlement check stopped, so successive ticks walk the pending
// series in id order instead of rereading the same first page. In memory:
// the worker is a single process, and a restart only restarts the walk.
let stampCursor = '';

/** Stamps the close of the markets the prune has not seen close yet: every
 * one past its expiry at once (one indexed update, no engine read), and,
 * for a bounded page of the unexpired ones, now when they are settled. */
const stampClosedMarkets = async ({
	nowMs,
	seriesLimit
}: {
	nowMs: number;
	seriesLimit: number;
}): Promise<void> => {
	await query(
		`update challenge_links set market_closed_at_ms = series_expiry_ms
		 where market_closed_at_ms is null and series_expiry_ms <= $1`,
		[nowMs]
	);

	const pending = await query<{ series_id: string; series_expiry_ms: string }>(
		`select series_id, min(series_expiry_ms)::text as series_expiry_ms from challenge_links
		 where market_closed_at_ms is null and series_id > $1
		 group by series_id
		 order by series_id
		 limit $2`,
		[stampCursor, seriesLimit]
	);

	stampCursor = pending.length < seriesLimit ? '' : (pending.at(-1)?.series_id ?? '');

	const open = await openSeriesIds(
		pending.map((row) => ({ seriesId: row.series_id, expiryMs: Number(row.series_expiry_ms) }))
	);
	const settled = pending.map(({ series_id }) => series_id).filter((id) => !open.has(id));

	if (settled.length > 0) {
		await query(
			`update challenge_links set market_closed_at_ms = $2
			 where market_closed_at_ms is null and series_id = any($1::text[])`,
			[settled, nowMs]
		);
	}
};

/**
 * Retention job: deletes, with their answers, the links whose market closed
 * or which were revoked more than {@link CHALLENGE_LINK_RETENTION_MS} ago, in
 * bounded batches. Re-running finds nothing more to delete.
 */
export const pruneChallengeLinks = async ({
	stampSeriesLimit = CHALLENGE_STAMP_SERIES_PER_TICK
}: {
	stampSeriesLimit?: number;
} = {}): Promise<{ pruned: number }> => {
	const nowMs = Date.now();

	await stampClosedMarkets({ nowMs, seriesLimit: stampSeriesLimit });

	const cutoffMs = nowMs - CHALLENGE_LINK_RETENTION_MS;
	let pruned = 0;

	for (let batch = 0; batch < CHALLENGE_PRUNE_MAX_BATCHES; batch++) {
		const rows = await query<{ id: string }>(
			`delete from challenge_links where id in (
			   select id from challenge_links where market_closed_at_ms <= $1
			   union
			   select id from challenge_links where status = 'revoked' and status_changed_at_ms <= $1
			   limit $2
			 )
			 returning id`,
			[cutoffMs, CHALLENGE_PRUNE_BATCH_SIZE]
		);

		pruned += rows.length;

		if (rows.length < CHALLENGE_PRUNE_BATCH_SIZE) {
			break;
		}
	}

	return { pruned };
};
