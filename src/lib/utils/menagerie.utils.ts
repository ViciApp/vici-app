// ─────────────────────────────────────────────────────────────────────────────
// THE MENAGERIE — tier logic (pure).
//
// Single source of truth for turning the owner's real stats into the trophy
// layer: which tier each animal currently sits at, progress toward the next
// rung, the plain-English concept descriptor, and the diff engine that spots a
// newly-crossed tier so the celebration pipeline can fire exactly once.
//
// Keep this file PURE (no Svelte / stores / I/O). Inputs flow in through
// `MenagerieStats`; outputs are deterministic so the badge, the achievements
// screen, and the celebration host all agree.
// ─────────────────────────────────────────────────────────────────────────────

import {
	MAGPIE_MIN_CATEGORY_ACCURACY,
	MAGPIE_MIN_CATEGORY_CALLS,
	MENAGERIE,
	MENAGERIE_BY_SLUG,
	MENAGERIE_TIER_COLORS,
	MENAGERIE_TIER_RANK,
	type MenagerieAnimal,
	type MenagerieSlug,
	type MenagerieTier
} from '#lib/constants/menagerie.constants.ts';
import { isNullish, nonNullish } from '@dfinity/utils';

/** Minimum settled calls before the Owl's accuracy ladder is eligible. A
 * stricter, animal-specific gate than the general accuracy-display threshold:
 * accuracy on a handful of calls isn't yet a signal of calibration. */
export const MENAGERIE_OWL_MIN_CALLS = 50;

/**
 * Number of categories the owner "owns": at least
 * `MAGPIE_MIN_CATEGORY_CALLS` settled calls at a win ratio of at least
 * `MAGPIE_MIN_CATEGORY_ACCURACY`. The Magpie metric, computed from the same
 * per-category buckets the dashboard categories tile reads
 * (`UserStatsDoc.categoryStats`).
 */
export const countWinningCategories = (
	categoryStats: Record<string, { calls: number; wins: number }>
): number =>
	Object.values(categoryStats).filter(
		({ calls, wins }) =>
			calls >= MAGPIE_MIN_CATEGORY_CALLS && wins / calls >= MAGPIE_MIN_CATEGORY_ACCURACY
	).length;

/**
 * Real-stat snapshot the menagerie reads. Built from the owner's `UserProfile`
 * (plus a couple of live signals the profile doc doesn't carry) by the surfaces
 * that render the trophy layer — see `menagerieStatsFromProfile`.
 *
 */
export interface MenagerieStats {
	/** Lifetime calls placed. Drives Hatchling + Beaver. */
	calls: number;
	/** Lifetime long-shot wins (execution consensus ≤ 30%). Drives Raven. */
	contrarianWins: number;
	/** Smallest winning execution consensus (0..1), or `undefined` when the
	 * owner has no settled win yet. Drives Octopus (reversed ladder). */
	bestUpsetConsensus?: number;
	/** Current daily-activity streak (days). Drives Rooster. */
	dailyStreak: number;
	/** Longest consecutive-win run ever recorded (high-water). Drives Snake. */
	onFireStreak: number;
	/** Settled-call accuracy as a 0..1 ratio. Drives Owl (gated). */
	accuracyRatio: number;
	/** Lifetime cold-streak recoveries (a win after ≥`COMEBACK_COLD_STREAK_LOSSES`
	 * straight losses). Drives Honey Badger. */
	comebacks: number;
	/** Distinct categories with a winning record (see
	 * {@link countWinningCategories}). Drives Magpie. */
	winningCategories: number;
	/** Leagues the owner has ever joined (any role; high-water — leaving
	 * never decrements). Bee's "join" milestone. */
	leaguesJoined: number;
	/** Resolved battles the owner's side has ever won (high-water). Bee's
	 * "win a bout" milestone. */
	boutsWon: number;
	/** Leagues the owner has ever owned (high-water). Bee's "found"
	 * milestone. */
	leaguesFounded: number;
	/** Distinct people the owner has brought to the app. Drives Parrot. */
	referrals: number;
	/** Global leaderboard rank (1-based), or `undefined` when unranked. */
	rank?: number;
	/** Total ranked predictors, for the percentile. Defaults applied in the hook. */
	totalRanked?: number;
}

/**
 * The `UserProfile` fields the menagerie reads, narrowed so callers can pass a
 * partial profile in tests / loaders without the full schema.
 */
export interface MenagerieProfileFields {
	totalTrades?: number;
	dailyStreak?: number;
	onFireStreak?: number;
	accuracy?: number;
	contrarianWins?: number;
	bestUpsetConsensus?: number;
	comebacks?: number;
	winningCategories?: number;
	leaguesJoined?: number;
	boutsWon?: number;
	leaguesFounded?: number;
}

