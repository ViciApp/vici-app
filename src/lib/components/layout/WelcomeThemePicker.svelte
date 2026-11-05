<script lang="ts">
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { THEME_SWATCHES, theme } from '#lib/stores/theme.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
</script>

<div
	class="welcome-theme-picker"
	aria-label={t({ locale: $localeStore, key: 'a11y.appearance' })}
	role="radiogroup"
>
	{#each THEME_SWATCHES as option (option.id)}
		{@const optionLabel = t({ locale: $localeStore, key: option.labelKey })}
		<button
			style={`--swatch-bg: ${option.bg}; --swatch-dot: ${option.dot}`}
			class="welcome-theme-dot"
			class:active={$theme === option.id}
			aria-checked={$theme === option.id}
			aria-label={optionLabel}
			onclick={() => theme.set(option.id)}
			role="radio"
			title={optionLabel}
			type="button"
		>
			<span class="welcome-theme-dot-inner"></span>
		</button>
	{/each}
</div>

<style lang="postcss">
	.welcome-theme-picker {
		display: inline-flex;
		gap: 0.35rem;
	}

	.welcome-theme-dot {
		width: 1.5rem;
		height: 1.5rem;
		padding: 0;
		border-radius: var(--r-pill);
		border: 2px solid transparent;
		background: var(--swatch-bg);
		cursor: pointer;
		transition: border-color var(--d-state) var(--ease-vici);
	}

	.welcome-theme-dot.active {
		border-color: var(--color-primary);
	}

	.welcome-theme-dot-inner {
		display: block;
		width: 0.4rem;
		height: 0.4rem;
		margin: 0.4rem auto;
		border-radius: var(--r-pill);
		background: var(--swatch-dot);
	}
</style>
