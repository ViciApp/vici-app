// Shared plumbing for the VXP economy suites: a recording ledger stub in
// place of the treasury-signed ICRC client, so awards exercise the full
// pending/paid/failed machinery without any network. The stub mirrors the
// ledger's deduplication: a transfer carrying created_at_time that matches
// one already landed answers Duplicate instead of moving funds again. Its
// history lookup reads the same landed list; `historySynced: false` models an
// index lagging behind the ledger, so a missing transfer is not provable.

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
	/** How many history lookups were made. */
	lookups: () => number;
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
	balance,
	historySynced = true
}: {
	transferImpl?: (call: RecordedTransfer, callIndex: number) => Promise<bigint>;
	balance?: () => Promise<bigint>;
	historySynced?: boolean;
} = {}): LedgerStub => {
	const transfers: RecordedTransfer[] = [];
	const landed: Array<RecordedTransfer & { blockIndex: bigint }> = [];
	let lookupCount = 0;

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
		balance: () => (isNullish(balance) ? Promise.resolve(BigInt(0)) : balance()),
		findTreasuryTransfer: ({ to, amount, memo, createdAtTimeNs }) => {
			lookupCount += 1;

			const match = landed.find(
				(prior) =>
					prior.owner === to.toText() &&
					prior.amount === amount &&
					prior.memo === new TextDecoder().decode(memo) &&
					prior.createdAtTime === createdAtTimeNs
			);

			if (nonNullish(match)) {
				return Promise.resolve({ status: 'found', blockIndex: match.blockIndex.toString() });
			}

			return Promise.resolve(
				historySynced ? { status: 'absent' } : { status: 'unknown', reason: 'index behind' }
			);
		}
	};

	const restore = setVxpLedgerProvider(() => Promise.resolve(ledger));

	return { transfers, landed, lookups: () => lookupCount, restore };
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
