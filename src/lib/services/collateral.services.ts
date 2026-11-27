import type { ClearingDid } from '#declarations';
import { transactionFee } from '#lib/api/icrc-ledger.api.ts';
import { ZERO } from '#lib/constants/app.constants.ts';
import { VXP_TOKEN } from '#lib/constants/tokens/tokens.ic.constants.ts';
import { anonymousIdentity } from '#lib/services/identity.services.ts';
import { refreshAllBalances } from '#lib/utils/refresh.utils.ts';
import { resolveClearingAssetId } from '#lib/utils/tokens.utils.ts';
import {
	depositEngineCollateral as depositEngineCollateralApi,
	getEngineAccountState as getEngineAccountStateApi,
	getWalletBalances as getWalletBalancesApi,
	listEngineCollateralAssets as listEngineCollateralAssetsApi
} from '#lib/api-client/client.ts';
import { getSessionUser } from '#lib/api-client/session.ts';
import { isNullish } from '@dfinity/utils';
import { nanoid } from 'nanoid';

const makeOperationId = ({ prefix, hint }: { prefix: string; hint?: bigint }): string => {
	// Idempotency keys are user-provided strings on the clearing canister side.
	// `nanoid` is cryptographically secure by default and avoids the
	// `Date.now()` collision risk under rapid retries/double-clicks.
	const id = nanoid();

	return isNullish(hint) ? `${prefix}_${id}` : `${prefix}_${hint.toString()}_${id}`;
};

/**
 * Clearing deposit for the current balance domain; refreshes balances on
 * success. The API owns the custodial keys, so the ICRC approval and the
 * clearing deposit both run server-side under the caller's derived identity,
 * and the route resolves the balance domain from the asset. The clearing
 * `asset_id` still resolves client-side from the public collateral catalog.
 */
export const depositCollateral = async ({
	assetPrincipal,
	amount
}: {
	assetPrincipal: string;
	amount: bigint;
	domain: ClearingDid.BalanceDomain;
}): Promise<void> => {
	await depositEngineCollateralApi({
		depositId: makeOperationId({ prefix: 'DEPOSIT', hint: amount }),
		assetId: resolveClearingAssetId(assetPrincipal),
		amount
	});

	refreshAllBalances();
};

/**
 * Fetches clearing account state (balances per domain) for the signed-in user.
 * No-op when nobody is signed in. The read is delivered as the final
 * (`certified: true`) pass: delivering it uncertified would trip the
 * Settlement-only gate in `LoaderCollaterals` and leave the store empty.
 */
export const loadAccountState = async ({
	domain,
	onLoad,
	onUpdateError
}: {
	domain: ClearingDid.BalanceDomain;
	onLoad: (options: { certified: boolean; response: ClearingDid.AccountStateResponse }) => void;
	onUpdateError?: (error: unknown) => void;
}): Promise<void> => {
	if (isNullish(getSessionUser())) {
		return;
	}

	try {
		onLoad({ certified: true, response: await getEngineAccountStateApi(domain) });
	} catch (err: unknown) {
		onUpdateError?.(err);
	}
};

/**
 * Lists the collateral assets configured on clearing, a public engine read on
 * the HTTP bridge.
 */
export const getCollateralAssets = (): Promise<ClearingDid.CollateralAssetInfo[]> =>
	listEngineCollateralAssetsApi();

/**
 * Callback-based variant of {@link getCollateralAssets}. The bridge answers
 * once, so the single response is delivered as the final (`certified: true`)
 * pass.
 */
export const loadCollateralAssets = async ({
	onLoad,
	onUpdateError
}: {
	onLoad: (options: { certified: boolean; response: ClearingDid.CollateralAssetInfo[] }) => void;
	onUpdateError?: (error: unknown) => void;
}): Promise<void> => {
	try {
		onLoad({ certified: true, response: await listEngineCollateralAssetsApi() });
	} catch (err: unknown) {
		onUpdateError?.(err);
	}
};

// The sweep leaves a small fee reserve behind so the source account can still
// pay the approve + transfer fees of the deposit itself.
const SWEEP_FEE_RESERVE_MULTIPLIER = 2n;

/**
 * Free VXP available to auto-sweep into clearing collateral, minus the
 * ledger-fee reserve, in base units. `ZERO` when signed out or when nothing
 * exceeds the reserve, so the sweep loop gates on a single figure.
 *
 * The free balance is the custodial one held by the API, while the fee stays a
 * public ledger query read anonymously like the other public on-chain reads.
 */
export const getSweepableVxpAmount = async (): Promise<bigint> => {
	const { ledgerCanisterId } = VXP_TOKEN;

	if (isNullish(getSessionUser())) {
		return ZERO;
	}

	const [{ balances }, fee] = await Promise.all([
		getWalletBalancesApi(),
		transactionFee({ identity: anonymousIdentity(), ledgerCanisterId })
	]);

	const rawBalance =
		balances.find(({ chain, symbol }) => chain === 'ic' && symbol === VXP_TOKEN.symbol)?.balance ??
		ZERO;

	const reserve = fee * SWEEP_FEE_RESERVE_MULTIPLIER;

	return rawBalance > reserve ? rawBalance - reserve : ZERO;
};
