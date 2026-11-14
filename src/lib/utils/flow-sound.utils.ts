import { preferencesStore } from '#lib/stores/preferences.store.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import { get } from 'svelte/store';

// Flow sound: a tiny Web Audio oscillator synth that gives Flow its
// tactile-adjacent feedback. On the web this matters more than haptics:
// iOS Safari has no Vibration API, so SOUND is the only feedback iOS
// users get. The AudioContext is lazy-initialised on the first cue
// (autoplay policy: the context can only be created/resumed inside a
// user gesture, and every Flow cue originates from a swipe) and the
// whole module no-ops gracefully where Web Audio is unavailable
// (SSR, hostile in-app browsers): it never throws.
//
// Call sites use the named cue (`flowTick`, `flowBeat`, `flowWild`,
// `flowSummary`), not raw oscillator math: that keeps the vocabulary
// inspectable and pairs each sound with its motion / haptic moment.
//
// The four cues are the full set:
//   tick: every committed call (per-swipe)
//   beat(hard): milestone beat; `hard` plays a bigger two-note figure
//   wild: wildcard treat (ascending arpeggio)
//   summary: session end (rising four-note chord)

// Minimal structural type for the prefixed AudioContext on older WebKit.
interface WebAudioWindow {
	AudioContext?: typeof AudioContext;
	webkitAudioContext?: typeof AudioContext;
}

let audioContext: AudioContext | null = null;

/**
 * Construct (or return) the shared AudioContext without consulting the
 * sound preference. Used by the gesture unlock, which must prime the
 * hardware route even while muted so a later un-mute plays immediately.
 * Returns `null` on SSR or where Web Audio is unavailable.
 */
const ensureContext = (): AudioContext | null => {
	if (typeof window === 'undefined') {
		return null;
	}

	const Ctor =
		(window as WebAudioWindow).AudioContext ?? (window as WebAudioWindow).webkitAudioContext;

	if (isNullish(Ctor)) {
		return null;
	}

	// A cached context can move to `closed` over its lifetime (OS/UA audio
	// lifecycle, e.g. the page is backgrounded and the route is reclaimed).
	// A closed context never plays again, so drop the reference and let the
	// next gesture/cue construct a fresh one.
	if (nonNullish(audioContext) && audioContext.state === 'closed') {
		audioContext = null;
	}

	if (isNullish(audioContext)) {
		try {
			audioContext = new Ctor();
		} catch {
			// Construction can throw if the document hasn't had a user
			// gesture yet, or on UA shims. Non-essential feedback: bail.
			return null;
		}
	}

	return audioContext;
};

/**
 * Resolve the shared AudioContext, lazily creating it on first use and
 * resuming it if the browser has parked it in the `suspended` state
 * (autoplay policy). Returns `null`, and the caller no-ops, when sound
 * is disabled in preferences or Web Audio is unavailable.
 */
const audio = (): AudioContext | null => {
	if (!get(preferencesStore).soundEnabled) {
		return null;
	}

	const context = ensureContext();

	if (isNullish(context)) {
		return null;
	}

	if (context.state === 'suspended') {
		// Resume may reject without a user gesture; catch the async rejection
		// so it never surfaces as an unhandled promise rejection. The next
		// cue retries.
		void context.resume().catch(() => undefined);
	}

	return context;
};

type OscillatorKind = 'sine' | 'triangle' | 'square';

interface ToneSpec {
	/** Oscillator frequency in Hz. */
	freq: number;
	/** Total tone duration in seconds. */
	dur: number;
	/** Oscillator waveform. */
	type: OscillatorKind;
	/** Peak gain (0–1). The envelope ramps up to this then decays. */
	vol: number;
	/** Start offset in seconds from "now": sequences notes within a cue. */
	when?: number;
}

/**
 * Play a single enveloped tone. The gain envelope is a fast 12 ms linear
 * attack to `vol` followed by an exponential decay to silence over
 * `dur`, which reads as a soft pluck rather than a click. Best-effort:
 * swallows any Web Audio exception so a failed cue never bubbles into
 * the swipe handler.
 */
const tone = ({ freq, dur, type, vol, when = 0 }: ToneSpec): void => {
	const context = audio();

	if (isNullish(context)) {
		return;
	}

	try {
		const start = context.currentTime + when;
		const oscillator = context.createOscillator();
		const gain = context.createGain();

		oscillator.type = type;
		oscillator.frequency.value = freq;

		gain.gain.setValueAtTime(0.0001, start);
		gain.gain.linearRampToValueAtTime(vol, start + 0.012);
		gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);

		oscillator.connect(gain);
		gain.connect(context.destination);

		oscillator.start(start);
		oscillator.stop(start + dur + 0.03);
	} catch {
		// AudioContext can throw on hostile UA shims or after the context
		// has been closed. The feedback is non-essential: swallow.
	}
};

/**
 * Per-swipe cue: fired on every committed call. A brief, dry triangle
 * tick that sits under the swipe without drawing attention.
 */
