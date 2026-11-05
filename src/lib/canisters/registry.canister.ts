import {
	idlFactoryCertifiedRegistry,
	idlFactoryRegistry,
	type RegistryDid,
	type RegistryService
} from '#declarations';
import type { CreateCanisterOptions } from '#lib/types/canister.ts';
import {
	Canister,
	createServices,
	fromNullable,
	isNullish,
	jsonReplacer,
	nonNullish,
	type QueryParams,
	toNullable
} from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';

export class RegistryCanister extends Canister<RegistryService> {
	static create(options: CreateCanisterOptions<RegistryService>) {
		const { service, certifiedService, canisterId } = createServices<RegistryService>({
			options,
			idlFactory: idlFactoryRegistry,
			certifiedIdlFactory: idlFactoryCertifiedRegistry
		});

		return new RegistryCanister(canisterId, service, certifiedService);
	}

	addSeries = async ({
		params,
		...queryParams
	}: {
		params: RegistryDid.AddSeriesParams;
	} & QueryParams): Promise<string> => {
		const { add_series } = this.caller(queryParams);
		const result = await add_series(params);

		if ('Ok' in result) {
			return result.Ok;
		}

		throw new Error(`Failed to add series: ${JSON.stringify(result.Err, jsonReplacer)}`);
	};

	forkSeries = async ({
		params,
		...queryParams
	}: {
		params: RegistryDid.ForkSeriesParams;
	} & QueryParams): Promise<string> => {
		const { fork_series } = this.caller(queryParams);
		const result = await fork_series(params);

		if ('Ok' in result) {
			return result.Ok;
		}

		throw new Error(`Failed to fork series: ${JSON.stringify(result.Err, jsonReplacer)}`);
	};

	getSeries = async ({
		seriesId,
		...queryParams
	}: {
		seriesId: string;
	} & QueryParams): Promise<RegistryDid.Series | undefined> => {
		const { get_series } = this.caller(queryParams);
		const result = await get_series(seriesId);

		return fromNullable(result);
	};

	/**
	 * Lists registered series, transparently following the registry's
	 * exclusive pagination cursor until every matching page is drained.
	 *
	 * Pass `params` to use the filtered `list_series_with` endpoint — e.g.
	 * `only_unexpired: true` to let the registry drop expired series
	 * server-side (the expiry half of the "currently tradeable" predicate;
	 * resolution is owned by clearing's `list_settled_series`). Omitting
	 * `params` keeps the historical unfiltered `list_series` behavior.
	 *
	 * Any caller-supplied `pagination` is treated as the *page size* and
	 * starting `cursor`; the loop then walks `next_cursor` to completion so
	 * the returned array is the full result set regardless of page size.
	 */
	listSeries = async ({
		params,
		...queryParams
	}: {
		params?: RegistryDid.ListSeriesParams;
	} & QueryParams = {}): Promise<RegistryDid.Series[]> => {
		const { list_series, list_series_with } = this.caller(queryParams);

		const pageSize = fromNullable(params?.pagination ?? [])?.limit ?? toNullable();

		const items: RegistryDid.Series[] = [];
		let cursor = fromNullable(params?.pagination ?? [])?.cursor ?? toNullable();
		let done = false;

		// Drain every page: the registry caps a single response, so a naive
		// single call silently truncates the catalog once enough series exist.
		while (!done) {
			const page = nonNullish(params)
				? await list_series_with({
						...params,
						pagination: toNullable({ cursor, limit: pageSize })
					})
				: await list_series({ cursor, limit: pageSize });

			items.push(...page.items);

			const next = fromNullable(page.next_cursor);

			if (isNullish(next)) {
				done = true;
			} else {
				cursor = toNullable(next);
			}
		}

		return items;
	};

	createGroup = async ({
		params,
		...queryParams
	}: {
		params: RegistryDid.CreateGroupParams;
	} & QueryParams): Promise<string> => {
		const { create_group } = this.caller(queryParams);
		const result = await create_group(params);

		if ('Ok' in result) {
			return result.Ok;
		}

		throw new Error(`Failed to create group: ${JSON.stringify(result.Err, jsonReplacer)}`);
	};

	updateGroup = async ({
		params,
		...queryParams
	}: {
		params: RegistryDid.UpdateGroupParams;
	} & QueryParams): Promise<void> => {
		const { update_group } = this.caller(queryParams);
		const result = await update_group(params);

		if ('Err' in result) {
			throw new Error(`Failed to update group: ${JSON.stringify(result.Err, jsonReplacer)}`);
		}
	};

