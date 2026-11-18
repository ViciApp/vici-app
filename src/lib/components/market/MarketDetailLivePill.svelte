<script lang="ts">
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
</script>

<!-- Pulsing LIVE pill that sits beside the category chip on the Market
     detail hero. The dot pulses at 1.6s, same beat as the Welcome /
     Tournament heroes: three surfaces now share the same `pulse-live`
     keyframe so future tweaks land in one place. The pill suppresses
     itself for resolved markets via the caller; this component is
     visual-only. -->
<span class="market-live-pill" aria-label={t({ locale: $localeStore, key: 'hero.live' })}>
	{t({ locale: $localeStore, key: 'hero.live' })}
</span>

<style lang="postcss">
	.market-live-pill {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.45rem;
		border-radius: var(--r-pill);
		font-size: var(--t-10);
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		background: color-mix(in srgb, var(--no) 10%, transparent);
		color: var(--no);
	}

	.market-live-pill::before {
		content: '';
		display: inline-block;
		width: 5px;
		height: 5px;
		margin-right: 6px;
		border-radius: var(--r-pill);
		background: var(--no);
		animation: market-live-pulse 1.6s infinite;
	}

	@keyframes market-live-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.3;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.market-live-pill::before {
			animation: none;
		}
	}
</style>
