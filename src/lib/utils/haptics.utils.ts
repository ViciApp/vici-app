import { preferencesStore } from '#lib/stores/preferences.store.ts';
import { get } from 'svelte/store';

// Named haptic patterns: single source of truth for VICI's
// touch-feedback vocabulary. Every motion moment has a paired
// haptic; the eight named patterns below are the full set.
//
// Call sites use the named pattern, not raw ms numbers: that
// keeps the vocabulary inspectable and avoids drift when a pattern
// needs to be retuned globally.
//
// Per the Web Vibration API: array entries alternate vibrate / pause
// (odd indexes are gaps, even indexes are buzzes). A pattern with N
// buzzes therefore has N + (N - 1) entries: never an even count
// ending in a pause.

export type HapticPattern =
	| 'light-tap'
	| 'soft-tick'
	| 'double-pulse'
	| 'triple-tap'
	| 'mischief'
	| 'soft-hum'
	| 'firm-tap'
	| 'low-thud'
	| 'celebration'
	| 'milestone-tap'
	| 'oracle-tap'
	| 'oracle-roll'
	| 'centurion'
	| 'vici-fanfare'
	| 'streak-ramp';

type HapticValue = number | readonly number[];

/**
 * Pattern definitions. Numbers are the same ms values you'd pass to
 * `navigator.vibrate` (single number = single buzz; array = pulse
 * sequence with alternating buzz / silence).
 */
export const HAPTIC_PATTERNS: Record<HapticPattern, HapticValue> = {
	// Background / ambient feedback. Very brief.
	'light-tap': 8,
	// Negative-state: skip, soft pass-through. Lighter than commit.
	'soft-tick': [4, 8],
	// Standard YES / NO commit on a routine swipe. Single firm beat.
	'firm-tap': 12,
	// Milestone double: bonus XP at swipe 10 / 50 / 250 / 1000.
	// vibrate 12 ms, pause 40 ms, vibrate 12 ms. Two beats.
	'double-pulse': [12, 40, 12],
	// First call + streak tier-up: strongest reusable pattern.
	// vibrate 12 / pause 40 / vibrate 18 / pause 40 / vibrate 14.
	// Three beats with a slight crescendo on the middle.
	'triple-tap': [12, 40, 18, 40, 14],
	// Trickster's signature: staccato, mischievous.
	mischief: [6, 20, 6, 20, 6],
	// Idle / Companion arrival: longer, smoother. Reads as ambient.
	'soft-hum': [40],
	// Streak break: single low buzz, honest, no warmth.
	'low-thud': 28,
	// Session complete celebration: distinct envelope from the
	// within-session beats. Lives in the same vocabulary so call
	// sites stay consistent.
	celebration: [14, 30, 20, 30, 40],
	// Mid-tier milestone beat: used at 10 / 250 / 500 swipes + streak
	// tier-up. `[25, 30, 25]`.
	'milestone-tap': [25, 30, 25],
	// Oracle's first-leaderboard arrival: `[40, 60, 40]`.
	'oracle-tap': [40, 60, 40],
	// Oracle's 50-swipe roll: `[25, 30, 25, 40, 60]`.
	'oracle-roll': [25, 30, 25, 40, 60],
	// Centurion (100 swipes): `[12, 30, 12, 30, 12, 30, 60]`.
	centurion: [12, 30, 12, 30, 12, 30, 60],
	// Vici 1000 fanfare: `[40, 30, 40, 30, 80]`.
	'vici-fanfare': [40, 30, 40, 30, 80],
	// Streak ramp-up beat (multi-stage flame escalation):
	// `[40, 60, 40, 60, 80]`.
	'streak-ramp': [40, 60, 40, 60, 80]
};

/**
 * Android vibration floor. Most Android motors (ERM, and many LRA)
 * can't render a buzz shorter than ~20 ms: the motor barely spins up
 * before it's told to stop, so the crisp sub-20 ms taps our vocabulary
 * leans on are inaudible to the hand even though `navigator.vibrate`
 * dutifully returns `true`. We raise every *buzz* up to this floor on
 * Android so the feedback is actually felt. iOS Safari has no
 * Vibration API at all (sound is its only channel), so this never
 * affects it; non-Android UAs keep the original crisp values.
 */
export const ANDROID_BUZZ_FLOOR_MS = 25;