/** Live signals the profile doc doesn't carry but the menagerie can use. */
export interface MenagerieLiveSignals {
	referrals?: number;
	rank?: number;
	totalRanked?: number;
}

/**
 * Builds the menagerie metric snapshot from the owner's profile plus any live
 * signals the profile doc doesn't carry (referral count, global rank). Absent
 * signals default to the "none recorded" value, which keeps those animals at
 * their locked / wood baseline rather than fabricating progress.
 *
 * `accuracy` is stored as a 0..100 percentage on the profile; the Owl ladder
 * works in a 0..1 ratio, so it's converted here.
 */
export const menagerieStatsFromProfile = ({
	profile,
	signals = {}
}: {
	profile: MenagerieProfileFields | undefined;
	signals?: MenagerieLiveSignals;
}): MenagerieStats => ({
	calls: profile?.totalTrades ?? 0,
	contrarianWins: profile?.contrarianWins ?? 0,
	bestUpsetConsensus: profile?.bestUpsetConsensus,
	dailyStreak: profile?.dailyStreak ?? 0,
	onFireStreak: profile?.onFireStreak ?? 0,
	accuracyRatio: (profile?.accuracy ?? 0) / 100,
	comebacks: profile?.comebacks ?? 0,
	winningCategories: profile?.winningCategories ?? 0,
	leaguesJoined: profile?.leaguesJoined ?? 0,
	boutsWon: profile?.boutsWon ?? 0,
	leaguesFounded: profile?.leaguesFounded ?? 0,
	referrals: signals.referrals ?? 0,
	rank: signals.rank,
	totalRanked: signals.totalRanked
});

/**
 * Per-animal metric extractor — reads one number from {@link MenagerieStats}.
 * Centralised so `menagerieTierFor` and `menagerieProgress` always agree on the
 * source.
 */
const METRICS: Record<MenagerieSlug, (stats: MenagerieStats) => number> = {
	hatchling: (stats) => stats.calls,
	beaver: (stats) => stats.calls,
	rooster: (stats) => stats.dailyStreak,
	// Snake reads the longest consecutive-win run ever recorded (recomputed
	// from clearing history in `calculateAndSyncStats`) — a high-water mark,
	// so a rung once earned doesn't read as regressed when the current run
	// ends.
	snake: (stats) => stats.onFireStreak,
	// Owl is gated: accuracy only counts once the owner has enough settled calls
	// for it to be a real calibration signal.
	owl: (stats) => (stats.calls >= MENAGERIE_OWL_MIN_CALLS ? stats.accuracyRatio : 0),
	// Raven: lifetime wins on long-shot calls — settled wins whose execution
	// price sat at or under `CONTRARIAN_PRICE_THRESHOLD`, the same counter the
	// `contrarian` achievement reads (derived from clearing history in
	// `calculateAndSyncStats`).
	raven: (stats) => stats.contrarianWins,
	// Octopus: rarest single upset — the smallest execution consensus among
	// settled wins (recomputed from clearing history in
	// `calculateAndSyncStats`). Reversed ladder, so an owner with no settled
	// win reads the worst value (1) and stays below every rung.
	octopus: (stats) => stats.bestUpsetConsensus ?? 1,
	// Magpie: breadth — distinct categories with a winning record, persisted
	// on the profile from the per-category buckets in `calculateAndSyncStats`
	// (see `countWinningCategories`).
	magpie: (stats) => stats.winningCategories,
	// Honey Badger reads the persisted cold-streak recovery tally — wins that
	// snapped a run of at least `COMEBACK_COLD_STREAK_LOSSES` straight losses
	// (recomputed from clearing history in `calculateAndSyncStats`).
	badger: (stats) => stats.comebacks,
	parrot: (stats) => stats.referrals,
	// Bee: league-life milestones, one point per rung of the ladder — joined
	// a league, won a bout, founded a league (the counters are persisted by
	// `calculateAndSyncStats`). Matching the rule copy, each milestone counts
	// once no matter how many times it's repeated.
	bee: (stats) =>
		(stats.leaguesJoined > 0 ? 1 : 0) +
		(stats.boutsWon > 0 ? 1 : 0) +
		(stats.leaguesFounded > 0 ? 1 : 0),
	// Goat: global-rank percentile (rank / total) — lower is better. Returns 0
	// as the #1 sentinel; an unranked owner reads as 1 (worst).
	goat: (stats) => {
		if (isNullish(stats.rank)) {
			return 1;
		}

		if (stats.rank === 1) {
			return 0;
		}

		const total = stats.totalRanked && stats.totalRanked > 0 ? stats.totalRanked : stats.rank;

		return stats.rank / total;
	}
};

