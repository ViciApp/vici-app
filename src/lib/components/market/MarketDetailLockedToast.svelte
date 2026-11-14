<script lang="ts">
	import { Check } from '@lucide/svelte/icons';
	import { fade } from 'svelte/transition';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		open: boolean;
	}

	const { open }: Props = $props();
</script>

<!-- Locked-in confirmation overlay.
     Fires after a successful prediction; the parent toggles `open` on
     for ~1.1s so the message reads as a moment of acknowledgement
     rather than a permanent state. Backdrop is blurred + dimmed so the
     check + serif "Locked in." pop forward. -->
{#if open}
	<div
		class="market-locked-toast"
		aria-live="assertive"
		role="status"
		in:fade={{ duration: 120 }}
		out:fade={{ duration: 220 }}
	>
		<div class="market-locked-toast-check">
			<Check aria-hidden="true" size={48} strokeWidth={1.5} />
		</div>
		<div class="market-locked-toast-msg serif-italic">
			{t({ locale: $localeStore, key: 'market.detail.locked_in' })}
		</div>
	</div>
{/if}

<style lang="postcss">
	.market-locked-toast {
		position: fixed;
		inset: 0;
		z-index: 90;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.625rem;
		background: rgba(14, 13, 11, 0.55);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
	}

	.market-locked-toast-check {
		color: var(--laurel);
	}

	/* Serif-italic brand treatment: the `.serif-italic` utility on the
	   element supplies font-family + italic + weight; we only set the
	   surface-specific size / colour / rhythm here. */
	.market-locked-toast-msg {
		color: var(--laurel);
		font-size: var(--t-32);
		line-height: 1;
	}
</style>
