import type { ClearingDid } from '#declarations';
import { DAY_IN_MS, ZERO } from '#lib/constants/app.constants.ts';
import { CLEARING_CANISTER_ID } from '#lib/constants/canisters.constants.ts';
import { VXP_TOKEN } from '#lib/constants/tokens/tokens.ic.constants.ts';
import type {
	IcpTransaction,
	IcrcTransaction,
	IcTransactionAddOnsInfo
} from '#lib/types/ic-transaction.ts';
import type { MarketId } from '#lib/types/market.ts';
import type { Token } from '#lib/types/token.ts';
import type { Transaction, TransactionType } from '#lib/types/wallet.ts';
import { decimalFixedValueToNumber } from '#lib/utils/format.utils.ts';
import { fromNullable, isNullish, jsonReplacer, nonNullish } from '@dfinity/utils';
import { type IcpIndexDid, AccountIdentifier } from '@icp-sdk/canisters/ledger/icp';
import {
	type IcrcAccount,
	type IcrcIndexDid,
	encodeIcrcAccount,
	fromCandidAccount
} from '@icp-sdk/canisters/ledger/icrc';
import type { Identity } from '@icp-sdk/core/agent';
import type { Principal } from '@icp-sdk/core/principal';

export const getAccountIdentifier = (principal: Principal): AccountIdentifier =>
	AccountIdentifier.fromPrincipal({ principal, subAccount: undefined });

export const getIcrcAccount = (principal: Principal): IcrcAccount => ({ owner: principal });

const CLEARING_PRINCIPAL_TEXT = CLEARING_CANISTER_ID.toText();

/**
 * Whether an ICRC counterparty principal is the clearing canister. We compare
 * by owner only so subaccounted addresses (e.g. per-user collateral
 * subaccounts) still match.
 */
const isClearingOwner = (owner: Principal | undefined): boolean =>
	nonNullish(owner) && owner.toText() === CLEARING_PRINCIPAL_TEXT;

/**
 * Splits self-transfers into a send and a receive pseudo-row so the wallet
 * activity list shows both legs (otherwise self-transfers look like a no-op).
 */
export const mapTransactionIcpToSelf = (
	tx: IcpIndexDid.TransactionWithId
): ({ transaction: IcpIndexDid.Transaction & IcTransactionAddOnsInfo } & Pick<
	IcpIndexDid.TransactionWithId,
	'id'
>)[] => {
	const { transaction, id } = tx;
	const { operation } = transaction;

	if (!('Transfer' in operation)) {
		return [
			{
				id,
				transaction
			}
		];
	}

	const {
		Transfer: { from, to }
	} = operation;

	return [
		{
			id,
			transaction: {
				...transaction,
				transferToSelf: 'send'
			}
		},
		...(from.toLowerCase() === to.toLowerCase()
			? [
					{
						id,
						transaction: {
							...transaction,
							transferToSelf: 'receive' as const
						}
					}
				]
			: [])
	];
};

export const mapIcpTransaction = ({
	transaction: { transaction, id },
	token,
	identity
}: {
	transaction: IcpTransaction;
	token: Transaction['token'];
	identity: Identity;
}): Transaction => {
	const { operation, timestamp, transferToSelf } = transaction;

	const principal = identity.getPrincipal();

	const tx: Pick<Transaction, 'id' | 'user' | 'timestamp' | 'token' | 'source' | 'domain'> = {
		id: `${id.toString()}${transferToSelf === 'receive' ? '-self' : ''}`,
		user: principal.toText(),
		timestamp: fromNullable(timestamp)?.timestamp_nanos ?? ZERO,
		token,
		source: 'ledger',
		domain: 'wallet'
	};

	const accountIdentifier = nonNullish(identity)
		? getAccountIdentifier(identity.getPrincipal())
		: undefined;

	if ('Approve' in operation) {
		const approve = operation.Approve;
		const approveValue = approve.allowance.e8s;

		return {
			...tx,
			type: 'Approve',
			amount: approveValue,
			counterparty: approve.spender
		};
	}

	if ('Burn' in operation) {
		return {
			...tx,
			type: 'Burn',
			amount: operation.Burn.amount.e8s,
			counterparty: operation.Burn.from
		};
	}

	if ('Mint' in operation) {
		return {
			...tx,
			type: 'Mint',
			amount: operation.Mint.amount.e8s,
			counterparty: operation.Mint.to
		};
	}

	if ('Transfer' in operation) {
		const { from } = operation.Transfer;
		const incoming =
			from?.toLowerCase() !== accountIdentifier?.toHex().toLowerCase() ||
			transferToSelf === 'receive';

		return {
			...tx,
			type: incoming ? 'Receive' : 'Send',
			amount: operation.Transfer.amount.e8s,
			counterparty: incoming ? operation.Transfer.from : operation.Transfer.to
		};
	}

	throw new Error(`Unknown transaction type ${JSON.stringify(transaction, jsonReplacer)}`);
};

