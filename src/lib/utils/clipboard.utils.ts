import type { AppLocale } from '#lib/constants/locale.constants.ts';
import { notificationsStore } from '#lib/stores/notification.store.ts';
import { t } from '#lib/utils/i18n.utils.ts';

/**
 * Pure clipboard write: wraps `navigator.clipboard.writeText` so we
 * centralise the (rare) `NotAllowedError` / missing-API failure modes
 * in one place. Resolves `true` on success, `false` if the write
 * fails. Use this when the caller manages its own success UI (e.g.
 * an inline toast).
 */
export const writeToClipboard = async (value: string): Promise<boolean> => {
	try {
		await navigator.clipboard.writeText(value);

		return true;
	} catch {
		return false;
	}
};

/**
 * Clipboard write + global success/failure notification. Preferred for
 * "address copied" / "code copied" surfaces that want the standard
 * VICI toast treatment.
 */
export const copyToClipboard = async ({
	value,
	text,
	locale
}: {
	value: string;
	text: string;
	locale: AppLocale;
}): Promise<void> => {
	const ok = await writeToClipboard(value);

	notificationsStore.add({
		title: t({ locale, key: ok ? 'ui.clipboard.copied_title' : 'ui.clipboard.failed_title' }),
		message: t({
			locale,
			key: ok ? 'ui.clipboard.copied_message' : 'ui.clipboard.failed_message',
			params: { label: text }
		}),
		type: ok ? 'success' : 'error',
		duration: 2000
	});
};
