import { track } from '#lib/services/analytics.services.ts';
import {
	get as storageGet,
	has as storageHas,
	set as storageSet
} from '#lib/utils/storage.utils.ts';
import { browser } from '$app/env';
import { isNullish, nonNullish } from '@dfinity/utils';
import { derived, get, writable, type Readable } from 'svelte/store';

/**
 * Add-to-Home-Screen (PWA install) engine.
 *
 * Owns the install funnel's reactive state and imperative actions as a
 * typed Svelte module + store: never a `window` global. Consumers import
 * {@link canInstall} for gating and call {@link nativePrompt} /
 * {@link markDismissed} / {@link markInstalled} imperatively.
 *
 * On Android/Chrome the browser fires `beforeinstallprompt` once, early,
 * on a cold load; we capture and stash it so a later user gesture (the
 * sheet CTA) can replay it via {@link nativePrompt}. The capture is wired
 * by {@link initA2hs}, called from the `(app)` layout so it runs before any
 * child component mounts. iOS has no install API, so there the engine only
 * reports `canInstall` and the sheet renders manual Share → Add to Home
 * Screen steps.
 */

/** Lifetime calls at/above which the primary install window opens. */
export const A2HS_PRIMARY_CALLS = 15;

/**
 * Fallback window: a returning visitor (`sessionCount >= 2`) who has placed
 * at least this many lifetime calls.
 */
export const A2HS_FALLBACK_CALLS = 10;
const A2HS_FALLBACK_SESSIONS = 2;

/** Re-ask no sooner than 14 days after a dismissal. */
export const A2HS_COOLOFF_MS = 14 * 24 * 60 * 60 * 1000;

const KEY_SESSIONS = 'vici.a2hs.sessions';
const KEY_DISMISSED = 'vici.a2hs.dismissed';
const KEY_INSTALLED = 'vici.a2hs.installed';
const KEY_SESSION_COUNTED = 'vici.a2hs.session-counted';
const KEY_SHOWN = 'vici.a2hs.shown';

export type A2hsPlatform = 'ios' | 'android' | 'desktop' | 'other';

/**
 * The deferred `beforeinstallprompt` event. Typed locally: it is not in
 * the standard `lib.dom` types, so we model the two members we use.
 */
interface BeforeInstallPromptEvent extends Event {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
	interface Window {
		/** Set by the early `beforeinstallprompt` listener in `app.html`; adopted by {@link initA2hs}. */
		__viciDeferredInstallPrompt?: BeforeInstallPromptEvent;
	}
}

interface A2hsState {
	/** A captured (deferred) Android `beforeinstallprompt` event, if any. */
	deferredPrompt: BeforeInstallPromptEvent | null;
	/** The app reported itself installed (`appinstalled`, accept, or persisted). */
	installed: boolean;
	/** Distinct-visit counter (persisted). */
	sessionCount: number;
}

const initialState: A2hsState = {
	deferredPrompt: null,
	installed: false,
	sessionCount: 0
};

const state = writable<A2hsState>(initialState);

/**
 * Set once the CTA flow has handled (and tracked) an accepted install, so
 * the global `appinstalled` listener, which can fire moments later for the
 * same install: skips its own `pwa_install_accepted` track and doesn't
 * double-count on Chrome/Android.
 */
let ctaInstallHandled = false;

/**
 * iOS detection: reuses the SAME facts the pre-paint `app.html` bootstrap
 * already computed and stamped on `<html>` (`data-ios`), so the two never
 * diverge. Falls back to the UA + iPadOS `maxTouchPoints` check only when
 * the attribute is absent (e.g. SSR or a stripped document).
 */
