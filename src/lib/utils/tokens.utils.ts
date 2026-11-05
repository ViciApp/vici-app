import { SUPPORTED_TOKENS } from '#lib/constants/tokens/tokens.ic.constants.ts';
import { collateralsStore } from '#lib/stores/collaterals.store.ts';
import type { Token } from '#lib/types/token.ts';
import { findCollateralInfoByIcrcLedger } from '#lib/utils/asset-ref.utils.ts';
import { isNullish } from '@dfinity/utils';
import { get } from 'svelte/store';

export const findTokenByLedgerId = (ledgerCanisterId: string): Token | undefined =>
	SUPPORTED_TOKENS.find((t) => t.ledgerCanisterId === ledgerCanisterId);

/**
 * Canonical clearing `asset_id` for an ICRC ledger: resolved only from registered collateral
 * config (ledger match), never from token symbol.
 */
export const resolveClearingAssetId = (ledgerCanisterId: string): string => {
	const collateralData = get(collateralsStore);

	if (isNullish(collateralData)) {
		throw new Error(
			`Cannot resolve asset ID: collateral configuration is still loading. Ensure clearing registry is populated.`
		);
	}

	const { assetsConfig } = collateralData;
	const info = findCollateralInfoByIcrcLedger({ assetsConfig, ledgerCanisterId });

	if (isNullish(info)) {
		throw new Error(
			`No clearing collateral registered for ICRC ledger ${ledgerCanisterId}. Load collateral config or register the asset on clearing.`
		);
	}

	return info.config.asset_id;
};
