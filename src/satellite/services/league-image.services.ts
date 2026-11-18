import { Collection } from '#lib/constants/collections.constants.ts';
import {
	LEAGUE_IMAGE_CONTENT_TYPE,
	LEAGUE_IMAGES_COLLECTION,
	leagueIdFromImageFullPath,
	type LeagueDoc
} from '#lib/types/league.ts';
import { isControllerText } from '#satellite/services/authz.services.ts';
import { isNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import type { AssertDeleteAssetContext, AssertUploadAssetContext } from '@junobuild/functions';
import { decodeDocData, getDocStore } from '@junobuild/functions/sdk';

/**
 * Only the owner of the league a cover's path names, or a satellite
 * controller, may change that cover. `league_images` is `write: 'public'`
 * and Juno does no owner check on it, while every cover's full path is
 * public (it is the league's `imageUrl`), so without this anyone could
 * overwrite or delete any league's cover. The owner is the principal
 * `assertSetLeague` lets set `imageUrl`.
 */
const assertLeagueOwnerOrController = ({
	caller,
	fullPath
}: {
	caller: Uint8Array;
	fullPath: string;
}): void => {
	const callerText = Principal.fromUint8Array(caller).toText();

	if (isControllerText(callerText)) {
		return;
	}

	const leagueId = leagueIdFromImageFullPath(fullPath);

	if (isNullish(leagueId)) {
		throw new Error(`${LEAGUE_IMAGES_COLLECTION}: ${fullPath} is not a league cover path.`);
	}

	const league = getDocStore({ caller, collection: Collection.LEAGUES, key: leagueId });

	if (isNullish(league)) {
		throw new Error(`${LEAGUE_IMAGES_COLLECTION}: no league ${leagueId}.`);
	}

	if (decodeDocData<LeagueDoc>(league.data).owner !== callerText) {
		throw new Error(`${LEAGUE_IMAGES_COLLECTION}: only the league owner may change its cover.`);
	}
};

const contentTypeOf = (headers: [string, string][]): string | undefined =>
	headers.find(([name]) => name.toLowerCase() === 'content-type')?.[1];

/**
 * Pre-upload guard for `league_images`: the cover of a league its owner
 * (or a controller) names in the path, stored as
 * {@link LEAGUE_IMAGE_CONTENT_TYPE} only. The per-asset size cap is the
 * collection's `maxSize` in `juno.config.ts`, which Juno checks itself.
 */
export const assertUploadLeagueImage = ({
	caller,
	data: { batch, commit_batch }
}: AssertUploadAssetContext): void => {
	if (batch.key.collection !== LEAGUE_IMAGES_COLLECTION) {
		return;
	}

	assertLeagueOwnerOrController({ caller, fullPath: batch.key.full_path });

	if (contentTypeOf(commit_batch.headers) !== LEAGUE_IMAGE_CONTENT_TYPE) {
		throw new Error(
			`${LEAGUE_IMAGES_COLLECTION}: content type must be ${LEAGUE_IMAGE_CONTENT_TYPE}.`
		);
	}
};

/** Pre-delete guard for `league_images`: the league's owner or a controller. */
export const assertDeleteLeagueImage = ({
	caller,
	data: { key }
}: AssertDeleteAssetContext): void => {
	if (key.collection !== LEAGUE_IMAGES_COLLECTION) {
		return;
	}

	assertLeagueOwnerOrController({ caller, fullPath: key.full_path });
};
