import type { ClearingDid } from '$declarations';
import {
	depositCollateral as depositCollateralApi,
	getAccountState as getAccountStateApi,
	getAccountStateQuery as getAccountStateQueryApi,
	listCollateralAssets as listCollateralAssetsApi,
	registerIcrcAsset as registerIcrcAssetApi,
	withdrawCollateral as withdrawCollateralApi
} from '$lib/api/clearing.api';
import { approve, balance as getLedgerBalance, transactionFee } from '$lib/api/icrc-ledger.api';
import { ZERO } from '$lib/constants/app.constants';
import { CLEARING_CANISTER_ID } from '$lib/constants/canisters.constants';
import { VXP_TOKEN } from '$lib/constants/tokens/tokens.ic.constants';
import { getIdentity, safeGetIdentityOnce } from '$lib/services/identity.services';
import { loadWithCertification } from '$lib/services/query-update.services';
import { refreshAllBalances } from '$lib/utils/refresh.utils';
import { resolveClearingAssetId } from '$lib/utils/tokens.utils';
import { getIcrcAccount } from '$lib/utils/transactions.utils';
import { isWeb2Backend } from '$lib/web2/backend-mode';
import {
	depositEngineCollateral as depositEngineCollateralWeb2,
	getEngineAccountState as getEngineAccountStateWeb2,
	getWalletBalances as getWalletBalancesWeb2,
	listEngineCollateralAssets as listEngineCollateralAssetsWeb2,
	withdrawEngineCollateral as withdrawEngineCollateralWeb2
} from '$lib/web2/client';
import { getWeb2User } from '$lib/web2/session';
import { isNullish, nowInBigIntNanoSeconds, toNullable } from '@dfinity/utils';
import { AnonymousIdentity, type Identity } from '@icp-sdk/core/agent';
import { getIdentityOnce } from '@junobuild/core';
import { nanoid } from 'nanoid';

const makeOperationId = ({ prefix, hint }: { prefix: string; hint?: bigint }): string => {
	// Idempotency keys are user-provided strings on the clearing canister side.
	// `nanoid` is cryptographically secure by default and avoids the
	// `Date.now()` collision risk under rapid retries/double-clicks.
	const id = nanoid();

	return isNullish(hint) ? `${prefix}_${id}` : `${prefix}_${hint.toString()}_${id}`;
};

/**
 * ICRC approve + clearing deposit for the current balance domain; refreshes balances on success.
 */
export const depositCollateral = async ({
	assetPrincipal,
	amount,
	domain
}: {
	assetPrincipal: string;
	amount: bigint;
	domain: ClearingDid.BalanceDomain;
}): Promise<void> => {
	// web2: the API owns the custodial keys, so the ICRC approval and the
	// clearing deposit both run server-side under the caller's derived
	// identity; the route resolves the balance domain from the asset. The
	// clearing `asset_id` still resolves client-side from the (public,
	// dual-mode) collateral catalog.
	if (isWeb2Backend()) {
		await depositEngineCollateralWeb2({
			depositId: makeOperationId({ prefix: 'DEPOSIT', hint: amount }),
			assetId: resolveClearingAssetId(assetPrincipal),
			amount
		});

		refreshAllBalances();

		return;
	}

	const identity = await safeGetIdentityOnce();

	const ledgerFee = await transactionFee({ identity, ledgerCanisterId: assetPrincipal });
	// ICRC-2: allowance must cover `amount + fee` for `icrc2_transfer_from`
	const approvalAmount = amount + ledgerFee;

	await approve({
		identity,
		ledgerCanisterId: assetPrincipal,
		amount: approvalAmount,
		spender: getIcrcAccount(CLEARING_CANISTER_ID),
		expiresAt: nowInBigIntNanoSeconds() + 60n * 1_000_000_000n // 1 minute
	});

	const asset_id = resolveClearingAssetId(assetPrincipal);

	await depositCollateralApi({
		identity,
		params: {
			deposit_id: makeOperationId({ prefix: 'DEPOSIT', hint: amount }),
			domain: toNullable(domain),
			asset_id,
			amount
		}
	});

	refreshAllBalances();
};

