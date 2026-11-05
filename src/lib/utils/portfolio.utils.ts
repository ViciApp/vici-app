import { USD_DECIMALS, ZERO } from '#lib/constants/app.constants.ts';
import { PORTFOLIO_DEFAULT_DECIMALS } from '#lib/constants/portfolio.constants.ts';
import type { Market } from '#lib/types/market.ts';
import type { Position } from '#lib/types/position.ts';
import { decimalFixedValueToNumber } from '#lib/utils/format.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';

/**
 * Returns the settled value of a position on a resolved market, in the
 * position's native `netQty` bigint units. Mirrors the clearing engine's
 * binary / categorical payoff rules: the full `netQty` on the winning
 * outcome, `ZERO` on every other outcome. Returns `undefined` if we don't
 * know which outcome won so the caller can fall back to live probabilities.
 *
 * Uses bigint arithmetic end-to-end — avoid routing position quantities
 * through `Number` here, which would lose precision on positions larger
 * than `Number.MAX_SAFE_INTEGER` (2^53 − 1).
 */
const resolvedPositionValue = ({
	position,
	market
}: {
	position: Position;
	market: Market;
}): bigint | undefined => {
	if (isNullish(market.outcome)) {
		return;
	}

	return position.outcomeId === market.outcome ? position.netQty : ZERO;
};

/**
 * Calculates the current real-value of a user position.
 *
 * For open markets we use live implied probability from the order book.
 * For resolved markets we use the final outcome (full `netQty` if won, zero
 * if lost) so the portfolio reflects the settled value rather than
 * pre-resolution midpoints.
 *
 * Returns `undefined` when the value cannot be computed — no market, or an
 * open binary market whose implied probability is still unknown (the book
 * hasn't been read, or read empty; see {@link Market.yesProbability}). The
 * caller must treat `undefined` as "value unknown" and render a placeholder
 * rather than substituting a fabricated `0`/50%.
 */
export const calculatePositionValue = ({
	position,
	market
}: {
	position: Position;
	market?: Market;
}): bigint | undefined => {
	if (isNullish(market)) {
		return;
	}

	if (market.status === 'Resolved') {
		const settled = resolvedPositionValue({ position, market });

		if (nonNullish(settled)) {
			return settled;
		}
	}

	const prob =
		market.payoffType === 'Binary'
			? position.outcomeId === 'YES'
				? market.yesProbability
				: market.noProbability
			: 1 / (market.outcomes?.length ?? 1);

	// Unknown implied probability (binary market, book not yet read or empty).
	// Bail out instead of coercing `undefined` through `Number` into a NaN /
	// fabricated value — the caller surfaces a "value unknown" placeholder.
	if (isNullish(prob)) {
		return;
	}

	return BigInt(Math.floor(Number(position.netQty) * prob));
};

/**
 * Unrealized P&L for a position, in VXP units. Returns `undefined` when the
 * underlying value is unknown (see {@link calculatePositionValue}) so the
 * caller can render a placeholder rather than a misleading `0`.
 */
export const calculatePositionPnL = ({
	position,
	market
}: {
	position: Position;
	market?: Market;
}): number | undefined => {
	if (isNullish(market)) {
		return;
	}

	const currentValue = calculatePositionValue({ position, market });

	if (isNullish(currentValue)) {
		return;
	}

	// lockedCollateral is clearing USD (`USD_DECIMALS`). currentValue uses token decimals.
	const valNum = decimalFixedValueToNumber({
		value: currentValue,
		decimals: market.token.decimals ?? PORTFOLIO_DEFAULT_DECIMALS
	});
	const costNum = decimalFixedValueToNumber({
		value: position.lockedCollateral,
		decimals: USD_DECIMALS
	});

	return valNum - costNum;
};

/**
 * Effective entry probability of a position — the volume-weighted average
 * price the user paid per share, expressed as a 0..1 probability. Shown
 * as the "Entry X% → Y%" value in the Portfolio active-calls list.
 *
 * Derivation: `lockedCollateral` is the total cost in clearing units
 * (`USD_DECIMALS`); `netQty` is the share count in the market's token
 * decimals. `cost / shares` is paid per share, which in our prediction
 * markets equals the implied entry probability (each winning share pays
 * 1 token at resolution).
 *
 * Returns `undefined` when the position has no quantity (avoids divide-by-zero).
 */
export const positionEntryProbability = ({
	position,
	market
}: {
	position: Position;
	market?: Market;
}): number | undefined => {
	if (isNullish(market)) {
		return;
	}

	if (position.netQty === ZERO) {
		return;
	}

	const sharesNum = decimalFixedValueToNumber({
		value: position.netQty,
		decimals: market.token.decimals ?? PORTFOLIO_DEFAULT_DECIMALS
	});

	if (sharesNum === 0) {
		return;
	}

	const costNum = decimalFixedValueToNumber({
		value: position.lockedCollateral,
		decimals: USD_DECIMALS
	});

	const prob = costNum / sharesNum;

	if (prob < 0 || prob > 1) {
		return;
	}

	return prob;
};
