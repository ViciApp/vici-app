import type { ClearingDid } from '#declarations';
import { ZERO } from '#lib/constants/app.constants.ts';
import { SUPPORTED_TOKENS } from '#lib/constants/tokens/tokens.ic.constants.ts';
import { getCollateralAssets } from '#lib/services/collateral.services.ts';
import type { TokenId } from '#lib/types/token.ts';
import type { LedgerBalancesRead, Transaction, WalletBalance } from '#lib/types/wallet.ts';
import { findSupportedTokenForClearingAssetId } from '#lib/utils/asset-ref.utils.ts';
import { compareBalanceDomains } from '#lib/utils/balance-domain.utils.ts';
import {
	getEngineAccountState as getEngineAccountStateApi,
	getWalletBalances as getWalletBalancesApi,
	getWalletDepositAddress as getWalletDepositAddressApi
} from '#lib/web2/client.ts';
import { getSessionUser } from '#lib/web2/session.ts';
import { isNullish, nonNullish } from '@dfinity/utils';

/**
 * On-ledger balances for each supported token id, with the account they
 * belong to (no owner and no balances if not signed in). The API reads the
 * ledgers for the session user's custodial principal, keyed back to the app's
 * token ids by symbol (the custody asset catalog mirrors the supported IC
 * tokens). A token the API could not read is absent, never zero: callers keep
 * their last known value for it (see `mergeReadBalances`).
 */
export const getLedgerBalances = async (): Promise<LedgerBalancesRead> => {
	const user = getSessionUser();

	if (isNullish(user)) {
		return { balances: {} };
	}

	try {
		const { balances } = await getWalletBalancesApi();

		const bySymbol = new Map(
			balances
				.filter(({ chain }) => chain === 'ic')
				.map(({ symbol, balance }) => [symbol, balance] as const)
		);

		return {
			owner: user.id,
			balances: SUPPORTED_TOKENS.reduce<Record<TokenId, bigint>>((acc, token) => {
				const balance = bySymbol.get(token.symbol);

				return nonNullish(balance) ? { ...acc, [token.id]: balance } : acc;
			}, {})
		};
	} catch (e: unknown) {
		console.error('Failed to get ledger balances', e);

		return { owner: user.id, balances: {} };
	}
};

/**
 * Clearing account state for `domain`.
 */
const getCollateralBalances = async (
	domain: ClearingDid.BalanceDomain
): Promise<ClearingDid.AccountStateResponse | undefined> => {
	if (isNullish(getSessionUser())) {
		return;
	}

	try {
		return await getEngineAccountStateApi(domain);
	} catch (e: unknown) {
		console.error('Failed to get collateral balances', e);
	}
};

/**
 * Combined ledger balances and per-token clearing collateral for the given domain.
 */
export const getBalances = async (domain: ClearingDid.BalanceDomain): Promise<WalletBalance> => {
	const [{ balances }, accountState, collateralInfos] = await Promise.all([
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
 * The next "batch" of merged wallet ledger transactions. Always the final,
 * empty page (see below).
 */
export const getTransactionsPage = (_params: {
	batchSize: bigint;
	cursors?: WalletTransactionsCursors;
	done?: Partial<WalletTransactionsDone>;
}): Promise<{
	transactions: Transaction[];
	cursors: WalletTransactionsCursors;
	done: WalletTransactionsDone;
	hasMore: boolean;
}> =>
	// The ICRC index canisters key history by principal, which the browser
	// does not hold (the API keeps the custodial keys), and the API exposes no
	// custodial transfer feed yet. The wallet still shows clearing activity
	// (trades, settlements) through the trade-history read; the ledger rows
	// are absent until the API grows that feed.
	Promise.resolve({
		transactions: [],
		cursors: {},
		done: { icp: true, ckUsdc: true, vxp: true },
		hasMore: false
	});

/**
 * The address to receive IC tokens on: the custodial IC principal the API
 * derives for the session user (deposits to it are detected server-side and
 * credited to the custodial balance).
 */
export const getReceiveAddress = async (): Promise<string> => {
	const { address } = await getWalletDepositAddressApi('ic');

	return address;
};
