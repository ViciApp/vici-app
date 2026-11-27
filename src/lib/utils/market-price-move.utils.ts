import type { AppLocale } from '#lib/constants/locale.constants.ts';
import { DAY_IN_MS } from '#lib/constants/time.constants.ts';
import { t } from '#lib/utils/i18n.utils.ts';
import type { MarketPriceSeries } from '#lib/utils/market-price-history.utils.ts';

/**
 * The YES price's move over the last 24 hours, in whole points: the current
 * price against the last trade at least a day old. When every trade in the
 * window is younger than a day (a `1d` window, or a market that opened
 * today) the first one stands in. `undefined` when the window holds no trade
 * at all, so the UI states no move rather than a made-up "flat".
 */
export const priceMove24h = ({
	yes,
	xs,
	windowMs,
	currentPercent
}: Pick<MarketPriceSeries, 'yes' | 'xs'> & {
	/** Length of the window `xs` spans, ms. */
	windowMs: number;
	/** Live YES price, whole percent; the last trade stands in when unknown. */
	currentPercent?: number;
}): number | undefined => {
	if (yes.length === 0) {
		return;
	}

	const cutoff = (windowMs - DAY_IN_MS) / Math.max(windowMs, 1);
	const dayOld = xs.reduce((found, x, index) => (x <= cutoff ? index : found), 0);
	const current = currentPercent ?? yes[yes.length - 1];

	return Math.round(current - yes[dayOld]);
};

/** "+4 in 24h" / "-3 in 24h" / "0 in 24h", in `locale`. */
export const formatPriceMove24h = ({ move, locale }: { move: number; locale: AppLocale }): string =>
	t({
		locale,
		key: 'market.move_24h',
		params: { move: new Intl.NumberFormat(locale, { signDisplay: 'exceptZero' }).format(move) }
	});
