// Flow motion engine — lifetime swipe state + beat resolver.
//
// A swipe in Flow PLACES a call; it does not resolve one. Markets
// settle on their own dates, elsewhere. So this engine never sees a
// "correct" signal and never moves accuracy or win/loss. It rewards
// the ACT of calling and the discipline of showing up.
//
// Design highlights (see `docs/ai/frontend/design.md` §7):
//   • Copy is a rotating POOL per slot — never the same line twice
//     running, persisted so a daily user gets variation session to
//     session. Pools hold i18n keys, not literals, so every line still
//     resolves through `t()`.
//   • Within-day rhythm beats fire on JITTERED positions (a window, not
//     a fixed slot) so the cadence is never memorised.
//   • Deflation-safe VXP economy: dopamine is not currency. The daily
//     ten mints nothing; VXP is minted only at the overtime finish (+25)
//     and rare lifetime milestones (10 → +50 … 1,000 → +500). Growth
//     comes from being right, not showing up.
//   • Credit-STACKING: if a milestone coincides with the daily-complete
//     beat, BOTH bonuses are credited even though one beat animates.
//   • Wildcard — a rare (~1 in 6) variable-ratio surprise carrying a
//     non-currency TREAT (sticker / shield / flair), never VXP.
//   • Comeback — a distinct, no-shame opener for a user returning after
//     a broken streak, separate from the daily "welcome back".
//   • Single-pass priority resolver — never two beats back to back.

import { DAILY_HARD_CAP } from '#lib/constants/flow-rewards.constants.ts';
import type { FlowAction } from '#lib/types/market.ts';
import type { MessageKey } from '#lib/utils/i18n.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';

const STORAGE_KEY = 'vici.motion.state.v3';

// ── Streak tiers ──────────────────────────────────────────────────
// Mirrors `stageForStreak` (streak.utils) but adds the NONE floor the
// beat resolver needs for "tier did not advance". Thresholds:
// NONE 0 · SPARK 1 · EMBER 3 · FLAME 7 · BLAZE 15 · INFERNO 30.
export type MotionStreakTier = 'NONE' | 'SPARK' | 'EMBER' | 'FLAME' | 'BLAZE' | 'INFERNO';

export const tierForStreak = (days: number): MotionStreakTier => {
	if (days >= 30) {
		return 'INFERNO';
	}

	if (days >= 15) {
		return 'BLAZE';
	}

	if (days >= 7) {
		return 'FLAME';
	}

	if (days >= 3) {
		return 'EMBER';
	}

	if (days >= 1) {
		return 'SPARK';
	}

	return 'NONE';
};

export type MotionCharacter = 'vici' | 'oracle' | 'trickster' | 'flame';

// ── Copy pools — rotating, non-repeating. Each entry is an i18n key so
// the line resolves through `t()`; the engine only chooses WHICH key,
// never the literal text. Single-entry pools are still arrays so the
// picker is uniform.
type PoolKey =
	| 'first-call'
	| 'daily-ten'
	| 'overtime-15'
	| 'ot-enter'
	| 'ot-rare'
	| 'first-yes'
	| 'first-no'
	| 'first-contra'
	| 'r3'
	| 'r5'
	| 'r8'
	| 'welcome-back'
	| 'comeback'
	| 'wildcard'
	| 'streak-reborn'
	| 'first-leaderboard';

