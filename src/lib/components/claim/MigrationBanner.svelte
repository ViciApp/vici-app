<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import { X } from '@lucide/svelte/icons';
	import type { Snippet } from 'svelte';

	interface Props {
		label: string;
		text: string;
		dismissLabel: string;
		onDismiss: () => void;
		lead?: string;
		action?: Snippet;
	}

	const { label, text, dismissLabel, onDismiss, lead, action }: Props = $props();
</script>

<div class="migration-banner" aria-label={label} role="region">
	<p class="migration-banner-text">
		{#if nonNullish(lead)}
			<strong class="migration-banner-lead">{lead}</strong>
		{/if}
		{text}
	</p>
	{@render action?.()}
	<button
		class="migration-banner-dismiss"
		aria-label={dismissLabel}
		onclick={onDismiss}
		type="button"
	>
		<X aria-hidden="true" size={16} strokeWidth={2} />
	</button>
</div>

<style lang="postcss">
	.migration-banner {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.5rem 0.75rem;
		padding-top: calc(0.5rem + env(safe-area-inset-top, 0px));
		background: var(--bg-surface);
		border-bottom: 1px solid var(--border-base);
		color: var(--text-base);
	}

	.migration-banner-text {
		margin: 0;
		flex: 1;
		min-width: 0;
		font-size: 0.8125rem;
		line-height: 1.3;
	}

	.migration-banner-lead {
		font-weight: 700;
	}

	.migration-banner-dismiss {
		flex-shrink: 0;
		display: grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		border: none;
		border-radius: 999px;
		background: transparent;
		color: inherit;
		cursor: pointer;
		opacity: 0.7;
	}

	.migration-banner-dismiss:hover {
		opacity: 1;
	}
</style>
