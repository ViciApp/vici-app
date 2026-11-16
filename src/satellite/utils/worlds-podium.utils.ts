import { MILLISECOND_IN_NANOSECONDS } from '#lib/constants/app.constants.ts';
import { monthEndMs } from '#lib/utils/month-anchor.utils.ts';

/**
 * Whether an affiliation slot joined at `joinedAtNs` may collect
 * `monthAnchor`'s podium prize. A member at month-end qualifies whatever
 * their join date, but only for a slot joined before the month closed: a
 * first join has no switch lock, so without this anyone could join last
 * month's winner after close and collect its prize. A switch or a leave
 * creates a new slot, so a move after close never carries tenure.
 */
export const joinedBeforeMonthClose = ({
	joinedAtNs,
	monthAnchor
}: {
	joinedAtNs: bigint;
	monthAnchor: string;
}): boolean => joinedAtNs < BigInt(monthEndMs(monthAnchor)) * MILLISECOND_IN_NANOSECONDS;
