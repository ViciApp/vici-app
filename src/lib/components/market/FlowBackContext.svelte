<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { CategoryAccuracySignal, PriorCallSignal } from '#lib/types/market-signals.ts';
	import type { FlowArtCategory } from '#lib/utils/flow-art.utils.ts';
	import { probabilityToPercent } from '#lib/utils/format.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		category: FlowArtCategory;
		yesPct: number;
		categoryAcc?: CategoryAccuracySignal;
		priorCall?: PriorCallSignal;
	}

	const { category, yesPct, categoryAcc, priorCall }: Props = $props();

	// Friends-followed accuracy line — shown when the user has any
	// followed predictors who've called this market.
	const categoryAccLine = $derived(
		nonNullish(categoryAcc)
			? {
					pct: probabilityToPercent(categoryAcc.accuracy),
					calls: categoryAcc.calls,
					accGood: categoryAcc.accuracy >= 0.6
				}
			: undefined
	);

	// Prior-call drift: how far consensus has moved since the user
	// committed. Used by the prior-call section at the bottom.
	const priorDrift = $derived.by<number | undefined>(() => {
		if (isNullish(priorCall) || isNullish(priorCall.consensusThen)) {
			return;
		}

		return Math.round(yesPct - probabilityToPercent(priorCall.consensusThen));
	});
</script>

{#if categoryAccLine}
	<p
		class="flow-back-track"
		class:flow-back-track-no={!categoryAccLine.accGood}
		class:flow-back-track-yes={categoryAccLine.accGood}
	>
		{t({
			locale: $localeStore,
			key: 'card.your_accuracy_line',
			params: {
				category,
				pct: categoryAccLine.pct,
				calls: categoryAccLine.calls
			}
		})}
	</p>
{/if}

{#if priorCall}
	<div class="flow-back-prior">
		<span class="eyebrow flow-back-label">
			{t({ locale: $localeStore, key: 'card.you_called_eyebrow' })}
		</span>
		<span class="flow-back-prior-line num">
			<span class={priorCall.side === 'YES' ? 'text-yes' : 'text-no'}>
				{priorCall.side}
			</span>
			{#if nonNullish(priorDrift)}
				<span class="flow-back-prior-dim">
					{t({
						locale: $localeStore,
						key: 'card.prior_call_drift',
						params: {
							when: priorCall.when,
							drift: `${priorDrift >= 0 ? '+' : ''}${priorDrift}`
						}
					})}
				</span>
			{:else}
				<span class="flow-back-prior-dim">· {priorCall.when}</span>
			{/if}
		</span>
	</div>
{/if}

<style lang="postcss">
	.flow-back-label {
		margin: 0;
		color: var(--text-muted);
	}

	.flow-back-track {
		margin: 0;
		font-size: var(--t-12);
		color: var(--text-muted);
	}
	.flow-back-track-yes {
		color: var(--yes);
	}
	.flow-back-track-no {
		color: var(--no);
	}

	/* Prior-call pill — always the laurel-gold treatment, not a
	   category-accent tint. Eyebrow + value sit at opposite ends. */
	.flow-back-prior {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 10px 12px;
		border-radius: var(--r-12);
		border: 1px solid color-mix(in srgb, var(--laurel) 22%, var(--border-base));
		background: color-mix(in srgb, var(--laurel) 6%, transparent);
	}
	.flow-back-prior .flow-back-label {
		color: var(--laurel);
	}
	.flow-back-prior-line {
		font-size: var(--t-12);
		font-weight: 700;
	}
	.flow-back-prior-dim {
		margin-left: 6px;
		opacity: 0.7;
		font-weight: 500;
	}
</style>
