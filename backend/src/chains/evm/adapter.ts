// EVM adapter: plain JSON-RPC over fetch, EIP-1559 signing via src/chains/evm/tx.ts.
// Native ETH deposits are found by scanning block transactions, ERC-20
// deposits via eth_getLogs Transfer events, both behind the configured
// confirmation depth with a persisted block cursor.

import { isNullish, nonNullish } from '@dfinity/utils';
import type { Asset } from '../../custody/assets';
import { query } from '../../db/client';
import { env } from '../../env';
import { ZERO } from '../../lib/constants';
import { deriveUserKey } from '../../lib/keys';
import { logger } from '../../lib/logger';
import {
	ChainDisabledError,
	type ChainAdapter,
	type DepositEvent,
	type TransferParams,
	type TransferStatus,
	type WatchResult
} from '../types';
import { encodeErc20Transfer, evmAddressFromPrivateKey, isEvmAddress, signEip1559Tx } from './tx';

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/** Bound one watcher tick so a long outage cannot produce an unbounded scan. */
const MAX_BLOCKS_PER_TICK = 50;

/** Recipients per eth_getLogs filter. Nodes reject a whole filter whose topic
 * OR-list is too long (geth caps one position at 1,000) and hosted providers
 * cap the request body, so a growing user base would fail every token scan
 * at once. Half the geth cap leaves room for stricter providers, and 500
 * left-padded topics keep a request near 35 KB. */
export const MAX_LOG_RECIPIENTS = 500;

const EVM_ADDRESS = /^0x[0-9a-f]{40}$/;

/** An address as the indexed `to` topic of an ERC-20 Transfer log. */
const addressTopic = (address: string): string => `0x${address.slice(2).padStart(64, '0')}`;

interface RpcError {
	code: number;
	message: string;
}

/** A null result is a valid answer for some methods (a receipt not yet mined). */
const rpcOrNull = async <T>(method: string, params: unknown[]): Promise<T | null> => {
	const response = await fetch(env.evm.rpcUrl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
	});

	if (!response.ok) {
		throw new Error(`evm rpc ${method} failed: http ${response.status}`);
	}

	const body = (await response.json()) as { result?: T; error?: RpcError };

	if (nonNullish(body.error)) {
		throw new Error(`evm rpc ${method} failed: ${body.error.message}`);
	}

	return body.result ?? null;
};

const rpc = async <T>(method: string, params: unknown[]): Promise<T> => {
	const result = await rpcOrNull<T>(method, params);

	if (isNullish(result)) {
		throw new Error(`evm rpc ${method} returned no result`);
	}

	return result;
};

const hexQuantity = (value: bigint): string => `0x${value.toString(16)}`;

const deriveAddress = (userId: string): string =>
	evmAddressFromPrivateKey(deriveUserKey({ userId, chain: 'evm' }));

const getBalance = async ({
	address,
	asset
}: {
	address: string;
	asset: Asset;
}): Promise<bigint> => {
	if (isNullish(asset.ledger_ref)) {
		return BigInt(await rpc<string>('eth_getBalance', [address, 'latest']));
	}

	const data = `0x70a08231${address.toLowerCase().replace('0x', '').padStart(64, '0')}`;
	const result = await rpc<string>('eth_call', [{ to: asset.ledger_ref, data }, 'latest']);

	return result === '0x' ? ZERO : BigInt(result);
};

const transfer = async ({ fromUserId, to, amount, asset }: TransferParams): Promise<string> => {
	if (isNullish(fromUserId)) {
		throw new Error('evm transfers require a sending user (no treasury key on evm yet)');
	}

	const privateKey = deriveUserKey({ userId: fromUserId, chain: 'evm' });
	const from = evmAddressFromPrivateKey(privateKey);
	const isNative = isNullish(asset.ledger_ref);

	const nonce = BigInt(await rpc<string>('eth_getTransactionCount', [from, 'pending']));
	const gasPrice = BigInt(await rpc<string>('eth_gasPrice', []));
	// A simple 2x headroom over the node's price quote; the priority fee rides
	// inside it. Unspent max fee is refunded by the protocol.
	const maxFeePerGas = gasPrice * BigInt(2);
	const maxPriorityFeePerGas = gasPrice / BigInt(10) + BigInt(1);

	const txRequest = isNative
		? { to, value: hexQuantity(amount), from }
		: { to: asset.ledger_ref ?? '', data: encodeErc20Transfer({ to, amount }), from };
	const gasLimit = BigInt(await rpc<string>('eth_estimateGas', [txRequest]));

	const raw = signEip1559Tx({
		tx: {
			chainId: BigInt(env.evm.chainId),
			nonce,
			maxPriorityFeePerGas,
			maxFeePerGas,
			gasLimit,
			to: isNative ? to : (asset.ledger_ref ?? ''),
			value: isNative ? amount : ZERO,
			data: isNative ? '' : encodeErc20Transfer({ to, amount })
		},
		privateKey
	});

	return await rpc<string>('eth_sendRawTransaction', [raw]);
};