export const flowTick = (): void => {
	tone({ freq: 430, dur: 0.05, type: 'triangle', vol: 0.04 });
};

/**
 * Milestone beat cue. The default beat is a single warm sine note; a
 * `hard` beat (bigger milestone / hard-pause) plays a two-note rising
 * figure with the upper note layered in after 100 ms.
 */
export const flowBeat = (hard = false): void => {
	if (hard) {
		tone({ freq: 523, dur: 0.13, type: 'sine', vol: 0.07 });
		tone({ freq: 784, dur: 0.2, type: 'sine', vol: 0.06, when: 0.1 });

		return;
	}

	tone({ freq: 620, dur: 0.11, type: 'sine', vol: 0.05 });
};

/**
 * Wildcard-treat cue: a quick ascending three-note arpeggio (square →
 * square → triangle) that reads as a playful "bonus".
 */
export const flowWild = (): void => {
	tone({ freq: 680, dur: 0.07, type: 'square', vol: 0.04 });
	tone({ freq: 1020, dur: 0.09, type: 'square', vol: 0.04, when: 0.07 });
	tone({ freq: 1360, dur: 0.12, type: 'triangle', vol: 0.04, when: 0.14 });
};

/**
 * Session-summary cue: a rising four-note sine chord (C5·E5·G5·C6)
 * staggered 110 ms apart, played when a Flow session completes.
 */
export const flowSummary = (): void => {
	[523, 659, 784, 1047].forEach((freq, index) => {
		tone({ freq, dur: 0.34, type: 'sine', vol: 0.065, when: index * 0.11 });
	});
};

/**
 * Resume the shared AudioContext if it exists and is suspended. Called
 * when sound is re-enabled: re-enabling happens from a tap (a gesture),
 * so resuming here lets the very next cue play without waiting for
 * another interaction. No-op when no context has been created yet.
 */
export const resumeFlowSound = (): void => {
	if (nonNullish(audioContext) && audioContext.state === 'suspended') {
		void audioContext.resume().catch(() => undefined);
	}
};

// Gesture-unlock events tried in order of likelihood across UAs. Captured
// (capture: true) so we observe the gesture even when a child stops
// propagation, and `once`-free so iOS Chrome, which can need a couple of
// gestures before the context actually leaves `suspended`, gets retried.
const UNLOCK_EVENTS = ['pointerdown', 'touchend', 'touchstart', 'mousedown', 'keydown'] as const;

/**
 * Arm a one-time, self-removing user-gesture listener that unlocks iOS
 * Web Audio.
 *
 * WebKit (Safari and *every* browser on iOS, plus all WKWebViews) only
 * starts the audio hardware route when the AudioContext is resumed AND a
 * buffer is played from inside a real user gesture. Most Flow cues fire
 * from deferred timers (character beats, the session summary), which are
 * not gestures: so resuming lazily at play-time unlocks lenient Safari
 * but not strict iOS Chrome. Priming once on the first gesture makes
 * every later deferred cue audible.
 *
 * Returns a teardown that removes the listeners; callers wire it through
 * an `$effect` so the registration is leak-free. SSR-safe: returns a
 * no-op teardown when there is no `window` or no Web Audio.
 */
export const unlockFlowSound = (): (() => void) => {
	if (typeof window === 'undefined') {
		return () => undefined;
	}

	const tryUnlock = (): void => {
		// Always create + resume + play a silent buffer inside the gesture:
		// this is what actually unlocks the hardware route on iOS WebKit. Runs
		// even when muted so a later un-mute works without a fresh gesture.
		const context = ensureContext();

		if (isNullish(context)) {
			teardown();

			return;
		}

		if (context.state === 'suspended') {
			void context.resume().catch(() => undefined);
		}

		try {
			const source = context.createBufferSource();
			source.buffer = context.createBuffer(1, 1, context.sampleRate); // one sample of silence
			source.connect(context.destination);
			source.start(); // immediate: avoids past-time scheduling quirks
		} catch {
			// Best-effort priming: swallow on hostile UA shims.
		}

		// Once the context is actually running we're done. If it's still
		// suspended (some iOS Chrome cases need another gesture) keep the
		// listeners armed so the next gesture retries.
		if (context.state === 'running') {
			teardown();
		}
	};

	// These fire on high-frequency input events and the handler never calls
	// `preventDefault`, so mark them passive to keep scrolling/tapping
	// jank-free. `capture` must match between add and remove for the
	// listener to actually detach: share one options object for both.
	const listenerOptions: AddEventListenerOptions = { capture: true, passive: true };

	const teardown = (): void => {
		UNLOCK_EVENTS.forEach((event) => {
			window.removeEventListener(event, tryUnlock, listenerOptions);
		});
	};

	UNLOCK_EVENTS.forEach((event) => {
		window.addEventListener(event, tryUnlock, listenerOptions);
	});

	return teardown;
};
