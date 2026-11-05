<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import { Share2 } from '@lucide/svelte/icons';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { notificationsStore } from '#lib/stores/notification.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { browser } from '$app/env';

	interface Props {
		title: string;
	}

	const { title }: Props = $props();

	const share = async () => {
		if (!browser) {
			return;
		}

		const url = window.location.href;

		try {
			if (typeof navigator.share === 'function') {
				await navigator.share({ title, url });

				return;
			}

			if (nonNullish(navigator.clipboard)) {
				await navigator.clipboard.writeText(url);
				notificationsStore.add({
					title: t({ locale: $localeStore, key: 'market.detail.share.copied_title' }),
					message: t({ locale: $localeStore, key: 'market.detail.share.copied' }),
					type: 'success'
				});
			}
		} catch (err) {
			// User-cancelled native share sheets reject — treat as silent no-op.
			if (err instanceof DOMException && err.name === 'AbortError') {
				return;
			}

			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'market.detail.share.failed_title' }),
				message: t({ locale: $localeStore, key: 'market.detail.share.failed' }),
				type: 'error'
			});
		}
	};
</script>

<!-- Share button on the Market detail appbar — prefers the native Web
     Share sheet (mobile), falls back to clipboard copy on desktop with
     a toast acknowledgement. Wears the faint ghost icon-button look so
     it reads as one set with the back chevron and the save control. -->
<button
	class="market-detail-share"
	aria-label={t({ locale: $localeStore, key: 'market.detail.share.label' })}
	onclick={share}
	type="button"
>
	<Share2 aria-hidden="true" size={18} strokeWidth={1.8} />
</button>

<style lang="postcss">
	.market-detail-share {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 8px 10px;
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		/* Faint foreground wash so the fill tracks every theme (dark /
		   light / peach) instead of a hardcoded dark-only rgba. */
		background: color-mix(in srgb, var(--text-base) 6%, transparent);
		color: var(--text-base);
		cursor: pointer;
		transition:
			background-color var(--d-hover) var(--ease-vici),
			border-color var(--d-hover) var(--ease-vici);
	}

	.market-detail-share:hover {
		border-color: var(--border-strong);
		background: color-mix(in srgb, var(--text-base) 11%, transparent);
	}
</style>
