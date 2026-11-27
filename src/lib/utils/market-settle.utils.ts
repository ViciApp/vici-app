import type { AppLocale } from '#lib/constants/locale.constants.ts';
import { DAY_IN_MS, HOUR_IN_MS } from '#lib/constants/time.constants.ts';
import { t } from '#lib/utils/i18n.utils.ts';

/**
 * When a market settles, worded the same on every surface: relative
 * ("Settles in 12 days") or absolute ("Settles on 31 Dec 2026"). Both read
 * the market's expiry in epoch ms.
 */

// Past this many days the countdown reads in months ("Settles in 4 months").
const COUNTDOWN_DAYS_LIMIT = 60;
const DAYS_PER_MONTH = 30;
const HOURS_PER_DAY = 24;

/** The settle date, always with the year: "31 Dec 2026", in `locale`'s order. */
export const formatSettleDate = ({
	expiryMs,
	locale
}: {
	expiryMs: number;
	locale: AppLocale;
}): string =>
	new Date(expiryMs).toLocaleDateString(locale, {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});

/** "Settles on 31 Dec 2026". */
export const formatSettlesOn = ({
	expiryMs,
	locale
}: {
	expiryMs: number;
	locale: AppLocale;
}): string =>
	t({ locale, key: 'market.settles.on', params: { date: formatSettleDate({ expiryMs, locale }) } });

/**
 * "Settles in 12 days": hours under a day, whole days up to two months,
 * rounded months beyond. Under an hour it settles "within the hour"; once
 * the expiry has passed it is "settling now" (the outcome is not in yet).
 */
export const formatSettlesIn = ({
	expiryMs,
	nowMs,
	locale
}: {
	expiryMs: number;
	nowMs: number;
	locale: AppLocale;
}): string => {
	const leftMs = expiryMs - nowMs;

	if (!Number.isFinite(leftMs) || leftMs <= 0) {
		return t({ locale, key: 'market.settles.now' });
	}

	if (leftMs < HOUR_IN_MS) {
		return t({ locale, key: 'market.settles.within_hour' });
	}

	if (leftMs < DAY_IN_MS) {
		const hours = Math.min(HOURS_PER_DAY - 1, Math.round(leftMs / HOUR_IN_MS));

		return hours === 1
			? t({ locale, key: 'market.settles.in_hours_one' })
			: t({ locale, key: 'market.settles.in_hours', params: { count: hours } });
	}

	const days = Math.max(1, Math.round(leftMs / DAY_IN_MS));

	if (days >= COUNTDOWN_DAYS_LIMIT) {
		return t({
			locale,
			key: 'market.settles.in_months',
			params: { count: Math.round(days / DAYS_PER_MONTH) }
		});
	}

	return days === 1
		? t({ locale, key: 'market.settles.in_days_one' })
		: t({ locale, key: 'market.settles.in_days', params: { count: days } });
};
