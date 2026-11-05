import { MINUTE_IN_MS } from '#lib/constants/app.constants.ts';
import { readable, type Readable } from 'svelte/store';

/**
 * Shared one-minute heartbeat (`Date.now()`, refreshed every minute).
 *
 * Date-driven reactive surfaces (featured-event status, World-Cup phase
 * arc, kickoff countdowns) derive off this single tick so they flip in
 * step rather than each spinning up its own out-of-phase `setInterval`.
 * One-minute precision is plenty for "is the event live / how many days
 * left" — sub-minute cadence buys nothing for any surface we render.
 *
 * Tests can substitute a mock store by importing the consumer from a
 * different module.
 */
export const minuteTick_ms: Readable<number> = readable(Date.now(), (set) => {
	// The seed value was captured at module-evaluation time, which can be
	// many minutes stale by the time a surface first subscribes. Refresh
	// immediately so the first subscriber gets the real `now`, not the
	// module-load timestamp, before the first interval tick lands.
	set(Date.now());

	const id = setInterval(() => set(Date.now()), MINUTE_IN_MS);

	return () => clearInterval(id);
});
