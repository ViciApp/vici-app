/**
 * Product-analytics capture + read (cockpit DQ-1).
 *
 * Two `defineUpdate` / `defineQuery` endpoints, wired in `src/satellite/index.ts`:
 *
 *   trackEvents({ events }) -> { accepted }
 *     · the FE batches behavioural events and flushes them here
 *     · the server stamps the authoritative timestamp and derives the
 *       pseudonymous `principal` from the caller (anonymous before sign-in)
 *     · writes one append-only doc per event to `events`
 *     · best-effort bumps the day's `event_rollups` counter doc inline
 *       (a rollup failure never blocks event capture)
 *
 *   getAnalyticsSummary({ days }) -> { rows: [{ day, start, name, count }] }
 *     · admin-gated (the cockpit's founder principal)
 *     · returns the trailing `days` daily rollups, flattened to rows
 *
 * Both `events` and `event_rollups` are controllers-scoped collections, so
 * the privileged `*DocStore` APIs run as an admin (the invoking user is not
 * a controller). Bodies are behavioural only — never PII; the only identity
 * stored is the principal, which is pseudonymous and never leaves the
 * satellite.
 */

import { ZERO } from '#lib/constants/app.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import { VXP_TOKEN } from '#lib/constants/tokens/tokens.ic.constants.ts';
import {
	ANALYTICS_PROP_KEYS,
	type AnalyticsEventDoc,
	type AnalyticsEventName,
	type AnalyticsEventProps,
	type EventCount,
	type EventRollupDoc,
	type TrackEventInput
} from '#lib/types/analytics-event.ts';
import type { VxpAwardDoc } from '#lib/types/vxp-award.ts';
import { controllerCaller, isAdmin } from '#satellite/services/authz.services.ts';
import { logError } from '#satellite/utils/logger.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import type { OnSetDocContext } from '@junobuild/functions';
import { msgCaller, time } from '@junobuild/functions/ic-cdk';
import {
	countDocsStore,
	decodeDocData,
	deleteDocStore,
	encodeDocData,
	getDocStore,
	listDocsStore,
	setDocStore
} from '@junobuild/functions/sdk';

const MS_PER_NS = 1_000_000n;
const MS_PER_DAY = 86_400_000;

/** Defensive cap so one call can't write an unbounded number of docs. */
const MAX_EVENTS_PER_BATCH = 100;

const nowMs = (): number => Number(time() / MS_PER_NS);

/**
 * Re-nest the flat wire dimensions back into a `props` object, dropping
 * undefined keys. Returns `undefined` when no dimension was set so the
 * stored doc stays lean.
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

	ANALYTICS_PROP_KEYS.forEach((key) => copy(key));

	return present ? props : undefined;
};

/**
 * A satellite controller principal, used as the `caller` for the
 * server-owned, controllers-scoped analytics collections. The `*DocStore`
 * APIs enforce the collection rule against the `caller` they're given, and
 * the end user is not a controller — so we read/write as an admin.
 */
const adminCaller = (): Uint8Array => controllerCaller('analytics capture');

/**
 * Best-effort inline rollup. Bumps the day's per-event-name counts so the
 * cockpit reads cheap aggregates. Wrapped so any failure (e.g. a rare
 * version race under concurrent writes) is logged and swallowed — the raw
 * `events` log is the source of truth and must never be blocked by this.
 */
const bumpRollup = ({
	admin,
	tsMs,
	names
}: {
	admin: Uint8Array;
	tsMs: number;
	names: AnalyticsEventName[];
}): void => {
	try {
		const epochDay = Math.floor(tsMs / MS_PER_DAY);
		const key = `${epochDay}`;

		const current = getDocStore({
			collection: Collection.EVENT_ROLLUPS,
			key,
			caller: admin
		});

		const existing = isNullish(current) ? undefined : decodeDocData<EventRollupDoc>(current.data);

		const counts: Record<string, number> = {};
		existing?.counts.forEach(({ name, count }) => {
			counts[name] = count;
		});
		names.forEach((name) => {
			counts[name] = (counts[name] ?? 0) + 1;
		});

		const rollup: EventRollupDoc = {
			epochDay,
			dayStartMs: epochDay * MS_PER_DAY,
			counts: Object.keys(counts).map((name): EventCount => ({
				name: name as AnalyticsEventName,
				count: counts[name]
			})),
			updatedAtMs: tsMs
		};

		setDocStore({
			collection: Collection.EVENT_ROLLUPS,
			key,
			caller: admin,
			doc: {
				version: current?.version,
				data: encodeDocData<EventRollupDoc>(rollup)
			}
		});
	} catch (err) {
		logError({
			message: 'analytics rollup bump failed (events still captured)',
			detail: { error: err instanceof Error ? err.message : `${err}` }
		});
	}
};