/**
 * Withdraws collateral from clearing to the user for the given ledger asset.
 */
export const withdrawCollateral = async ({
	assetPrincipal,
	amount,
	domain
}: {
	assetPrincipal: string;
	amount: bigint;
	domain: ClearingDid.BalanceDomain;
}): Promise<void> => {
	// web2: the release runs server-side under the derived identity, back to
	// the caller's custodial account; the route resolves the domain from the
	// asset.
	if (isWeb2Backend()) {
		await withdrawEngineCollateralWeb2({
			withdrawalId: makeOperationId({ prefix: 'WITHDRAW', hint: amount }),
			assetId: resolveClearingAssetId(assetPrincipal),
			amount
		});

		refreshAllBalances();

		return;
	}

	const identity = await safeGetIdentityOnce();

	const asset_id = resolveClearingAssetId(assetPrincipal);

	await withdrawCollateralApi({
		identity,
		params: {
			withdrawal_id: makeOperationId({ prefix: 'WITHDRAW', hint: amount }),
			domain: toNullable(domain),
			asset_id,
			amount
		}
	});

	refreshAllBalances();
};

/**
 * Core account-state fetch: routes to the right canister method per path.
 *
 * - Uncertified (query) → `get_account_state_query` (declared `query` in Candid,
 *   read-only, does NOT refresh external ledger balances). Fast first paint.
 * - Certified (update)  → `get_account_state` with `refresh: true`, which
 *   re-prices mark-to-market and reconciles external ledgers. Source of truth.
 *
 * Using the same update method on both paths would double the external-ledger
 * refresh cost and side-effects on every load.
 */
const fetchAccountState = ({
	identity,
	certified,
	domain
}: {
	identity: Identity;
	certified: boolean;
	domain: ClearingDid.BalanceDomain;
}): Promise<ClearingDid.AccountStateResponse> => {
	if (certified) {
		return getAccountStateApi({
			identity,
			certified: true,
			params: { refresh: toNullable(true), domain: toNullable(domain) }
		});
	}

	// `get_account_state_query` takes no params and returns all domains; the
	// caller (see `LoaderCollaterals`) filters by domain client-side.
	return getAccountStateQueryApi({ identity, certified: false });
};

/**
 * Fetches clearing account state (balances per domain) for the signed-in user.
 *
 * Performs a single certified update. Prefer {@link loadAccountState} for UI
 * flows that benefit from the fast-then-certified render pattern.
 */
export const getAccountState = async (
	domain: ClearingDid.BalanceDomain
): Promise<ClearingDid.AccountStateResponse> => {
	if (isWeb2Backend()) {
		return await getEngineAccountStateWeb2(domain);
	}

	const identity = await safeGetIdentityOnce();

	return fetchAccountState({ identity, certified: true, domain });
};

/**
 * Callback-based variant of {@link getAccountState}. No-op when the user is
 * not signed in.
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
	// web2 reads the account state once and delivers it as the final
	// (`certified: true`) pass: no query/update pair exists on that transport,
	// and delivering it uncertified would trip the Settlement-only gate in
	// `LoaderCollaterals` and leave the store empty forever.
	if (isWeb2Backend()) {
		if (isNullish(getWeb2User())) {
			return;
		}

		try {
			onLoad({ certified: true, response: await getEngineAccountStateWeb2(domain) });
		} catch (err: unknown) {
			onUpdateError?.(err);
		}

		return;
	}

	const identity = await getIdentity();

	if (isNullish(identity)) {
		return;
	}

	return loadWithCertification<ClearingDid.AccountStateResponse>({
		identity,
		request: ({ certified, identity: reqIdentity }) =>
			fetchAccountState({ identity: reqIdentity, certified, domain }),
		onLoad,
		onUpdateError
	});
};

/**
 * Core collateral-assets fetch: threads identity + certified so it composes
 * with {@link loadCollateralAssets} / `queryAndUpdate`.
 */
const fetchCollateralAssets = ({
	identity,
	certified
}: {
	identity: Identity;
	certified: boolean;
}): Promise<ClearingDid.CollateralAssetInfo[]> => listCollateralAssetsApi({ identity, certified });

