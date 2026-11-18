import { LEADERBOARD_QUALIFY_MIN } from '#lib/constants/standings.constants.ts';
import { writable } from 'svelte/store';

/**
 * Dev-only, ephemeral product-tuning knobs.
 *
 * These back the `isDev()`-gated Tweaks panel (`components/dev/TweaksPanel`)
 * and let product feel out a parameter live without a deploy. They are
 * deliberately **not** user preferences: nothing here persists, nothing
 * round-trips through the profile, and a reload restores the seeded default.
 * Production reads the same store but never writes it, so the value is always
 * the canonical constant there.
 */

/**
 * Effective leaderboard qualify threshold (settled calls). Seeded from
 * {@link LEADERBOARD_QUALIFY_MIN}; the Tweaks panel writes it to re-rank the
 * board live. `globalStandingsRows` reads it as the gate.
 */
export const leaderboardQualifyMin = writable(LEADERBOARD_QUALIFY_MIN);