export const mapTransactionIcrcToSelf = (tx: IcrcIndexDid.TransactionWithId): IcrcTransaction[] => {
	const { transaction, id } = tx;
	const { transfer: t } = transaction;

	const transfer = fromNullable(t);

	if (isNullish(transfer)) {
		return [
			{
				id,
				transaction
			}
		];
	}

	const { from, to } = transfer;

	const isSelfTransaction =
		encodeIcrcAccount(fromCandidAccount(from)).toLowerCase() ===
		encodeIcrcAccount(fromCandidAccount(to)).toLowerCase();

	return [
		{
			id,
			transaction: {
				...transaction,
				transferToSelf: 'send'
			}
		},
		...(isSelfTransaction
			? [
					{
						id,
						transaction: {
							...transaction,
							transferToSelf: 'receive' as const
						}
					}
				]
			: [])
	];
};

export const mapIcrcTransaction = ({
	transaction: { transaction, id },
	token,
	identity
}: {
	transaction: IcrcTransaction;
	token: Transaction['token'];
	identity: Identity;
}): Transaction => {
	const { timestamp, approve, burn, mint, transfer, transferToSelf } = transaction;

	const principal = identity.getPrincipal();

	const data =
		fromNullable(approve) ?? fromNullable(burn) ?? fromNullable(mint) ?? fromNullable(transfer);

	if (isNullish(data)) {
		throw new Error(`Unknown transaction type ${JSON.stringify(transaction, jsonReplacer)}`);
	}

	const accountIdentifier = nonNullish(identity)
		? encodeIcrcAccount(getIcrcAccount(identity.getPrincipal()))
		: undefined;

	const fromAccount = 'from' in data ? fromCandidAccount(data.from) : undefined;
	const toAccount = 'to' in data ? fromCandidAccount(data.to) : undefined;
	const from = nonNullish(fromAccount) ? encodeIcrcAccount(fromAccount) : undefined;
	const to = nonNullish(toAccount) ? encodeIcrcAccount(toAccount) : undefined;

	const incoming =
		from?.toLowerCase() !== accountIdentifier?.toLowerCase() || transferToSelf === 'receive';

	const isApprove = nonNullish(fromNullable(approve));
	const isBurn = nonNullish(fromNullable(burn));
	const isMint = nonNullish(fromNullable(mint));

	let type: TransactionType = isApprove
		? 'Approve'
		: isBurn
			? 'Burn'
			: isMint
				? 'Mint'
				: incoming
					? 'Receive'
					: 'Send';

	// Re-label transfers whose counterparty is the clearing canister as
	// collateral moves so the unified activity view shows them as wallet ↔
	// clearing flows rather than generic sends/receives.
	const isTransferRow = !isApprove && !isBurn && !isMint;

	if (isTransferRow) {
		if (type === 'Send' && isClearingOwner(toAccount?.owner)) {
			type = 'CollateralDeposit';
		} else if (type === 'Receive' && isClearingOwner(fromAccount?.owner)) {
			type = 'CollateralWithdraw';
		}
	}

	const value = data?.amount;

	const approveData = fromNullable(approve);
	const approveSpender = nonNullish(approveData)
		? encodeIcrcAccount(fromCandidAccount(approveData.spender))
		: undefined;

	const counterparty = isApprove ? approveSpender : isBurn ? from : isMint || incoming ? from : to;

	return {
		id: `${id.toString()}${transferToSelf === 'receive' ? '-self' : ''}`,
		user: principal.toText(),
		timestamp,
		type,
		source: 'ledger',
		domain: 'wallet',
		amount: value,
		token,
		counterparty,
		approveSpender
	};
};

