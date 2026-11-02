// Bitcoin adapter over an Esplora-compatible HTTP API (mempool.space,
// blockstream.info). Addresses are P2WPKH from the derived secp256k1 key;
// spending builds and signs the transaction with @scure/btc-signer (the
// consensus-critical BIP143 sighash and witness serialization are not worth
// hand-rolling; the library is zero-dependency and from the same audited
// family as the noble crypto already in use).

import { isNullish, nonNullish } from '@dfinity/utils';
import { secp256k1 } from '@noble/curves/secp256k1';
import * as btc from '@scure/btc-signer';
import type { Asset } from '../../custody/assets';
import { env } from '../../env';
import { ZERO } from '../../lib/constants';
import { deriveUserKey } from '../../lib/keys';
import {
	ChainDisabledError,
	type ChainAdapter,
	type DepositEvent,
	type TransferParams,
	type WatchResult
} from '../types';
import { btcAddressFromPrivateKey, type BtcNetwork } from './address';

const NETWORKS: Record<BtcNetwork, typeof btc.NETWORK> = {
	mainnet: btc.NETWORK,
	testnet: btc.TEST_NETWORK,
	regtest: { ...btc.TEST_NETWORK, bech32: 'bcrt' }
};

const esplora = async <T>(path: string): Promise<T> => {
	const response = await fetch(`${env.btc.esploraUrl}${path}`);

	if (!response.ok) {
		throw new Error(`esplora ${path} failed: http ${response.status}`);
	}

	return (await response.json()) as T;
};

const esploraText = async (path: string): Promise<string> => {
	const response = await fetch(`${env.btc.esploraUrl}${path}`);

	if (!response.ok) {
		throw new Error(`esplora ${path} failed: http ${response.status}`);
	}

	return await response.text();
};

const deriveAddress = (userId: string): string =>
	btcAddressFromPrivateKey({
		privateKey: deriveUserKey({ userId, chain: 'btc' }),
		network: env.btc.network
	});

interface AddressStats {
	chain_stats: { funded_txo_sum: number; spent_txo_sum: number };
}

const getBalance = async ({ address }: { address: string; asset: Asset }): Promise<bigint> => {
	const stats = await esplora<AddressStats>(`/address/${address}`);

	return BigInt(stats.chain_stats.funded_txo_sum) - BigInt(stats.chain_stats.spent_txo_sum);
};

interface Utxo {
	txid: string;
	vout: number;
	value: number;
	status: { confirmed: boolean };
}

/** Conservative virtual size of a 1-in 2-out P2WPKH spend, grown per extra
 * input; used with the fee-estimate endpoint to price the transaction. */
const estimateVsize = (inputs: number): number => 31 * 2 + 11 + inputs * 68;

const transfer = async ({ fromUserId, to, amount }: TransferParams): Promise<string> => {
	if (isNullish(fromUserId)) {
		throw new Error('btc transfers require a sending user (no treasury key on btc yet)');
	}

	const privateKey = deriveUserKey({ userId: fromUserId, chain: 'btc' });
	const publicKey = secp256k1.getPublicKey(privateKey, true);
	const network = NETWORKS[env.btc.network];
	const from = btcAddressFromPrivateKey({ privateKey, network: env.btc.network });

	const utxos = (await esplora<Utxo[]>(`/address/${from}/utxo`)).filter(
		(utxo) => utxo.status.confirmed
	);
	const feeEstimates = await esplora<Record<string, number>>('/fee-estimates');
	// Target ~3 blocks; fall back to 2 sat/vB when the endpoint is sparse.
	const feeRate = Math.max(feeEstimates['3'] ?? feeEstimates['6'] ?? 2, 1);

	const payment = btc.p2wpkh(publicKey, network);
	const tx = new btc.Transaction();
	let selected = ZERO;
	let inputCount = 0;

	for (const utxo of utxos) {
		tx.addInput({
			txid: utxo.txid,
			index: utxo.vout,
			witnessUtxo: { script: payment.script, amount: BigInt(utxo.value) }
		});
		selected += BigInt(utxo.value);
		inputCount++;

		const fee = BigInt(Math.ceil(estimateVsize(inputCount) * feeRate));

		if (selected >= amount + fee) {
			break;
		}
	}

	const fee = BigInt(Math.ceil(estimateVsize(inputCount) * feeRate));

	if (selected < amount + fee) {
		throw new Error('insufficient confirmed utxo value for withdrawal plus fee');
	}

	tx.addOutputAddress(to, amount, network);

	const change = selected - amount - fee;

	// Dust change is left to the miners instead of creating an unspendable output.
	if (change > BigInt(546)) {
		tx.addOutputAddress(from, change, network);
	}

	tx.sign(privateKey);
	tx.finalize();

	const txid = await (async () => {
		const response = await fetch(`${env.btc.esploraUrl}/tx`, {
			method: 'POST',
			body: tx.hex
		});

		if (!response.ok) {
			throw new Error(`esplora broadcast failed: http ${response.status} ${await response.text()}`);
		}

		return await response.text();
	})();

	return txid.trim();
};

interface AddressTx {
	txid: string;
	status: { confirmed: boolean; block_height?: number };
	vout: { scriptpubkey_address?: string; value: number }[];
}

const CHAIN_TX_PAGE = 25;

/** The address's whole confirmed history: there is no cursor to stop at, and a
 * sweep can leave an address unread for several ticks, so a first page alone
 * could lose an output. Deposit addresses see few transactions. */
const confirmedTxs = async (address: string): Promise<AddressTx[]> => {
	const txs: AddressTx[] = [];
	let path = `/address/${address}/txs/chain`;

	for (;;) {
		const page = await esplora<AddressTx[]>(path);

		txs.push(...page);

		const last = page[CHAIN_TX_PAGE - 1];

		if (isNullish(last)) {
			return txs;
		}

		path = `/address/${address}/txs/chain/${last.txid}`;
	}
};

export const watchBtcDeposits = async ({
	addresses,
	assets
}: {
	addresses: string[];
	assets: Asset[];
}): Promise<WatchResult> => {
	const asset = assets.find((candidate) => candidate.symbol === 'BTC');

	if (isNullish(asset)) {
		return { events: [] };
	}

	const tipHeight = Number(await esploraText('/blocks/tip/height'));
	const events: DepositEvent[] = [];

	for (const address of addresses) {
		for (const transaction of await confirmedTxs(address)) {
			const blockHeight = transaction.status.block_height;

			if (transaction.status.confirmed && nonNullish(blockHeight)) {
				const confirmations = tipHeight - blockHeight + 1;
				const received = transaction.vout
					.filter((out) => out.scriptpubkey_address === address)
					.reduce((sum, out) => sum + BigInt(out.value), ZERO);

				if (confirmations >= env.btc.confirmations && received > ZERO) {
					events.push({
						kind: 'tx',
						txRef: transaction.txid,
						address,
						amount: received,
						asset,
						confirmations
					});
				}
			}
		}
	}

	return { events };
};

export const btcAdapter: ChainAdapter = env.btc.enabled
	? {
			chain: 'btc',
			enabled: true,
			watchScope: 'address',
			deriveAddress,
			getBalance,
			transfer,
			watchDeposits: watchBtcDeposits
		}
	: {
			chain: 'btc',
			enabled: false,
			watchScope: 'address',
			deriveAddress,
			getBalance: () => Promise.reject(new ChainDisabledError('btc')),
			transfer: () => Promise.reject(new ChainDisabledError('btc')),
			watchDeposits: () => Promise.reject(new ChainDisabledError('btc'))
		};
