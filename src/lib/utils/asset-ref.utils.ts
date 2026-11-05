import type { Token } from '#lib/types/token.ts';
import type { ClearingDid } from '$declarations';
import { Principal } from '@icp-sdk/core/principal';

/**
 * Principal text in canonical form for stable string comparison.
 */
export const normalizeIcrcLedgerId = (ledgerCanisterId: string): string =>
	Principal.fromText(ledgerCanisterId).toText();

export const icrcLedgerIdsEqual = ({ first, second }: { first: string; second: string }): boolean =>
	normalizeIcrcLedgerId(first) === normalizeIcrcLedgerId(second);

/**
 * Whether a clearing `Asset` is the given ICRC ledger.
 */
export const clearingAssetIsIcrcLedger = ({
	asset,
	ledgerCanisterId
}: {
	asset: ClearingDid.Asset;
	ledgerCanisterId: string;
}): boolean => {
	if (!('Icrc' in asset)) {
		return false;
	}

	return icrcLedgerIdsEqual({
		first: asset.Icrc.toText(),
		second: ledgerCanisterId
	});
};

/**
 * First collateral row whose underlying ledger matches (ICRC only for now).
 */
export const findCollateralInfoByIcrcLedger = ({
	assetsConfig,
	ledgerCanisterId
}: {
	assetsConfig: Record<string, ClearingDid.CollateralAssetInfo>;
	ledgerCanisterId: string;
}): ClearingDid.CollateralAssetInfo | undefined =>
	Object.values(assetsConfig).find((info) =>
		clearingAssetIsIcrcLedger({ asset: info.config.asset, ledgerCanisterId })
	);

/**
 * Decimal places for an ICRC ledger as registered on clearing (from ledger metadata at
 * registration). Clearing stores and transfers collateral in these base units; app `Token.decimals`
 * must match for UX, but when they drift, prefer this for parse/format of collateral amounts.
 */
export const icrcLedgerDecimalsFromCollateralConfig = ({
	assetsConfig,
	ledgerCanisterId,
	fallbackDecimals
}: {
	assetsConfig: Record<string, ClearingDid.CollateralAssetInfo>;
	ledgerCanisterId: string;
	fallbackDecimals: number;
}): number => {
	const info = findCollateralInfoByIcrcLedger({ assetsConfig, ledgerCanisterId });

	return info?.config.decimals ?? fallbackDecimals;
};

/**
 * Maps a clearing `asset_id` (from account state) to an app token using collateral registration
 * metadata (ICRC ledger), never ticker symbol.
 */
export const findSupportedTokenForClearingAssetId = ({
	assetId,
	collateralInfos,
	supportedTokens
}: {
	assetId: string;
	collateralInfos: ClearingDid.CollateralAssetInfo[];
	supportedTokens: readonly Token[];
}): Token | undefined => {
	const info = collateralInfos.find((i) => i.config.asset_id === assetId);

	if (!info || !('Icrc' in info.config.asset)) {
		return;
	}

	const ledger = info.config.asset.Icrc.toText();

	return supportedTokens.find((t) => t.ledgerCanisterId === ledger);
};