/**
 * Maps a clearing-canister `Event` (OrderPlaced / Executed / Settled /
 * Liquidated) into a `Transaction` row so it can stream into the same
 * activity table as ICRC ledger entries.
 *
 * The on-chain event records `qty` (in token base units) and `price`
 * (a probability between 0 and 1). The user-visible "amount" for trades is
 * the notional, i.e. `qty × price`, rounded back to base units. For
 * `OrderPlaced` we use `qty` directly so the order's full notional shows up
 * regardless of execution status; the row is informational and does not
 * itself move VXP on the ICRC ledger.
 */
export const mapClearingEventToTransaction = ({
	event,
	token,
	user
}: {
	event: ClearingDid.Event;
	token: Token;
	user: string;
}): Transaction => {
	const [eventKey] = Object.keys(event.event_type) as Array<keyof ClearingDid.EventType>;

	const priceUnit = decimalFixedValueToNumber({
		value: event.price.decimal.value,
		decimals: event.price.decimal.decimals
	});

	const qtyAsNumber = Number(event.qty);
	const notional = BigInt(Math.round(qtyAsNumber * priceUnit));

	const type: TransactionType =
		eventKey === 'OrderPlaced'
			? 'OrderPlaced'
			: eventKey === 'Executed'
				? 'Trade'
				: eventKey === 'Settled'
					? 'Settlement'
					: 'Liquidation';

	const amount = type === 'OrderPlaced' ? event.qty : notional;

	return {
		id: `clearing-${event.event_id.toString()}-${eventKey}`,
		user,
		timestamp: event.timestamp,
		type,
		source: 'clearing',
		domain: 'collateral',
		marketId: event.series_id as MarketId,
		amount,
		token,
		priceE6: event.price.decimal.value,
		qty: event.qty
	};
};

const sortNewestFirst = (txs: Transaction[]): Transaction[] =>
	txs.sort((a, b) => (a.timestamp === b.timestamp ? 0 : a.timestamp > b.timestamp ? -1 : 1));

/**
 * Assembles the unified Wallet activity feed: merges the paged ICRC ledger
 * rows with the clearing rows, keeps only the tokens the wallet currently
 * surfaces, and sorts newest-first.
 */
export const mergeWalletFeed = ({
	ledgerTransactions,
	clearingTransactions,
	allowedLedgerCanisterIds
}: {
	ledgerTransactions: Transaction[];
	clearingTransactions: Transaction[];
	allowedLedgerCanisterIds: Iterable<string>;
}): Transaction[] => {
	const allowed = new Set(allowedLedgerCanisterIds);

	const merged = [...ledgerTransactions, ...clearingTransactions].filter((tx) =>
		allowed.has(tx.token.ledgerCanisterId)
	);

	return sortNewestFirst(merged);
};

/**
 * Weekly VXP delta — sums signed amounts on VXP-denominated rows from the last
 * 7 days. Settlements / receives / mints / rewards credit; trades / sends /
 * burns / liquidations debit (entry stake is never refunded). Result is in VXP
 * base units; format at display only.
 */
export const weeklyVxpDeltaBaseUnits = (transactions: Transaction[]): bigint => {
	const cutoffNs = BigInt(Date.now() - 7 * DAY_IN_MS) * 1_000_000n;
	let delta = ZERO;

	const recentVxpTx = transactions.filter(
		(tx) => tx.timestamp >= cutoffNs && tx.token.symbol === VXP_TOKEN.symbol
	);

	for (const tx of recentVxpTx) {
		switch (tx.type) {
			case 'Settlement':
			case 'Receive':
			case 'Mint':
			case 'Reward':
				delta += tx.amount;
				break;
			case 'Trade':
			case 'Send':
			case 'Burn':
			case 'Liquidation':
				delta -= tx.amount;
				break;
			default:
				break;
		}
	}

	return delta;
};
