// Worlds podium monthly payout, user-claim model: the member claims a closed
// month's finish; the first claim freezes that month's ranking, eligibility
// is the caller's current affiliation appearing in the frozen top-3 and
// joined before the month closed, and the payment itself goes through the
// economy's idempotent award grant (keyed <YYYY-MM>_<place>, so a second
// claim collides cleanly).

import { nonNullish } from '@dfinity/utils';
import { MONTH_ANCHOR_RE, monthAnchorFromMs, monthEndMs } from '../lib/time';
import { grantWorldsPodiumPrize, type PodiumPlace } from '../vxp/prizes';
import {
	AffiliationStatsError,
	freezeMonthlySnapshots,
	listAffiliationStatsForMonth
} from './affiliation-stats';
import { AFFILIATION_KINDS, getMyAffiliation } from './affiliations';

const PODIUM_PLACES: readonly PodiumPlace[] = ['gold', 'silver', 'bronze'];

export interface ClaimWorldsPodiumPrizeResult {
	monthAnchor: string;
	awardsCreated: number;
	awardsAlreadyClaimed: number;
	notEligible: boolean;
}

/**
 * Per-user claim endpoint. Walks both kinds (a member can hold one
 * university and one country slot), freezes the month on first touch, and
 * grants one award per podium finish. Counts let the client render the
 * "+N VXP for your school's finish" beat.
 */
export const claimWorldsPodiumPrize = async ({
	userId,
	monthAnchor,
	nowMs = Date.now()
}: {
	userId: string;
	monthAnchor: string;
	nowMs?: number;
}): Promise<ClaimWorldsPodiumPrizeResult> => {
	if (!MONTH_ANCHOR_RE.test(monthAnchor)) {
		throw new AffiliationStatsError(
			`claimWorldsPodiumPrize: invalid monthAnchor "${monthAnchor}" (expected YYYY-MM).`
		);
	}

	const currentMonth = monthAnchorFromMs(nowMs);

	if (monthAnchor >= currentMonth) {
		throw new AffiliationStatsError(
			`claimWorldsPodiumPrize: month ${monthAnchor} is not yet closed (current month is ${currentMonth}).`
		);
	}

	const monthClosedMs = monthEndMs(monthAnchor);
	let awardsCreated = 0;
	let awardsAlreadyClaimed = 0;
	let foundAnyEligibleAffiliation = false;

	for (const kind of AFFILIATION_KINDS) {
		// Frozen-at-close: the first claim of the month captures the ranking so
		// the podium stays stable across claimants; a no-op once frozen.
		await freezeMonthlySnapshots({ kind, monthAnchor, nowMs });

		const myAffiliation = await getMyAffiliation({ userId, kind });

		// A first join has no lock, so the current slot alone would let anyone
		// join last month's winner after close and collect its prize. A member
		// at month-end qualifies whatever their join date, so the slot must
		// have been joined before the month closed: joined_at_ms is
		// server-stamped, kept on a re-join of the same slot and reset by a
		// switch or a leave, so a move after close never carries tenure.
		if (nonNullish(myAffiliation) && myAffiliation.joinedAtMs < monthClosedMs) {
			const top3 = (await listAffiliationStatsForMonth({ kind, monthAnchor, nowMs })).slice(0, 3);
			const placeIndex = top3.findIndex(
				(s) => s.affiliationIdentifier === myAffiliation.affiliationIdentifier
			);
			const place = PODIUM_PLACES[placeIndex];

			if (placeIndex !== -1 && nonNullish(place)) {
				foundAnyEligibleAffiliation = true;

				const outcome = await grantWorldsPodiumPrize({ userId, monthAnchor, place });

				if (outcome.outcome === 'already') {
					awardsAlreadyClaimed += 1;
				} else if (outcome.outcome === 'paid' || outcome.outcome === 'recorded') {
					awardsCreated += 1;
				}
			}
		}
	}

	return {
		monthAnchor,
		awardsCreated,
		awardsAlreadyClaimed,
		notEligible: !foundAnyEligibleAffiliation && awardsAlreadyClaimed === 0
	};
};