/** True on Android UAs, where the buzz floor above applies. */
export const isAndroid = (): boolean =>
	typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);

/**
 * Raise sub-floor *buzzes* to {@link ANDROID_BUZZ_FLOOR_MS}, leaving
 * pauses untouched. Per the Web Vibration API an array alternates
 * buzz / pause starting with a buzz, so even indexes are buzzes (and a
 * lone number is a single buzz). Exported so the diagnostics page can
 * show the resolved envelope.
 */
export const applyAndroidFloor = (value: HapticValue): number | number[] => {
	if (typeof value === 'number') {
		return Math.max(value, ANDROID_BUZZ_FLOOR_MS);
	}

	return value.map((ms, i) => (i % 2 === 0 ? Math.max(ms, ANDROID_BUZZ_FLOOR_MS) : ms));
};

/**
 * Best-effort haptic. Safe to call from server-rendered or
 * iOS-Safari contexts (where `navigator.vibrate` doesn't exist):
 * silently no-ops and never throws.
 *
 * Use the named pattern, not raw ms: see file header for why.
 */
export const haptic = (pattern: HapticPattern): void => {
	if (!get(preferencesStore).hapticsEnabled) {
		return;
	}

	if (typeof navigator === 'undefined' || !('vibrate' in navigator)) {
		return;
	}

	const value = HAPTIC_PATTERNS[pattern];

	try {
		navigator.vibrate(isAndroid() ? applyAndroidFloor(value) : (value as number | number[]));
	} catch {
		// Vibration API can throw on hostile UA shims (e.g. some
		// in-app browsers). The feedback is non-essential: swallow.
	}
};

// Swipe-count milestone → haptic pattern. Keyed by the exact
// committed-swipe count that triggers a `milestone-<n>` beat.
const MILESTONE_HAPTIC: Record<number, HapticPattern> = {
	1: 'triple-tap',
	3: 'firm-tap',
	5: 'firm-tap',
	10: 'milestone-tap',
	25: 'firm-tap',
	100: 'centurion',
	500: 'milestone-tap',
	1000: 'vici-fanfare'
};

/**
 * Maps a Flow-Mode beat kind to its haptic pattern name. Returns
 * `null` for an absent beat. The pattern names below resolve to their
 * ms envelopes via `HAPTIC_PATTERNS` above, the single source of
 * truth, so this mapping intentionally names patterns only and never
 * restates the ms arrays.
 *
 *   volume-1               → triple-tap (the welcome first call)
 *   volume-10              → milestone-tap
 *   volume-25              → firm-tap
 *   volume-100             → centurion
 *   volume-500             → milestone-tap
 *   volume-1000            → vici-fanfare
 *   daily / overtime-complete → oracle-roll (the streak beat)
 *   comeback               → triple-tap
 *   ot-11 / wildcard       → mischief (Trickster signature)
 *   ot-13                  → firm-tap
 *   first-yes / first-no   → triple-tap
 *   first-contrarian       → mischief
 *   first-leaderboard      → oracle-tap
 *   daily-<n> (rhythm)     → firm-tap
 *   ambient-10             → firm-tap
 */
export const hapticForBeat = (beatKind: string | undefined): HapticPattern | null => {
	if (!beatKind) {
		return null;
	}

	// Lifetime-volume milestones share the swipe-count haptic ladder.
	if (beatKind.startsWith('volume-')) {
		const n = Number(beatKind.slice('volume-'.length));

		return MILESTONE_HAPTIC[n] ?? 'double-pulse';
	}

	// Within-day rhythm pacing beats (`daily-2` … `daily-9`) are light.
	if (beatKind.startsWith('daily-') && beatKind !== 'daily-complete') {
		return 'firm-tap';
	}

	switch (beatKind) {
		case 'first-yes':
		case 'first-no':
		case 'comeback':
			return 'triple-tap';
		case 'first-contrarian':
		case 'ot-11':
		case 'wildcard':
			return 'mischief';
		case 'first-leaderboard':
			return 'oracle-tap';
		case 'daily-complete':
		case 'overtime-complete':
			return 'oracle-roll';
		case 'ot-13':
			return 'firm-tap';
		case 'ambient-10':
			return 'firm-tap';
		default:
			return 'double-pulse';
	}
};
