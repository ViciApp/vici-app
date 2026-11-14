<script lang="ts">
	import { Plus } from '@lucide/svelte/icons';

	/**
	 * Compact "Create a league" / "Join with code" action rendered in
	 * the trailing "Start or join" grid beneath the league list. A
	 * single-row pill: small accent-glow icon tile + a title / sub
	 * stack: deliberately lighter than the league cards above so the
	 * leagues you're in stay the focus.
	 */
	interface Props {
		title: string;
		sub: string;
		variant: 'create' | 'join';
		onclick: () => void;
	}

	const { title, sub, variant, onclick }: Props = $props();
</script>

<button class="leagues-cta" {onclick} type="button">
	<span class="leagues-cta-ic" class:mono={variant === 'join'} aria-hidden="true">
		{#if variant === 'create'}
			<Plus aria-hidden="true" size={16} strokeWidth={2.2} />
		{:else}
			CODE
		{/if}
	</span>
	<span class="leagues-cta-tx">
		<span class="leagues-cta-t">{title}</span>
		<span class="leagues-cta-s num">{sub}</span>
	</span>
</button>

<style lang="postcss">
	.leagues-cta {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 11px 12px;
		font: inherit;
		text-align: left;
		color: var(--text-base);
		background: var(--bg-surface);
		border: 1px solid var(--border-base);
		border-radius: var(--r-11, 11px);
		cursor: pointer;
		transition: border-color var(--d-hover) var(--ease-vici);
	}

	.leagues-cta:hover {
		border-color: var(--border-strong);
	}

	/* Small accent-glow icon tile: `--laurel`-tinted square holding the
	   plus glyph (create) or a mono "CODE" label (join). */
	.leagues-cta-ic {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: 30px;
		height: 30px;
		border-radius: var(--r-8);
		background: color-mix(in srgb, var(--laurel) 12%, transparent);
		color: var(--laurel);
	}

	.leagues-cta-ic.mono {
		font-family: var(--font-mono);
		font-size: 9.5px;
		font-weight: 700;
		letter-spacing: 0.02em;
	}

	.leagues-cta-tx {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}

	.leagues-cta-t {
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-base);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.leagues-cta-s {
		font-size: 9px;
		letter-spacing: 0.02em;
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
