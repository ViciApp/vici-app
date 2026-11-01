import type { ClearingDid } from '$declarations';
import { getAccountState } from '$lib/api/clearing.api';
import { getTransactions as getIcpTransactionsApi } from '$lib/api/icp-index.api';
import { getTransactions as getIcrcTransactionsApi } from '$lib/api/icrc-index-ng.api';
import { balance as getLedgerBalance } from '$lib/api/icrc-ledger.api';
import { WALLET_PAGINATION, ZERO } from '$lib/constants/app.constants';
import {
	CKUSDC_INDEX_CANISTER_ID,
	ICP_INDEX_CANISTER_ID,
	VXP_INDEX_CANISTER_ID
} from '$lib/constants/canisters.constants';
import {
	CKUSDC_TOKEN,
	ICP_TOKEN,
	SUPPORTED_TOKENS,
	VXP_TOKEN
} from '$lib/constants/tokens/tokens.ic.constants';
import { getCollateralAssets } from '$lib/services/collateral.services';
import { getIdentity, safeGetIdentityOnce } from '$lib/services/identity.services';
import type { TokenId } from '$lib/types/token';
import type { Transaction, WalletBalance } from '$lib/types/wallet';
import { findSupportedTokenForClearingAssetId } from '$lib/utils/asset-ref.utils';
import { compareBalanceDomains } from '$lib/utils/balance-domain.utils';
import {
	getIcrcAccount,
	mapIcpTransaction,
	mapIcrcTransaction,
	mapTransactionIcpToSelf,
	mapTransactionIcrcToSelf
} from '$lib/utils/transactions.utils';
import { isWeb2Backend } from '$lib/web2/backend-mode';
import {
	getEngineAccountState as getEngineAccountStateWeb2,
	getWalletBalances as getWalletBalancesWeb2,
	getWalletDepositAddress as getWalletDepositAddressWeb2
} from '$lib/web2/client';
import { getWeb2User } from '$lib/web2/session';
import { isNullish, nonNullish, toNullable } from '@dfinity/utils';

/**
 * On-ledger balances for each supported token id (empty if not signed in).
 */
export const getLedgerBalances = async (): Promise<Record<string, bigint>> => {
	// web2: the API reads the ledgers for the session user's custodial
	// principal, keyed back to the app's token ids by symbol (the custody asset
	// catalog mirrors the supported IC tokens). Direct ledger reads need an
	// identity, which never exists in this mode. A token the API could not read
	// is absent, not zero.
	if (isWeb2Backend()) {
		if (isNullish(getWeb2User())) {
			return {};
		}

		try {
			const { balances } = await getWalletBalancesWeb2();

			const bySymbol = new Map(
				balances
					.filter(({ chain }) => chain === 'ic')
					.map(({ symbol, balance }) => [symbol, balance] as const)
			);

			return SUPPORTED_TOKENS.reduce<Record<TokenId, bigint>>((acc, token) => {
				const balance = bySymbol.get(token.symbol);

				return nonNullish(balance) ? { ...acc, [token.id]: balance } : acc;
			}, {});
		} catch (e: unknown) {
			console.error('Failed to get ledger balances', e);

			return {};
		}
	}

	const identity = await getIdentity();

	if (isNullish(identity)) {
		return {};
	}

	const principal = identity.getPrincipal();

	try {
		const account = getIcrcAccount(principal);

		const balancePromises = SUPPORTED_TOKENS.map((token) =>
			getLedgerBalance({
				identity,
				ledgerCanisterId: token.ledgerCanisterId,
				account
			})
		);

		const balanceResults = await Promise.all(balancePromises);

		const balances: Record<TokenId, bigint> = {};

		SUPPORTED_TOKENS.forEach((token, index) => {
			balances[token.id] = balanceResults[index];
		});

		return balances;
	} catch (e: unknown) {
		console.error('Failed to get ledger balances', e);

		return {};
	}
};

/**
 * Clearing account state for `domain`.
 */