/**
 * Highest tier the animal currently qualifies for, or `null` (locked).
 *
 * For most animals the highest cleared threshold wins; for reversed (lower-is-
 * better) metrics the lowest threshold the metric is at-or-below wins. Goat's
 * iridescent rung is reached only by world rank #1 (the `-1` sentinel).
 */
export const menagerieTierFor = ({
	slug,
	stats
}: {
	slug: MenagerieSlug;
	stats: MenagerieStats;
}): MenagerieTier | null => {
	const animal = MENAGERIE_BY_SLUG.get(slug);

	if (!animal) {
		return null;
	}

	const metric = METRICS[slug](stats);
	let earned: MenagerieTier | null = null;

	for (const step of animal.tiers) {
		const ok = animal.reversed ? metric <= step.t : metric >= step.t;

		if (ok) {
			earned = step.tier;
		}
	}

	// Goat #1 sentinel: percentile 0 means world rank #1 → the iridescent rung
	// (whose `-1` threshold the reversed compare never matches on its own).
	if (slug === 'goat' && stats.rank === 1) {
		earned = 'irid';
	}

	return earned;
};

export interface MenagerieProgress {
	/** The animal's current raw metric value. */
	current: number;
	/** Threshold of the next rung, or `null` at max tier. */
	next: number | null;
	/** 0..1 progress toward the next rung (1 at max tier). */
	ratio: number;
	/** The next rung's tier, or `'max'` at max tier. */
	label: MenagerieTier | 'max';
	/** The tier the owner currently sits at (or `null` when locked). */
	atTier: MenagerieTier | null;
}

/**
 * Progress toward the next rung — drives the "X% to next tier" bars. At max tier
 * `next` is `null`, `ratio` is `1`, and `label` is `'max'`.
 */
export const menagerieProgress = ({
	slug,
	stats
}: {
	slug: MenagerieSlug;
	stats: MenagerieStats;
}): MenagerieProgress | null => {
	const animal = MENAGERIE_BY_SLUG.get(slug);

	if (!animal) {
		return null;
	}

	const metric = METRICS[slug](stats);
	const atTier = menagerieTierFor({ slug, stats });
	const atIdx = atTier ? animal.tiers.findIndex((step) => step.tier === atTier) : -1;
	const nextStep = animal.tiers[atIdx + 1];

	if (!nextStep) {
		return { current: metric, next: null, ratio: 1, label: 'max', atTier };
	}

	const clamp = (value: number): number => Math.max(0, Math.min(1, value));

	let ratio: number;

	if (animal.reversed) {
		// Distance closed from the current rung's threshold toward the next.
		const lo = atIdx >= 0 ? animal.tiers[atIdx].t : 1;
		// Goat's iridescent rung (`-1` sentinel) is treated as 0 for progress —
		// closer to world rank #1 is closer to iridescent.
		const nextT = slug === 'goat' && nextStep.tier === 'irid' ? 0 : nextStep.t;
		ratio = clamp((lo - metric) / (lo - nextT));
	} else {
		const lo = atIdx >= 0 ? animal.tiers[atIdx].t : 0;
		ratio = clamp((metric - lo) / (nextStep.t - lo));
	}

	return { current: metric, next: nextStep.t, ratio, label: nextStep.tier, atTier };
};

/**
 * Plain-English achievement descriptor key.
 *
 * Earned: the milestone label for that rung (`"Top 1%"`, `"10 in a row"`).
 * Locked / no tier: the animal's general concept (`"Contrarian"`, `"Global rank"`).
 */
export const menagerieConceptKey = ({
	slug,
	tier
}: {
	slug: MenagerieSlug;
	tier: MenagerieTier | null;
}) => {
	const animal = MENAGERIE_BY_SLUG.get(slug);

	if (!animal) {
		return;
	}

	if (tier) {
		const idx = animal.tiers.findIndex((step) => step.tier === tier);

		if (idx >= 0 && animal.labelKeys[idx]) {
			return animal.labelKeys[idx];
		}
	}

	return animal.conceptKey;
};

/** Representative colour for a tier (or a muted fallback when locked). */
export const menagerieTierColor = (tier: MenagerieTier | null): string =>
	tier ? MENAGERIE_TIER_COLORS[tier] : 'var(--text-muted)';

