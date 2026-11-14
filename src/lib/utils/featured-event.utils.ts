import type { FeaturedEvent } from '#lib/types/featured-event.ts';
import { isEmptyString, nonNullish } from '@dfinity/utils';

/**
 * The market ids that belong to a single featured-event participant; the
 * "<participant> wins" outcome (`participant.marketId`) plus the
 * participant's advancement market (`advancementMarkets[id].id`).
 *
 * Used to boost the markets tied to the user's favourite team
 * (`preferences.favoriteParticipantId`) in the Flow ranker: see
 * `rankMarkets`. The favourite can be set or changed at any time, not
 * just at onboarding. Returns an empty set when no participant is
 * selected (the empty-string skip sentinel) or the id isn't part of the
 * event, so callers can pass the raw preference value without guarding
 * first.
 */
export const participantMarketIds = ({
	event,
	participantId
}: {
	event: FeaturedEvent;
	participantId: string;
}): Set<string> => {
	const ids = new Set<string>();

	if (isEmptyString(participantId)) {
		return ids;
	}

	const participant = event.participants.find(({ id }) => id === participantId);

	if (nonNullish(participant?.marketId)) {
		ids.add(participant.marketId);
	}

	const advancement = event.advancementMarkets?.[participantId];

	if (nonNullish(advancement)) {
		ids.add(advancement.id);
	}

	return ids;
};
