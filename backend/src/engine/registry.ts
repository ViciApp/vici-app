// Typed wrappers over the registry canister, mirroring the method surface the
// app consumes: catalog reads sign with the engine reader identity behind the
// shared TTL cache, group management signs per-user, series/oracle
// administration signs with the admin identity.

import { fromNullable, isNullish, jsonReplacer, nonNullish, toNullable } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import type { RegistryDid } from '../declarations';
import { adminRegistry, readerRegistry, userRegistry } from './actors';
import { cached } from './cache';

const PUBLIC_READ_TTL_MS = 15_000;

const expectOk = <O>(result: { Ok: O } | { Err: unknown }, label: string): O => {
	if ('Ok' in result) {
		return result.Ok;
	}

	throw new Error(`${label} failed: ${JSON.stringify(result.Err, jsonReplacer)}`);
};

// Public catalog reads (engine reader identity, cached)

export const getSeries = (seriesId: string): Promise<RegistryDid.Series | undefined> =>
	cached({
		key: `registry:series:${seriesId}`,
		ttlMs: PUBLIC_READ_TTL_MS,
		load: async () => {
			const actor = await readerRegistry();

			return fromNullable(await actor.get_series(seriesId));
		}
	});

/** Drains the registry's pagination cursor to completion, exactly like the
 * app's canister wrapper: filtered reads go through `list_series_with`, the
 * unfiltered legacy read through `list_series`. */
export const listSeries = (params?: RegistryDid.ListSeriesParams): Promise<RegistryDid.Series[]> =>
	cached({
		key: `registry:series-list:${JSON.stringify(params ?? {}, jsonReplacer)}`,
		ttlMs: PUBLIC_READ_TTL_MS,
		load: async () => {
			const actor = await readerRegistry();
			const pageSize = fromNullable(params?.pagination ?? [])?.limit ?? toNullable();
			const items: RegistryDid.Series[] = [];
			let cursor = fromNullable(params?.pagination ?? [])?.cursor ?? toNullable();

			for (;;) {
				const page = nonNullish(params)
					? await actor.list_series_with({
							...params,
							pagination: toNullable({ cursor, limit: pageSize })
						})
					: await actor.list_series({ cursor, limit: pageSize });

				items.push(...page.items);

				const next = fromNullable(page.next_cursor);

				if (isNullish(next)) {
					return items;
				}

				cursor = toNullable(next);
			}
		}
	});

export const getGroup = async (groupId: string): Promise<RegistryDid.Group | undefined> => {
	const actor = await readerRegistry();

	return fromNullable(await actor.get_group(groupId));
};

export const listGroups = async (creator?: string): Promise<RegistryDid.Group[]> => {
	const actor = await readerRegistry();

	return await actor.list_groups(isNullish(creator) ? [] : [Principal.fromText(creator)]);
};

export const getOracle = async (oracleId: string): Promise<RegistryDid.Oracle | undefined> => {
	const actor = await readerRegistry();

	return fromNullable(await actor.get_oracle(oracleId));
};

// Per-user group management

export const createGroup = async ({
	userId,
	params
}: {
	userId: string;
	params: RegistryDid.CreateGroupParams;
}): Promise<string> => {
	const actor = await userRegistry(userId);

	return expectOk(await actor.create_group(params), 'create_group');
};

export const updateGroup = async ({
	userId,
	params
}: {
	userId: string;
	params: RegistryDid.UpdateGroupParams;
}): Promise<void> => {
	const actor = await userRegistry(userId);

	expectOk(await actor.update_group(params), 'update_group');
};

export const addGroupAdmins = async ({
	userId,
	params
}: {
	userId: string;
	params: RegistryDid.UpdateGroupAdminsParams;
}): Promise<void> => {
	const actor = await userRegistry(userId);

	expectOk(await actor.add_group_admins(params), 'add_group_admins');
};

export const removeGroupAdmins = async ({
	userId,
	params
}: {
	userId: string;
	params: RegistryDid.UpdateGroupAdminsParams;
}): Promise<void> => {
	const actor = await userRegistry(userId);

	expectOk(await actor.remove_group_admins(params), 'remove_group_admins');
};

export const addGroupMembers = async ({
	userId,
	params
}: {
	userId: string;
	params: RegistryDid.UpdateGroupAdminsParams;
}): Promise<void> => {
	const actor = await userRegistry(userId);

	expectOk(await actor.add_group_members(params), 'add_group_members');
};

export const removeGroupMembers = async ({
	userId,
	params
}: {
	userId: string;
	params: RegistryDid.UpdateGroupAdminsParams;
}): Promise<void> => {
	const actor = await userRegistry(userId);

	expectOk(await actor.remove_group_members(params), 'remove_group_members');
};

export const deleteGroup = async ({
	userId,
	groupId
}: {
	userId: string;
	groupId: string;
}): Promise<void> => {
	const actor = await userRegistry(userId);

	expectOk(await actor.delete_group(groupId), 'delete_group');
};

// Privileged administration (admin identity)

export const addSeries = async (params: RegistryDid.AddSeriesParams): Promise<string> => {
	const actor = await adminRegistry();

	return expectOk(await actor.add_series(params), 'add_series');
};

export const forkSeries = async (params: RegistryDid.ForkSeriesParams): Promise<string> => {
	const actor = await adminRegistry();

	return expectOk(await actor.fork_series(params), 'fork_series');
};

export const updateTradingAccess = async (
	params: RegistryDid.UpdateTradingAccessParams
): Promise<void> => {
	const actor = await adminRegistry();

	expectOk(await actor.update_trading_access(params), 'update_trading_access');
};

export const addOracle = async (params: RegistryDid.AddOracleParams): Promise<void> => {
	const actor = await adminRegistry();

	expectOk(await actor.add_oracle(params), 'add_oracle');
};

export const manageOraclePrincipals = async (
	params: RegistryDid.ManageOraclePrincipalsParams
): Promise<void> => {
	const actor = await adminRegistry();

	expectOk(await actor.manage_oracle_principals(params), 'manage_oracle_principals');
};