interface RpcReceipt {
	status: string;
	blockNumber: string;
}

export const evmTransferStatus = async ({ txRef }: { txRef: string }): Promise<TransferStatus> => {
	const receipt = await rpcOrNull<RpcReceipt>('eth_getTransactionReceipt', [txRef]);

	if (isNullish(receipt)) {
		return 'pending';
	}

	const head = BigInt(await rpc<string>('eth_blockNumber', []));
	const confirmations = head - BigInt(receipt.blockNumber) + BigInt(1);

	// A revert is final only as deep as a success: a reorg can re-run it.
	if (confirmations < BigInt(env.evm.confirmations)) {
		return 'pending';
	}

	return receipt.status === '0x0' ? 'failed' : 'confirmed';
};

interface RpcBlock {
	number: string;
	transactions: { hash: string; to: string | null; value: string }[];
}

interface RpcLog {
	transactionHash: string;
	/** Hex quantity; null only on a pending log, which a confirmed range never holds. */
	logIndex: string | null;
	address: string;
	topics: string[];
	data: string;
}

interface TokenTransfer {
	log: RpcLog;
	asset: Asset;
	to: string;
	amount: bigint;
}

const logIndexOf = (log: RpcLog): bigint => {
	if (isNullish(log.logIndex)) {
		throw new Error(`evm log in ${log.transactionHash} has no logIndex`);
	}

	return BigInt(log.logIndex);
};

/**
 * Deposit events for ERC-20 transfers. Deposits dedupe on (account, asset,
 * tx_ref) and one transaction can carry several Transfer logs to the same
 * address, so each log needs a key of its own: `<txHash>:<logIndex>`. The
 * first log of a transaction to an address on a contract keeps the bare
 * hash, the key every token deposit was recorded under before log indexes
 * were part of it, which only ever credited that first log. A rescan of an
 * old block then collides with the row already booked instead of crediting
 * it twice.
 */
const tokenDepositEvents = (transfers: TokenTransfer[]): DepositEvent[] => {
	const groupOf = ({ log, asset, to }: TokenTransfer): string =>
		`${log.transactionHash}|${asset.id}|${to}`;
	const firstIndex = new Map<string, bigint>();

	for (const transfer of transfers) {
		const group = groupOf(transfer);
		const index = logIndexOf(transfer.log);
		const first = firstIndex.get(group);

		if (isNullish(first) || index < first) {
			firstIndex.set(group, index);
		}
	}

	return transfers.map((transfer) => {
		const { log, asset, to, amount } = transfer;
		const index = logIndexOf(log);

		return {
			kind: 'tx',
			txRef:
				index === firstIndex.get(groupOf(transfer))
					? log.transactionHash
					: `${log.transactionHash}:${index}`,
			address: to,
			amount,
			asset,
			confirmations: env.evm.confirmations
		};
	});
};

const readCursor = async (): Promise<bigint | null> => {
	const rows = await query<{ cursor: string }>(
		`select cursor from chain_cursors where chain = 'evm'`
	);
	const cursor = rows[0]?.cursor;

	return isNullish(cursor) ? null : BigInt(cursor);
};

const writeCursor = async (cursor: bigint): Promise<void> => {
	await query(
		`insert into chain_cursors (chain, cursor) values ('evm', $1)
		 on conflict (chain) do update set cursor = excluded.cursor, updated_at = now()`,
		[cursor.toString()]
	);
};

