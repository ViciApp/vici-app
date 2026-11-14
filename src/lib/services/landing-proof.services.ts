import { Collection } from '#lib/constants/collections.constants.ts';
import type { UserProfile } from '#lib/types/profile.ts';
import { nonNullish } from '@dfinity/utils';
import { listDocs } from '@junobuild/core';

/**
 * Real, anonymous proof figure for the landing band: the total number of
 * registered VICI users.
 *
 * The figure is the count of docs in the public `profiles` datastore
 * collection ({@link Collection.PROFILES}, `read: 'public'`). That read is
 * anonymous by construction: the pre-auth landing already runs under an
 * initialised satellite (see the root `+layout.svelte`), and public-collection
 * reads need no sign-in, the same path the rest of the marketing surface uses.
 *
 * We never page the full collection: a single `listDocs` with a one-item page
 * returns the total in `ListResults.matches_length` (total matching docs,
 * ignoring pagination), so the cost is one minimal query regardless of how
 * many users exist. This is a genuine, always-non-zero platform-wide figure.
 */

/**
 * Session cache. The landing is a marketing surface; one anonymous read per
 * session is plenty; we never poll. `undefined` means "not yet resolved".
 */
let cached: number | undefined;

/**
 * Resolves the real total count of registered VICI users, anonymously. Returns
 * `undefined` on any error so the caller keeps its placeholder dash rather than
 * rendering a fake number or a blank.
 *
 * Cached for the session: repeated mounts reuse the first resolved value.
 */
export const getViciUserCount = async (): Promise<number | undefined> => {
	if (nonNullish(cached)) {
		return cached;
	}

	try {
		// One minimal page: we only need the total, exposed as `matches_length`
		// (total matching docs, ignoring pagination), never the doc bodies.
		const { matches_length } = await listDocs<UserProfile>({
			collection: Collection.PROFILES,
			filter: { paginate: { limit: 1 } }
		});

		const total = Number(matches_length);

		if (!Number.isFinite(total) || total <= 0) {
			return;
		}

		cached = total;

		return cached;
	} catch (err: unknown) {
		// Pre-auth marketing surface: never throw, never block render. Fall
		// through to the implicit `undefined` so the caller keeps its placeholder
		// dash on any failure.
		console.error('Failed to derive VICI user count', err);
	}
};
