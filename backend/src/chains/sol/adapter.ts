// Solana adapter: JSON-RPC over fetch, ed25519 signing from the derived
// seed. Deposits are detected per address via getSignaturesForAddress with a
// per-address cursor, then credited from the parsed transaction balances.

import { isNullish, nonNullish } from '@dfinity/utils';
import type { Asset } from '../../custody/assets';
import { query } from '../../db/client';
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
import {
	buildSolTransferTx,
	buildSplTransferTx,
	deriveAssociatedTokenAccount,
	solAddressFromSeed
} from './tx';

interface RpcError {
	code: number;
	message: string;
}

const rpc = async <T>(method: string, params: unknown[]): Promise<T> => {
	const response = await fetch(env.sol.rpcUrl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
	});

	if (!response.ok) {
		throw new Error(`sol rpc ${method} failed: http ${response.status}`);
	}

	const body = (await response.json()) as { result?: T; error?: RpcError };

	if (nonNullish(body.error)) {
		throw new Error(`sol rpc ${method} failed: ${body.error.message}`);
	}

	if (isNullish(body.result)) {
		throw new Error(`sol rpc ${method} returned no result`);
	}

	return body.result;
};

const userSeed = (userId: string): Uint8Array => deriveUserKey({ userId, chain: 'sol' });

const deriveAddress = (userId: string): string => solAddressFromSeed(userSeed(userId));

const getBalance = async ({
	address,
	asset
}: {
	address: string;
	asset: Asset;
}): Promise<bigint> => {
	if (isNullish(asset.ledger_ref)) {
		const result = await rpc<{ value: number }>('getBalance', [
			address,
			{ commitment: env.sol.commitment }
		]);

		return BigInt(result.value);
	}

	const result = await rpc<{
		value: { account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }[];
	}>('getTokenAccountsByOwner', [
		address,
		{ mint: asset.ledger_ref },
		{ encoding: 'jsonParsed', commitment: env.sol.commitment }
	]);

	return result.value.reduce(
		(sum, entry) => sum + BigInt(entry.account.data.parsed.info.tokenAmount.amount),
		ZERO
	);
};

const latestBlockhash = async (): Promise<string> => {
	const result = await rpc<{ value: { blockhash: string } }>('getLatestBlockhash', [
		{ commitment: env.sol.commitment }
	]);

	return result.value.blockhash;
};

const transfer = async ({ fromUserId, to, amount, asset }: TransferParams): Promise<string> => {
	if (isNullish(fromUserId)) {
		throw new Error('sol transfers require a sending user (no treasury key on sol yet)');
	}

	const seed = userSeed(fromUserId);
	const recentBlockhash = await latestBlockhash();

	const signed = isNullish(asset.ledger_ref)
		? buildSolTransferTx({ seed, to, lamports: amount, recentBlockhash })
		: buildSplTransferTx({ seed, to, amount, mint: asset.ledger_ref, recentBlockhash });

	return await rpc<string>('sendTransaction', [
		signed,
		{ encoding: 'base64', preflightCommitment: env.sol.commitment }
	]);
};

const cursorKey = (address: string): string => `sol:${address}`;

const readCursor = async (address: string): Promise<string | null> => {
	const rows = await query<{ cursor: string }>(
		`select cursor from chain_cursors where chain = $1`,
		[cursorKey(address)]
	);

	return rows[0]?.cursor ?? null;
};

const writeCursor = async ({
	address,
	cursor
}: {
	address: string;
	cursor: string;
}): Promise<void> => {
	await query(
		`insert into chain_cursors (chain, cursor) values ($1, $2)
		 on conflict (chain) do update set cursor = excluded.cursor, updated_at = now()`,
		[cursorKey(address), cursor]
	);
};

interface SignatureInfo {
	signature: string;
	err: unknown;
}

const SIGNATURE_PAGE = 25;

/** Every signature newer than `until`, newest first. Walked to the end: the
 * cursor moves to the newest signature, so one left unread is never revisited,
 * and a sweep can leave an address unread for several ticks. */
const signaturesSince = async ({
	address,
	until
}: {
	address: string;
	until: string | null;
}): Promise<SignatureInfo[]> => {
	const signatures: SignatureInfo[] = [];
	let before: string | undefined;

	for (;;) {
		const page = await rpc<SignatureInfo[]>('getSignaturesForAddress', [
			address,
			{
				limit: SIGNATURE_PAGE,
				commitment: env.sol.commitment,
				...(nonNullish(until) ? { until } : {}),
				...(nonNullish(before) ? { before } : {})
			}
		]);

		signatures.push(...page);

		if (page.length < SIGNATURE_PAGE) {
			return signatures;
		}

		before = page[page.length - 1]?.signature;
	}
};

interface ParsedTxMeta {
	preBalances: number[];
	postBalances: number[];
}

interface ParsedTx {
	meta: ParsedTxMeta | null;
	transaction: { message: { accountKeys: { pubkey: string }[] } };
}

export const watchSolDeposits = async ({
	addresses,
	assets
}: {
	addresses: string[];
	assets: Asset[];
}): Promise<WatchResult> => {
	const nativeAsset = assets.find((asset) => isNullish(asset.ledger_ref));

	if (isNullish(nativeAsset)) {
		return { events: [] };
	}

	const events: DepositEvent[] = [];
	const cursors = new Map<string, string>();

	for (const address of addresses) {
		const until = await readCursor(address);
		const signatures = await signaturesSince({ address, until });

		// Newest first from the RPC; reported oldest first so credits follow
		// chain order.
		for (const info of [...signatures].reverse()) {
			if (isNullish(info.err)) {
				const parsed = await rpc<ParsedTx | null>('getTransaction', [
					info.signature,
					{
						encoding: 'jsonParsed',
						commitment: env.sol.commitment,
						maxSupportedTransactionVersion: 0
					}
				]);
				const meta = parsed?.meta ?? null;
				const index = isNullish(meta)
					? -1
					: (parsed?.transaction.message.accountKeys.findIndex((key) => key.pubkey === address) ??
						-1);

				if (nonNullish(meta) && index !== -1) {
					const pre = BigInt(meta.preBalances[index] ?? 0);
					const post = BigInt(meta.postBalances[index] ?? 0);

					if (post > pre) {
						events.push({
							kind: 'tx',
							txRef: info.signature,
							address,
							amount: post - pre,
							asset: nativeAsset,
							confirmations: 1
						});
					}
				}
			}

			// An errored or irrelevant transaction still advances the cursor:
			// nothing in it can ever become creditable.
			cursors.set(address, info.signature);
		}
	}

	return {
		events,
		commit: async () => {
			for (const [address, cursor] of cursors) {
				await writeCursor({ address, cursor });
			}
		}
	};
};

export const solAdapter: ChainAdapter = env.sol.enabled
	? {
			chain: 'sol',
			enabled: true,
			watchScope: 'address',
			deriveAddress,
			getBalance,
			transfer,
			watchDeposits: watchSolDeposits
		}
	: {
			chain: 'sol',
			enabled: false,
			watchScope: 'address',
			deriveAddress,
			getBalance: () => Promise.reject(new ChainDisabledError('sol')),
			transfer: () => Promise.reject(new ChainDisabledError('sol')),
			watchDeposits: () => Promise.reject(new ChainDisabledError('sol'))
		};

export { deriveAssociatedTokenAccount };
