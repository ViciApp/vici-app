// Behavioural event capture: the client ingest batch and the server-side
// capture path other domains call (payouts, settlements). Event writes and
// the daily rollup bump share one transaction, so the summary can never
// drift from the log it aggregates.

import { isNullish, nonNullish } from '@dfinity/utils';
import { tx, type TxQuery } from '../db/client';
import { ZERO } from '../lib/constants';
import { nowNs } from '../lib/time';
import {
	ANALYTICS_PROP_KEYS,
	isAnalyticsEventName,
	isValidPropValue,
	type AnalyticsEventName,
	type AnalyticsEventProps
} from './taxonomy';

const MS_PER_DAY = 86_400_000;

/** Defensive cap so one call cannot write an unbounded number of rows. */
export const MAX_EVENTS_PER_BATCH = 100;

/** Thrown on a malformed ingest batch; the route maps it to a 400. */
export class AnalyticsValidationError extends Error {}

export interface TrackEventInput extends AnalyticsEventProps {
	name: AnalyticsEventName;
	sessionId: string;
	path?: string;
	/** Client-side event time, advisory only; the server time wins. */
	occurredAtMs?: number;
}

/**
 * Monotonic nanosecond stamp for event keys. Keys must stay unique and
 * chronologically sorted (the warehouse export pages by key), and two
 * batches from the same session can land within one millisecond, so equal
 * wall-clock reads are bumped forward by one.
 */
let lastStampNs = ZERO;

const nextStampNs = (): bigint => {
	const now = nowNs();

	lastStampNs = now > lastStampNs ? now : lastStampNs + 1n;

	return lastStampNs;
};

const parseTrackEvent = (value: unknown, position: number): TrackEventInput => {
	if (isNullish(value) || typeof value !== 'object') {
		throw new AnalyticsValidationError(`events[${position}] must be an object.`);
	}

	const event = value as Record<string, unknown>;
	const { name, sessionId, path, occurredAtMs } = event;

	if (typeof name !== 'string' || !isAnalyticsEventName(name)) {
		throw new AnalyticsValidationError(`events[${position}].name is not a known event name.`);
	}

	if (typeof sessionId !== 'string') {
		throw new AnalyticsValidationError(`events[${position}].sessionId must be a string.`);
	}

	if (nonNullish(path) && typeof path !== 'string') {
		throw new AnalyticsValidationError(`events[${position}].path must be a string.`);
	}

	if (nonNullish(occurredAtMs) && typeof occurredAtMs !== 'number') {
		throw new AnalyticsValidationError(`events[${position}].occurredAtMs must be a number.`);
	}

	const parsed: TrackEventInput = { name, sessionId };

	if (nonNullish(path)) {
		parsed.path = path;
	}

	// The same object seen through its dimension half: generic indexed writes
	// type-check against AnalyticsEventProps but not against the subtype.
	const dimensions: AnalyticsEventProps = parsed;

	const copyDimension = <K extends keyof AnalyticsEventProps>(key: K): void => {
		const propValue = event[key];

		if (isNullish(propValue)) {
			return;
		}

		if (!isValidPropValue(key, propValue)) {
			throw new AnalyticsValidationError(`events[${position}].${key} has the wrong type.`);
		}

		dimensions[key] = propValue;
	};

	for (const key of ANALYTICS_PROP_KEYS) {
		copyDimension(key);
	}

	return parsed;
};

/**
 * Re-nest the flat wire dimensions back into a props object, dropping unset
 * keys. Returns undefined when no dimension was set so the stored row stays
 * lean.
 */
const propsFromInput = (event: TrackEventInput): AnalyticsEventProps | undefined => {
	const props: AnalyticsEventProps = {};
	let present = false;

	const copy = <K extends keyof AnalyticsEventProps>(key: K): void => {
		const value = event[key];

		if (nonNullish(value)) {
			props[key] = value;
			present = true;
		}
	};

	for (const key of ANALYTICS_PROP_KEYS) {
		copy(key);
	}

	return present ? props : undefined;
};

