<script lang="ts">
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { MarketWhyNow } from '#lib/types/market-metadata.ts';
	import type { PriorCallSignal } from '#lib/types/market-signals.ts';
	import type { CallSide } from '#lib/types/market.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		/**
		 * The viewer's own prior call on this market, if any. Takes the
		 * slot when present: a stronger "you already called this" cue
		 * outranks the editorial why-now line.
		 */
		priorCall?: PriorCallSignal;
		/**
		 * Curated "why this card now" cue from market metadata. Surfaces
		 * only when no `priorCall` claims the slot.
		 */
		whyNow?: MarketWhyNow;
	}

	const { priorCall, whyNow }: Props = $props();

	const priorSideLabel = (side: CallSide): string =>
		side === 'YES'
			? t({ locale: $localeStore, key: 'outcome.yes' })
			: t({ locale: $localeStore, key: 'outcome.no' });
</script>

<!-- Contextual cue under the title: either a "you already called this"
     badge (when the viewer holds a prior call) or the curated why-now
     line. Mirrors the Flow front-card treatment: a small pill whose dot
     is tinted by the cue kind so the surface reads as curated, not
     random. -->
{#if priorCall}
	<span
		class="md-priorcall"
		class:is-no={priorCall.side === 'NO'}
		class:is-yes={priorCall.side === 'YES'}
	>
		<span class="md-cue-dot" aria-hidden="true"></span>
		{t({ locale: $localeStore, key: 'market.detail.you_called' })}
		<strong>{priorSideLabel(priorCall.side)}</strong>
		<span class="md-priorcall-when">· {priorCall.when}</span>
	</span>
{:else if whyNow}
	<span class="md-whynow md-whynow-{whyNow.kind}">
		<span class="md-cue-dot" aria-hidden="true"></span>
		{whyNow.text}
	</span>
{/if}

<style lang="postcss">
	.md-whynow {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-top: 0.5rem;
		padding: 3px 9px 3px 8px;
		border-radius: var(--r-pill);
		background: color-mix(in srgb, var(--text-base) 4%, transparent);
		border: 1px solid color-mix(in srgb, var(--text-base) 7%, transparent);
		color: var(--fg-dim);
		font-size: var(--t-11);
		font-weight: 500;
		letter-spacing: 0;
	}

	.md-cue-dot {
		width: 5px;
		height: 5px;
		border-radius: var(--r-pill);
		background: var(--laurel);
		box-shadow: 0 0 6px color-mix(in srgb, var(--laurel) 50%, transparent);
	}

	/* Kind-tinted dot: matches the Flow front-card why-now palette. */
	.md-whynow-closing .md-cue-dot {
		background: var(--no);
		box-shadow: 0 0 6px color-mix(in srgb, var(--no) 50%, transparent);
	}
	.md-whynow-trending .md-cue-dot {
		background: var(--yes);
		box-shadow: 0 0 6px color-mix(in srgb, var(--yes) 50%, transparent);
	}
	.md-whynow-new .md-cue-dot {
		background: var(--laurel);
	}
	.md-whynow-social .md-cue-dot {
		background: #b49cff;
		box-shadow: 0 0 6px rgba(180, 156, 255, 0.5);
	}
	.md-whynow-topical .md-cue-dot {
		background: var(--text-muted);
		box-shadow: none;
	}

	/* Prior-call badge: stronger than why-now; takes its slot. */
	.md-priorcall {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-top: 0.5rem;
		padding: 3px 10px 3px 9px;
		border-radius: var(--r-pill);
		font-family: var(--font-mono);
		font-size: var(--t-10);
		font-weight: 600;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
	}
	.md-priorcall.is-yes {
		color: var(--yes);
		background: color-mix(in srgb, var(--yes) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--yes) 32%, transparent);
	}
	.md-priorcall.is-no {
		color: var(--no);
		background: color-mix(in srgb, var(--no) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--no) 32%, transparent);
	}
	.md-priorcall.is-yes .md-cue-dot {
		background: var(--yes);
		box-shadow: 0 0 6px color-mix(in srgb, var(--yes) 50%, transparent);
	}
	.md-priorcall.is-no .md-cue-dot {
		background: var(--no);
		box-shadow: 0 0 6px color-mix(in srgb, var(--no) 50%, transparent);
	}
	.md-priorcall-when {
		font-weight: 400;
		opacity: 0.85;
	}
</style>
