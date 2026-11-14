import { notificationsStore } from '#lib/stores/notification.store.ts';

/**
 * Pure clipboard write: wraps `navigator.clipboard.writeText` so we
 * centralise the (rare) `NotAllowedError` / missing-API failure modes
 * in one place. Resolves `true` on success, `false` if the write
 * fails. Use this when the caller manages its own success UI (e.g.
 * FlowInviteCard's inline toast).
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
	text
}: {
	value: string;
	text: string;
}): Promise<void> => {
	const ok = await writeToClipboard(value);

	notificationsStore.add({
		title: ok ? 'Copied' : 'Copy failed',
		message: ok ? `${text} copied to clipboard.` : `Could not copy ${text} to clipboard.`,
		type: ok ? 'success' : 'error',
		duration: 2000
	});
};
