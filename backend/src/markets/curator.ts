// Shared write gate for per-series curator surfaces (market metadata, market
// translations): an admin may write any series, and the series creator may
// write their own. The creator is the principal that registered the series on
// the registry; a web user matches it through the custodial identity derived
// from their user id, or through a linked legacy principal from the earlier
// stack.

import { isNullish } from '@dfinity/utils';
import type { AuthedUser } from '../auth/guard';
import { query } from '../db/client';
import { getSeries } from '../engine/registry';
import { userIcPrincipalText } from '../lib/keys';

/** Thrown by curator-gated services; routes map it to a 403. */
export class CuratorForbiddenError extends Error {}

/** Thrown on invalid curator input; routes map it to a 400. */
export class MarketValidationError extends Error {}

/**
 * The principal that registered a series on the registry (`add_series`).
 * Returns undefined when the series is unknown.
 */
export const getSeriesCreator = async (seriesId: string): Promise<string | undefined> =>
	(await getSeries(seriesId))?.creator.toText();

export const isCreatorOrAdmin = async ({
	user,
	seriesId
}: {
	user: AuthedUser;
	seriesId: string;
}): Promise<boolean> => {
	if (user.role === 'admin') {
		return true;
	}

	const creator = await getSeriesCreator(seriesId);

	if (isNullish(creator)) {
		return false;
	}

	if (creator === userIcPrincipalText(user.id)) {
		return true;
	}

	const rows = await query<{ ok: number }>(
		`select 1 as ok from legacy_principals where user_id = $1 and principal = $2 limit 1`,
		[user.id, creator]
	);

	return rows.length > 0;
};

export const assertCreatorOrAdmin = async ({
	user,
	seriesId,
	surface
}: {
	user: AuthedUser;
	seriesId: string;
	surface: string;
}): Promise<void> => {
	if (!(await isCreatorOrAdmin({ user, seriesId }))) {
		throw new CuratorForbiddenError(`Only the market creator or an admin can edit ${surface}.`);
	}
};
