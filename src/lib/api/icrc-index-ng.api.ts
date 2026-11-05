import { getAgent } from '#lib/actors/agents.ic.ts';
import { WALLET_PAGINATION } from '#lib/constants/app.constants.ts';
import type { CanisterIdText } from '#lib/types/canister.ts';
import { getIcrcAccount } from '#lib/utils/transactions.utils.ts';
import { IcrcIndexCanister, type IcrcIndexDid } from '@icp-sdk/canisters/ledger/icrc';
import type { Identity } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';

export const getTransactions = async ({
	identity,
	principal,
	start,
	maxResults = WALLET_PAGINATION,
	indexCanisterId
}: {
	identity: Identity;
	principal: Principal;
	start?: bigint;
	maxResults?: bigint;
	indexCanisterId: CanisterIdText;
}): Promise<IcrcIndexDid.GetTransactions> => {
	const { getTransactions } = await indexNgCanister({ identity, indexCanisterId });

	return getTransactions({
		start,
		max_results: maxResults,
		account: getIcrcAccount(principal)
	});
};

const indexNgCanister = async ({
	identity,
	indexCanisterId
}: {
	identity: Identity;
	indexCanisterId: CanisterIdText;
}): Promise<IcrcIndexCanister> => {
	const agent = await getAgent({ identity });

	return IcrcIndexCanister.create({
		agent,
		canisterId: Principal.fromText(indexCanisterId)
	});
};