const POOLS: Record<PoolKey, readonly MessageKey[]> = {
	'first-call': [
		'motion.pool.first_call_1',
		'motion.pool.first_call_2',
		'motion.pool.first_call_3',
		'motion.pool.first_call_4'
	],
	'daily-ten': ['motion.pool.daily_ten_1', 'motion.pool.daily_ten_2', 'motion.pool.daily_ten_3'],
	'overtime-15': [
		'motion.pool.overtime_15_1',
		'motion.pool.overtime_15_2',
		'motion.pool.overtime_15_3'
	],
	'ot-enter': ['motion.pool.ot_enter_1', 'motion.pool.ot_enter_2', 'motion.pool.ot_enter_3'],
	'ot-rare': ['motion.pool.ot_rare_1', 'motion.pool.ot_rare_2', 'motion.pool.ot_rare_3'],
	'first-yes': ['motion.pool.first_yes_1', 'motion.pool.first_yes_2', 'motion.pool.first_yes_3'],
	'first-no': ['motion.pool.first_no_1', 'motion.pool.first_no_2', 'motion.pool.first_no_3'],
	'first-contra': [
		'motion.pool.first_contra_1',
		'motion.pool.first_contra_2',
		'motion.pool.first_contra_3'
	],
	r3: ['motion.pool.r3_1', 'motion.pool.r3_2', 'motion.pool.r3_3'],
	r5: ['motion.pool.r5_1', 'motion.pool.r5_2', 'motion.pool.r5_3', 'motion.pool.r5_4'],
	r8: ['motion.pool.r8_1', 'motion.pool.r8_2', 'motion.pool.r8_3', 'motion.pool.r8_4'],
	'welcome-back': [
		'motion.pool.welcome_back_1',
		'motion.pool.welcome_back_2',
		'motion.pool.welcome_back_3',
		'motion.pool.welcome_back_4',
		'motion.pool.welcome_back_5'
	],
	comeback: [
		'motion.pool.comeback_1',
		'motion.pool.comeback_2',
		'motion.pool.comeback_3',
		'motion.pool.comeback_4'
	],
	wildcard: [
		'motion.pool.wildcard_1',
		'motion.pool.wildcard_2',
		'motion.pool.wildcard_3',
		'motion.pool.wildcard_4'
	],
	'streak-reborn': [
		'motion.pool.streak_reborn_1',
		'motion.pool.streak_reborn_2',
		'motion.pool.streak_reborn_3'
	],
	'first-leaderboard': ['motion.pool.first_leaderboard_1']
};

// Non-currency wildcard rewards. The chosen key is surfaced as the beat's
// `treatKey` in the payload only — the engine does not persist it. Callers
// are responsible for crediting the treat to the user; a dedicated treats
// store does not exist yet and is a follow-up concern.
export const TREAT_KEYS: readonly MessageKey[] = [
	'motion.treat.rare_sticker',
	'motion.treat.streak_shield',
	'motion.treat.profile_flair',
	'motion.treat.mystery_drop'
];

// ── Lifetime call-volume milestones ───────────────────────────────
// VXP minted from the 10-call mark up; each milestone fires ONCE ever.
// 1 · 25 are moment-only (no VXP). Oracle owns the ladder from 10; Vici
// welcomes the very first call.
interface VolumeMilestone {
	bonus: number;
	character: MotionCharacter;
	// `pool` resolves through the rotating picker; `copyKey` is a fixed
	// single line. Exactly one is set per milestone.
	pool?: PoolKey;
	copyKey?: MessageKey;
	subKey: MessageKey;
	duration_ms: number;
	haptic: number | number[];
	badgeKey?: MessageKey;
	titleCharacter?: MotionCharacter;
}

const VOLUME: Record<number, VolumeMilestone> = {
	1: {
		bonus: 0,
		character: 'vici',
		pool: 'first-call',
		subKey: 'motion.sub.first_call',
		duration_ms: 1900,
		haptic: [12, 30, 12, 30, 12]
	},
	10: {
		bonus: 50,
		character: 'oracle',
		copyKey: 'motion.volume.ten',
		subKey: 'motion.sub.lifetime_10',
		duration_ms: 1300,
		haptic: [25, 30, 25]
	},
	25: {
		bonus: 0,
		character: 'oracle',
		copyKey: 'motion.volume.twenty_five',
		subKey: 'motion.sub.lifetime_25',
		duration_ms: 1200,
		haptic: 12
	},
	100: {
		bonus: 100,
		character: 'oracle',
		copyKey: 'motion.volume.hundred',
		subKey: 'motion.sub.lifetime_100',
		duration_ms: 1700,
		haptic: [12, 30, 12, 30, 12, 30, 60],
		badgeKey: 'motion.badge.centurion'
	},
	500: {
		bonus: 250,
		character: 'oracle',
		copyKey: 'motion.volume.five_hundred',
		subKey: 'motion.sub.lifetime_500',
		duration_ms: 1500,
		haptic: [25, 30, 25]
	},
	1000: {
		bonus: 500,
		character: 'oracle',
		copyKey: 'motion.volume.thousand',
		subKey: 'motion.sub.lifetime_1000',
		duration_ms: 2000,
		haptic: [40, 30, 40, 30, 80],
		titleCharacter: 'vici'
	}
};