/** A `${slug}:${tier}` celebration-ledger key. */
export const menagerieKey = ({
	slug,
	tier
}: {
	slug: MenagerieSlug;
	tier: MenagerieTier;
}): string => `${slug}:${tier}`;

/**
 * Every `${slug}:${tier}` the owner currently qualifies for — cumulative, so
 * gold implies wood + silver + gold. This is the full earned set; the celebration
 * ledger (`earnedMenagerie`) is compared against it to find fresh crossings.
 */
export const earnedMenagerieKeys = (stats: MenagerieStats): string[] => {
	const keys: string[] = [];

	for (const animal of MENAGERIE) {
		const tier = menagerieTierFor({ slug: animal.slug, stats });

		if (tier) {
			const reached = MENAGERIE_TIER_RANK[tier];

			for (const step of animal.tiers) {
				if (MENAGERIE_TIER_RANK[step.tier] <= reached) {
					keys.push(menagerieKey({ slug: animal.slug, tier: step.tier }));
				}
			}
		}
	}

	return keys;
};

export interface MenagerieCrossing {
	slug: MenagerieSlug;
	tier: MenagerieTier;
}

export type MenagerieDiff =
	| { firstRun: true; all: string[]; celebrate: [] }
	| { firstRun: false; all: string[]; celebrate: MenagerieCrossing[] };

/**
 * Compares the live earned set against the already-celebrated ledger.
 *
 * - **First run** (`isNullish(celebrated)` — the field was never seeded): returns
 *   `{ firstRun: true, all }` so the host seeds the ledger SILENTLY. A
 *   fully-stocked profile must not fire a dozen celebrations on its first load.
 * - **Otherwise**: returns the HIGHEST newly-crossed tier per animal, in
 *   catalogue (reveal-cadence) order, so multi-unlock ticks queue predictably.
 */
export const detectNewMenagerieTiers = ({
	stats,
	celebrated
}: {
	stats: MenagerieStats;
	celebrated: readonly string[] | null | undefined;
}): MenagerieDiff => {
	const all = earnedMenagerieKeys(stats);

	if (isNullish(celebrated)) {
		return { firstRun: true, all, celebrate: [] };
	}

	const prev = new Set(celebrated);
	const fresh = all.filter((key) => !prev.has(key));
	const bySlug = new Map<MenagerieSlug, MenagerieTier>();

	for (const key of fresh) {
		// Keys are `${slug}:${tier}`, but the ledger is opaque persisted data — a
		// malformed or stale entry (unknown slug / tier) must never be ranked, or
		// `MENAGERIE_TIER_RANK[undefined]` would enqueue an invalid reveal. Only
		// act on entries we can resolve against the live catalogue.
		const [rawSlug, rawTier] = key.split(':');
		const slug = rawSlug as MenagerieSlug;
		const tier = rawTier as MenagerieTier;
		const known = MENAGERIE_BY_SLUG.has(slug) && nonNullish(MENAGERIE_TIER_RANK[tier]);

		if (known) {
			const existing = bySlug.get(slug);

			if (!existing || MENAGERIE_TIER_RANK[tier] > MENAGERIE_TIER_RANK[existing]) {
				bySlug.set(slug, tier);
			}
		}
	}

	const celebrate: MenagerieCrossing[] = MENAGERIE.filter((animal) => bySlug.has(animal.slug)).map(
		(animal): MenagerieCrossing => ({
			slug: animal.slug,
			// `bySlug.has` was checked in the filter above.
			tier: bySlug.get(animal.slug) as MenagerieTier
		})
	);

	return { firstRun: false, all, celebrate };
};

/** A decorated catalogue row for the achievements grid: animal + live state. */
export interface MenagerieRow {
	animal: MenagerieAnimal;
	tier: MenagerieTier | null;
	progress: MenagerieProgress | null;
}

/**
 * The full catalogue decorated with each animal's live tier + progress, sorted
 * earned-first (highest tier first), then locked rows by progress descending.
 */
export const menagerieRows = (stats: MenagerieStats): MenagerieRow[] => {
	const rows: MenagerieRow[] = MENAGERIE.map((animal) => ({
		animal,
		tier: menagerieTierFor({ slug: animal.slug, stats }),
		progress: menagerieProgress({ slug: animal.slug, stats })
	}));

	return rows.sort((a, b) => {
		const at = a.tier ? MENAGERIE_TIER_RANK[a.tier] : 0;
		const bt = b.tier ? MENAGERIE_TIER_RANK[b.tier] : 0;

		if (at !== bt) {
			return bt - at;
		}

		if (at === 0) {
			return (b.progress?.ratio ?? 0) - (a.progress?.ratio ?? 0);
		}

		return 0;
	});
};
