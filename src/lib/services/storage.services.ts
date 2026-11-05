import {
	LEAGUE_IMAGE_JPEG_QUALITY,
	LEAGUE_IMAGE_SIZE_PX,
	LEAGUE_IMAGES_COLLECTION
} from '#lib/types/league.ts';
import { downscaleImageToSquareJpeg } from '#lib/utils/image.utils.ts';
import { isWeb2Backend } from '#lib/web2/backend-mode.ts';
import {
	deleteLeagueImage as deleteLeagueImageWeb2,
	uploadLeagueImage as uploadLeagueImageWeb2
} from '#lib/web2/client.ts';
import { isNullish } from '@dfinity/utils';
import { deleteAsset, uploadFile } from '@junobuild/core';

/**
 * Juno Storage helpers. Uploads land binary assets in a Storage
 * collection and persist only the resolved download URL on the owning
 * Datastore doc — we never inline base64 data URLs into a record.
 *
 * On the web2 backend the bytes go to the API's league-image route
 * instead (which stores them and stamps the serving URL on the league
 * row itself); the stored-URL contract the components render is the
 * same on both transports.
 */

/**
 * Downscale a user-picked image to a 256² cover JPEG and upload it to
 * the league-images Storage collection. Returns the public download URL
 * to persist on the league doc's `imageUrl`.
 *
 * The asset is keyed under `/<collection>/<leagueId>-<timestamp>.jpg`
 * so a re-upload for the same league never collides with the prior
 * asset (the caller clears the old one separately via
 * {@link deleteLeagueImageByUrl}).
 *
 * Throws when the picked file can't be decoded/painted (the caller
 * surfaces a friendly error) so a half-uploaded state never reaches the
 * doc.
 */
export const uploadLeagueImage = async ({
	leagueId,
	file
}: {
	leagueId: string;
	file: File;
}): Promise<string> => {
	const downscaled = await downscaleImageToSquareJpeg({
		file,
		size: LEAGUE_IMAGE_SIZE_PX,
		quality: LEAGUE_IMAGE_JPEG_QUALITY
	});

	if (isNullish(downscaled)) {
		throw new Error('Could not process the selected image.');
	}

	// The API route re-encodes to the canonical square cover server-side, but
	// the client-side downscale still runs first so the upload stays tiny; the
	// route also persists the URL on the league row, so the follow-up doc write
	// the caller performs is a read-back rather than a second persist.
	if (isWeb2Backend()) {
		const { imageUrl } = await uploadLeagueImageWeb2({ leagueId, image: downscaled });

		if (isNullish(imageUrl)) {
			throw new Error('Could not process the selected image.');
		}

		return imageUrl;
	}

	const { downloadUrl } = await uploadFile({
		collection: LEAGUE_IMAGES_COLLECTION,
		data: new File([downscaled], `${leagueId}-${Date.now()}.jpg`, { type: 'image/jpeg' })
	});

	return downloadUrl;
};

/**
 * Delete a previously-uploaded league image given its download URL.
 * Best-effort: a missing or already-deleted asset is swallowed so
 * clearing the doc's `imageUrl` never fails on a stale URL. Only acts
 * on URLs that point at the league-images collection — external or
 * malformed URLs (e.g. a legacy value) are left untouched.
 */
export const deleteLeagueImageByUrl = async (url: string): Promise<void> => {
	// The API serves one canonical cover URL per league
	// (`/api/v1/leagues/{id}/image`), so the league id is recovered from the
	// path and the delete goes through the owner-gated route, which drops the
	// asset and clears the row's URL. Same best-effort contract as below.
	if (isWeb2Backend()) {
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
			console.warn('storage.services: deleteLeagueImageByUrl failed', err);
		}

		return;
	}

	const prefix = `/${LEAGUE_IMAGES_COLLECTION}/`;

	let fullPath: string;

	try {
		({ pathname: fullPath } = new URL(url));
	} catch {
		return;
	}

	if (!fullPath.startsWith(prefix)) {
		return;
	}

	try {
		await deleteAsset({
			collection: LEAGUE_IMAGES_COLLECTION,
			fullPath
		});
	} catch (err) {
		// The doc-side clear is the source of truth; a dangling asset is
		// a cosmetic leak, not a failure the user should see.
		console.warn('storage.services: deleteLeagueImageByUrl failed', err);
	}
};