// ── Within-day rhythm — pacing only, NO bonus. Each soft beat fires
// somewhere inside its WINDOW (jittered per day), not on a fixed call
// number.
interface RhythmBeat {
	window: readonly [number, number];
	character: MotionCharacter;
	pool: PoolKey;
	duration_ms: number;
	haptic: number;
}

type RhythmKey = 'r3' | 'r5' | 'r8';

const RHYTHM: Record<RhythmKey, RhythmBeat> = {
	r3: { window: [2, 4], character: 'vici', pool: 'r3', duration_ms: 700, haptic: 12 },
	r5: { window: [4, 6], character: 'vici', pool: 'r5', duration_ms: 750, haptic: 12 },
	r8: { window: [7, 9], character: 'vici', pool: 'r8', duration_ms: 700, haptic: 12 }
};

// Overtime rhythm (calls 11 & 13) — fixed; the overtime push is a short,
// special arc.
interface OvertimeBeat {
	character: MotionCharacter;
	pool: PoolKey;
	subKey?: MessageKey;
	duration_ms: number;
	haptic: number | number[];
}

const OT_RHYTHM: Record<number, OvertimeBeat> = {
	11: {
		character: 'trickster',
		pool: 'ot-enter',
		subKey: 'motion.sub.overtime',
		duration_ms: 1300,
		haptic: [10, 40, 10]
	},
	13: { character: 'trickster', pool: 'ot-rare', duration_ms: 900, haptic: 12 }
};

// Daily hard cap — the daily-ten / overtime cadence never schedules a
// rhythm beat beyond this many calls in a single day. The constant lives
// in a dependency-free constants module so the satellite can own it too;
// re-exported here so the motion engine's existing importers are unchanged.
export { DAILY_HARD_CAP };

// ── Beat payload — consumed by `MotionBeat.svelte`. Copy is carried as
// an i18n key (`copyKey`); the chips/labels (`treatKey`, `subKey`,
// `badgeKey`) are keys too. `coin` is true when a VXP grant rides along.
export interface MotionBeatPayload {
	kind: string;
	character: MotionCharacter;
	copyKey: MessageKey | null;
	subKey?: MessageKey;
	treatKey?: MessageKey;
	badgeKey?: MessageKey;
	// A custom title was unlocked (rendered as a generic "title unlocked"
	// chip); the value names the character whose title it is.
	titleCharacter?: MotionCharacter;
	// Flame stage to render when `character === 'flame'`.
	tier?: MotionStreakTier;
	// Lifetime call count, surfaced by volume milestones for count-up.
	count?: number;
	duration_ms: number;
	haptic: number | number[];
	bonusXp: number;
}

export interface MotionSwipeInput {
	side: FlowAction;
	isContrarian?: boolean;
	// Calls done today INCLUDING this one (1-based), capped at target.
	dailyDone: number;
	// Today's goal (10 normally, 15 in overtime).
	dailyTarget: number;
	// True only on the swipe that crosses the daily goal.
	dailyJustCompleted: boolean;
	// Streak day-count this swipe lands on (already bumped by the caller).
	dayStreak: number;
	firstLeaderboard?: boolean;
	wildcards?: boolean;
	isComeback?: boolean;
	// REAL lifetime call count from the profile (`me.calls`), BEFORE this
	// swipe. When supplied, it seeds the engine's count as a FLOOR — the
	// engine uses whichever is larger, this or its own persisted tally,
	// since the profile count can lag behind in-session activity.
	lifetimeCalls?: number;
}

export interface MotionSwipeResult {
	bonusXp: number;
	beat: MotionBeatPayload | null;
}

