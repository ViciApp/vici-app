<script lang="ts">
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		sizeStake: number;
		// Guided (onboarding first-call) mode; the depth hint becomes a
		// commit prompt since the card can't flip there.
		guided?: boolean;
	}

	let { sizeStake, guided = false }: Props = $props();

	const hintKey = $derived(guided ? 'card.swipe_to_call' : 'card.tap_depth');
</script>

<div class="flow-foot num">
	<span class="flow-foot-size">
		<span class="flow-foot-size-label">
			{t({ locale: $localeStore, key: 'card.size_label' })}
		</span>
		<span class="flow-foot-size-num">{sizeStake}</span>
		<span class="flow-foot-size-unit">VXP</span>
	</span>
	<span class="flow-foot-hint allcaps">
		{t({ locale: $localeStore, key: hintKey })}
	</span>
</div>

<style lang="postcss">
	/* The foot is a plain flex child of `.flow-body`. Only `.flow-probs`
	   carries `margin-top: auto`, which parks the probs-plus-foot block
	   at the bottom of the card. The probs/foot separation is the body's
	   own row gap; a stray `margin-top: auto` here would steal that free
	   space a second time and float the probs into mid-card. */
	.flow-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin: 0 1.1rem;
		padding-top: 4px;
		font-size: var(--t-12);
		color: var(--text-muted);
		letter-spacing: 0.06em;
	}
	.flow-foot-size {
		display: inline-flex;
		align-items: baseline;
		gap: 5px;
		font-family: var(--font-mono);
		font-size: var(--text-eyebrow);
		font-variant-numeric: tabular-nums slashed-zero;
		letter-spacing: 0.06em;
		color: var(--text-base);
		background: var(--bg-popover);
		border: 1px solid var(--border-strong);
		border-radius: var(--r-pill);
		padding: 4px 10px;
		box-shadow: var(--inset-hi);
	}
	.flow-foot-size-label {
		color: var(--text-muted);
		letter-spacing: 0.12em;
	}
	.flow-foot-size-num {
		color: var(--text-base);
	}
	.flow-foot-size-unit {
		color: var(--text-muted);
	}
	.flow-foot-hint {
		letter-spacing: 0.14em;
		font-size: 11px;
		opacity: 0.7;
	}
</style>
