<script lang="ts">
	import { fly } from 'svelte/transition';
	import ViciChar from '#lib/components/characters/ViciChar.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { prefersReducedMotion } from '#lib/utils/reduced-motion.utils.ts';

	interface Props {
		onBackToMarkets: () => void;
	}

	const { onBackToMarkets }: Props = $props();
</script>

<!-- Empty-deck state. VICI in `thinking` mood holds the canvas,
     single-line copy, no escalation, no celebration. -->
<div class="empty-deck flex h-full w-full flex-col items-center justify-center px-6">
	<div
		class="relative z-10 max-w-md text-center"
		in:fly={prefersReducedMotion() ? { duration: 0 } : { y: 20, duration: 500 }}
	>
		<div class="empty-deck-char">
			<ViciChar mood="thinking" size={96} />
		</div>
		<h2 class="empty-deck-title">{t({ locale: $localeStore, key: 'flow.empty.title' })}</h2>
		<p class="empty-deck-sub">{t({ locale: $localeStore, key: 'flow.empty.sub' })}</p>
		<Button onclick={onBackToMarkets}>
			{t({ locale: $localeStore, key: 'flow.back_to_markets' })}
		</Button>
	</div>
</div>

<style lang="postcss">
	/* Empty-deck negative state. VICI in `thinking` mood owns the
	   canvas; copy is single-line; no celebration; no escalation. */
	.empty-deck {
		position: relative;
		background: var(--bg-base);
	}
	.empty-deck-char {
		margin-bottom: 1.5rem;
		display: flex;
		justify-content: center;
	}
	.empty-deck-title {
		font-family: var(--font-display);
		font-size: var(--t-32);
		font-weight: 600;
		letter-spacing: var(--tracking-snug);
		color: var(--text-base);
		margin: 0 0 0.5rem;
	}
	.empty-deck-sub {
		font-size: var(--t-14);
		color: var(--text-muted);
		margin: 0 0 1.5rem;
	}
</style>
