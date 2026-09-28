<script lang="ts">
	import type { LucideIcon } from '@lucide/svelte';
	import { ChevronRight } from '@lucide/svelte/icons';
	import type { Snippet } from 'svelte';

	interface Props {
		label: string;
		sub?: string;
		icon?: LucideIcon;
		badge?: string;
		muted?: boolean;
		onclick?: () => void;
		right?: Snippet;
	}

	const {
		label,
		sub = undefined,
		icon: IconComponent = undefined,
		badge = undefined,
		muted = false,
		onclick = undefined,
		right = undefined
	}: Props = $props();
</script>

<button class="set-row" class:is-muted={muted} {onclick} type="button">
	{#if IconComponent}
		<span class="set-row-icon" aria-hidden="true">
			<IconComponent size={18} strokeWidth={1.6} />
		</span>
	{/if}
	<span class="set-row-copy">
		<span class="set-row-label">{label}</span>
		{#if sub}
			<span class="set-row-sub">{sub}</span>
		{/if}
	</span>
	{#if badge}
		<span class="set-row-badge">{badge}</span>
	{/if}
	{#if right}
		{@render right()}
	{:else}
		<ChevronRight class="set-row-chevron" aria-hidden="true" size={16} strokeWidth={1.6} />
	{/if}
</button>

<style lang="postcss">
	.set-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		padding: 0.875rem;
		border: none;
		background: var(--bg-surface);
		color: var(--text-base);
		text-align: left;
		cursor: pointer;
		transition: background-color var(--d-hover) var(--ease-vici);
	}

	.set-row:hover {
		background: var(--bg-popover);
	}

	.set-row.is-muted {
		color: var(--text-muted);
	}

	/* Muted rows soften the label one tier — lighter weight and the dim
	   foreground — so secondary actions (help / legal links) read quieter
	   than the primary account / preference rows. */
	.set-row.is-muted .set-row-label {
		color: var(--fg-dim);
		font-weight: 400;
	}

	/* Settings row glyph — a bare inline icon (no tinted tile), tinted
	   to the dim foreground tier so it reads as a quiet leading marker
	   rather than a coloured chip. Muted rows drop one tier further to
	   the muted foreground. */
	.set-row-icon {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		color: var(--fg-dim);
	}

	.set-row.is-muted .set-row-icon {
		color: var(--text-muted);
	}

	.set-row-copy {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}

	.set-row-label {
		font-size: var(--t-14);
		font-weight: 500;
		letter-spacing: -0.005em;
	}

	.set-row-sub {
		font-size: var(--t-11);
		line-height: 1.4;
		color: var(--text-muted);
		text-wrap: pretty;
	}

	.set-row-badge {
		flex-shrink: 0;
		padding: 0.125rem 0.375rem;
		border-radius: var(--r-pill);
		font-size: var(--t-10);
		font-weight: 600;
		background: var(--laurel-glow);
		color: var(--color-primary);
	}

	:global(.set-row-chevron) {
		flex-shrink: 0;
		color: var(--text-muted);
	}
</style>
