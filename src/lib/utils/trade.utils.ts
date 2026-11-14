import { isVxpLadderStake, VXP_STAKE_LADDER } from '#lib/constants/vxp-economy.constants.ts';
import { placeOrder } from '#lib/services/order.services.ts';
import type { Market } from '#lib/types/market.ts';
import type { OrderType } from '#lib/types/order.ts';
import { isViciXp } from '#lib/utils/balance-domain.utils.ts';
import { resolveOutcomeExecutionPrice } from '#lib/utils/market.utils.ts';
import {
	parseToken,
	parseUsdBaseUnitsFromDecimal,
	tokenBaseUnitsToUsdBaseUnits
} from '#lib/utils/parse.utils.ts';
import { nonNullish } from '@dfinity/utils';

/**
 * @throws Error when the premium isn't a valid ViciXp stake-ladder rung.
 *
 * No max-payout floor is enforced: a winning call always nets a positive
 * amount (the settlement cashflow is `stake·(1/price − 1)`, above zero for
 * any price < 1), so gating on gross payout (`stake / price`) added nothing;
 * it only made any side priced above 0.5 unplaceable at the smallest
 * stake, e.g. a 50-VXP premium on a 50/50 market, which left first-call
 * users (locked to the smallest rung, market orders) with no placeable side
 * at all. Heavy favourites net a real sub-1 amount; the UI shows that
 * honestly as "<1" rather than over-promising a "+1" (see `vxpNetWin`).
 */
export const assertViciXpHumanPremium = ({ amountStr }: { amountStr: string }): void => {
	const premiumHuman = Number(String(amountStr).trim());

	if (!isVxpLadderStake(premiumHuman)) {
		throw new Error(`VXP premium must be one of ${VXP_STAKE_LADDER.join(', ')}`);
	}
};

/**
 * Parameters for placing an outcome trade from the flow or manual UI.
 */
export interface TradeParams {
	market: Market;
	action: 'YES' | 'NO' | string;
	amount: string;
	orderType?: OrderType;
	/**
	 * Normalized limit price in `[0, 1]` when `orderType` is LIMIT.
	 */
	limitPrice?: number;
}

/**
 * Computes execution price and quantity, then submits a buy via `placeOrder`.
 */
export const executeOutcomeTrade = async ({
	market,
	action,
	amount,
	orderType = 'MARKET',
	limitPrice
}: TradeParams): Promise<void> => {
	const amountBase = parseToken({
		value: String(amount).trim(),
		unitName: market.token.decimals
	});

	const resolveOrderType = (): OrderType => {
		if (orderType === 'LIMIT' && nonNullish(limitPrice)) {
			return orderType;
		}

		if (action === 'YES') {
			return nonNullish(market.bestAsk) ? 'MARKET' : 'LIMIT';
		}

		if (action === 'NO') {
			return nonNullish(market.bestBid) ? 'MARKET' : 'LIMIT';
		}

		return 'LIMIT';
	};

	const type = resolveOrderType();

	const finalPrice = resolveOutcomeExecutionPrice({
		market,
		action,
		orderType,
		limitPrice
	});

	if (isViciXp(market.balanceDomain)) {
		assertViciXpHumanPremium({ amountStr: String(amount) });
	}

	// Clearing margin is `qty * price` in USD `USD_DECIMALS` (see `get_required_margin`). Convert
	// collateral from token base units to that USD scale (1 token ≈ 1 USD notionally for sizing).
	const amountUsd = tokenBaseUnitsToUsdBaseUnits({
		amount: amountBase,
		tokenDecimals: market.token.decimals
	});
	const priceUsd = parseUsdBaseUnitsFromDecimal(finalPrice);
	const qty = amountUsd / priceUsd;

	const isBinary = market.payoffType === 'Binary';

	await placeOrder({
		marketId: market.id,
		marketTitle: market.title,
		side: 'BUY',
		type,
		price: isBinary && action === 'NO' ? 1 - finalPrice : finalPrice,
		qty,
		outcome: action,
		expiryDate: market.expiryDate
	});
};
