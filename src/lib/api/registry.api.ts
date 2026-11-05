import { getAgent } from '#lib/actors/agents.ic.ts';
import { RegistryCanister } from '#lib/canisters/registry.canister.ts';
import { REGISTRY_CANISTER_ID } from '#lib/constants/canisters.constants.ts';
import type { RegistryDid } from '$declarations';
import type { QueryParams } from '@dfinity/utils';
import type { Identity } from '@icp-sdk/core/agent';

export const addSeries = async ({
	identity,
	params,
	...queryParams
}: {
	identity: Identity;
	params: RegistryDid.AddSeriesParams;
} & QueryParams): Promise<string> => {
	const { addSeries } = await registryCanister({ identity });

	return await addSeries({ params, ...queryParams });
};

export const forkSeries = async ({
	identity,
	params,
	...queryParams
}: {
	identity: Identity;
	params: RegistryDid.ForkSeriesParams;
} & QueryParams): Promise<string> => {
	const { forkSeries } = await registryCanister({ identity });

	return await forkSeries({ params, ...queryParams });
};

export const getSeries = async ({
	identity,
	seriesId,
	...queryParams
}: {
	identity: Identity;
	seriesId: string;
} & QueryParams): Promise<RegistryDid.Series | undefined> => {
	const { getSeries } = await registryCanister({ identity });

	return await getSeries({ seriesId, ...queryParams });
};

export const listSeries = async ({
	identity,
	params,
	...queryParams
}: {
	identity: Identity;
	params?: RegistryDid.ListSeriesParams;
} & QueryParams): Promise<RegistryDid.Series[]> => {
	const { listSeries } = await registryCanister({ identity });

	return await listSeries({ params, ...queryParams });
};

export const createGroup = async ({
	identity,
	params,
	...queryParams
}: {
	identity: Identity;
	params: RegistryDid.CreateGroupParams;
} & QueryParams): Promise<string> => {
	const { createGroup } = await registryCanister({ identity });

	return await createGroup({ params, ...queryParams });
};

export const updateGroup = async ({
	identity,
	params,
	...queryParams
}: {
	identity: Identity;
	params: RegistryDid.UpdateGroupParams;
} & QueryParams): Promise<void> => {
	const { updateGroup } = await registryCanister({ identity });

	return await updateGroup({ params, ...queryParams });
};

export const addGroupAdmins = async ({
	identity,
	params,
	...queryParams
}: {
	identity: Identity;
	params: RegistryDid.UpdateGroupAdminsParams;
} & QueryParams): Promise<void> => {
	const { addGroupAdmins } = await registryCanister({ identity });

	return await addGroupAdmins({ params, ...queryParams });
};

export const removeGroupAdmins = async ({
	identity,
	params,
	...queryParams
}: {
	identity: Identity;
	params: RegistryDid.UpdateGroupAdminsParams;
} & QueryParams): Promise<void> => {
	const { removeGroupAdmins } = await registryCanister({ identity });

	return await removeGroupAdmins({ params, ...queryParams });
};

export const addGroupMembers = async ({
	identity,
	params,
	...queryParams
}: {
	identity: Identity;
	params: RegistryDid.UpdateGroupAdminsParams;
} & QueryParams): Promise<void> => {
	const { addGroupMembers } = await registryCanister({ identity });

	return await addGroupMembers({ params, ...queryParams });
};

export const removeGroupMembers = async ({
	identity,
	params,
	...queryParams
}: {
	identity: Identity;
	params: RegistryDid.UpdateGroupAdminsParams;
} & QueryParams): Promise<void> => {
	const { removeGroupMembers } = await registryCanister({ identity });

	return await removeGroupMembers({ params, ...queryParams });
};

export const getGroup = async ({
	identity,
	groupId,
	...queryParams
}: {
	identity: Identity;
	groupId: string;
} & QueryParams): Promise<RegistryDid.Group | undefined> => {
	const { getGroup } = await registryCanister({ identity });

	return await getGroup({ groupId, ...queryParams });
};

export const listGroups = async ({
	identity,
	creator,
	...queryParams
}: {
	identity: Identity;
	creator?: string;
} & QueryParams): Promise<RegistryDid.Group[]> => {
	const { listGroups } = await registryCanister({ identity });

	return await listGroups({ creator, ...queryParams });
};

export const deleteGroup = async ({
	identity,
	groupId,
	...queryParams
}: {
	identity: Identity;
	groupId: string;
} & QueryParams): Promise<void> => {
	const { deleteGroup } = await registryCanister({ identity });

	return await deleteGroup({ groupId, ...queryParams });
};

export const updateTradingAccess = async ({
	identity,
	params,
	...queryParams
}: {
	identity: Identity;
	params: RegistryDid.UpdateTradingAccessParams;
} & QueryParams): Promise<void> => {
	const { updateTradingAccess } = await registryCanister({ identity });

	return await updateTradingAccess({ params, ...queryParams });
};

export const getOracle = async ({
	identity,
	oracleId,
	...queryParams
}: {
	identity: Identity;
	oracleId: string;
} & QueryParams): Promise<RegistryDid.Oracle | undefined> => {
	const { getOracle } = await registryCanister({ identity });

	return await getOracle({ oracleId, ...queryParams });
};

export const addOracle = async ({
	identity,
	params,
	...queryParams
}: {
	identity: Identity;
	params: RegistryDid.AddOracleParams;
} & QueryParams): Promise<void> => {
	const { addOracle } = await registryCanister({ identity });

	return await addOracle({ params, ...queryParams });
};

export const manageOraclePrincipals = async ({
	identity,
	params,
	...queryParams
}: {
	identity: Identity;
	params: RegistryDid.ManageOraclePrincipalsParams;
} & QueryParams): Promise<void> => {
	const { manageOraclePrincipals } = await registryCanister({ identity });

	return await manageOraclePrincipals({ params, ...queryParams });
};

const registryCanister = async ({
	identity
}: {
	identity: Identity;
}): Promise<RegistryCanister> => {
	const agent = await getAgent({ identity });

	return RegistryCanister.create({
		agent,
		canisterId: REGISTRY_CANISTER_ID
	});
};
