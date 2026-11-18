<script lang="ts">
	import { ArrowLeft } from '@lucide/svelte/icons';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';
</script>

<section class="league-detail-empty">
	<h2>{t({ locale: $localeStore, key: 'leagues.detail.not_member.title' })}</h2>
	<p>{t({ locale: $localeStore, key: 'leagues.detail.not_member.sub' })}</p>
	<a class="league-detail-back-link" href={`${resolveAppPath(AppPath.Arena)}/leagues`}>
		<ArrowLeft aria-hidden="true" size={16} strokeWidth={2.2} />
		<span>{t({ locale: $localeStore, key: 'leagues.detail.back' })}</span>
	</a>
</section>

<style lang="postcss">
	.league-detail-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 2.5rem 1rem;
		text-align: center;
		background: color-mix(in srgb, var(--bg-surface) 86%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
	}

	.league-detail-empty h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--t-16, 1rem);
		color: var(--text-base);
	}

	.league-detail-empty p {
		margin: 0;
		font-size: var(--t-13);
		color: var(--text-muted);
	}

	.league-detail-back-link {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		margin-top: 0.5rem;
		padding: 0.45rem 0.9rem;
		font-size: var(--t-13);
		font-weight: 600;
		color: var(--laurel);
		text-decoration: none;
		border: 1px solid var(--border-base);
		border-radius: var(--r-pill);
	}
</style>
