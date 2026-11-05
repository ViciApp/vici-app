import { getAgent } from '#lib/actors/agents.ic.ts';
import type { CanisterIdText } from '#lib/types/canister.ts';
import { assertNonNullish, nonNullish } from '@dfinity/utils';
import {
	IcrcLedgerCanister,
	toCandidAccount,
	type IcrcAccount,
	type IcrcLedgerDid
} from '@icp-sdk/canisters/ledger/icrc';
import type { Identity } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';

export const transfer = async ({
	identity,
	to,
	amount,
	createdAt,
	ledgerCanisterId
}: {
	identity: Identity;
	to: IcrcAccount;
	amount: bigint;
	createdAt?: bigint;
	ledgerCanisterId: CanisterIdText;
}): Promise<IcrcLedgerDid.BlockIndex> => {
	const { transfer } = await ledgerCanister({ identity, ledgerCanisterId });

	return transfer({
		to: toCandidAccount(to),
		amount,
		...(nonNullish(createdAt) ? { created_at_time: createdAt } : {})
	});
};

export const approve = async ({
	identity,
	ledgerCanisterId,
	amount,
	spender,
	expiresAt: expires_at,
	createdAt
}: {
	identity: Identity;
	ledgerCanisterId: CanisterIdText;
	amount: bigint;
	spender: IcrcAccount;
	expiresAt: bigint;
	createdAt?: bigint;
}): Promise<IcrcLedgerDid.BlockIndex> => {
	assertNonNullish(identity);

	const { approve } = await ledgerCanister({ identity, ledgerCanisterId });

	return approve({
		amount,
		spender: toCandidAccount(spender),
		expires_at,
		...(nonNullish(createdAt) ? { created_at_time: createdAt } : {})
	});
};

/**
 * Per-ledger ICRC transfer fee (base units). Used for approve headroom before `icrc2_transfer_from`.
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

export const balance = async ({
	identity,
	ledgerCanisterId,
	account
}: {
	identity: Identity;
	ledgerCanisterId: CanisterIdText;
	account: IcrcAccount;
}): Promise<bigint> => {
	const { balance } = await ledgerCanister({ identity, ledgerCanisterId });

	return balance(account);
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