/**
 * Lists collateral assets configured on clearing (empty if anonymous).
 *
 * Performs a single certified update. Prefer {@link loadCollateralAssets} for
 * UI flows that benefit from the fast-then-certified render pattern.
 */
export const getCollateralAssets = async (): Promise<ClearingDid.CollateralAssetInfo[]> => {
	// The asset catalog is a public engine read on the HTTP bridge, so web2
	// needs no on-chain identity (none exists in that mode).
	if (isWeb2Backend()) {
		return await listEngineCollateralAssetsWeb2();
	}

	const identity = await getIdentityOnce();

	if (isNullish(identity)) {
		return [];
	}

	return fetchCollateralAssets({ identity, certified: true });
};

/**
 * Callback-based variant of {@link getCollateralAssets}. No-op when the user
 * is not signed in (mirrors `getCollateralAssets` returning `[]`).
 */
export const loadCollateralAssets = async ({
	onLoad,
	onUpdateError
}: {
	onLoad: (options: { certified: boolean; response: ClearingDid.CollateralAssetInfo[] }) => void;
	onUpdateError?: (error: unknown) => void;
}): Promise<void> => {
	// web2 reads the public HTTP bridge once: no query/update pair exists on
	// that transport, so the single response is delivered as the final
	// (`certified: true`) pass.
	if (isWeb2Backend()) {
		try {
			onLoad({ certified: true, response: await listEngineCollateralAssetsWeb2() });
		} catch (err: unknown) {
			onUpdateError?.(err);
		}

		return;
	}

	const identity = await getIdentity();

	if (isNullish(identity)) {
		return;
	}

	return loadWithCertification<ClearingDid.CollateralAssetInfo[]>({
		identity,
		request: ({ certified, identity: reqIdentity }) =>
			fetchCollateralAssets({ identity: reqIdentity, certified }),
		onLoad,
		onUpdateError
	});
};

// The sweep leaves a small fee reserve behind so the source account can still
// pay the approve + transfer fees of the deposit itself.
const SWEEP_FEE_RESERVE_MULTIPLIER = 2n;

/**
 * Free VXP available to auto-sweep into clearing collateral, minus the
 * ledger-fee reserve, in base units. `ZERO` when signed out or when nothing
 * exceeds the reserve, so the sweep loop gates on a single figure.
 *
 * On the default backend this reads the signed-in user's ICRC ledger balance;
 * in web2 mode the free balance is the custodial one held by the API (there
 * is no local identity), while the fee stays a public ledger query read
 * anonymously like the other public on-chain reads.
 */
export const getSweepableVxpAmount = async (): Promise<bigint> => {
	const { ledgerCanisterId } = VXP_TOKEN;

	if (isWeb2Backend()) {
		if (isNullish(getWeb2User())) {
			return ZERO;
		}

		const [{ balances }, fee] = await Promise.all([
			getWalletBalancesWeb2(),
			transactionFee({ identity: new AnonymousIdentity(), ledgerCanisterId })
		]);

		const rawBalance =
			balances.find(({ chain, symbol }) => chain === 'ic' && symbol === VXP_TOKEN.symbol)
				?.balance ?? ZERO;

		const reserve = fee * SWEEP_FEE_RESERVE_MULTIPLIER;

		return rawBalance > reserve ? rawBalance - reserve : ZERO;
	}

	const identity = await getIdentity();

	if (isNullish(identity)) {
		return ZERO;
	}

	const account = getIcrcAccount(identity.getPrincipal());

	const [rawBalance, fee] = await Promise.all([
		getLedgerBalance({ identity, ledgerCanisterId, account }),
		transactionFee({ identity, ledgerCanisterId })
	]);

	const reserve = fee * SWEEP_FEE_RESERVE_MULTIPLIER;

	return rawBalance > reserve ? rawBalance - reserve : ZERO;
};

/**
 * Registers an ICRC ledger as a collateral asset on clearing (admin-style operation).
 */
export const registerIcrcAsset = async (
	params: ClearingDid.RegisterIcrcAssetParams
): Promise<void> => {
	const identity = await safeGetIdentityOnce();

	await registerIcrcAssetApi({
		identity,
		params
	});

	refreshAllBalances();
};
