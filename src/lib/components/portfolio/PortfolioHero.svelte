<script lang="ts">
	import { EM_DASH } from '#lib/constants/app.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		vxpBalanceDisplay: string;
		unrealizedPnlDisplay: string;
		unrealizedPnlDirection: 'positive' | 'negative' | 'flat';
		accuracyDisplay: string;
	}

	let { vxpBalanceDisplay, unrealizedPnlDisplay, unrealizedPnlDirection, accuracyDisplay }: Props =
		$props();
</script>

<section class="portfolio-hero">
	<p class="eyebrow portfolio-hero-eyebrow">
		{t({ locale: $localeStore, key: 'portfolio.hero.eyebrow' })}
	</p>
	<div class="portfolio-hero-balance">
		<span class="num portfolio-hero-num">{vxpBalanceDisplay}</span>
		<span class="eyebrow portfolio-hero-num-unit">
			{t({ locale: $localeStore, key: 'portfolio.hero.unit' })}
		</span>
	</div>

	<dl class="portfolio-hero-stats">
		<div class="portfolio-hero-stat">
			<dt class="eyebrow">
				{t({ locale: $localeStore, key: 'portfolio.stat.unrealized_pnl' })}
			</dt>
			<dd
				class="num"
				class:is-negative={unrealizedPnlDirection === 'negative'}
				class:is-positive={unrealizedPnlDirection === 'positive'}
			>
				{unrealizedPnlDisplay}
			</dd>
		</div>
		<div class="portfolio-hero-stat">
			<dt class="eyebrow">
				{t({ locale: $localeStore, key: 'portfolio.stat.accuracy_7d' })}
			</dt>
			<dd class="num">{accuracyDisplay}</dd>
		</div>
		<div class="portfolio-hero-stat">
			<dt class="eyebrow">{t({ locale: $localeStore, key: 'portfolio.stat.rank' })}</dt>
			<dd class="num">{EM_DASH}</dd>
		</div>
	</dl>
</section>

<style lang="postcss">
	.portfolio-hero {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 1.25rem;
		background: linear-gradient(180deg, var(--bg-popover), var(--bg-surface));
		border: 1px solid var(--border-base);
		border-radius: var(--r-16, 16px);
		box-shadow:
			var(--inset-hi),
			0 8px 24px -10px rgba(0, 0, 0, 0.5);
	}

	.portfolio-hero-eyebrow {
		margin: 0;
		color: var(--text-muted);
	}

	.portfolio-hero-balance {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}

	.portfolio-hero-num {
		font-size: 38px;
		font-weight: 600;
		letter-spacing: -0.03em;
		color: var(--text-base);
		line-height: 1;
	}

	.portfolio-hero-num-unit {
		color: var(--text-muted);
	}

	.portfolio-hero-stats {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		width: 100%;
		margin: 0.875rem 0 0;
	}

	.portfolio-hero-stat {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.25rem;
	}

	.portfolio-hero-stat dt {
		margin: 0;
		color: var(--text-muted);
	}

	.portfolio-hero-stat dd {
		margin: 0;
		font-size: var(--t-18, 1.125rem);
		font-weight: 600;
		color: var(--text-base);
		letter-spacing: var(--tracking-snug);
	}

	.portfolio-hero-stat dd.is-positive {
		color: var(--yes);
	}

	.portfolio-hero-stat dd.is-negative {
		color: var(--no);
	}
</style>
