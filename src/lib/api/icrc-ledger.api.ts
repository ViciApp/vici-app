import { getAgent } from '#lib/actors/agents.ic.ts';
import type { CanisterIdText } from '#lib/types/canister.ts';
import { IcrcLedgerCanister } from '@icp-sdk/canisters/ledger/icrc';
import type { Identity } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';

/**
 * Per-ledger ICRC transfer fee (base units), a public query: the VXP sweep keeps a reserve of it.
 */
export const transactionFee = async ({
	identity,
	ledgerCanisterId
}: {
	identity: Identity;
	ledgerCanisterId: CanisterIdText;
}): Promise<bigint> => {
	const { transactionFee: feeQuery } = await ledgerCanister({ identity, ledgerCanisterId });

	return feeQuery({});
};

const ledgerCanister = async ({
	identity,
	ledgerCanisterId
}: {
	identity: Identity;
	ledgerCanisterId: CanisterIdText;
}): Promise<IcrcLedgerCanister> => {
	const agent = await getAgent({ identity });

	return IcrcLedgerCanister.create({
		agent,
		canisterId: Principal.fromText(ledgerCanisterId)
	});
};
