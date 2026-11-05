import { functions } from '#declarations/satellite/satellite.api.ts';
import { theme } from '#lib/stores/theme.store.ts';
import type {
	AnalyticsEventName,
	AnalyticsEventProps,
	TrackEventInput
} from '#lib/types/analytics-event.ts';
import { isWeb2Backend } from '#lib/web2/backend-mode.ts';
import { postEvents } from '#lib/web2/client.ts';
import { browser } from '$app/env';
import { nonNullish } from '@dfinity/utils';
import { get } from 'svelte/store';

/**
 * Client-side product-analytics buffer (cockpit DQ-1).
 *
 * `track()` is **fire-and-forget**: it pushes a behavioural event into an
 * in-memory buffer and returns immediately — it never blocks a click or a
 * render. The buffer flushes in batches (a short debounce, a size cap, or
 * on tab-hide), and a flush failure is swallowed — analytics must never
 * break the app.
 *
 * Nothing identifying is sent from the client: only the event name, a
 * per-visit `sessionId`, the current route, and the bounded
 * {@link AnalyticsEventProps} dimensions. The satellite derives the
 * pseudonymous principal from the caller server-side, and the data lands in
 * our own satellite — never a third party.
 */

const FLUSH_INTERVAL_MS = 5_000;
const MAX_BUFFER = 20;
const SESSION_STORAGE_KEY = 'vici.analytics.session';
const SESSION_STARTED_KEY = 'vici.analytics.session.started';

let buffer: TrackEventInput[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let initialized = false;

/**
 * A per-visit (per-tab) session id. Lives in `sessionStorage` so it groups
 * one browsing session and resets on a fresh tab — the stitch key the
 * server can later use to associate pre-auth events with a principal.
 */
const sessionId = (): string => {
	const existing = sessionStorage.getItem(SESSION_STORAGE_KEY);

	if (nonNullish(existing)) {
		return existing;
	}

	// `crypto.randomUUID()` (not `Math.random()`) so the id is collision-free
	// and CodeQL doesn't flag insecure randomness — it's just an opaque
	// grouping key, but there's no reason to use a weak RNG.
	const fresh = crypto.randomUUID();
	sessionStorage.setItem(SESSION_STORAGE_KEY, fresh);

	return fresh;
};

const scheduleFlush = (): void => {
	if (nonNullish(flushTimer)) {
		return;
	}

	flushTimer = setTimeout(() => {
		flushTimer = undefined;
		void flushEvents();
	}, FLUSH_INTERVAL_MS);
};

/**
 * Send the buffered events in one batched update call. Best-effort: on
 * failure the batch is dropped rather than retried or surfaced.
 */
export const flushEvents = async (): Promise<void> => {
	if (buffer.length === 0) {
		return;
	}

	const events = buffer;
	buffer = [];

	if (nonNullish(flushTimer)) {
		clearTimeout(flushTimer);
		flushTimer = undefined;
	}

	try {
		// The batch shape is identical on both transports; only the destination
		// switches (see #lib/web2/backend-mode). Default stays the satellite call.
		if (isWeb2Backend()) {
			await postEvents({ events });
		} else {
			await functions.trackEvents({ events });
		}
	} catch (err) {
		// Analytics is best-effort and must never break the app — drop the batch.
		// eslint-disable-next-line no-console
		console.debug('analytics flush failed', err);
	}
};

/**
 * Record a behavioural event. Safe to call from anywhere — a no-op during
 * SSR, never throws, never blocks. The event is `{ name, ...dimensions }`,
 * e.g. `track({ name: 'flow_swipe', source: 'flow', marketId })`.
 */
export const track = (event: { name: AnalyticsEventName } & AnalyticsEventProps): void => {
	if (!browser) {
		return;
	}

	const { name, ...props } = event;

	// Coarse geo/language dims from the browser locale (`en-US` → country US,
	// locale en) — feeds the cockpit's regional + localization analytics.
	// Aggregate-level only, never precise location; best-effort (many browsers
	// report a bare `en`, in which case country is simply absent). Validated
	// strictly (2-letter alpha subtags) so a malformed tag can't smuggle an
	// invalid ISO code in. Spread BEFORE `props` deliberately: a call site that
	// passes an explicit `country`/`locale` knows more than the ambient browser
	// locale and wins.
	const [lang, region] = (navigator.languages?.[0] ?? navigator.language ?? '').split('-');
	const locale = lang && /^[a-z]{2,3}$/i.test(lang) ? lang.toLowerCase() : undefined;
	const country = region && /^[a-z]{2}$/i.test(region) ? region.toUpperCase() : undefined;

	buffer.push({
		name,
		sessionId: sessionId(),
		path: window.location.pathname,
		occurredAtMs: Date.now(),
		...(locale ? { locale } : {}),
		...(country ? { country } : {}),
		...props
	});

	if (buffer.length >= MAX_BUFFER) {
		void flushEvents();
	} else {
		scheduleFlush();
	}
};

/**
 * Wire the session-level listeners once, after the satellite is ready.
 * Flushes on tab-hide (the last chance to land buffered events) and emits
 * the opening `session_started` event.
 *
 * `session_started` fires once per SESSION (the `sessionStorage`-scoped
 * `sessionId`), not once per JS boot: a hard reload in the same tab keeps
 * the sessionId, so without the marker every reload would append another
 * `session_started` and inflate the cockpit's session counts. `label`
 * carries the active theme — the props vocabulary is a closed schema (no
 * `theme` key without a satellite regen), and `label` is free on this
 * event, so the theme dimension rides here for every session.
 */
export const initAnalytics = (): void => {
	if (!browser || initialized) {
		return;
	}

	initialized = true;

	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') {
			void flushEvents();
		}
	});

	const session = sessionId();

	if (sessionStorage.getItem(SESSION_STARTED_KEY) !== session) {
		sessionStorage.setItem(SESSION_STARTED_KEY, session);

		track({ name: 'session_started', label: get(theme) });
	}
};