interface MotionLifetime {
	calls: number;
	yes: number;
	no: number;
	skips: number;
}

interface MotionFlags {
	firstYes: boolean;
	firstNo: boolean;
	firstContrarian: boolean;
	firstLeaderboard: boolean;
}

interface MotionDay {
	// Jittered rhythm schedule for the current day: callNo → rhythm key.
	sched: Partial<Record<number, RhythmKey>> | null;
	// Last `dailyDone` seen, to detect a fresh day.
	last: number;
}

interface MotionState {
	lifetime: MotionLifetime;
	flags: MotionFlags;
	dayTier: MotionStreakTier;
	// pool key → last index shown (non-repeat).
	seen: Partial<Record<PoolKey, number>>;
	day: MotionDay;
}

const defaultState = (): MotionState => ({
	lifetime: { calls: 0, yes: 0, no: 0, skips: 0 },
	flags: { firstYes: false, firstNo: false, firstContrarian: false, firstLeaderboard: false },
	dayTier: 'NONE',
	seen: {},
	day: { sched: null, last: 0 }
});

const loadState = (): MotionState => {
	if (typeof localStorage === 'undefined') {
		return defaultState();
	}

	try {
		const raw = localStorage.getItem(STORAGE_KEY);

		if (!raw) {
			return defaultState();
		}

		const parsed = JSON.parse(raw) as Partial<MotionState>;
		const base = defaultState();

		return {
			...base,
			...parsed,
			lifetime: { ...base.lifetime, ...parsed.lifetime },
			flags: { ...base.flags, ...parsed.flags },
			dayTier: parsed.dayTier ?? base.dayTier,
			seen: { ...parsed.seen },
			day: { ...base.day, ...parsed.day }
		};
	} catch {
		return defaultState();
	}
};

const saveState = (state: MotionState): void => {
	if (typeof localStorage === 'undefined') {
		return;
	}

	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		// Best-effort persistence only.
	}
};

// Pick a pool entry, never repeating the last one shown for that key.
// eslint-disable-next-line local-rules/prefer-object-params -- threads the mutable state object + key positionally at every resolver call site
const pick = (state: MotionState, key: PoolKey): MessageKey => {
	const arr = POOLS[key];

	if (arr.length === 1) {
		return arr[0];
	}

	const last = state.seen[key];
	let i: number;

	do {
		i = Math.floor(Math.random() * arr.length);
	} while (i === last);

	state.seen[key] = i;

	return arr[i];
};

// Build a jittered rhythm schedule for a fresh day: each rhythm beat
// lands on a random call within its window, collisions avoided.
const buildSchedule = (): Partial<Record<number, RhythmKey>> => {
	const out: Partial<Record<number, RhythmKey>> = {};
	const used: Record<number, boolean> = {};
	const keys: RhythmKey[] = ['r3', 'r5', 'r8'];

	keys.forEach((k) => {
		const [lo, hi] = RHYTHM[k].window;
		const opts: number[] = [];

		for (let p = lo; p <= hi; p++) {
			if (!used[p]) {
				opts.push(p);
			}
		}

		const pos = opts.length > 0 ? opts[Math.floor(Math.random() * opts.length)] : lo;
		used[pos] = true;
		out[pos] = k;
	});

	return out;
};

/**
 * Records a committed swipe and returns credit-stacked bonus VXP plus an
 * optional single beat (highest priority wins; never two back to back).
 * Pure aside from `localStorage` persistence of the rotating-copy / day
 * schedule / first-flag state — no DOM, no network.
 */
