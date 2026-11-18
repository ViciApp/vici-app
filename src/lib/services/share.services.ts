import { localeStore } from '#lib/stores/locale.store.ts';
import { notificationsStore } from '#lib/stores/notification.store.ts';
import { t } from '#lib/utils/i18n.utils.ts';
import { get } from 'svelte/store';

/**
 * The one "sharing failed" toast for every share surface. A user-cancelled
 * share sheet (`AbortError`) is not a failure: callers skip this for it.
 * Locale is sampled at call time from `localeStore`.
 */
export const notifyShareFailed = (): void => {
	const locale = get(localeStore);

	notificationsStore.add({
		title: t({ locale, key: 'market.detail.share.failed_title' }),
		message: t({ locale, key: 'market.detail.share.failed' }),
		type: 'error'
	});
};
