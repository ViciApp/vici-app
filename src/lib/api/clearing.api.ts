import type { ClearingDid } from '#declarations';
import { getAgent } from '#lib/actors/agents.ic.ts';
import { ClearingCanister } from '#lib/canisters/clearing.canister.ts';
import { CLEARING_CANISTER_ID } from '#lib/constants/canisters.constants.ts';
import type { QueryParams } from '@dfinity/utils';
import type { Identity } from '@icp-sdk/core/agent';

export const listOrders = async ({
	identity,
	...rest
}: {
	identity: Identity;
	params: ClearingDid.ListOrdersParams;
} & QueryParams): Promise<ClearingDid.LimitOrder[]> => {
	const { listOrders } = await clearingCanister({ identity });

	return await listOrders(rest);
};

const clearingCanister = async ({
	identity
}: {
	identity: Identity;
}): Promise<ClearingCanister> => {
	const agent = await getAgent({ identity });

	return ClearingCanister.create({
		agent,
		canisterId: CLEARING_CANISTER_ID
	});
};