export const trackEventsFn = ({ events }: { events: TrackEventInput[] }): { accepted: number } => {
	if (events.length === 0) {
		return { accepted: 0 };
	}

	const batch = events.slice(0, MAX_EVENTS_PER_BATCH);

	const caller = msgCaller();
	const principalText = caller.toText();
	const isAnonymous = principalText === Principal.anonymous().toText();
	const admin = adminCaller();
	const tsMs = nowMs();
	const stamp = time();

	batch.forEach((event, index) => {
		const props = propsFromInput(event);
		const doc: AnalyticsEventDoc = {
			name: event.name,
			tsMs,
			sessionId: event.sessionId,
			...(isAnonymous ? {} : { principal: principalText }),
			...(isNullish(event.path) ? {} : { path: event.path }),
			...(isNullish(props) ? {} : { props })
		};

		// Key is unique within the batch (index) and across callers/calls
		// (ns stamp + sessionId); the collection is append-only.
		setDocStore({
			collection: Collection.EVENTS,
			key: `${stamp}-${event.sessionId}-${index}`,
			caller: admin,
			doc: {
				data: encodeDocData<AnalyticsEventDoc>(doc)
			}
		});
	});

	bumpRollup({ admin, tsMs, names: batch.map(({ name }) => name) });

	return { accepted: batch.length };
};

/** One flat `(day, name, count)` row in the summary result. */
interface SummaryRow {
	day: number;
	start: number;
	name: AnalyticsEventName;
	count: number;
}

export const getAnalyticsSummaryFn = ({ days }: { days: number }): { rows: SummaryRow[] } => {
	const caller = msgCaller();

	if (!isAdmin({ caller })) {
		throw new Error('Analytics is restricted to admins.');
	}

	const admin = adminCaller();

	const { items } = listDocsStore({
		collection: Collection.EVENT_ROLLUPS,
		caller: admin,
		params: {}
	});

	const rollups: EventRollupDoc[] = [];
	items.forEach(([, doc]) => {
		try {
			rollups.push(decodeDocData<EventRollupDoc>(doc.data));
		} catch (err) {
			logError({
				message: 'analytics rollup decode failed',
				detail: { error: err instanceof Error ? err.message : `${err}` }
			});
		}
	});

	const trimmed = rollups
		.sort((a, b) => b.epochDay - a.epochDay)
		.slice(0, Math.max(0, Math.floor(days)));

	const rows: SummaryRow[] = [];
	trimmed.forEach(({ epochDay, dayStartMs, counts }) => {
		counts.forEach(({ name, count }: EventCount) => {
			rows.push({ day: epochDay, start: dayStartMs, name, count });
		});
	});

	return { rows };
};

/**
 * Admin-gated all-time registered-account count for the cockpit's
 * "Registered" tile. Counts every doc in `PROFILES` — i.e. all accounts
 * ever created, INCLUDING soft-deleted ones: Delete account v2 only sets
 * `deletedAtMs` and retains the doc (recoverable within the window), so a
 * soft-deleted profile is still a registered account. This matches the
 * tile's "all-time accounts created" semantic. Accounts hard-deleted past
 * the recovery window are necessarily absent because their doc no longer
 * exists.
 *
 * Uses `countDocsStore` rather than `listDocsStore(...).items.length`: the
 * latter materialises the whole collection (keys + docs) into the query
 * just to size it, which grows unbounded with the user base and would blow
 * the 5B-instruction query budget (IC0522) — the same trap that broke the
 * events export. `countDocsStore` returns the count without loading a
 * single doc.
 */
export const getAnalyticsUserStatsFn = (): { registered: number } => {
	const caller = msgCaller();

	if (!isAdmin({ caller })) {
		throw new Error('Analytics is restricted to admins.');
	}

	const count = countDocsStore({
		collection: Collection.PROFILES,
		caller,
		params: {}
	});

	// `registered` is a float64 on the wire; guard the bigint→number narrowing
	// so an (implausibly huge) count can't silently lose precision.
	if (count > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new Error('registered account count exceeds MAX_SAFE_INTEGER.');
	}

	return { registered: Number(count) };
};

