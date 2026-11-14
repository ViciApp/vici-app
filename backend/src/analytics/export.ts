// Admin analytics reads for the warehouse: the daily summary, the keyset
// event export with its drain delete, the registered-account count, and the
// profile-created export. Pagination contracts mirror the legacy endpoints:
// pages are keyset-cursored, capped at MAX_EXPORT_LIMIT, and hasMore is
// derived from a full page.

import { query } from '../db/client';
import { ZERO } from '../lib/constants';
import { DAY_IN_MS } from '../lib/time';
import { AnalyticsValidationError } from './events';
import type { AnalyticsEventName, AnalyticsEventProps } from './taxonomy';

/** Hard batch ceiling for the export and its drain. */
export const MAX_EXPORT_LIMIT = 100;

/** One flat (day, name, count) row in the summary result. */
export interface SummaryRow {
	day: number;
	start: number;
	name: AnalyticsEventName;
	count: number;
}

/** The trailing `days` daily rollups, flattened to rows, newest day first. */
export const getAnalyticsSummary = async ({
	days
}: {
	days: number;
}): Promise<{ rows: SummaryRow[] }> => {
	const cap = Math.max(0, Math.floor(days));

	if (cap === 0) {
		return { rows: [] };
	}

	const rows = await query<{ epoch_day: string | number; name: string; count: string | number }>(
		`select epoch_day, name, count from analytics_event_rollups
		 where epoch_day in (
		   select distinct epoch_day from analytics_event_rollups order by epoch_day desc limit $1
		 )
		 order by epoch_day desc, name`,
		[cap]
	);

	return {
		rows: rows.map(({ epoch_day, name, count }) => ({
			day: Number(epoch_day),
			start: Number(epoch_day) * DAY_IN_MS,
			name: name as AnalyticsEventName,
			count: Number(count)
		}))
	};
};

/**
 * All-time registered-account count. Counts every profile row, INCLUDING
 * soft-deleted ones: delete-account only marks the profile and retains the
 * row (recoverable within the window), so a soft-deleted profile is still a
 * registered account. Accounts hard-deleted past the recovery window are
 * necessarily absent because their row no longer exists.
 */
export const getAnalyticsUserStats = async (): Promise<{ registered: number }> => {
	const rows = await query<{ registered: string | number }>(
		`select count(*) as registered from profiles`
	);

	return { registered: Number(rows[0]?.registered ?? 0) };
};

