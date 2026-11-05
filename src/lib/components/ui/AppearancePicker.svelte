<script lang="ts">
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { THEME_SWATCHES, theme, type Theme } from '#lib/stores/theme.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		variant?: 'dots' | 'tiles';
	}

	const { variant = 'dots' }: Props = $props();

	const options = THEME_SWATCHES;

	const setTheme = (value: Theme) => {
		theme.set(value);
	};
</script>

{#if variant === 'tiles'}
	<div
		class="appearance-tiles"
		aria-label={t({ locale: $localeStore, key: 'a11y.appearance' })}
		role="radiogroup"
	>
		{#each options as option (option.id)}
			{@const optionLabel = t({ locale: $localeStore, key: option.labelKey })}
			<button
				class="appearance-tile"
				class:is-active={$theme === option.id}
				aria-checked={$theme === option.id}
				aria-label={optionLabel}
				onclick={() => setTheme(option.id)}
				role="radio"
				title={optionLabel}
				type="button"
			>
				<span style:background={option.bg} class="appearance-tile-swatch">
					<span style:background={option.dot} class="appearance-tile-dot"></span>
				</span>
				<span class="appearance-tile-label">{optionLabel}</span>
			</button>
		{/each}
	</div>
{:else}
	<div
		class="appearance-picker"
		aria-label={t({ locale: $localeStore, key: 'a11y.appearance' })}
		role="radiogroup"
	>
		{#each options as option (option.id)}
			{@const optionLabel = t({ locale: $localeStore, key: option.labelKey })}
			<button
				style:background={option.bg}
				class="appearance-dot"
				class:is-active={$theme === option.id}
				aria-checked={$theme === option.id}
				aria-label={optionLabel}
				onclick={() => setTheme(option.id)}
				role="radio"
				title={optionLabel}
				type="button"
			>
				<span style:background={option.dot} class="appearance-dot-inner"></span>
			</button>
		{/each}
	</div>
{/if}

<style lang="postcss">
	/* Dots variant — landing footer, dropdown */
	.appearance-picker {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}

	.appearance-dot {
		position: relative;
		display: inline-flex;
		width: 1.4rem;
		height: 1.4rem;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: 1px solid var(--border-base);
		border-radius: var(--r-pill);
		cursor: pointer;
		transition:
			box-shadow var(--d-hover) var(--ease-vici),
			border-color var(--d-hover) var(--ease-vici),
			transform var(--d-hover) var(--ease-vici);
	}

	.appearance-dot:hover {
		border-color: var(--border-strong);
	}

	.appearance-dot:active {
		transform: scale(0.94);
	}

	.appearance-dot.is-active {
		border-color: var(--color-primary);
		box-shadow:
			0 0 0 2px var(--bg-base),
			0 0 0 3px var(--color-primary);
	}

	.appearance-dot-inner {
		display: block;
		width: 0.4rem;
		height: 0.4rem;
		border-radius: var(--r-pill);
	}

	/* Tiles variant — settings preferences */
	.appearance-tiles {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.625rem;
	}

	.appearance-tile {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.45rem;
		padding: 0.4rem 0.4rem 0.55rem;
		border: 1.5px solid var(--border-base);
		border-radius: 0.875rem;
		background: var(--bg-popover);
		cursor: pointer;
		transition:
			border-color var(--d-hover) var(--ease-vici),
			background-color var(--d-hover) var(--ease-vici),
			transform var(--d-hover) var(--ease-vici);
	}

	.appearance-tile:hover {
		border-color: var(--border-strong);
	}

	.appearance-tile:active {
		transform: scale(0.985);
	}

	.appearance-tile.is-active {
		border-color: var(--color-primary);
		background: color-mix(in srgb, var(--color-primary) 10%, var(--bg-popover));
	}

	.appearance-tile-swatch {
		position: relative;
		display: block;
		width: 100%;
		aspect-ratio: 4 / 3;
		border: 1px solid var(--border-base);
		border-radius: 0.55rem;
		box-shadow: inset 0 1px 0 color-mix(in srgb, #ffffff 18%, transparent);
	}

	.appearance-tile-dot {
		position: absolute;
		bottom: 0.45rem;
		left: 0.5rem;
		display: block;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: var(--r-pill);
	}

	.appearance-tile-label {
		text-align: center;
		color: var(--text-base);
		font-size: var(--t-13);
		font-weight: 600;
	}

	.appearance-tile.is-active .appearance-tile-label {
		color: var(--color-primary);
	}
</style>
