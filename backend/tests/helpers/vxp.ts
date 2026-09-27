// Shared plumbing for the VXP economy suites: a recording ledger stub in
// place of the treasury-signed ICRC client, so awards exercise the full
// pending/paid/failed machinery without any network. The stub mirrors the
// ledger's deduplication: a transfer carrying created_at_time that matches
// one already landed answers Duplicate instead of moving funds again.

import { isNullish, nonNullish } from '@dfinity/utils';
import { IcrcTransferError } from '@icp-sdk/canisters/ledger/icrc';
import { query } from '../../src/db/client';
import { setVxpLedgerProvider, type VxpLedger } from '../../src/vxp/payout';

export interface RecordedTransfer {
	owner: string;
	amount: bigint;
	fee?: bigint;
	memo?: string;
	createdAtTime?: bigint;
}

export interface LedgerStub {
	/** Every transfer attempt, including rejected and deduplicated ones. */
	transfers: RecordedTransfer[];
	/** Only the transfers that moved funds, with their block index. */
	landed: Array<RecordedTransfer & { blockIndex: bigint }>;
	restore: () => void;
}

let nextBlock = BigInt(1);

/**
 * Installs a stub ledger. `transferImpl` may throw per call (BadFee tests);
 * the default acknowledges every transfer with an increasing block index.
 * `balance` feeds the recovery-floor gates.
 */
export const stubVxpLedger = ({
	transferImpl,
	balance
}: {
	transferImpl?: (call: RecordedTransfer, callIndex: number) => Promise<bigint>;
	balance?: () => Promise<bigint>;
} = {}): LedgerStub => {
	const transfers: RecordedTransfer[] = [];
	const landed: Array<RecordedTransfer & { blockIndex: bigint }> = [];

	const sameTransaction = (a: RecordedTransfer, b: RecordedTransfer): boolean =>
		a.owner === b.owner &&
		a.amount === b.amount &&
		a.fee === b.fee &&
		a.memo === b.memo &&
		a.createdAtTime === b.createdAtTime;

	const ledger: VxpLedger = {
		transfer: async (params) => {
			const call: RecordedTransfer = {
				owner: params.to.owner.toText(),
				amount: params.amount,
				fee: params.fee,
				memo: nonNullish(params.memo) ? new TextDecoder().decode(params.memo) : undefined,
				createdAtTime: params.created_at_time
			};

			transfers.push(call);

			const duplicate = nonNullish(call.createdAtTime)
				? landed.find((prior) => sameTransaction(prior, call))
				: undefined;

			if (nonNullish(duplicate)) {
				throw new IcrcTransferError({
					msg: 'duplicate',
					errorType: { Duplicate: { duplicate_of: duplicate.blockIndex } }
				});
			}

			let blockIndex: bigint;

			if (isNullish(transferImpl)) {
				nextBlock += BigInt(1);
				blockIndex = nextBlock;
			} else {
				blockIndex = await transferImpl(call, transfers.length - 1);
			}

			landed.push({ ...call, blockIndex });

			return blockIndex;
		},
		balance: () => (isNullish(balance) ? Promise.resolve(BigInt(0)) : balance())
	};

	const restore = setVxpLedgerProvider(() => Promise.resolve(ledger));

	return { transfers, landed, restore };
};

/** The stored award row for direct assertions on status transitions. */
export const readAwardRow = async ({
	userId,
	awardType,
	awardKey
}: {
	userId: string;
	awardType: string;
	awardKey: string;
}): Promise<
	| {
			status: string;
			amount_base_units: string;
			block_index: string | null;
			error_message: string | null;
	  }
	| undefined
> => {
	const rows = await query<{
		status: string;
		amount_base_units: string;
		block_index: string | null;
		error_message: string | null;
	}>(
		`select status, amount_base_units, block_index, error_message
		 from vxp_awards where user_id = $1 and award_type = $2 and award_key = $3`,
		[userId, awardType, awardKey]
	);

	return rows[0];
};