export const recordMotionSwipe = (input: MotionSwipeInput): MotionSwipeResult => {
	const {
		side,
		isContrarian = false,
		dailyDone,
		dailyTarget,
		dailyJustCompleted,
		dayStreak,
		firstLeaderboard = false,
		wildcards = true,
		isComeback = false,
		lifetimeCalls
	} = input;

	const state = loadState();

	// SKIP — skims past a market; no call placed, no beat, no streak progress.
	if (side === 'SKIP') {
		state.lifetime.skips += 1;
		saveState(state);

		return { bonusXp: 0, beat: null };
	}

	state.lifetime.calls += 1;

	if (side === 'YES') {
		state.lifetime.yes += 1;
	} else {
		state.lifetime.no += 1;
	}

	// Lifetime call number for THIS swipe: the larger of the app's REAL
	// count (`lifetimeCalls + 1`) and the engine's persisted tally. The
	// profile count is recomputed from trade history on profile syncs —
	// not bumped per swipe — so within a session it lags behind and, taken
	// alone, would pin `calls` at the same number swipe after swipe and
	// re-fire that milestone (e.g. "first call") on every card. The local
	// tally (already incremented above) is strictly monotonic, so the max
	// of the two advances every swipe while still snapping up to the true
	// number when the profile is ahead (fresh device / cleared storage).
	const calls = nonNullish(lifetimeCalls)
		? Math.max(lifetimeCalls + 1, state.lifetime.calls)
		: state.lifetime.calls;

	// Write the merged count back so the persisted tally stays the
	// high-water mark across this device's sessions.
	state.lifetime.calls = calls;
	const target = dailyTarget > 0 ? dailyTarget : 10;
	const overtime = target >= DAILY_HARD_CAP;

	// New day → fresh jittered rhythm schedule. (dailyDone resets to 1 each day.)
	if (dailyDone <= 1 || dailyDone < state.day.last) {
		state.day.sched = buildSchedule();
	}

	state.day.last = dailyDone;
	state.day.sched ??= buildSchedule();

	let bonusXp = 0; // credit-stacked across all eligible sources
	let beat: MotionBeatPayload | null = null; // only the highest-priority beat animates

	const withBonus = (b: Omit<MotionBeatPayload, 'bonusXp'>): MotionBeatPayload => ({
		...b,
		bonusXp
	});

	// ── Comeback opener (after a lapse) — owns the first call of the day ──
	if (isComeback && dailyDone === 1) {
		beat = {
			kind: 'comeback',
			character: 'vici',
			copyKey: pick(state, 'comeback'),
			subKey: 'motion.sub.comeback',
			duration_ms: 1700,
			haptic: [12, 30, 12, 30, 12],
			bonusXp: 0
		};
	}

	// ── 1. Daily / overtime complete — the streak beat (showing up) ──
	if (dailyJustCompleted) {
		const tier = tierForStreak(dayStreak > 0 ? dayStreak : 1);
		state.dayTier = tier;
		const renderTier: MotionStreakTier = tier === 'NONE' ? 'SPARK' : tier;

		if (overtime) {
			bonusXp += 25; // the ONLY repeatable mint — the overtime finish

			beat ??= {
				kind: 'overtime-complete',
				character: 'flame',
				tier: renderTier,
				copyKey: pick(state, 'overtime-15'),
				subKey: 'motion.sub.overtime_complete',
				duration_ms: 1900,
				haptic: [25, 30, 25, 40, 60],
				bonusXp: 25
			};
		} else {
			// Regular daily ten — celebration + streak, but NO VXP (deflation-safe).
			beat ??= {
				kind: 'daily-complete',
				character: 'flame',
				tier: renderTier,
				copyKey: isComeback ? pick(state, 'streak-reborn') : pick(state, 'daily-ten'),
				subKey: isComeback ? 'motion.sub.streak_restarted' : 'motion.sub.streak_plus_one',
				duration_ms: 1900,
				haptic: [25, 30, 25, 40, 60],
				bonusXp: 0
			};
		}
	}

	// ── 2. Lifetime volume milestone — VXP credited even if it coincides ──
	const milestone = VOLUME[calls];

	if (nonNullish(milestone)) {
		bonusXp += milestone.bonus;

		beat ??= withBonus({
			kind: `volume-${calls}`,
			character: milestone.character,
			copyKey: nonNullish(milestone.pool)
				? pick(state, milestone.pool)
				: (milestone.copyKey ?? null),
			subKey: milestone.subKey,
			badgeKey: milestone.badgeKey,
			titleCharacter: milestone.titleCharacter,
			count: calls,
			duration_ms: milestone.duration_ms,
			haptic: milestone.haptic
		});
	}

	// ── 3. Overtime rhythm (calls 11 & 13) ──
	if (isNullish(beat) && overtime) {
		const ot = OT_RHYTHM[dailyDone];

		if (nonNullish(ot)) {
			beat = {
				kind: `ot-${dailyDone}`,
				character: ot.character,
				copyKey: pick(state, ot.pool),
				subKey: ot.subKey,
				duration_ms: ot.duration_ms,
				haptic: ot.haptic,
				bonusXp: 0
			};
		}
	}

	// ── 4. First-position events — a stance taken, not an outcome ──
	// Deferred past call #1 so "first-call" owns the very first swipe.
	if (isNullish(beat) && calls > 1) {
		if (side === 'YES' && !state.flags.firstYes) {
			state.flags.firstYes = true;
			beat = {
				kind: 'first-yes',
				character: 'vici',
				copyKey: pick(state, 'first-yes'),
				duration_ms: 900,
				haptic: [12, 30, 12],
				bonusXp: 0
			};
		} else if (side === 'NO' && !state.flags.firstNo) {
			state.flags.firstNo = true;
			beat = {
				kind: 'first-no',
				character: 'vici',
				copyKey: pick(state, 'first-no'),
				duration_ms: 900,
				haptic: [12, 30, 12],
				bonusXp: 0
			};
		} else if (isContrarian && !state.flags.firstContrarian) {
			state.flags.firstContrarian = true;
			beat = {
				kind: 'first-contrarian',
				character: 'trickster',
				copyKey: pick(state, 'first-contra'),
				subKey: 'motion.sub.contrarian',
				badgeKey: 'motion.badge.contrarian',
				duration_ms: 1100,
				haptic: [10, 40, 10, 40, 10],
				bonusXp: 0
			};
		} else if (firstLeaderboard && !state.flags.firstLeaderboard) {
			state.flags.firstLeaderboard = true;
			beat = {
				kind: 'first-leaderboard',
				character: 'oracle',
				copyKey: pick(state, 'first-leaderboard'),
				duration_ms: 1200,
				haptic: [40, 60, 40],
				bonusXp: 0
			};
		}
	}

	// ── 5. Within-day rhythm (jittered) ──
	if (isNullish(beat) && !overtime && dailyDone < target) {
		const key = state.day.sched[dailyDone];

		if (nonNullish(key)) {
			const m = RHYTHM[key];
			beat = {
				kind: `daily-${dailyDone}`,
				character: m.character,
				copyKey: pick(state, m.pool),
				duration_ms: m.duration_ms,
				haptic: m.haptic,
				bonusXp: 0
			};
		}
	}

	// ── 6. Wildcard — rare variable-ratio surprise, non-currency TREAT ──
	if (isNullish(beat) && wildcards && calls > 1 && Math.random() < 1 / 6) {
		const treatKey = TREAT_KEYS[Math.floor(Math.random() * TREAT_KEYS.length)];
		beat = {
			kind: 'wildcard',
			character: 'trickster',
			copyKey: pick(state, 'wildcard'),
			treatKey,
			subKey: 'motion.sub.surprise',
			duration_ms: 1250,
			haptic: [10, 40, 10],
			bonusXp: 0
		};
	}

	// ── 7. Every-10th lifetime ambient (no copy, just a pop) ──
	if (isNullish(beat) && calls > 10 && calls % 10 === 0) {
		beat = {
			kind: 'ambient-10',
			character: 'vici',
			copyKey: null,
			duration_ms: 360,
			haptic: 12,
			bonusXp: 0
		};
	}

	saveState(state);

	// Sync the chosen beat's `bonusXp` to the fully-stacked total so the
	// coin chip always displays what is actually awarded. A beat can be
	// created before all bonus sources are tallied (e.g. overtime-complete
	// fires at step 1 with bonusXp 25, then a volume milestone stacks more
	// at step 2), leaving `beat.bonusXp` stale unless we reconcile here.
	if (nonNullish(beat)) {
		beat = { ...beat, bonusXp };
	}

	return { bonusXp, beat };
};

export const resetMotionState = (): void => saveState(defaultState());
