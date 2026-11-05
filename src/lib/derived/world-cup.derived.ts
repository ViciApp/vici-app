import { DAY_IN_MS } from '#lib/constants/app.constants.ts';
import { CURRENT_FEATURED_EVENT } from '#lib/constants/featured-event.constants.ts';
import { featuredEventActive } from '#lib/derived/featured-event.derived.ts';
import { minuteTick_ms } from '#lib/derived/time.derived.ts';
import { preferencesStore } from '#lib/stores/preferences.store.ts';
import { derived, type Readable } from 'svelte/store';

/**
 * World-Cup mode foundation.
 *
 * Two orthogonal signals back the World-Cup experience:
 *
 * 1. {@link worldCupMode} — the *user's* persisted opt-in. Mirrors the
 *    `worldCupMode` flag on `profile.preferences` (cross-device, written
 *    through `preferencesStore`). It is a pure preference: `true` even
 *    after the event has archived if the user last left it on.
 * 2. {@link featuredEventActive} — the *product's* archive gate. Flips
 *    to `false` once `now` passes the featured event's `archiveAfter_ms`
 *    (the product-set cut-over date; see
 *    `featured-event.constants.ts`). Time-driven, user-independent.
 *
 * Consumers that want "should we render World-Cup content right now"
 * (later: Markets focus, the Dashboard WC tile) read {@link worldCupActive}
 * — the AND of the two — so they never re-derive the gate or reach into
 * the preferences object themselves.
 *
 * On top of the gate sits the retention *arc* — {@link worldCupPhase} —
 * which gradually widens the deck from WC-only back to all categories as
 * the event winds down. It layers on these signals plus the featured
 * event's dates rather than introducing a parallel source of truth.
 */

/**
 * The user's persisted World-Cup-mode opt-in, projected off
 * `preferencesStore` so consumers can subscribe to just this flag
 * without destructuring the whole preferences object.
 */
export const worldCupMode: Readable<boolean> = derived(
	preferencesStore,
	(prefs) => prefs.worldCupMode
);

/**
 * Re-export of the product's archive gate for World-Cup content. `true`
 * while the featured event is `upcoming` / `live` / `wrap-up`; `false`
 * once it has archived. Surfaced here so World-Cup consumers have a
 * single import for the whole foundation.
 */
export const worldCupNotArchived: Readable<boolean> = featuredEventActive;

/**
 * Whether World-Cup content should be surfaced right now: the user has
 * opted in **and** the event has not yet archived. This is the boolean
 * most surfaces want.
 */
export const worldCupActive: Readable<boolean> = derived(
	[worldCupMode, worldCupNotArchived],
	([optedIn, notArchived]) => optedIn && notArchived
);

/**
 * One phase of the World-Cup retention arc.
 *
 * - `off` — the user hasn't opted in; Markets keeps its all-categories shape.
 * - `wc-focus` — Cup active, comfortably before the final. Markets opens
 *   laser-focused on the World Cup (the shipped WC-default + collapsed rail).
 * - `bridge` — the last stretch before the final. Still WC-focused, but the
 *   deck also seeds a curated "Beyond the Cup" rail to pre-empt the post-Cup
 *   cliff *before* the event resolves.
 * - `open` — the Cup has resolved (now ≥ final, or the event archived).
 *   Markets reverts to all-categories and a recap card converts WC interest
 *   into broader play.
 */
export type WorldCupPhase = 'off' | 'wc-focus' | 'bridge' | 'open';

/**
 * How long before the final the `bridge` phase opens. Two weeks gives the
 * "Beyond the Cup" rail time to land before the deck would otherwise fall
 * off the cliff at resolution.
 */
const BRIDGE_WINDOW_MS = 14 * DAY_IN_MS;

/**
 * The current phase of the retention arc. `off` whenever the user hasn't
 * opted in; otherwise date-driven off the featured event's `finalAt_ms`.
 * Once the event archives, `worldCupNotArchived` is `false` so the arc
 * settles on `open` regardless of the clock.
 */
export const worldCupPhase: Readable<WorldCupPhase> = derived(
	[worldCupMode, worldCupNotArchived, minuteTick_ms],
	([optedIn, notArchived, t]): WorldCupPhase => {
		if (!optedIn) {
			return 'off';
		}

		const { finalAt_ms } = CURRENT_FEATURED_EVENT;

		// Resolved: past the final, or the product archived the event.
		if (!notArchived || t >= finalAt_ms) {
			return 'open';
		}

		// The pre-final bridge window.
		if (t >= finalAt_ms - BRIDGE_WINDOW_MS) {
			return 'bridge';
		}

		return 'wc-focus';
	}
);