const detectIos = (): boolean => {
	if (!browser) {
		return false;
	}

	if (document.documentElement.hasAttribute('data-ios')) {
		return true;
	}

	const ua = navigator.userAgent || '';

	return (
		/iP(ad|hone|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
	);
};

/** Current install platform. iOS first (it has no install API), then Android. */
export const platform = (): A2hsPlatform => {
	if (!browser) {
		return 'other';
	}

	if (detectIos()) {
		return 'ios';
	}

	const ua = navigator.userAgent || '';

	if (/Android/i.test(ua)) {
		return 'android';
	}

	// A pointer-coarse, touch-capable viewport with no desktop pointer reads
	// as mobile-like; everything else is treated as desktop (never prompted).
	const coarse = nonNullish(window.matchMedia) && window.matchMedia('(pointer: coarse)').matches;

	return coarse ? 'other' : 'desktop';
};

/**
 * Whether the app is already running as an installed PWA. Mirrors the
 * `app.html` bootstrap: the legacy iOS-only `navigator.standalone` plus the
 * standard `display-mode: standalone` media query.
 */
export const isStandalone = (): boolean => {
	if (!browser) {
		return false;
	}

	const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
	const displayStandalone =
		nonNullish(window.matchMedia) && window.matchMedia('(display-mode: standalone)').matches;

	return iosStandalone || displayStandalone;
};

/** A mobile-like surface (iOS or Android): desktop is never prompted. */
export const isMobileLike = (): boolean => {
	const p = platform();

	return p === 'ios' || p === 'android';
};

/**
 * Reactive gate for the install surfaces (Settings row, FlowEnd row).
 * True when the app is not already installed/standalone and either it is
 * iOS (manual path) or an Android prompt has been captured.
 */
export const canInstall: Readable<boolean> = derived(state, ($state) => {
	if (!browser || $state.installed || isStandalone()) {
		return false;
	}

	if (platform() === 'ios') {
		return true;
	}

	return nonNullish($state.deferredPrompt);
});

/** Reactive distinct-visit counter. */
export const sessionCount: Readable<number> = derived(state, ($state) => $state.sessionCount);

/**
 * Trigger predicate for the contextual FlowEnd nudge. Primary window at
 * lifetime calls >= 15; fallback at >= 10 on a 2nd+ session. Always false
 * on desktop, when installed/standalone, in cool-off, or already shown this
 * session.
 */
export const shouldAutoPrompt = (calls: number): boolean => {
	if (!browser || !isMobileLike() || isStandalone() || get(state).installed) {
		return false;
	}

	if (storageHas({ key: KEY_INSTALLED }) || hasSessionFlag(KEY_SHOWN)) {
		return false;
	}

	const dismissedAtMs = storageGet<number>({ key: KEY_DISMISSED });

	if (nonNullish(dismissedAtMs) && Date.now() - dismissedAtMs < A2HS_COOLOFF_MS) {
		return false;
	}

	if (calls >= A2HS_PRIMARY_CALLS) {
		return true;
	}

	return get(state).sessionCount >= A2HS_FALLBACK_SESSIONS && calls >= A2HS_FALLBACK_CALLS;
};

/** Record a dismissal: starts the cool-off and marks this session shown. */
export const markDismissed = (): void => {
	storageSet({ key: KEY_DISMISSED, value: Date.now() });
	setSessionFlag(KEY_SHOWN);
};

/** Record an install: suppresses every future prompt. */
export const markInstalled = (): void => {
	storageSet({ key: KEY_INSTALLED, value: '1' });
	state.update((s) => ({ ...s, installed: true, deferredPrompt: null }));
};

/**
 * Fire the captured Android prompt. Resolves with the user's choice, or
 * `'unavailable'` when no prompt was captured (iOS, desktop, or a load
 * that never saw the event).
 */
export const nativePrompt = async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
	const deferred = get(state).deferredPrompt;

	if (isNullish(deferred)) {
		return 'unavailable';
	}

	// The captured event is single-use: clear it whatever the outcome.
	state.update((s) => ({ ...s, deferredPrompt: null }));

	try {
		await deferred.prompt();
		const { outcome } = await deferred.userChoice;

		if (outcome === 'accepted') {
			ctaInstallHandled = true;
			markInstalled();
		}

		return outcome;
	} catch {
		return 'unavailable';
	}
};

const hasSessionFlag = (key: string): boolean => {
	try {
		return browser && nonNullish(sessionStorage.getItem(key));
	} catch {
		return false;
	}
};

const setSessionFlag = (key: string): void => {
	try {
		sessionStorage.setItem(key, '1');
	} catch {
		// Private-mode / blocked storage: the flag is best-effort.
	}
};

/**
 * Bump the distinct-visit counter once per tab-session. Guards on a
 * sessionStorage flag so a within-tab navigation never double-counts.
 */
const countSession = (): void => {
	if (hasSessionFlag(KEY_SESSION_COUNTED)) {
		state.update((s) => ({ ...s, sessionCount: storageGet<number>({ key: KEY_SESSIONS }) ?? 0 }));

		return;
	}

	const next = (storageGet<number>({ key: KEY_SESSIONS }) ?? 0) + 1;
	storageSet({ key: KEY_SESSIONS, value: next });
	setSessionFlag(KEY_SESSION_COUNTED);
	state.update((s) => ({ ...s, sessionCount: next }));
};

let initialized = false;

/**
 * Wire the install listeners and seed persisted state. Idempotent and
 * browser-only. Chrome fires `beforeinstallprompt` once, early in page load,
 * before this runs, so the actual capture happens in an inline `app.html`
 * listener; here we adopt that pre-captured event (and keep a listener for any
 * later re-fire). Do not remove the `app.html` listener as "redundant".
 */
export const initA2hs = (): void => {
	if (!browser || initialized) {
		return;
	}

	initialized = true;

	if (storageHas({ key: KEY_INSTALLED }) || isStandalone()) {
		state.update((s) => ({ ...s, installed: true }));
	}

	countSession();

	// Adopt the event the early `app.html` listener captured before this store
	// initialised: `beforeinstallprompt` fires once during initial load, well
	// before the app layout calls `initA2hs`, so a listener registered only here
	// misses it and `canInstall` never flips true. Keep listening below for any
	// later re-fire.
	const earlyPrompt = window.__viciDeferredInstallPrompt;

	if (nonNullish(earlyPrompt)) {
		state.update((s) => ({ ...s, deferredPrompt: earlyPrompt }));
		// The store now owns the single-use event; drop the global so a stale
		// reference doesn't linger for the tab's lifetime.
		delete window.__viciDeferredInstallPrompt;
	}

	window.addEventListener('beforeinstallprompt', (event: Event) => {
		// Suppress Chrome's mini-infobar; we drive the install from our own UI.
		event.preventDefault();
		state.update((s) => ({ ...s, deferredPrompt: event as BeforeInstallPromptEvent }));
	});

	window.addEventListener('appinstalled', () => {
		// `appinstalled` can fire after the OS-level install completes, even
		// without our CTA (e.g. the browser's own menu), so close the funnel
		// here too. No `source`: this is platform-level, not a surface action.
		// Skip the track when the CTA flow already counted this install (it
		// fires `appinstalled` moments after an accepted prompt on Chrome).
		if (!ctaInstallHandled) {
			track({ name: 'pwa_install_accepted', label: platform() });
		}

		markInstalled();
	});
};
