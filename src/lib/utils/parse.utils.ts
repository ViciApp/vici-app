import { PRICE_DECIMALS, USD_DECIMALS } from '#lib/constants/app.constants.ts';
import { parseUnits, type BigNumberish } from 'ethers/utils';

/**
 * Parses a decimal token string into a bigint using ethers `parseUnits`.
 */
export const parseToken = ({
	value,
	unitName
}: {
	value: string;
	unitName: BigNumberish;
}): bigint => parseUnits(value, unitName);

/**
 * Encodes a decimal into fixed-base units with `fractionDigits` fractional digits (e.g. limit price book).
 */
export const parseDecimalToFixedBigInt = ({
	value,
	fractionDigits
}: {
	value: number;
	fractionDigits: number;
}): bigint => parseUnits(value.toFixed(fractionDigits), fractionDigits);

/**
 * Clearing USD base units (`USD_DECIMALS`) from a nominal decimal (e.g. `0.35`).
 */
export const parseUsdBaseUnitsFromDecimal = (value: number): bigint =>
	parseDecimalToFixedBigInt({ value, fractionDigits: USD_DECIMALS });

/**
 * Limit-order price `decimal.value` for the clearing API (`PRICE_DECIMALS`).
 */
export const parseLimitOrderPriceValue = (normalizedProbability: number): bigint =>
	parseDecimalToFixedBigInt({ value: normalizedProbability, fractionDigits: PRICE_DECIMALS });

/**
 * Converts token smallest units to clearing USD base units (`USD_DECIMALS`).
 * Used when sizing orders under the 1 token ≈ 1 USD collateral convention.
 */
export const tokenBaseUnitsToUsdBaseUnits = ({
	amount,
	tokenDecimals
}: {
	amount: bigint;
	tokenDecimals: number | bigint;
}): bigint => {
	const td = typeof tokenDecimals === 'bigint' ? tokenDecimals : BigInt(tokenDecimals);

	return (amount * 10n ** BigInt(USD_DECIMALS)) / 10n ** td;
};
