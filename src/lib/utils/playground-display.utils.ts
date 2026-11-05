import { USD_DECIMALS, ZERO } from '#lib/constants/app.constants.ts';
import {
	PLAYGROUND_CLEARING_MARGIN_DECIMALS,
	PLAYGROUND_DISPLAY_SYMBOL,
	VXP_BALANCE_DISPLAY_DECIMALS
} from '#lib/constants/playground.constants.ts';
import { VXP_TOKEN } from '#lib/constants/tokens/tokens.ic.constants.ts';
import {
	formatAvailableUsd,
	formatToken,
	groupIntegerPart,
	safeBigInt
} from '#lib/utils/format.utils.ts';
import type { ClearingDid } from '$declarations';
import { nonNullish } from '@dfinity/utils';

/**
 * Plain VXP balance — whole-number "points" feel with thousands separators
 * (e.g. `24,000`). Defaults to native VXP ledger decimals; pass `decimals`
 * when formatting a value already scaled to a different unit (e.g. clearing
 * margin units). No symbol — callers add `VXP` / `PLAYGROUND_DISPLAY_SYMBOL`
 * themselves so the same helper works for both display contexts.
 */
export const formatVxpBalance = ({
	value,
	decimals = VXP_TOKEN.decimals
}: {
	value: bigint;
	decimals?: number;
}): string =>
	formatToken({
		value,
		unitName: decimals,
		displayDecimals: VXP_BALANCE_DISPLAY_DECIMALS
	});

/**
 * Format a single VXP win / PnL magnitude for the whole-number "points" UI.
 *
 * VXP surfaces render whole points (`VXP_BALANCE_DISPLAY_DECIMALS = 0`), but a
 * winning call on a heavy favourite credits a real *sub-1* amount — e.g. a 50
 * VXP stake on a 0.99 side nets ~0.43 VXP, since the server pays the true
 * `stake·(1/price − 1)` cashflow minus fees with **no** payout floor (see
 * the `vxpNetWin` formula). Rounding such a win to the
 * nearest whole point would render it as `0` — a genuine win that reads as
 * nothing ("+0 VXP"). To keep the points feel without lying, any non-zero
 * amount below one whole point renders as `<1`; one point or more rounds to
 * the nearest whole point.
 *
 * Magnitude only — callers prepend the sign (`+` / `−`) and the `VXP` unit.
 * Whole-point amounts keep thousands separators (matching the rest of the
 * numeric UI); a non-finite value (malformed data) renders as `0` rather
 * than leaking `NaN` / `Infinity` into the UI.
 */
export const formatWholeVxpMagnitude = (value: number): string => {
	if (!Number.isFinite(value)) {
		return '0';
	}

	const abs = Math.abs(value);

	if (abs === 0) {
		return '0';
	}

	if (abs < 1) {
		return '<1';
	}

	return groupIntegerPart({ formatted: String(Math.round(abs)) });
};

/**
 * A profile's whole-number `points` → VXP base units (scaled by the VXP
 * ledger decimals), ready to hand to {@link formatVxpBalance}.
 *
 * `points` is stored as a `j.number()` on the profile doc, so a friend's
 * profile may legitimately carry a float / `NaN` / `Infinity` (malformed or
 * legacy data). Coercing it through {@link safeBigInt} — truncated and
 * clamped to a non-negative floor — keeps the bare `BigInt(...)` from
 * throwing a `RangeError` and taking the surrounding view down with it.
 */
export const vxpBaseUnitsFromPoints = (points: number): bigint =>
	safeBigInt({ value: points, min: ZERO }) * 10n ** BigInt(VXP_TOKEN.decimals);

/**
 * Clearing-margin units → `24,000 VXP` (playground display). Uses the
 * shared {@link formatVxpBalance} so grouping / display decimals stay in
 * lock-step with non-playground VXP surfaces.
 */
export const formatPlaygroundClearingAsVxp = (value: bigint): string =>
	`${formatVxpBalance({ value, decimals: PLAYGROUND_CLEARING_MARGIN_DECIMALS })} ${PLAYGROUND_DISPLAY_SYMBOL}`;

export const formatAvailableMarginForUi = ({
	value,
	playground
}: {
	value: bigint;
	playground: boolean;
}): string => (playground ? formatPlaygroundClearingAsVxp(value) : formatAvailableUsd({ value }));

/**
 * Native ICRC amount → clearing margin scale (`USD_DECIMALS`), same units as `total_equity_usd`.
 */
export const nativeToClearingMarginUnits = ({
	nativeBalance,
	nativeDecimals
}: {
	nativeBalance: bigint;
	nativeDecimals: number;
}): bigint => {
	if (nativeDecimals <= USD_DECIMALS) {
		return nativeBalance * 10n ** BigInt(USD_DECIMALS - nativeDecimals);
	}

	return nativeBalance / 10n ** BigInt(nativeDecimals - USD_DECIMALS);
};

const sumAssetWorthValueUsd = (assets: ClearingDid.AssetWorth[]): bigint =>
	assets.reduce((sum, asset) => sum + asset.value_usd, ZERO);

/**
 * "Available" margin for simple wallet copy: collateral value at mark minus
 * margin reserved for open activity. Uses `assets[].value_usd` when present;
 * otherwise `fallbackCollateralMarginUnits`.
 */
export const intuitiveAvailableMarginUsd = ({
	assets,
	totalEquityUsd,
	availableMarginUsd,
	fallbackCollateralMarginUnits
}: {
	assets: ClearingDid.AssetWorth[] | undefined;
	totalEquityUsd: bigint;
	availableMarginUsd: bigint;
	fallbackCollateralMarginUnits: bigint;
}): bigint => {
	const locked = totalEquityUsd - availableMarginUsd;
	const atMark =
		nonNullish(assets) && assets.length > 0
			? sumAssetWorthValueUsd(assets)
			: fallbackCollateralMarginUnits;

	return atMark > locked ? atMark - locked : ZERO;
};

export const quickBetChipLabel = ({
	amount,
	playground
}: {
	amount: string;
	playground: boolean;
}): string => (playground ? `${amount} ${PLAYGROUND_DISPLAY_SYMBOL}` : `$${amount}`);

export const flowTradeDenominationLabel = (playground: boolean): 'VXP' | 'USD' =>
	playground ? PLAYGROUND_DISPLAY_SYMBOL : 'USD';

export const formatPositionPnLWithOptionalUnit = ({
	pnl,
	playground
}: {
	pnl: number;
	playground: boolean;
}): string => {
	const core = `${pnl >= 0 ? '+' : ''}${groupIntegerPart({ formatted: pnl.toFixed(2) })}`;

	return playground ? `${core} ${PLAYGROUND_DISPLAY_SYMBOL}` : core;
};
