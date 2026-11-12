// Withdrawal lifecycle. The funds move on the internal ledger at request time
// (hold: user -> external for the amount, user -> network_fee for the chain
// fee the sender pays on top) so a user can never double-spend a pending
// withdrawal and the internal balance drops exactly as the on-chain one will;
// a failed or rejected withdrawal posts the compensating refund.
//
//   requested -> processing | rejected   (processing via claimWithdrawal, which
//                                          fixes the transfer's dedup fields)
//   processing -> submitted | failed
//   submitted -> confirmed | failed
//   confirmed / failed / rejected are terminal.

import { isNullish, nonNullish } from '@dfinity/utils';
import { query, tx, type TxQuery } from '../db/client';
import { ZERO } from '../lib/constants';
import { nowNs } from '../lib/time';
import { ensureInternalAccount, ensureUserAccount } from './accounts';
import { isWithdrawable, type Asset } from './assets';
import { accountBalance, postLedgerEvent, type LedgerLeg } from './ledger';

export type WithdrawalState =
	'requested' | 'processing' | 'submitted' | 'confirmed' | 'failed' | 'rejected';

export interface Withdrawal {
	id: string;
	user_id: string;
	asset_id: string;
	amount: string;
	/** The network fee the sender pays on top of `amount`, fixed at request
	 * time, held with it and sent explicitly with every attempt. 0 on rows
	 * requested before the fee was held, which were sent without one. */
	fee: string;
	destination: string;
	self_custody: boolean;
	state: WithdrawalState;
	tx_ref: string | null;
	failure_reason: string | null;
	/** Fixed by the claim that first moves the row to processing and resent
	 * unchanged on every attempt, so a replay-safe chain deduplicates it. */
	transfer_memo: string | null;
	transfer_created_at_ns: string | null;
}

export const WITHDRAWAL_TRANSITIONS: Record<WithdrawalState, readonly WithdrawalState[]> = {
	requested: ['processing', 'rejected'],
	processing: ['submitted', 'failed'],
	submitted: ['confirmed', 'failed'],
	confirmed: [],
	failed: [],
	rejected: []
};

export const canTransition = ({
	from,
	to
}: {
	from: WithdrawalState;
	to: WithdrawalState;
}): boolean => WITHDRAWAL_TRANSITIONS[from].includes(to);

const COLUMNS = `id, user_id, asset_id, amount::text as amount, fee::text as fee, destination,
	self_custody, state, tx_ref, failure_reason, transfer_memo,
	transfer_created_at_ns::text as transfer_created_at_ns`;

const SELECT = `select ${COLUMNS} from withdrawals`;

export class InsufficientBalanceError extends Error {}

export class AssetNotWithdrawableError extends Error {}

/** The hold's legs; the refund posts them negated. A zero fee books no fee
 * leg, so a row requested before the fee was held refunds exactly its hold. */
const holdLegs = ({
	userAccountId,
	externalId,
	feeAccountId,
	assetId,
	amount,
	fee
}: {
	userAccountId: string;
	externalId: string;
	feeAccountId: string | undefined;
	assetId: string;
	amount: bigint;
	fee: bigint;
}): LedgerLeg[] => {
	const legs: LedgerLeg[] = [
		{ accountId: userAccountId, assetId, delta: (-(amount + fee)).toString() },
		{ accountId: externalId, assetId, delta: amount.toString() }
	];

	if (fee === ZERO) {
		return legs;
	}

	if (isNullish(feeAccountId)) {
		throw new Error('withdrawal fee has no network fee account to book it in');
	}

	return [...legs, { accountId: feeAccountId, assetId, delta: fee.toString() }];
};

/** Create a withdrawal request and post the balance hold atomically. Throws
 * AssetNotWithdrawableError for an asset that may never leave the platform,
 * before any balance is read, and InsufficientBalanceError when the internal
 * balance cannot cover the amount plus the fee. */
export const requestWithdrawal = async ({
	userId,
	asset,
	amount,
	fee,
	destination,
	selfCustody,
	userAddress
}: {
	userId: string;
	asset: Asset;
	amount: bigint;
	/** The network fee the chain charges the sender on top of `amount`, read
	 * from the adapter (passed in so this module stays chain-agnostic). */
	fee: bigint;
	destination: string;
	selfCustody: boolean;
	/** The user's custodial address on the asset's chain (derived by the
	 * adapter; passed in so this module stays chain-agnostic). */
	userAddress: string;
}): Promise<Withdrawal> => {
	if (!isWithdrawable(asset)) {
		throw new AssetNotWithdrawableError(`${asset.chain}:${asset.symbol} is not withdrawable`);
	}

	if (amount <= ZERO) {
		throw new Error('withdrawal amount must be positive');
	}

	if (fee < ZERO) {
		throw new Error('withdrawal fee must not be negative');
	}

	const account = await ensureUserAccount({ userId, chain: asset.chain, address: userAddress });
	const external = await ensureInternalAccount({
		kind: 'external',
		chain: asset.chain,
		address: 'external'
	});
	const feeAccount =
		fee > ZERO
			? await ensureInternalAccount({
					kind: 'network_fee',
					chain: asset.chain,
					address: 'network_fee'
				})
			: undefined;

	return tx(async (q) => {
		// Under read committed two requests would both read the balance before
		// either hold lands and overdraw it together; the row lock makes the
		// second wait for the first hold and read the balance after it.
		await q(`select id from custody_accounts where id = $1 for update`, [account.id]);

		const balance = await accountBalance({ q, accountId: account.id, assetId: asset.id });

		if (balance < amount + fee) {
			throw new InsufficientBalanceError(
				`balance ${balance} below requested withdrawal ${amount} plus network fee ${fee}`
			);
		}

		const inserted = await q<Withdrawal>(
			`insert into withdrawals (user_id, asset_id, amount, fee, destination, self_custody)
			 values ($1, $2, $3, $4, $5, $6)
			 returning ${COLUMNS}`,
			[userId, asset.id, amount.toString(), fee.toString(), destination, selfCustody]
		);
		const [withdrawal] = inserted;

		if (isNullish(withdrawal)) {
			throw new Error('withdrawal insert returned no row');
		}

		await postLedgerEvent(
			{
				eventKey: `withdrawal:${withdrawal.id}:hold`,
				kind: 'withdrawal_hold',
				legs: holdLegs({
					userAccountId: account.id,
					externalId: external.id,
					feeAccountId: feeAccount?.id,
					assetId: asset.id,
					amount,
					fee
				})
			},
			q
		);

		return withdrawal;
	});
};

