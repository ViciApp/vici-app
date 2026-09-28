<script lang="ts">
	import type { LucideIcon } from '@lucide/svelte';

	interface Option<T extends string | number> {
		value: T;
		label: string;
	}

	interface Props<T extends string | number> {
		label: string;
		sub?: string;
		icon?: LucideIcon;
		value: T;
		options: readonly Option<T>[];
		onchange: (value: T) => void;
	}

	let {
		label,
		sub = undefined,
		icon: IconComponent = undefined,
		value,
		options,
		onchange
	}: Props<string | number> = $props();
</script>

<div class="set-segmented">
	<div class="set-segmented-head">
		{#if IconComponent}
			<span class="set-segmented-icon" aria-hidden="true">
				<IconComponent size={18} strokeWidth={1.6} />
			</span>
		{/if}
		<div class="set-segmented-copy">
			<span class="set-segmented-label">{label}</span>
			{#if sub}
				<span class="set-segmented-sub">{sub}</span>
			{/if}
		</div>
	</div>
	<div class="set-segmented-track" aria-label={label} role="radiogroup">
		{#each options as option (option.value)}
			<button
				class="set-segment"
				class:is-active={value === option.value}
				aria-checked={value === option.value}
				onclick={() => onchange(option.value)}
				role="radio"
				type="button"
			>
				{option.label}
			</button>
		{/each}
	</div>
</div>

<style lang="postcss">
	.set-segmented {
		padding: 0.875rem;
		background: var(--bg-surface);
	}

	.set-segmented-head {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.625rem;
	}

	/* Bare inline glyph, tinted to the dim foreground tier — matches the
	   settings-row icon treatment (no tinted tile). */
	.set-segmented-icon {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		color: var(--fg-dim);
	}

	.set-segmented-copy {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.set-segmented-label {
		font-size: var(--t-14);
		font-weight: 500;
		letter-spacing: -0.005em;
		color: var(--text-base);
	}

	.set-segmented-sub {
		font-size: var(--t-11);
		line-height: 1.4;
		color: var(--text-muted);
		text-wrap: pretty;
	}

	.set-segmented-track {
		display: grid;
		grid-template-columns: repeat(var(--cols, 3), minmax(0, 1fr));
		gap: 0.125rem;
		padding: 0.2rem;
		border-radius: var(--r-8);
		background: color-mix(in srgb, var(--text-base) 5%, transparent);
		border: 1px solid var(--border-base);
	}

	.set-segmented-track {
		--cols: 3;
	}

	.set-segment {
		padding: 0.5rem 0.625rem;
		border: none;
		border-radius: var(--r-4);
		background: transparent;
		font-size: var(--t-13);
		font-weight: 500;
		color: var(--text-muted);
		cursor: pointer;
		transition:
			background-color var(--d-hover) var(--ease-vici),
			color var(--d-hover) var(--ease-vici);
	}

	.set-segment:hover {
		color: var(--text-base);
	}

	/* Active segment lifts to the elevated surface with plain foreground
	   text (not the brand accent) so the selected pill reads as a neutral
	   raised tab, matching the in-page flow-deck tabs. */
	.set-segment.is-active {
		background: var(--bg-popover);
		color: var(--text-base);
		box-shadow: var(--shadow-card);
	}
</style>
