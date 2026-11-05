import { getAgent } from '#lib/actors/agents.ic.ts';
import { WALLET_PAGINATION } from '#lib/constants/app.constants.ts';
import type { CanisterIdText } from '#lib/types/canister.ts';
import { getAccountIdentifier } from '#lib/utils/transactions.utils.ts';
import { IcpIndexCanister, type IcpIndexDid } from '@icp-sdk/canisters/ledger/icp';
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
}): Promise<IcpIndexDid.GetAccountIdentifierTransactionsResponse> => {
	const { getTransactions } = await indexCanister({ identity, indexCanisterId });

	return getTransactions({
		start,
		maxResults,
		accountIdentifier: getAccountIdentifier(principal).toHex()
	});
};

const indexCanister = async ({
	identity,
	indexCanisterId
}: {
	identity: Identity;
	indexCanisterId: CanisterIdText;
}): Promise<IcpIndexCanister> => {
	const agent = await getAgent({ identity });

	return IcpIndexCanister.create({
		agent,
		canisterId: Principal.fromText(indexCanisterId)
	});
};
