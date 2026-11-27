<script lang="ts">
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		yesPct: number;
	}

	const { yesPct }: Props = $props();

	// Sharp-predictor lean: `sharpPct = min(95, yes + 10)` keeps the
	// top-decile band leaning 10pp further than consensus, capped at 95.
	const sharpPct = $derived(Math.min(95, yesPct + 10));
	const sharpDiff = $derived(sharpPct - yesPct);
</script>

<!-- Two-row "Who's calling what" split: the differentiating value of
     VICI's reputation layer. Row 1 = all callers, Row 2 = sharp
     predictors (with a +/- diff badge vs consensus). -->
<section class="flow-back-block flow-split">
	<p class="eyebrow flow-back-label">
		{t({ locale: $localeStore, key: 'card.back.who_calling' })}
	</p>

	<div class="flow-split-row">
		<div class="flow-split-meta">
			<span class="flow-split-label">
				{t({ locale: $localeStore, key: 'card.back.all_callers' })}
			</span>
			<span class="flow-split-pct num">{yesPct}%</span>
		</div>
		<div class="flow-split-bar" role="presentation">
			<i style:width="{100 - yesPct}%" class="flow-split-fill-no"></i>
			<i style:width="{yesPct}%" class="flow-split-fill-yes"></i>
		</div>
	</div>

	<div class="flow-split-row">
		<div class="flow-split-meta">
			<span class="flow-split-label">
				{t({ locale: $localeStore, key: 'card.back.top_accuracy' })}
			</span>
			<span class="flow-split-pct num">{sharpPct}%</span>
			{#if sharpDiff !== 0}
				<span class="flow-split-badge num">
					{t({
						locale: $localeStore,
						key: sharpDiff > 0 ? 'card.back.sharp_diff_ahead' : 'card.back.sharp_diff_behind',
						params: { count: Math.abs(sharpDiff) }
					})}
				</span>
			{/if}
		</div>
		<div class="flow-split-bar" role="presentation">
			<i style:width="{100 - sharpPct}%" class="flow-split-fill-no"></i>
			<i style:width="{sharpPct}%" class="flow-split-fill-yes"></i>
		</div>
	</div>
</section>

<style lang="postcss">
	/* Shared block wrapper + section surface: duplicated here so the
	   extracted section keeps its spacing + surface under Svelte's
	   per-component style scoping. */
	.flow-back-block {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.flow-split {
		padding: 0.75rem 0.85rem;
		border-radius: var(--r-12);
		border: 1px solid var(--border-base);
		background: color-mix(in srgb, var(--bg-surface) 86%, transparent);
		box-shadow: var(--inset-hi);
	}

	.flow-back-label {
		margin: 0;
		color: var(--text-muted);
	}

	.flow-split-row {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 0.35rem 0;
	}
	.flow-split-row + .flow-split-row {
		border-top: 1px solid var(--border-base);
	}
	.flow-split-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 6px;
		font-size: var(--t-12);
		color: var(--text-muted);
	}
	.flow-split-label {
		flex: 1 1 auto;
		color: var(--text-base);
		font-weight: 500;
	}
	.flow-split-pct {
		font-weight: 700;
		color: var(--text-base);
	}
	/* Sharp-lean badge: always the laurel-gold pill (it reads as
	   "sharps' lean", not a good/bad signal), so it doesn't flip
	   green / red on the sign of the diff like before. */
	.flow-split-badge {
		font-family: var(--font-mono);
		font-size: 9.5px;
		letter-spacing: 0.08em;
		padding: 1px 6px;
		border-radius: var(--r-pill);
		border: 1px solid color-mix(in srgb, var(--laurel) 32%, transparent);
		background: var(--laurel-glow);
		color: var(--laurel);
	}

	.flow-split-bar {
		display: flex;
		height: 6px;
		border-radius: var(--r-pill);
		overflow: hidden;
		background: var(--border-base);
	}
	.flow-split-fill-no {
		display: block;
		height: 100%;
		background: var(--no);
		opacity: 0.78;
		transition: width 480ms var(--ease-vici);
	}
	.flow-split-fill-yes {
		display: block;
		height: 100%;
		background: var(--yes);
		opacity: 0.95;
		transition: width 480ms var(--ease-vici);
	}
</style>