export const getCollateralBalances = async (
	domain: ClearingDid.BalanceDomain
): Promise<ClearingDid.AccountStateResponse | undefined> => {
	if (isWeb2Backend()) {
		if (isNullish(getWeb2User())) {
			return;
		}

		try {
			return await getEngineAccountStateWeb2(domain);
		} catch (e: unknown) {
			console.error('Failed to get collateral balances', e);
		}

		return;
	}

	const identity = await getIdentity();

	if (isNullish(identity)) {
		return;
	}

	try {
		return await getAccountState({
			identity,
			params: { refresh: toNullable(true), domain: toNullable(domain) }
		});
	} catch (e: unknown) {
		console.error('Failed to get collateral balances', e);
	}
};

/**
 * Combined ledger balances and per-token clearing collateral for the given domain.
 */
export const getBalances = async (domain: ClearingDid.BalanceDomain): Promise<WalletBalance> => {
	const [balances, accountState, collateralInfos] = await Promise.all([
		getLedgerBalances(),
		getCollateralBalances(domain),
		getCollateralAssets()
	]);

	const collateral: Record<TokenId, bigint> = {};

	if (nonNullish(accountState)) {
		const targetDomainBalances = accountState.state.balances.find(([d]) =>
			compareBalanceDomains(d, domain)
		);

		if (nonNullish(targetDomainBalances)) {
			const [, domainBalances] = targetDomainBalances;
			domainBalances.forEach(([assetId, balance]) => {
				const token = findSupportedTokenForClearingAssetId({
					assetId,
					collateralInfos,
					supportedTokens: SUPPORTED_TOKENS
				});

				if (nonNullish(token)) {
					collateral[token.id] = (collateral[token.id] ?? ZERO) + balance;
				}
			});
		}
	}

	return {
		balances,
		collateral,
		accountState
	};
};

export interface WalletTransactionsCursors {
	icp?: bigint;
	ckUsdc?: bigint;
	vxp?: bigint;
}

export interface WalletTransactionsDone {
	icp: boolean;
	ckUsdc: boolean;
	vxp: boolean;
}

/**
 * Fetch the next "batch" of merged wallet transactions.
 *
 * Note: we fetch one page per index canister (ICP, ckUSDC, VXP) and then merge/sort newest-first.
 * This means the *exact* number of rendered rows per batch can vary slightly.
 */
