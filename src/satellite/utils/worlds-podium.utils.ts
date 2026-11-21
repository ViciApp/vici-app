import { MILLISECOND_IN_NANOSECONDS } from '#lib/constants/time.constants.ts';
import type { AffiliationKind } from '#lib/types/affiliation.ts';
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

export type WorldsPodiumPlace = 'gold' | 'silver' | 'bronze';

/** The award key of one podium finish: a member is paid once per month,
 * kind and place, so a university and a country finish are two awards. */
export const worldsPodiumAwardKey = ({
	monthAnchor,
	kind,
	place
}: {
	monthAnchor: string;
	kind: AffiliationKind;
	place: WorldsPodiumPlace;
}): string => `${monthAnchor}_${kind}_${place}`;

/**
 * Every award key that counts as a claim of a podium finish: its own, and
 * the key without the kind (`<YYYY-MM>_<place>`) claims were once written
 * under, when one award covered a month and place whichever kind finished
 * there. That award stands for both kinds of its place, so a month paid
 * under it never pays the place again.
 */
export const claimedWorldsPodiumAwardKeys = ({
	monthAnchor,
	kind,
	place
}: {
	monthAnchor: string;
	kind: AffiliationKind;
	place: WorldsPodiumPlace;
}): string[] => [worldsPodiumAwardKey({ monthAnchor, kind, place }), `${monthAnchor}_${place}`];
