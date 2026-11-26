<script lang="ts">
	import { isNullish } from '@dfinity/utils';
	import type { MacroId } from '#lib/constants/market-taxonomy.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { categoryLabel } from '#lib/utils/market-tags.utils.ts';

	/**
	 * Category filter above the Markets list: "All", then every category
	 * that has an open market. The selected one is underlined.
	 */
	interface Props {
		categories: MacroId[];
		selected?: MacroId;
		onselect: (category: MacroId | undefined) => void;
	}

	const { categories, selected, onselect }: Props = $props();
</script>

<div
	class="lmk"
	aria-label={t({ locale: $localeStore, key: 'landing.markets.categories' })}
	role="group"
>
	<button
		class:is-on={isNullish(selected)}
		aria-pressed={isNullish(selected)}
		onclick={() => onselect(undefined)}
		type="button"
	>
		{t({ locale: $localeStore, key: 'market.category.all' })}
	</button>
	{#each categories as category (category)}
		<button
			class:is-on={selected === category}
			aria-pressed={selected === category}
			onclick={() => onselect(category)}
			type="button"
		>
			{categoryLabel({ category, variant: 'full', locale: $localeStore })}
		</button>
	{/each}
</div>

<style lang="postcss">
	.lmk {
		display: flex;
		flex: 1 1 auto;
		gap: 2px;
		min-width: 0;
		margin: 0 0 14px -12px;
		overflow-x: auto;
		scrollbar-width: none;
		touch-action: pan-x pan-y;
		mask-image: linear-gradient(90deg, var(--ink) calc(100% - 28px), transparent);
	}

	.lmk::-webkit-scrollbar {
		display: none;
	}

	button {
		flex: none;
		height: 44px;
		padding: 0 12px;
		border: 0;
		border-radius: var(--r-8);
		background: none;
		color: var(--lm-quiet);
		font: 600 15px/1 var(--font-display);
		cursor: pointer;
		transition: color 160ms ease;
	}

	button.is-on {
		color: var(--parchment);
		text-decoration: underline;
		text-decoration-thickness: 1.5px;
		text-underline-offset: 7px;
	}

	button:focus-visible {
		outline: 2px solid var(--parchment);
		outline-offset: -2px;
	}

	@media (hover: hover) and (pointer: fine) {
		button:not(.is-on):hover {
			color: var(--parchment);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		button {
			transition: none;
		}
	}
</style>