/** One flat export row of the raw event log. */
export interface AnalyticsEventExportRow {
	key: string;
	createdAtNs: string;
	updatedAtNs: string;
	name: AnalyticsEventName;
	tsMs: number;
	sessionId: string;
	userId?: string;
	path?: string;
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

/** Parse the exclusive updated-at cursor. Tolerates absent/whitespace/
 * non-numeric input by restarting from the beginning rather than throwing a
 * low-signal BigInt error on a malformed cursor. */
const parseCursorNs = (raw?: string): bigint => {
	const trimmed = raw?.trim() ?? '';

	return /^\d+$/.test(trimmed) ? BigInt(trimmed) : -1n;
};

const clampLimit = (limit: number): number => {
	const safeLimit = Number.isFinite(limit) ? Math.floor(limit) : MAX_EXPORT_LIMIT;

	return Math.min(Math.max(1, safeLimit), MAX_EXPORT_LIMIT);
};

interface EventRow {
	key: string;
	name: string;
	ts_ms: string | number;
	session_id: string;
	user_id: string | null;
	path: string | null;
	props: AnalyticsEventProps | null;
	created_at_ns: string;
}

/**
 * The next page of the raw event log ordered by key, strictly after the
 * (afterUpdatedAtNs, afterKey) keyset cursor. Event keys carry a monotonic
 * ns stamp and the log is append-only, so key order IS chronological order;
 * the caller advances the cursor from the last returned row's
 * (updatedAtNs, key). The key tie-breaker is what makes a page boundary that
 * splits a group of same-timestamp rows safe: the next call resumes
 * mid-group instead of skipping the rest.
 */
export const getAnalyticsEvents = async ({
	afterUpdatedAtNs,
	afterKey,
	limit
}: {
	afterUpdatedAtNs?: string;
	afterKey?: string;
	limit: number;
}): Promise<{ rows: AnalyticsEventExportRow[]; hasMore: boolean }> => {
	const afterNs = parseCursorNs(afterUpdatedAtNs);
	const afterKeyText = afterKey?.trim() ?? '';

	// A timestamp-only cursor cannot position the key-ordered walk: it would
	// page from the start and the timestamp filter would drop every row,
	// stalling pagination on an empty page. Reject it loudly. (A blank/blank
	// cursor is the valid first page; a set/set cursor is a normal resume.)
	if (afterNs > ZERO && afterKeyText === '') {
		throw new AnalyticsValidationError('after_key is required when after_updated_at_ns is set.');
	}

	const cap = clampLimit(limit);

	const items = await query<EventRow>(
		`select key, name, ts_ms, session_id, user_id, path, props,
		        ((extract(epoch from created_at) * 1000000)::bigint * 1000)::text as created_at_ns
		 from analytics_events
		 where ($1 = '' or key > $1)
		 order by key
		 limit $2`,
		[afterKeyText, cap]
	);

	// The keyset filter is a no-op safety net unless a cursor row was drained
	// mid-pagination; rows are append-only so created == updated.
	const page = items.filter((row) => {
		const u = BigInt(row.created_at_ns);

		return u === afterNs ? row.key > afterKeyText : u > afterNs;
	});

	const rows = page.map((row): AnalyticsEventExportRow => {
		const p = row.props ?? {};

		return {
			key: row.key,
			createdAtNs: row.created_at_ns,
			updatedAtNs: row.created_at_ns,
			name: row.name as AnalyticsEventName,
			tsMs: Number(row.ts_ms),
			sessionId: row.session_id,
			userId: row.user_id ?? undefined,
			path: row.path ?? undefined,
			marketId: p.marketId,
			seriesId: p.seriesId,
			leagueId: p.leagueId,
			battleId: p.battleId,
			source: p.source,
			label: p.label,
			step: p.step,
			value: p.value,
			count: p.count,
			durationMs: p.durationMs,
			ok: p.ok,
			country: p.country,
			locale: p.locale
		};
	});

	// A full page means there may be more; the key cursor already excluded the
	// cursor's own row, so the fetched count is the unseen-row count.
	return { rows, hasMore: items.length >= cap };
};

/** One profile-created export row: the user id and the row's created_at in
 * nanoseconds. Deliberately minimal: the warehouse only needs WHEN each
 * account was created to compute window cohorts; no profile body field ever
 * leaves this service. */
export interface ProfileCreatedExportRow {
	key: string;
	createdAtNs: string;
}

/**
 * Profile-created export: the next page of profile keys plus created_at,
 * keyset-paged by key. Key order is NOT chronological (keys are user ids),
 * so the caller walks ALL pages and orders by createdAtNs on its side.
 * Unlike the events export this is NOT a drain: profiles stay; the caller
 * re-walks to resync. Soft-deleted profiles are included: an account created
 * in a window was created in that window.
 */
export const getAnalyticsProfileCreated = async ({
	afterKey,
	limit
}: {
	afterKey?: string;
	limit: number;
}): Promise<{ rows: ProfileCreatedExportRow[]; hasMore: boolean }> => {
	const afterKeyText = afterKey?.trim() ?? '';
	const cap = clampLimit(limit);

	const rows = await query<{ key: string; created_at_ns: string }>(
		`select user_id::text as key,
		        ((extract(epoch from created_at) * 1000000)::bigint * 1000)::text as created_at_ns
		 from profiles
		 where ($1 = '' or user_id::text > $1)
		 order by user_id::text
		 limit $2`,
		[afterKeyText, cap]
	);

	return {
		rows: rows.map(({ key, created_at_ns }) => ({ key, createdAtNs: created_at_ns })),
		hasMore: rows.length >= cap
	};
};

/**
 * DRAIN delete for the warehouse export. After the caller has durably written
 * a page of events to its own store, it passes their keys back here to delete
 * them from the log, keeping the log a small buffer rather than an
 * ever-growing archive. Missing keys (already drained / never existed) are
 * skipped, so the call is idempotent: safe to retry a page whose downstream
 * write succeeded but whose delete did not.
 */
export const deleteAnalyticsEvents = async ({
	keys
}: {
	keys: string[];
}): Promise<{ deleted: number }> => {
	const batch = keys.slice(0, MAX_EXPORT_LIMIT);

	if (batch.length === 0) {
		return { deleted: 0 };
	}

	const rows = await query<{ key: string }>(
		`delete from analytics_events where key = any($1) returning key`,
		[batch]
	);

	return { deleted: rows.length };
};
