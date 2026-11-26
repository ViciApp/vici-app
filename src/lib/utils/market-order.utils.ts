import type { ClearingDid } from '#declarations';
import { USD_DECIMALS, ZERO } from '#lib/constants/app.constants.ts';
import type { OrderSide } from '#lib/types/order.ts';
import { isNullish } from '@dfinity/utils';

const USD_ONE = 10n ** BigInt(USD_DECIMALS);

// A healthy walk never reaches it: each pass either takes from a level or
// ends the walk.
const MAX_BOOK_PASSES = 10;

const NO_MATCHING_LIQUIDITY_MESSAGE = 'No matching liquidity found for market order';

const ceilDiv = ({ value, divisor }: { value: bigint; divisor: bigint }): bigint =>
	(value + divisor - 1n) / divisor;

const minOf = (values: bigint[]): bigint =>
	values.reduce((smallest, value) => (value < smallest ? value : smallest));

/**
 * What one share of the caller's outcome costs at a fixed-point engine price,
 * in clearing USD base units (`USD_DECIMALS`): the price when the caller buys,
 * its complement when the caller sells (buying NO on a binary book sells YES).
 * Rounded up, so a spend sized on it never comes out above the engine's own
 * margin figure.
 */
export const shareCostUsd = ({
	price: { value, decimals },
	side
}: {
	price: ClearingDid.DecimalValue;
	side: OrderSide;
}): bigint => {
	const scale = 10n ** BigInt(decimals);
	const outcomeValue = side === 'BUY' ? value : scale - value;

	return ceilDiv({ value: outcomeValue * USD_ONE, divisor: scale });
};

/**
 * What one share of the caller's outcome costs at a resting book level: the
 * level price when the caller buys from it, its complement when the caller
 * sells into it. See {@link shareCostUsd}.
 */
export const levelShareCostUsd = ({
	level,
	takerSide
}: {
	level: ClearingDid.LimitOrder;
	takerSide: OrderSide;
}): bigint => shareCostUsd({ price: level.price.decimal, side: takerSide });

export interface MarketOrderFill {
	filledQty: bigint;
	/** What the fill cost the caller, in clearing USD base units. */
	spentUsd: bigint;
}

/**
 * Walk the book best level first, taking from each level no more than the
 * rest of the requested `qty`, the level's size, and what the rest of
 * `maxSpendUsd` buys at that level's price. The walk stops once the call size
 * is spent, so a thin book never fills worse levels for more than the caller
 * chose to spend; a book smaller than the request fills what exists.
 *
 * The book is re-read between takes (`readBook`, sorted best first): a level
 * shrunk by a concurrent taker would otherwise overstate the fill, since the
 * engine executes `min(take, current level)`.
 *
 * Throws when nothing can fill (an empty book, or a best level the call size
 * cannot buy one share of) or when the first take fails. After a partial fill
 * the caller holds a real position, so a later failure ends the walk with what
 * filled instead of reading as "nothing happened".
 */
export const walkMarketOrder = async ({
	qty,
	maxSpendUsd,
	takerSide,
	readBook,
	takeLevel
}: {
	qty: bigint;
	maxSpendUsd: bigint;
	takerSide: OrderSide;
	readBook: () => Promise<ClearingDid.LimitOrder[]>;
	takeLevel: (params: { level: ClearingDid.LimitOrder; qty: bigint }) => Promise<void>;
}): Promise<MarketOrderFill> => {
	let book = await readBook();

	if (book.length === 0) {
		throw new Error(NO_MATCHING_LIQUIDITY_MESSAGE);
	}

	let filledQty = ZERO;
	let spentUsd = ZERO;

	try {
		for (let pass = 0; pass < MAX_BOOK_PASSES && filledQty < qty; pass++) {
			if (pass > 0) {
				book = await readBook();
			}

			const [best] = book;

			if (isNullish(best)) {
				break;
			}

			const shareCostUsd = levelShareCostUsd({ level: best, takerSide });
			const affordable = shareCostUsd > ZERO ? (maxSpendUsd - spentUsd) / shareCostUsd : qty;
			const take = minOf([qty - filledQty, best.qty, affordable]);

			if (take <= ZERO) {
				break;
			}

			await takeLevel({ level: best, qty: take });

			filledQty += take;
			spentUsd += take * shareCostUsd;
		}
	} catch (err: unknown) {
		if (filledQty === ZERO) {
			throw err;
		}

		console.warn('Market order partially filled before an error; keeping the filled amount', err);
	}

	if (filledQty === ZERO) {
		throw new Error(NO_MATCHING_LIQUIDITY_MESSAGE);
	}

	return { filledQty, spentUsd };
};
