<script lang="ts">
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { goto } from '$app/navigation';
</script>

<section class="portfolio-empty">
	<p class="portfolio-empty-quote serif-italic">
		{t({ locale: $localeStore, key: 'portfolio.empty.quote' })}
	</p>
	<p class="portfolio-empty-body">
		{t({ locale: $localeStore, key: 'portfolio.empty.body' })}
	</p>
	<button
		class="portfolio-empty-cta"
		onclick={() => void goto(resolveAppPath(AppPath.Flow))}
		type="button"
	>
		{t({ locale: $localeStore, key: 'portfolio.empty.cta' })}
	</button>
</section>

<style lang="postcss">
	.portfolio-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.875rem;
		padding: 2rem 1rem;
		text-align: center;
	}

	.portfolio-empty-quote {
		margin: 0;
		max-width: 28ch;
		font-size: var(--t-16, 1rem);
		color: var(--text-base);
	}

	.portfolio-empty-body {
		margin: 0;
		max-width: 32ch;
		font-size: var(--t-13);
		color: var(--text-muted);
		line-height: 1.5;
	}

	.portfolio-empty-cta {
		margin-top: 0.5rem;
		appearance: none;
		padding: 0.75rem 1.25rem;
		font: inherit;
		font-size: var(--t-13);
		font-weight: 600;
		color: var(--bg-base);
		background: var(--text-base);
		border: 1px solid var(--text-base);
		border-radius: var(--r-12);
		cursor: pointer;
		transition: opacity var(--d-hover) var(--ease-vici);
	}

	.portfolio-empty-cta:hover {
		opacity: 0.9;
	}
</style>
