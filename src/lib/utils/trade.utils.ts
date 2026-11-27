import { PRICE_DECIMALS } from '#lib/constants/app.constants.ts';
import { placeOrder } from '#lib/services/order.services.ts';
import type { Market } from '#lib/types/market.ts';
import type { CallSource, OrderSide, OrderType } from '#lib/types/order.ts';
import { isViciXp } from '#lib/utils/balance-domain.utils.ts';
import { shareCostUsd } from '#lib/utils/market-order.utils.ts';
import { resolveOutcomeExecutionPrice } from '#lib/utils/market.utils.ts';
import {
	parseLimitOrderPriceValue,
	parseToken,
	parseUsdBaseUnitsFromDecimal,
	tokenBaseUnitsToUsdBaseUnits
} from '#lib/utils/parse.utils.ts';
import { assertViciXpHumanPremium } from '#lib/utils/vxp-economy.utils.ts';
import { nonNullish } from '@dfinity/utils';

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
	/** The surface the call was placed from, for analytics. */
	source: CallSource;
}

/**
 * Computes execution price and quantity, then submits a buy via `placeOrder`.
 */
export const executeOutcomeTrade = async ({
	market,
	action,
	amount,
	orderType = 'MARKET',
	limitPrice,
	source
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

	const viciXp = isViciXp(market.balanceDomain);

	if (viciXp) {
		assertViciXpHumanPremium({ amountStr: String(amount) });
	}

	const isBinary = market.payoffType === 'Binary';
	const sellsYes = isBinary && action === 'NO';
	// The book is YES-framed: a NO call on a binary market is a YES sell at
	// the complement of the NO price.
	const enginePrice = sellsYes ? 1 - finalPrice : finalPrice;
	const engineSide: OrderSide = sellsYes ? 'SELL' : 'BUY';

	// Clearing margin is `qty * price` in USD `USD_DECIMALS` (see `get_required_margin`). Convert
	// collateral from token base units to that USD scale (1 token ≈ 1 USD notionally for sizing).
	const amountUsd = tokenBaseUnitsToUsdBaseUnits({
		amount: amountBase,
		tokenDecimals: market.token.decimals
	});
	// A resting limit order is sized on the exact price the engine receives (rounded to
	// `PRICE_DECIMALS`), so its notional never exceeds the call size and never falls a whole
	// share short of it; the web2 API refuses either on ViciXp. A market order is capped by
	// `maxSpendUsd` at every level it walks, so its upper bound may stay on the float price.
	const priceUsd =
		type === 'LIMIT'
			? shareCostUsd({
					price: { value: parseLimitOrderPriceValue(enginePrice), decimals: PRICE_DECIMALS },
					side: engineSide
				})
			: parseUsdBaseUnitsFromDecimal(finalPrice);
	const qty = amountUsd / priceUsd;

	await placeOrder({
		marketId: market.id,
		marketTitle: market.title,
		side: 'BUY',
		type,
		price: enginePrice,
		qty,
		maxSpendUsd: amountUsd,
		callSize: viciXp ? Number(String(amount).trim()) : undefined,
		outcome: action,
		expiryDate: market.expiryDate,
		source
	});
};