/** Bump the day's per-event-name counters on the caller's transaction. */
const bumpRollup = async ({
	q,
	tsMs,
	names
}: {
	q: TxQuery;
	tsMs: number;
	names: AnalyticsEventName[];
}): Promise<void> => {
	const epochDay = Math.floor(tsMs / MS_PER_DAY);
	const counts = new Map<string, number>();

	for (const name of names) {
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}

	for (const [name, count] of counts) {
		await q(
			`insert into analytics_event_rollups (epoch_day, name, count, updated_at_ms)
			 values ($1, $2, $3, $4)
			 on conflict (epoch_day, name) do update set
			   count = analytics_event_rollups.count + excluded.count,
			   updated_at_ms = excluded.updated_at_ms`,
			[epochDay, name, count, tsMs]
		);
	}
};

/**
 * Client ingest: the app batches behavioural events and flushes them here.
 * The server stamps the authoritative timestamp; identity is the pseudonymous
 * link to the session user (null for anonymous visitors). At most
 * MAX_EVENTS_PER_BATCH rows are written per call; the overflow is dropped and
 * the accepted count reported back.
 */
export const trackEvents = async ({
	events,
	userId
}: {
	events: unknown[];
	userId?: string;
}): Promise<{ accepted: number }> => {
	if (events.length === 0) {
		return { accepted: 0 };
	}

	const batch = events.slice(0, MAX_EVENTS_PER_BATCH).map(parseTrackEvent);

	const tsMs = Date.now();
	const stamp = nextStampNs();

	await tx(async (q) => {
		for (const [index, event] of batch.entries()) {
			const props = propsFromInput(event);

			// Key is unique within the batch (index) and across calls (monotonic
			// ns stamp + sessionId); the log is append-only.
			await q(
				`insert into analytics_events (key, name, ts_ms, session_id, user_id, path, props)
				 values ($1, $2, $3, $4, $5, $6, $7)`,
				[
					`${stamp}-${event.sessionId}-${index}`,
					event.name,
					tsMs,
					event.sessionId,
					userId ?? null,
					event.path ?? null,
					isNullish(props) ? null : JSON.stringify(props)
				]
			);
		}

		await bumpRollup({ q, tsMs, names: batch.map(({ name }) => name) });
	});

	return { accepted: batch.length };
};

/** One server-originated behavioural event (no browser visit behind it). */
export interface ServerEventInput {
	name: AnalyticsEventName;
	/** Recipient / actor user id, when the event concerns one. */
	userId?: string;
	props?: AnalyticsEventProps;
}

/**
 * Per-process sequence for server-event keys: two capture calls can share a
 * wall-clock stamp, and the sequence keeps their keys distinct while staying
 * chronologically sorted.
 */
let serverCaptureSeq = 0;

/**
 * Write server-originated events into the log, the capture path for
 * behaviour that never touches a browser (VXP payouts, settlements).
 * Mirrors trackEvents' write (key scheme, rollup bump) but takes the user
 * from the server's own record and stamps sessionId 'server' (there is no
 * visit).
 */
export const captureServerEvents = async ({
	events
}: {
	events: ServerEventInput[];
}): Promise<void> => {
	if (events.length === 0) {
		return;
	}

	const tsMs = Date.now();
	const stamp = nextStampNs();
	const seq = serverCaptureSeq;

	serverCaptureSeq += 1;

	await tx(async (q) => {
		for (const [index, event] of events.entries()) {
			await q(
				`insert into analytics_events (key, name, ts_ms, session_id, user_id, path, props)
				 values ($1, $2, $3, 'server', $4, null, $5)`,
				[
					`${stamp}-server-${seq}-${index}`,
					event.name,
					tsMs,
					event.userId ?? null,
					isNullish(event.props) ? null : JSON.stringify(event.props)
				]
			);
		}

		await bumpRollup({ q, tsMs, names: events.map(({ name }) => name) });
	});
};
