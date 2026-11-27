import { countProfiles } from '#lib/web2/client.ts';
import { nonNullish } from '@dfinity/utils';

/**
 * Real, anonymous proof figure for the landing band: the total number of
 * registered VICI users, read from the API's public profile count (one
 * aggregate, never the profiles themselves).
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
		const total = await countProfiles();

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