/** Hard batch ceiling for the analytics export AND its drain. `getAnalyticsEventsFn`
 * (a QUERY) reads at most this many docs per call, and `deleteAnalyticsEventsFn` (the
 * drain) deletes at most this many keys per call. The query is the binding
 * constraint: it's bounded by the ~5B-instruction message budget, and reading/decoding
 * a page of behavioural docs costs instructions — measured against the live satellite,
 * a 500-doc page already rejects with IC0522 and ~100 was the safe edge. So the cockpit
 * reader drives a smaller page (SYNC_PAGE_SIZE) and this ceiling is the last line of
 * defence against a client over-asking. 100 sits conservatively below the measured
 * query edge; the drain (an update call, ~40B budget) is comfortably within it, and a
 * page is never larger than what was just ingested, so the two stay in lockstep. */
const MAX_EXPORT_LIMIT = 100;

/** One flat export row — mirrors AnalyticsEventExportRowSchema. */
interface AnalyticsEventExportRow {
	key: string;
	createdAtNs: string;
	updatedAtNs: string;
	version?: string;
	ownerText?: string;
	name: AnalyticsEventName;
	tsMs: number;
	sessionId: string;
	principalText?: string;
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

/** Parse the exclusive `updated_at` cursor. Tolerates absent/whitespace/
 * non-numeric input by restarting from the beginning rather than throwing a
 * low-signal BigInt error on a malformed cursor. */
const parseCursorNs = (raw?: string): bigint => {
	const trimmed = raw?.trim() ?? '';

	return /^\d+$/.test(trimmed) ? BigInt(trimmed) : -1n;
};

/**
 * Admin-gated raw-event export for the cockpit warehouse. Returns the next page
 * of `events` ordered by `(updated_at, key)`, flattened, strictly after the
 * `(afterUpdatedAtNs, afterKey)` keyset cursor. The `key` tie-breaker is what
 * makes a page boundary that splits a group of same-`updated_at` docs safe — the
 * next call resumes mid-group instead of skipping the rest. The cockpit advances
 * the cursor from the last returned row's `(updatedAtNs, key)`. "List then
 * process in code" mirrors `getAnalyticsSummaryFn`.
 */
export const getAnalyticsEventsFn = ({
	afterUpdatedAtNs,
	afterKey,
	limit
}: {
	afterUpdatedAtNs?: string;
	afterKey?: string;
	limit: number;
}): { rows: AnalyticsEventExportRow[]; hasMore: boolean } => {
	const caller = msgCaller();

	if (!isAdmin({ caller })) {
		throw new Error('Analytics is restricted to admins.');
	}

	const admin = adminCaller();

	const afterNs = parseCursorNs(afterUpdatedAtNs);
	const afterKeyText = afterKey?.trim() ?? '';

	// The cursor is now the KEY (see the paging note below). A timestamp-only cursor
	// — `after_updated_at_ns` set but `after_key` blank — can't position the
	// key-ordered walk: it would list from the start and then the `afterNs` filter
	// below would drop every row, returning an empty page and stalling pagination.
	// Reject it loudly rather than silently stalling. (A blank/blank cursor is the
	// valid first page; a set/set cursor is a normal resume.)
	if (afterNs > ZERO && afterKeyText === '') {
		throw new Error('after_key is required when after_updated_at_ns is set.');
	}

	const safeLimit = Number.isFinite(limit) ? Math.floor(limit) : MAX_EXPORT_LIMIT;
	const cap = Math.min(Math.max(1, safeLimit), MAX_EXPORT_LIMIT);

	// Page by KEY only — the datastore's native (indexed) order. Event keys are
	// `${ns}-${sessionId}-${index}` (ns from `time()` at write) and the collection is
	// append-only, so key order IS chronological order; no `order`/`matcher` on
	// `updated_at` is needed. Those non-key params were the bug: the datastore has no
	// secondary index on `updated_at`, so ordering/matching on it forced Juno to load
	// and sort the ENTIRE `events` collection on every call, blowing the 5B-instruction
	// query budget once the collection grew (IC0522 — even at limit=1). `start_after`
	// on the unique key is a complete keyset cursor, and `paginate.limit` bounds the
	// walk to a single page, so the scan + response stay O(page), not O(collection).
	const { items } = listDocsStore({
		collection: Collection.EVENTS,
		caller: admin,
		params: {
			paginate: {
				limit: BigInt(cap),
				start_after: afterKeyText.length > 0 ? afterKeyText : undefined
			}
		}
	});

	const ordered = items
		.filter(([key, doc]) => {
			const u = doc.updated_at ?? ZERO;

			return u === afterNs ? key > afterKeyText : u > afterNs;
		})
		.sort(([ak, ad], [bk, bd]) => {
			const au = ad.updated_at ?? ZERO;
			const bu = bd.updated_at ?? ZERO;

			if (au !== bu) {
				return au < bu ? -1 : 1;
			}

			return ak < bk ? -1 : ak > bk ? 1 : 0;
		});

	const page = ordered.slice(0, cap);

	const rows = page.map(([key, doc]): AnalyticsEventExportRow => {
		const data = decodeDocData<AnalyticsEventDoc>(doc.data);
		const p = data.props ?? {};

		return {
			key,
			createdAtNs: `${doc.created_at ?? ZERO}`,
			updatedAtNs: `${doc.updated_at ?? ZERO}`,
			version: isNullish(doc.version) ? undefined : `${doc.version}`,
			ownerText: isNullish(doc.owner) ? undefined : Principal.fromUint8Array(doc.owner).toText(),
			name: data.name,
			tsMs: data.tsMs,
			sessionId: data.sessionId,
			principalText: data.principal,
			path: data.path,
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

	// A full datastore page means there may be more. `start_after` already excluded
	// the cursor's own key, so the fetched count is the unseen-row count — compare it
	// to `cap` directly (the keyset filter above is a no-op safety net unless the
	// cursor doc was deleted mid-pagination).
	return { rows, hasMore: items.length >= cap };
};

/** One profile-created export row: the doc key (principal text) and the doc
 * envelope's created_at in nanoseconds. Deliberately minimal — the cockpit only
 * needs WHEN each account was created to compute window cohorts; no profile
 * body field (nickname, pnl, …) ever leaves the satellite. */
interface ProfileCreatedExportRow {
	key: string;
	createdAtNs: string;
}

/**
 * Admin-gated profile-created export for the cockpit warehouse: the next page of
 * `profiles` doc keys + envelope `created_at`, keyset-paged by KEY (the
 * datastore's native indexed order — same O(page) discipline as
 * `getAnalyticsEventsFn`; ordering/matching on `updated_at` would materialise the
 * whole collection and blow the query budget). Key order is NOT chronological
 * (keys are principals) — the cockpit walks ALL pages and orders by
 * `createdAtNs` on its side. Unlike the events export this is NOT a drain:
 * profiles stay; the cockpit re-walks to resync.
 *
 * Why it exists: the raw event stream only starts at capture (2026-06-06) and
 * `signed_up` was emitted on a single path until #1112, so events cannot
 * reconstruct the true sign-up series. The profile envelope's `created_at` can.
 * Soft-deleted profiles (deletedAtMs set) are included — an account created in a
 * window was created in that window; hard-deleted docs are necessarily absent.
 */
export const getAnalyticsProfileCreatedFn = ({
	afterKey,
	limit
}: {
	afterKey?: string;
	limit: number;
}): { rows: ProfileCreatedExportRow[]; hasMore: boolean } => {
	const caller = msgCaller();

	if (!isAdmin({ caller })) {
		throw new Error('Analytics is restricted to admins.');
	}

	const admin = adminCaller();

	const afterKeyText = afterKey?.trim() ?? '';
	const safeLimit = Number.isFinite(limit) ? Math.floor(limit) : MAX_EXPORT_LIMIT;
	const cap = Math.min(Math.max(1, safeLimit), MAX_EXPORT_LIMIT);

	const { items } = listDocsStore({
		collection: Collection.PROFILES,
		caller: admin,
		params: {
			paginate: {
				limit: BigInt(cap),
				start_after: afterKeyText.length > 0 ? afterKeyText : undefined
			}
		}
	});

	const rows = items.map(([key, doc]): ProfileCreatedExportRow => ({
		key,
		createdAtNs: `${doc.created_at ?? ZERO}`
	}));

	// `start_after` already excluded the cursor's own key, so a full page means
	// there may be more (mirrors `getAnalyticsEventsFn`).
	return { rows, hasMore: items.length >= cap };
};

/**
 * Admin-gated DRAIN delete for the cockpit warehouse export. After the cockpit has
 * durably written a page of events to its own store, it passes their keys back here
 * to delete them from the on-chain `events` collection, keeping that collection a
 * small BUFFER rather than an ever-growing log. This is what makes the export
 * sustainable: `listDocsStore` materializes the whole collection per call, so a
 * large `events` collection blows the 5B-instruction query budget (IC0522) — draining
 * after ingest keeps every read cheap. Each delete is an O(log n) keyed op; `keys`
 * is capped at `MAX_EXPORT_LIMIT` so one call stays well under budget. Missing keys
 * (already drained / never existed) are skipped, so the call is idempotent — safe to
 * retry a page whose Postgres write succeeded but whose delete didn't.
 */
export const deleteAnalyticsEventsFn = ({ keys }: { keys: string[] }): { deleted: number } => {
	const caller = msgCaller();

	if (!isAdmin({ caller })) {
		throw new Error('Analytics is restricted to admins.');
	}

	const admin = adminCaller();

	let deleted = 0;

	for (const key of keys.slice(0, MAX_EXPORT_LIMIT)) {
		const existing = getDocStore({ collection: Collection.EVENTS, key, caller: admin });

		// Skip missing keys (already drained / never existed) — keeps the call
		// idempotent so a page whose Postgres write landed but whose delete didn't can
		// be retried safely.
		if (nonNullish(existing)) {
			deleteDocStore({
				collection: Collection.EVENTS,
				key,
				caller: admin,
				doc: { version: existing.version }
			});

			deleted += 1;
		}
	}

	return { deleted };
};

// ─── Server-side capture ────────────────────────────────────────

/** One server-originated behavioural event (no browser visit behind it). */
export interface ServerEventInput {
	name: AnalyticsEventName;
	/** Recipient / actor principal text, when the event concerns one. */
	principal?: string;
	props?: AnalyticsEventProps;
}

/**
 * Monotonic per-instance sequence for server-event doc keys. `time()` is
 * constant within a single IC message execution, so two `captureServerEvents`
 * calls inside the same update (e.g. `delete_confirmed` then
 * `delete_succeeded` in `deleteMyAccountFn`) would otherwise both key their
 * first event `${stamp}-server-0` and the later write would collide with the
 * earlier one. The sequence disambiguates calls within a message; across
 * messages the ns stamp already differs, so keys stay chronologically sorted.
 */
let serverCaptureSeq = 0;

/**
 * Write server-originated events into the `events` collection — the capture
 * path for behaviour that never touches a browser (VXP payouts, settlements).
 * Mirrors `trackEventsFn`'s doc write (admin caller, `${ns}-…-${index}` key
 * scheme, rollup bump) but takes the principal from the SERVER's own record
 * rather than `msgCaller`, and stamps `sessionId: 'server'` (there is no visit).
 */
export const captureServerEvents = ({ events }: { events: ServerEventInput[] }): void => {
	if (events.length === 0) {
		return;
	}

	const admin = adminCaller();
	const tsMs = nowMs();
	const stamp = time();
	const seq = serverCaptureSeq;
	serverCaptureSeq += 1;

	events.forEach((event, index) => {
		const doc: AnalyticsEventDoc = {
			name: event.name,
			tsMs,
			sessionId: 'server',
			...(isNullish(event.principal) ? {} : { principal: event.principal }),
			...(isNullish(event.props) ? {} : { props: event.props })
		};

		setDocStore({
			collection: Collection.EVENTS,
			key: `${stamp}-server-${seq}-${index}`,
			caller: admin,
			doc: {
				data: encodeDocData<AnalyticsEventDoc>(doc)
			}
		});
	});

	bumpRollup({ admin, tsMs, names: events.map(({ name }) => name) });
};

/**
 * `vxp_awards` post-write analytics: emit `vxp_awarded` (value = whole-VXP
 * amount, label = award type) exactly once per award — on the `pending → paid`
 * transition, when the ledger transfer actually completed. Streak awards also
 * emit `streak_milestone` (`step` = the crossed day count from the award key,
 * e.g. `streak_7` → 7). Best-effort: analytics must never break a payout.
 */
export const onVxpAwardSetForAnalytics = (ctx: OnSetDocContext): void => {
	try {
		const {
			data: {
				collection,
				data: { before, after }
			}
		} = ctx;

		if (collection !== Collection.VXP_AWARDS) {
			return;
		}

		const award = decodeDocData<VxpAwardDoc>(after.data);
		const prior = nonNullish(before) ? decodeDocData<VxpAwardDoc>(before.data) : undefined;

		// Only the transition INTO `paid` mints — a pending write, a failed write,
		// or a re-set of an already-paid doc must not double-count.
		if (award.status !== 'paid' || prior?.status === 'paid') {
			return;
		}

		const value = Number(award.amountBaseUnits) / 10 ** VXP_TOKEN.decimals;

		const events: ServerEventInput[] = [
			{
				name: 'vxp_awarded',
				principal: award.recipient,
				props: { value, label: award.awardType }
			}
		];

		if (award.awardType === 'streak') {
			const days = Number(award.awardKey.replace('streak_', ''));

			if (Number.isFinite(days) && days > 0) {
				events.push({
					name: 'streak_milestone',
					principal: award.recipient,
					props: { step: days }
				});
			}
		}

		captureServerEvents({ events });
	} catch (err) {
		logError({
			message: 'vxp award analytics capture failed',
			detail: { error: err instanceof Error ? err.message : `${err}` }
		});
	}
};
