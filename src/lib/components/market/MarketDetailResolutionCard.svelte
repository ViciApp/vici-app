<script lang="ts">
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { Market } from '#lib/types/market.ts';
	import { formatDate } from '#lib/utils/format.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		market: Market;
		/**
		 * Resolution clause to render in place of `market.resolution`; the
		 * caller passes the locale-resolved (translated or original) clause.
		 * Falls back to the market's own clause when omitted.
		 */
		resolution?: string;
	}

	const { market, resolution }: Props = $props();

	// Trim before testing emptiness so a whitespace-only clause falls back to
	// the templated sentence, matching FlowResolutionBlock.
	const resolutionClause = $derived((resolution ?? market.resolution)?.trim() ?? '');
	const closesLabel = $derived(formatDate(market.expiryDate));
</script>

<!-- Resolution rules inline card. The body either renders the market's
     own resolution clause (the binding settlement criterion authored by
     the market creator) or falls back to a templated sentence referencing
     the close date. A footer carries the resolution source and the
     settles date so the block answers "how / where / when" at a glance,
     mirroring the Flow back-card resolution structure. This card sits
     directly below the stats grid. -->
<div class="market-resolution-card">
	<span class="market-resolution-eyebrow">
		{t({ locale: $localeStore, key: 'market.detail.resolution.eyebrow' })}
	</span>
	<p class="market-resolution-body">
		{#if resolutionClause !== ''}
			{resolutionClause}
		{:else}
			{t({
				locale: $localeStore,
				key: 'market.detail.resolution.fallback',
				params: { closesAt: closesLabel }
			})}
		{/if}
	</p>
	<dl class="market-resolution-foot num">
		<div class="market-resolution-foot-row">
			<dt>{t({ locale: $localeStore, key: 'market.detail.resolution.source_label' })}</dt>
			<dd>{t({ locale: $localeStore, key: 'market.detail.resolution.source_value' })}</dd>
		</div>
		<div class="market-resolution-foot-row">
			<dt>{t({ locale: $localeStore, key: 'market.detail.resolution.settles_label' })}</dt>
			<dd>{closesLabel}</dd>
		</div>
	</dl>
</div>

<style lang="postcss">
	.market-resolution-card {
		margin: 0.5rem 1.25rem;
		padding: 1rem;
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		background: color-mix(in srgb, var(--bg-surface) 86%, transparent);
		box-shadow: var(--inset-hi);
	}

	.market-resolution-eyebrow {
		display: block;
		color: var(--text-muted);
		font-size: var(--t-10);
		font-weight: 700;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
	}

	.market-resolution-body {
		margin: 0.5rem 0 0;
		color: var(--text-base);
		font-size: var(--t-13);
		line-height: 1.55;
	}

	/* Source / settles footer: two label·value rows in the mono ramp
	   so they read as the market's machine-grade facts beneath the
	   prose criterion. */
	.market-resolution-foot {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin: 0.75rem 0 0;
		padding-top: 0.625rem;
		border-top: 1px dashed var(--border-base);
	}

	.market-resolution-foot-row {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.375rem;
	}

	.market-resolution-foot-row dt {
		color: var(--text-muted);
		font-size: var(--t-10);
		font-weight: 700;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
	}

	.market-resolution-foot-row dd {
		margin: 0;
		color: var(--text-base);
		font-size: var(--t-12);
	}
</style>
