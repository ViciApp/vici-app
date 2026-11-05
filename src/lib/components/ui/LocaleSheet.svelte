<script lang="ts">
	import { Globe, X } from '@lucide/svelte/icons';
	import BottomSheet from '#lib/components/ui/BottomSheet.svelte';
	import LocalePicker from '#lib/components/ui/LocalePicker.svelte';
	import { LOCALE_REGISTRY, type AppLocale } from '#lib/constants/locale.constants.ts';
	import {
		clearLocaleChoice,
		detectedLocale,
		localeChoiceExplicit,
		localeStore
	} from '#lib/stores/locale.store.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';

	/**
	 * Two-axis (Language ▸ Region) locale picker rendered as a bottom sheet
	 * docked to the bottom of the viewport. Chrome (scrim, grip, slide-up,
	 * focus trap, viewport pinning, pill-nav hide) comes from the shared
	 * {@link BottomSheet} primitive; this component owns the header, the
	 * shared `LocalePicker`, and a "Use automatic" footer that appears only
	 * when the active locale is an explicit choice. Used by the Settings
	 * surface and the landing nav (mobile), which pass their own `titleKey`.
	 */
	interface Props {
		isOpen: boolean;
		current: AppLocale;
		onClose: () => void;
		onPick: (locale: AppLocale) => void;
		/** Catalog key for the sheet header (e.g. settings vs. landing). */
		titleKey?: MessageKey;
	}

	const { isOpen, current, onClose, onPick, titleKey = 'settings.language' }: Props = $props();

	// Region the "Use automatic" reset would fall back to, for its sub-label.
	const detectedRegionLabel = $derived(
		LOCALE_REGISTRY.find(({ id }) => id === detectedLocale)?.regionLabel ?? null
	);

	const useAutomatic = () => {
		clearLocaleChoice();
		onClose();
	};
</script>

<BottomSheet {isOpen} labelledBy="lang-title" {onClose} sidePadding="0.5rem">
	<div class="lang-head">
		<h2 id="lang-title" class="lang-title">{t({ locale: $localeStore, key: titleKey })}</h2>
		<button
			class="lang-close"
			aria-label={t({ locale: $localeStore, key: 'a11y.close_modal' })}
			onclick={onClose}
			type="button"
		>
			<X aria-hidden="true" size={18} strokeWidth={1.8} />
		</button>
	</div>

	<LocalePicker {current} maxHeight={420} {onPick} />

	{#if $localeChoiceExplicit}
		<button class="lang-auto" onclick={useAutomatic} type="button">
			<Globe aria-hidden="true" size={15} strokeWidth={1.8} />
			<span>
				{t({ locale: $localeStore, key: 'picker.use_auto' })}{detectedRegionLabel
					? ` · ${detectedRegionLabel}`
					: ''}
			</span>
		</button>
	{/if}
</BottomSheet>

<style lang="postcss">
	.lang-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin: 0 0.75rem 0.5rem;
	}

	.lang-title {
		margin: 0;
		font-size: var(--t-16);
		font-weight: 600;
		letter-spacing: var(--tracking-snug);
		color: var(--text-base);
	}

	.lang-close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.375rem;
		border: none;
		border-radius: var(--r-8);
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition: color var(--d-hover) var(--ease-vici);
	}

	.lang-close:hover {
		color: var(--text-base);
	}

	/* "Use automatic" reset — a full-width footer above the safe-area
	   inset, separated from the list by a hairline. */
	.lang-auto {
		display: flex;
		align-items: center;
		gap: 0.5625rem;
		width: 100%;
		box-sizing: border-box;
		margin-top: 0.25rem;
		padding: 0.8125rem 1rem;
		border: 0;
		border-top: 1px solid var(--border-base);
		background: transparent;
		color: var(--text-muted);
		text-align: left;
		font-family: var(--font-sans);
		font-size: var(--t-13);
		font-weight: 500;
		cursor: pointer;
		transition: color var(--d-hover) var(--ease-vici);
	}

	.lang-auto:hover {
		color: var(--color-primary);
	}
</style>
