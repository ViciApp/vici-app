import { Collection } from '#lib/constants/collections.constants.ts';
import { track } from '#lib/services/analytics.services.ts';
import type { ActivityReaction } from '#lib/types/social.ts';
import { isWeb2Backend } from '#lib/web2/backend-mode.ts';
import { listActivityReactions as listActivityReactionsWeb2 } from '#lib/web2/client.ts';
import { listDocs } from '@junobuild/core';
import type { PrincipalText } from '@junobuild/schema';

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
 * Size of the recent global reaction window the HTTP transport scans for the viewer's received
 * likes (it has no author-scoped read yet); likes older than this window under-report.
 */
export const ACTIVITY_REACTIONS_READ_LIMIT = 1000;

/**
 * Cap on the received-reactions scan: likes on the viewer's OWN calls (the like-received inbox
 * source). Scoped to one author's activities by the key prefix, so this is a small set even when the
 * global feed is busy.
 */
export const RECEIVED_REACTIONS_READ_LIMIT = 200;

/**
 * Every like on `author`'s own activities. The reaction doc key is `${author}#${ts}#${type}#${liker}`,
 * so the author (the liked call's owner) is the key prefix; a single key-prefix `listDocs` returns
 * all likes on their calls, bounded and scoped to that author (not the global feed window). Backs
 * the like-received inbox card; `author` is the viewer's principal.
 */
export const getReceivedActivityReactions = async ({
	author,
	limit = RECEIVED_REACTIONS_READ_LIMIT,
	certified = false
}: {
	author: PrincipalText;
	limit?: number;
	certified?: boolean;
}): Promise<ActivityReaction[]> => {
	if (limit <= 0) {
		return [];
	}

	try {
		// No author-scoped reactions read exists on the HTTP API yet, so filter
		// the recent global window by the activity-key author prefix (`author`
		// is the account id there and ids never contain `#`). Same bounded
		// under-reporting as the on-chain window scans on this surface.
		if (isWeb2Backend()) {
			const window = await listActivityReactionsWeb2({ limit: ACTIVITY_REACTIONS_READ_LIMIT });

			return window
				.filter(({ activityKey }) => activityKey.startsWith(`${author}#`))
				.slice(0, limit);
		}

		const { items } = await listDocs<ActivityReaction>({
			collection: Collection.ACTIVITY_REACTIONS,
			filter: {
				// Principal text is `[a-z0-9-]` only, so it carries no regex metacharacters; a bare `^…#`
				// prefix matches exactly the author segment (principals never contain `#`).
				matcher: { key: `^${author}#` },
				order: { field: 'created_at', desc: true },
				paginate: { limit }
			},
			options: { certified }
		});

		return items.map(({ data }) => data);
	} catch (err: unknown) {
		trackReactionReadFailure({
			collection: Collection.ACTIVITY_REACTIONS,
			operation: 'list_received',
			err
		});

		return [];
	}
};
