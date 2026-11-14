import { DAY_IN_MS } from '#lib/constants/app.constants.ts';
import { CURRENT_FEATURED_EVENT } from '#lib/constants/featured-event.constants.ts';
import { minuteTick_ms } from '#lib/derived/time.derived.ts';
import type { FeaturedEvent, FeaturedEventStatus } from '#lib/types/featured-event.ts';
import { derived, readable, type Readable } from 'svelte/store';

/**
 * The featured-event constant, exposed as a store so call sites can opt
 * into reactive updates if we later swap the active event at runtime.
 */
export const featuredEvent: Readable<FeaturedEvent> = readable(CURRENT_FEATURED_EVENT);

/**
 * Lifecycle status of the featured event: drives whether onboarding
 * surfaces the hero, whether Flow filters to event markets, and whether
 * the Worlds event-battle is visible.
 */
export const featuredEventStatus: Readable<FeaturedEventStatus> = derived(
	[featuredEvent, minuteTick_ms],
	([event, t]) => statusFor({ event, now_ms: t })
);

/**
 * Convenience boolean: the event hasn't been archived yet. `true` for
 * `upcoming`, `live`, and `wrap-up`. Most surfaces want this; only
 * countdown / "starts in" copy needs to split `upcoming` from `live`.
 */
export const featuredEventActive: Readable<boolean> = derived(
	featuredEventStatus,
	(status) => status !== 'archived'
);

/**
 * Whole days remaining until kickoff, clamped at 0. `null` once the event
 * has started: UI should switch to "live" copy in that branch.
 */
export const daysToKickoff: Readable<number | null> = derived(
	[featuredEvent, minuteTick_ms],
	([event, t]) => {
		if (t >= event.kickoffAt_ms) {
			return null;
		}

		const delta_ms = event.kickoffAt_ms - t;

		return Math.max(0, Math.floor(delta_ms / DAY_IN_MS));
	}
);

/**
 * Whole days remaining until the event's final (`finalAt_ms`), clamped
 * at 0. Used by surfaces that frame the active event as a battle with a
 * "{N}d left" timer (e.g. the Worlds hero card / scope toggle). `null`
 * once the event has wrapped: UI should switch to archival copy.
 */
export const daysToFinal: Readable<number | null> = derived(
	[featuredEvent, minuteTick_ms],
	([event, t]) => {
		if (t >= event.finalAt_ms) {
			return null;
		}

		const delta_ms = event.finalAt_ms - t;

		return Math.max(0, Math.ceil(delta_ms / DAY_IN_MS));
	}
);

const statusFor = ({
	event,
	now_ms
}: {
	event: FeaturedEvent;
	now_ms: number;
}): FeaturedEventStatus => {
	if (now_ms < event.kickoffAt_ms) {
		return 'upcoming';
	}

	if (now_ms <= event.finalAt_ms) {
		return 'live';
	}

	if (now_ms <= event.archiveAfter_ms) {
		return 'wrap-up';
	}

	return 'archived';
};