export const watchEvmDeposits = async ({
	addresses,
	assets
}: {
	addresses: string[];
	assets: Asset[];
}): Promise<WatchResult> => {
	if (addresses.length === 0) {
		return { events: [] };
	}

	const head = BigInt(await rpc<string>('eth_blockNumber', []));
	const safeHead = head - BigInt(env.evm.confirmations);

	if (safeHead <= ZERO) {
		return { events: [] };
	}

	const cursor = await readCursor();
	// First run starts at the safe head: historical back-fill is an explicit
	// operational action, not an implicit genesis scan.
	const fromBlock = isNullish(cursor) ? safeHead : cursor + BigInt(1);

	if (fromBlock > safeHead) {
		return { events: [] };
	}

	const toBlock =
		safeHead - fromBlock >= BigInt(MAX_BLOCKS_PER_TICK)
			? fromBlock + BigInt(MAX_BLOCKS_PER_TICK - 1)
			: safeHead;

	const addressSet = new Set(addresses.map((a) => a.toLowerCase()));
	const events: DepositEvent[] = [];

	const nativeAsset = assets.find((asset) => isNullish(asset.ledger_ref));
	const tokenAssets = assets.filter((asset) => nonNullish(asset.ledger_ref));

	if (nonNullish(nativeAsset)) {
		for (let block = fromBlock; block <= toBlock; block++) {
			const blockData = await rpc<RpcBlock>('eth_getBlockByNumber', [hexQuantity(block), true]);

			for (const txn of blockData.transactions) {
				if (
					nonNullish(txn.to) &&
					addressSet.has(txn.to.toLowerCase()) &&
					BigInt(txn.value) > ZERO
				) {
					events.push({
						kind: 'tx',
						txRef: txn.hash,
						address: txn.to.toLowerCase(),
						amount: BigInt(txn.value),
						asset: nativeAsset,
						confirmations: Number(head - block)
					});
				}
			}
		}
	}

	// A malformed address or contract can never match a transfer, but in the
	// filter it would make the node reject the call and stall every token
	// deposit on the chain.
	const recipients = [...addressSet].filter((address) => EVM_ADDRESS.test(address));
	const contracts = [
		...new Set(tokenAssets.map((asset) => (asset.ledger_ref ?? '').toLowerCase()))
	].filter((contract) => EVM_ADDRESS.test(contract));

	if (contracts.length > 0 && recipients.length > 0) {
		const logs: RpcLog[] = [];

		for (let start = 0; start < recipients.length; start += MAX_LOG_RECIPIENTS) {
			const batch = recipients.slice(start, start + MAX_LOG_RECIPIENTS);

			logs.push(
				...(await rpc<RpcLog[]>('eth_getLogs', [
					{
						fromBlock: hexQuantity(fromBlock),
						toBlock: hexQuantity(toBlock),
						address: contracts,
						topics: [TRANSFER_TOPIC, null, batch.map(addressTopic)]
					}
				]))
			);
		}

		// The node already filtered by contract and recipient; checking again
		// keeps a misbehaving provider from crediting someone else's transfer.
		const transfers: TokenTransfer[] = [];

		for (const log of logs) {
			const asset = tokenAssets.find(
				(candidate) => candidate.ledger_ref?.toLowerCase() === log.address.toLowerCase()
			);
			const [, , toTopic] = log.topics;

			if (nonNullish(asset) && nonNullish(toTopic)) {
				const to = `0x${toTopic.slice(-40)}`.toLowerCase();
				const amount = log.data === '0x' ? ZERO : BigInt(log.data);

				if (addressSet.has(to) && amount > ZERO) {
					transfers.push({ log, asset, to, amount });
				}
			}
		}

		events.push(...tokenDepositEvents(transfers));
	}

	if (events.length > 0) {
		logger.info(
			`evm watcher: observed ${events.length} deposit(s) in blocks ${fromBlock}-${toBlock}`
		);
	}

	return { events, commit: () => writeCursor(toBlock) };
};

// Gas is priced at send time and paid in the native coin, so no fee fixed at
// request time can describe it. Holding it is out of scope while evm
// withdrawals stay disabled in production.
const withdrawalFee = (): Promise<bigint> => Promise.resolve(ZERO);

const disabled = (): never => {
	throw new ChainDisabledError('evm');
};

export const evmAdapter: ChainAdapter = env.evm.enabled
	? {
			chain: 'evm',
			replaySafe: false,
			enabled: true,
			watchScope: 'chain',
			deriveAddress,
			isValidAddress: isEvmAddress,
			getBalance,
			withdrawalFee,
			transfer,
			transferStatus: evmTransferStatus,
			watchDeposits: watchEvmDeposits
		}
	: {
			chain: 'evm',
			replaySafe: false,
			enabled: false,
			watchScope: 'chain',
			deriveAddress,
			isValidAddress: isEvmAddress,
			getBalance: () => Promise.reject(new ChainDisabledError('evm')),
			withdrawalFee: () => Promise.reject(new ChainDisabledError('evm')),
			transfer: () => Promise.reject(new ChainDisabledError('evm')),
			transferStatus: () => Promise.reject(new ChainDisabledError('evm')),
			watchDeposits: disabled
		};