	addGroupAdmins = async ({
		params,
		...queryParams
	}: {
		params: RegistryDid.UpdateGroupAdminsParams;
	} & QueryParams): Promise<void> => {
		const { add_group_admins } = this.caller(queryParams);
		const result = await add_group_admins(params);

		if ('Err' in result) {
			throw new Error(`Failed to add group admins: ${JSON.stringify(result.Err, jsonReplacer)}`);
		}
	};

	removeGroupAdmins = async ({
		params,
		...queryParams
	}: {
		params: RegistryDid.UpdateGroupAdminsParams;
	} & QueryParams): Promise<void> => {
		const { remove_group_admins } = this.caller(queryParams);
		const result = await remove_group_admins(params);

		if ('Err' in result) {
			throw new Error(`Failed to remove group admins: ${JSON.stringify(result.Err, jsonReplacer)}`);
		}
	};

	addGroupMembers = async ({
		params,
		...queryParams
	}: {
		params: RegistryDid.UpdateGroupAdminsParams;
	} & QueryParams): Promise<void> => {
		const { add_group_members } = this.caller(queryParams);
		const result = await add_group_members(params);

		if ('Err' in result) {
			throw new Error(`Failed to add group members: ${JSON.stringify(result.Err, jsonReplacer)}`);
		}
	};

	removeGroupMembers = async ({
		params,
		...queryParams
	}: {
		params: RegistryDid.UpdateGroupAdminsParams;
	} & QueryParams): Promise<void> => {
		const { remove_group_members } = this.caller(queryParams);
		const result = await remove_group_members(params);

		if ('Err' in result) {
			throw new Error(
				`Failed to remove group members: ${JSON.stringify(result.Err, jsonReplacer)}`
			);
		}
	};

	getGroup = async ({
		groupId,
		...queryParams
	}: {
		groupId: string;
	} & QueryParams): Promise<RegistryDid.Group | undefined> => {
		const { get_group } = this.caller(queryParams);
		const result = await get_group(groupId);

		return fromNullable(result);
	};

	listGroups = async ({
		creator,
		...queryParams
	}: {
		creator?: string;
	} & QueryParams): Promise<RegistryDid.Group[]> => {
		const { list_groups } = this.caller(queryParams);

		return await list_groups(creator ? toNullable(Principal.fromText(creator)) : toNullable());
	};

	deleteGroup = async ({
		groupId,
		...queryParams
	}: {
		groupId: string;
	} & QueryParams): Promise<void> => {
		const { delete_group } = this.caller(queryParams);
		const result = await delete_group(groupId);

		if ('Err' in result) {
			throw new Error(`Failed to delete group: ${JSON.stringify(result.Err, jsonReplacer)}`);
		}
	};

	updateTradingAccess = async ({
		params,
		...queryParams
	}: {
		params: RegistryDid.UpdateTradingAccessParams;
	} & QueryParams): Promise<void> => {
		const { update_trading_access } = this.caller(queryParams);
		const result = await update_trading_access(params);

		if ('Err' in result) {
			throw new Error(
				`Failed to update trading access: ${JSON.stringify(result.Err, jsonReplacer)}`
			);
		}
	};

	getOracle = async ({
		oracleId,
		...queryParams
	}: {
		oracleId: string;
	} & QueryParams): Promise<RegistryDid.Oracle | undefined> => {
		const { get_oracle } = this.caller(queryParams);
		const result = await get_oracle(oracleId);

		return fromNullable(result);
	};

	addOracle = async ({
		params,
		...queryParams
	}: {
		params: RegistryDid.AddOracleParams;
	} & QueryParams): Promise<void> => {
		const { add_oracle } = this.caller(queryParams);
		const result = await add_oracle(params);

		if ('Err' in result) {
			throw new Error(`Failed to add oracle: ${JSON.stringify(result.Err, jsonReplacer)}`);
		}
	};

	manageOraclePrincipals = async ({
		params,
		...queryParams
	}: {
		params: RegistryDid.ManageOraclePrincipalsParams;
	} & QueryParams): Promise<void> => {
		const { manage_oracle_principals } = this.caller(queryParams);
		const result = await manage_oracle_principals(params);

		if ('Err' in result) {
			throw new Error(
				`Failed to manage oracle principals: ${JSON.stringify(result.Err, jsonReplacer)}`
			);
		}
	};
}
