import { track } from '#lib/services/analytics.services.ts';
import type { ActivityReaction } from '#lib/types/social.ts';
import { listReceivedActivityReactions as listReceivedActivityReactionsApi } from '#lib/web2/client.ts';

/**
 * Record a failed reaction read as an observable `app_error` event rather than
 * letting it vanish behind a console line. These reads hydrate the global shell
 * at startup, so a silent fallback would mask a persistent misconfiguration
 * (e.g. a read-permission or schema regression) as an empty inbox forever; the
 * tracked event keeps the failure (and its rate) visible in the cockpit.
 * `track` is fire-and-forget and never throws, so this can't re-break startup.
 */
const trackReactionReadFailure = ({
	collection,
	operation,
	err
}: {
	collection: string;
	operation: string;
	err: unknown;
}): void => {
	console.error(`Failed to load ${collection} (${operation})`, err);
	track({ name: 'app_error', source: collection, label: operation });
};

/**
 * Cap on the received-reactions read: likes on the viewer's OWN calls (the like-received inbox
 * source). Scoped to one author's activities, so this is a small set even when the global feed is
 * busy.
 */
const RECEIVED_REACTIONS_READ_LIMIT = 200;

/**
 * Every like on the signed-in account's own activities, bounded and scoped to that author (not the
 * global feed window): the API scopes the read to the session account. Backs the like-received
 * inbox card.
 */
export const getReceivedActivityReactions = async ({
	limit = RECEIVED_REACTIONS_READ_LIMIT
}: {
	limit?: number;
} = {}): Promise<ActivityReaction[]> => {
	if (limit <= 0) {
		return [];
	}

	try {
		return await listReceivedActivityReactionsApi({ limit });
	} catch (err: unknown) {
		trackReactionReadFailure({
			collection: 'activity_reactions',
			operation: 'list_received',
			err
		});

		return [];
	}
};