/** Advance a withdrawal through the state machine. The `where state = $from`
 * guard makes concurrent workers race safely: exactly one transition wins.
 * Returns the updated row, or null when the row was not in `from` anymore. */
export const transitionWithdrawal = async ({
	id,
	from,
	to,
	txRef,
	failureReason
}: {
	id: string;
	from: WithdrawalState;
	to: WithdrawalState;
	txRef?: string;
	failureReason?: string;
}): Promise<Withdrawal | null> => {
	if (!canTransition({ from, to })) {
		throw new Error(`invalid withdrawal transition ${from} -> ${to}`);
	}

	// One transaction with the refund: a terminal state committed without it
	// would leave the hold spent, and nothing selects a terminal row again.
	return await tx(async (q) => {
		const updated = await q<Withdrawal>(
			`update withdrawals
			 set state = $1,
				 tx_ref = coalesce($2, tx_ref),
				 failure_reason = coalesce($3, failure_reason),
				 updated_at = now()
			 where id = $4 and state = $5
			 returning ${COLUMNS}`,
			[to, txRef ?? null, failureReason ?? null, id, from]
		);
		const row = updated[0] ?? null;

		if (nonNullish(row) && (to === 'failed' || to === 'rejected')) {
			await refundWithdrawal({ q, withdrawal: row });
		}

		return row;
	});
};

/** requested -> processing, fixing the transfer's dedup fields in the same
 * statement, before anything is sent: every later attempt resends exactly
 * these, so a chain that deduplicates answers a resend of a landed transfer
 * with the original instead of paying twice. Returns null when another runner
 * already claimed the row. */
export const claimWithdrawal = async (id: string): Promise<Withdrawal | null> => {
	const claimed = await query<Withdrawal>(
		`update withdrawals
		 set state = 'processing',
			 transfer_memo = coalesce(transfer_memo, 'withdrawal:' || id::text),
			 transfer_created_at_ns = coalesce(transfer_created_at_ns, $2),
			 updated_at = now()
		 where id = $1 and state = 'requested'
		 returning ${COLUMNS}`,
		[id, nowNs().toString()]
	);

	return claimed[0] ?? null;
};

/** Post the compensating refund for a failed/rejected withdrawal: the hold's
 * legs reversed, fee included, since a rejected transfer charged no fee.
 * Idempotent via the event key: replaying after a crash cannot double-refund. */
const refundWithdrawal = async ({
	q,
	withdrawal
}: {
	q: TxQuery;
	withdrawal: Withdrawal;
}): Promise<void> => {
	const accounts = await q<{ id: string }>(
		`select id from custody_accounts
		 where user_id = $1
			 and chain = (select chain from assets where id = $2)`,
		[withdrawal.user_id, withdrawal.asset_id]
	);
	const internals = await q<{ id: string; kind: string }>(
		`select id, kind from custody_accounts
		 where user_id is null and kind in ('external', 'network_fee')
			 and chain = (select chain from assets where id = $1)`,
		[withdrawal.asset_id]
	);
	const accountId = accounts[0]?.id;
	const externalId = internals.find(({ kind }) => kind === 'external')?.id;

	if (isNullish(accountId) || isNullish(externalId)) {
		throw new Error('withdrawal refund could not resolve the ledger accounts');
	}

	const hold = holdLegs({
		userAccountId: accountId,
		externalId,
		feeAccountId: internals.find(({ kind }) => kind === 'network_fee')?.id,
		assetId: withdrawal.asset_id,
		amount: BigInt(withdrawal.amount),
		fee: BigInt(withdrawal.fee)
	});

	await postLedgerEvent(
		{
			eventKey: `withdrawal:${withdrawal.id}:refund`,
			kind: 'withdrawal_refund',
			legs: hold.map((leg) => ({ ...leg, delta: (-BigInt(leg.delta)).toString() }))
		},
		q
	);
};

export const listUserWithdrawals = (userId: string): Promise<Withdrawal[]> =>
	query<Withdrawal>(`${SELECT} where user_id = $1 order by created_at desc`, [userId]);

export const getWithdrawal = async (id: string): Promise<Withdrawal | null> => {
	const rows = await query<Withdrawal>(`${SELECT} where id = $1`, [id]);

	return rows[0] ?? null;
};

/** Used by tests and future reconciliation: a transaction-scoped balance read
 * without opening a new pool client. */
export const userChainBalance = async ({
	q,
	userId,
	asset
}: {
	q: TxQuery;
	userId: string;
	asset: Asset;
}): Promise<bigint> => {
	const rows = await q<{ id: string }>(
		`select id from custody_accounts where user_id = $1 and chain = $2`,
		[userId, asset.chain]
	);
	const accountId = rows[0]?.id;

	if (isNullish(accountId)) {
		return ZERO;
	}

	return accountBalance({ q, accountId, assetId: asset.id });
};
