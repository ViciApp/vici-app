import { LEAGUE_IMAGE_JPEG_QUALITY, LEAGUE_IMAGE_SIZE_PX } from '#lib/types/league.ts';
import { downscaleImageToSquareJpeg } from '#lib/utils/image.utils.ts';
import {
	deleteLeagueImage as deleteLeagueImageWeb2,
	uploadLeagueImage as uploadLeagueImageWeb2
} from '#lib/web2/client.ts';
import { isNullish } from '@dfinity/utils';

/**
 * League cover image helpers. The bytes go to the API's league-image route,
 * which stores them and stamps the serving URL on the league row itself; we
 * never inline base64 data URLs into a record.
 */

/**
 * Downscale a user-picked image to a 256² cover JPEG and upload it through
 * the league-image route. Returns the serving URL the league row now holds
 * as its `imageUrl`.
 *
 * Throws when the picked file can't be decoded/painted (the caller
 * surfaces a friendly error) so a half-uploaded state never reaches the
 * league.
 */
export const uploadLeagueImage = async ({
	leagueId,
	file
}: {
	leagueId: string;
	file: File;
}): Promise<string> => {
	// The API route re-encodes to the canonical square cover server-side, but
	// the client-side downscale still runs first so the upload stays tiny; the
	// route also persists the URL on the league row, so the follow-up write
	// the caller performs is a read-back rather than a second persist.
	const downscaled = await downscaleImageToSquareJpeg({
		file,
		size: LEAGUE_IMAGE_SIZE_PX,
		quality: LEAGUE_IMAGE_JPEG_QUALITY
	});

	if (isNullish(downscaled)) {
		throw new Error('Could not process the selected image.');
	}

	const { imageUrl } = await uploadLeagueImageWeb2({ leagueId, image: downscaled });

	if (isNullish(imageUrl)) {
		throw new Error('Could not process the selected image.');
	}

	return imageUrl;
};

/**
 * Delete a previously-uploaded league image given its serving URL.
 * Best-effort: a missing or already-deleted asset is swallowed so
 * clearing the league's `imageUrl` never fails on a stale URL. Only acts
 * on the API's league-image URLs: external or malformed URLs (e.g. a
 * legacy value) are left untouched.
 */
export const deleteLeagueImageByUrl = async (url: string): Promise<void> => {
	// The API serves one canonical cover URL per league
	// (`/api/v1/leagues/{id}/image`), so the league id is recovered from the
	// path and the delete goes through the owner-gated route, which drops the
	// asset and clears the row's URL.
	let pathname: string;

	try {
		({ pathname } = new URL(url));
	} catch {
		return;
	}

	const match = /^\/api\/v1\/leagues\/([^/]+)\/image$/.exec(pathname);
	const [, leagueId] = match ?? [];

	if (isNullish(leagueId)) {
		return;
	}

	try {
		await deleteLeagueImageWeb2(decodeURIComponent(leagueId));
	} catch (err) {
		// The row-side clear is the source of truth; a dangling asset is
		// a cosmetic leak, not a failure the user should see.
		console.warn('storage.services: deleteLeagueImageByUrl failed', err);
	}
};
