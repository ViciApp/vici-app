import { REGISTRY_CANISTER_ID } from '#lib/constants/canisters.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import { UserRole } from '#lib/enums/user.ts';
import type { RegistryDid } from '$declarations';
import { candidMethod } from '$satellite/utils/candid.utils';
import { isNullish } from '@dfinity/utils';
import type { Principal } from '@icp-sdk/core/principal';
import { call } from '@junobuild/functions/ic-cdk';
import { decodeDocData, getDocStore } from '@junobuild/functions/sdk';

/**
 * Shared admin check. Reads the caller's `ROLES` doc and returns
 * whether the role is `ADMIN`. Used by services that gate writes
 * (e.g. market metadata, market translations).
 */
export const isAdmin = ({ caller }: { caller: Principal }): boolean => {
	const callerDoc = getDocStore({
		collection: Collection.ROLES,
		key: caller.toText(),
		caller
	});

	if (isNullish(callerDoc)) {
		return false;
	}

	const { role } = decodeDocData<{ role: UserRole }>(callerDoc.data);

	return role === UserRole.ADMIN;
};

/**
 * The principal that registered a series on the registry (`add_series`).
 * Returns `undefined` when the series is unknown.
 */
export const getSeriesCreator = async (seriesId: string): Promise<string | undefined> => {
	const { argTypes, result: resultType } = candidMethod({
		canister: 'registry',
		method: 'get_series'
	});
	const result = await call<[] | [RegistryDid.Series]>({
		canisterId: REGISTRY_CANISTER_ID,
		method: 'get_series',
		args: [[argTypes[0], seriesId]],
		result: resultType
	});

	return result[0]?.creator.toText();
};

/**
 * Shared write gate for per-series curator surfaces (market metadata,
 * market translations): an `ADMIN` may write any series, and the series
 * creator may write their own.
 */
export const isCreatorOrAdmin = async ({
	caller,
	seriesId
}: {
	caller: Principal;
	seriesId: string;
}): Promise<boolean> => {
	if (isAdmin({ caller })) {
		return true;
	}

	const creator = await getSeriesCreator(seriesId);

	return creator === caller.toText();
};
