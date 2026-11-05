import type { CanisterIdText } from '#lib/types/canister.ts';
import type { TransferParams } from '#lib/types/send.ts';
import type { Identity } from '@icp-sdk/core/agent';

export type IcTransferParams = Pick<TransferParams, 'amount' | 'to'> & {
	identity: Identity;
};

export type IcSendParams = IcTransferParams & {
	ledgerCanisterId: CanisterIdText;
};
