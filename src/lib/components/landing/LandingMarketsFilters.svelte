<script lang="ts">
	import LandingMarketsChips from '#lib/components/landing/LandingMarketsChips.svelte';
	import type { LandingMarketsLayout } from '#lib/constants/landing-markets.constants.ts';
	import type { MacroId } from '#lib/constants/market-taxonomy.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	/**
	 * The row above the Markets board: the category filter, and on wide
	 * screens the switch between the front page and the table.
	 */
	interface Props {
		categories: MacroId[];
		category?: MacroId;
		oncategory: (category: MacroId | undefined) => void;
		layout: LandingMarketsLayout;
		/** Wide screens only: phones always show the front page. */
		canSwitch: boolean;
		onlayout: (layout: LandingMarketsLayout) => void;
	}

	const { categories, category, oncategory, layout, canSwitch, onlayout }: Props = $props();
</script>

<div class="lmf">
	{#if categories.length > 0}
		<LandingMarketsChips {categories} onselect={oncategory} selected={category} />
	{:else}
		<span class="lmf-fill"></span>
	{/if}

	{#if canSwitch}
		<div
			class="lmf-layout"
			aria-label={t({ locale: $localeStore, key: 'landing.markets.layout.label' })}
			role="group"
		>
			<button
				class:is-on={layout === 'front'}
				aria-label={t({ locale: $localeStore, key: 'landing.markets.layout.front' })}
				aria-pressed={layout === 'front'}
				onclick={() => onlayout('front')}
				title={t({ locale: $localeStore, key: 'landing.markets.layout.front' })}
				type="button"
			>
				<svg
					aria-hidden="true"
					fill="none"
					height="18"
					stroke="currentColor"
					stroke-linecap="round"
					stroke-width="1.6"
					viewBox="0 0 20 20"
					width="18"
				>
					<rect height="6.5" rx="1.6" width="14" x="3" y="3.5" />
					<path d="M3 13.5h14M3 16.8h9" />
				</svg>
			</button>
			<button
				class:is-on={layout === 'table'}
				aria-label={t({ locale: $localeStore, key: 'landing.markets.layout.table' })}
				aria-pressed={layout === 'table'}
				onclick={() => onlayout('table')}
				title={t({ locale: $localeStore, key: 'landing.markets.layout.table' })}
				type="button"
			>
				<svg
					aria-hidden="true"
					fill="none"
					height="18"
					stroke="currentColor"
					stroke-linecap="round"
					stroke-width="1.6"
					viewBox="0 0 20 20"
					width="18"
				>
					<path d="M3 5h14M3 10h14M3 15h14" />
				</svg>
			</button>
		</div>
	{/if}
</div>

<style lang="postcss">
	.lmf {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
		margin: 0 0 14px;
	}

	.lmf-fill {
		flex: 1 1 auto;
	}

	.lmf-layout {
		display: flex;
		flex: none;
		gap: 2px;
	}

	.lmf-layout button {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		padding: 0;
		border: 0;
		border-radius: 10px;
		background: none;
		color: var(--lm-quiet);
		cursor: pointer;
		transition:
			color 160ms ease,
			background 160ms ease;
	}

	.lmf-layout button.is-on {
		background: var(--lm-pane-a);
		color: var(--parchment);
	}

	.lmf-layout button:focus-visible {
		outline: 2px solid var(--parchment);
		outline-offset: 2px;
	}

	@media (hover: hover) and (pointer: fine) {
		.lmf-layout button:not(.is-on):hover {
			color: var(--parchment);
		}
	}

	@media (pointer: coarse) {
		.lmf-layout button {
			width: 44px;
			height: 44px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.lmf-layout button {
			transition: none;
		}
	}
</style>