export const getTransactionsPage = async ({
	batchSize,
	cursors = {},
	done
}: {
	batchSize: bigint;
	cursors?: WalletTransactionsCursors;
	done?: Partial<WalletTransactionsDone>;
}): Promise<{
	transactions: Transaction[];
	cursors: WalletTransactionsCursors;
	done: WalletTransactionsDone;
	hasMore: boolean;
}> => {
	// web2: the ICRC index canisters key history by principal, which the
	// browser does not hold in this mode, and the API exposes no custodial
	// transfer feed yet. The wallet still shows clearing activity (trades,
	// settlements) through the swapped trade-history read; the ledger rows are
	// simply absent until the API grows that feed.
	if (isWeb2Backend()) {
		return {
			transactions: [],
			cursors: {},
			done: { icp: true, ckUsdc: true, vxp: true },
			hasMore: false
		};
	}

	const identity = await getIdentity();

	if (isNullish(identity)) {
		return {
			transactions: [],
			cursors: {},
			done: {
				icp: done?.icp ?? false,
				ckUsdc: done?.ckUsdc ?? false,
				vxp: done?.vxp ?? false
			},
			hasMore: false
		};
	}

	const principal = identity.getPrincipal();

	const resolvedDone: WalletTransactionsDone = {
		icp: done?.icp ?? false,
		ckUsdc: done?.ckUsdc ?? false,
		vxp: done?.vxp ?? false
	};

	try {
		const [icpPage, ckUsdcPage, vxpPage] = await Promise.all([
			resolvedDone.icp
				? Promise.resolve(undefined)
				: getIcpTransactionsApi({
						identity,
						principal,
						start: cursors.icp,
						maxResults: batchSize,
						indexCanisterId: ICP_INDEX_CANISTER_ID
					}),
			resolvedDone.ckUsdc
				? Promise.resolve(undefined)
				: getIcrcTransactionsApi({
						identity,
						principal,
						start: cursors.ckUsdc,
						maxResults: batchSize,
						indexCanisterId: CKUSDC_INDEX_CANISTER_ID
					}),
			resolvedDone.vxp
				? Promise.resolve(undefined)
				: getIcrcTransactionsApi({
						identity,
						principal,
						start: cursors.vxp,
						maxResults: batchSize,
						indexCanisterId: VXP_INDEX_CANISTER_ID
					})
		]);

		const icpTxs = icpPage?.transactions ?? [];
		const ckUsdcTxs = ckUsdcPage?.transactions ?? [];
		const vxpTxs = vxpPage?.transactions ?? [];

		const icpNextStart = icpTxs.length > 0 ? icpTxs[icpTxs.length - 1]?.id : cursors.icp;
		const ckUsdcNextStart =
			ckUsdcTxs.length > 0 ? ckUsdcTxs[ckUsdcTxs.length - 1]?.id : cursors.ckUsdc;
		const vxpNextStart = vxpTxs.length > 0 ? vxpTxs[vxpTxs.length - 1]?.id : cursors.vxp;

		const icpNextDone =
			resolvedDone.icp ||
			icpTxs.length === 0 ||
			icpTxs.length < batchSize ||
			((icpPage?.oldest_tx_id.length ?? 0) > 0 && icpNextStart === icpPage?.oldest_tx_id[0]);

		const ckUsdcNextDone =
			resolvedDone.ckUsdc ||
			ckUsdcTxs.length === 0 ||
			ckUsdcTxs.length < batchSize ||
			((ckUsdcPage?.oldest_tx_id.length ?? 0) > 0 &&
				ckUsdcNextStart === ckUsdcPage?.oldest_tx_id[0]);

		const vxpNextDone =
			resolvedDone.vxp ||
			vxpTxs.length === 0 ||
			vxpTxs.length < batchSize ||
			((vxpPage?.oldest_tx_id.length ?? 0) > 0 && vxpNextStart === vxpPage?.oldest_tx_id[0]);

		const icpNormalized: Transaction[] = icpTxs
			.flatMap(mapTransactionIcpToSelf)
			.map((transaction) => mapIcpTransaction({ transaction, token: ICP_TOKEN, identity }));

		const ckUsdcNormalized: Transaction[] = ckUsdcTxs
			.flatMap(mapTransactionIcrcToSelf)
			.map((transaction) => mapIcrcTransaction({ transaction, token: CKUSDC_TOKEN, identity }));

		const vxpNormalized: Transaction[] = vxpTxs
			.flatMap(mapTransactionIcrcToSelf)
			.map((transaction) => mapIcrcTransaction({ transaction, token: VXP_TOKEN, identity }));

		const transactions = [...icpNormalized, ...ckUsdcNormalized, ...vxpNormalized].sort((a, b) => {
			if (a.timestamp === b.timestamp) {
				return 0;
			}

			return a.timestamp > b.timestamp ? -1 : 1;
		});

		const nextDone: WalletTransactionsDone = {
			icp: icpNextDone,
			ckUsdc: ckUsdcNextDone,
			vxp: vxpNextDone
		};

		const nextCursors: WalletTransactionsCursors = {
			icp: icpNextDone ? cursors.icp : icpNextStart,
			ckUsdc: ckUsdcNextDone ? cursors.ckUsdc : ckUsdcNextStart,
			vxp: vxpNextDone ? cursors.vxp : vxpNextStart
		};

		return {
			transactions,
			cursors: nextCursors,
			done: nextDone,
			hasMore: !(icpNextDone && ckUsdcNextDone && vxpNextDone)
		};
	} catch (e: unknown) {
		console.error('Failed to get transactions', e);

		return {
			transactions: [],
			cursors: cursors ?? {},
			done: resolvedDone,
			hasMore: false
		};
	}
};

/**
 * Backwards-compatible helper: first batch only.
 */
export const getTransactions = async (): Promise<Transaction[]> => {
	const result = await getTransactionsPage({ batchSize: WALLET_PAGINATION });

	return result.transactions;
};

/**
 * The address to receive IC tokens on: the signed-in principal on the default
 * backend, the custodial IC principal the API derives for the session user in
 * web2 mode (deposits to it are detected server-side and credited to the
 * custodial balance). Throws when signed out, mirroring the identity path.
 */
export const getReceiveAddress = async (): Promise<string> => {
	if (isWeb2Backend()) {
		const { address } = await getWalletDepositAddressWeb2('ic');

		return address;
	}

	const identity = await safeGetIdentityOnce();

	return identity.getPrincipal().toText();
};
