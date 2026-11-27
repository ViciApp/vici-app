<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import { DAY_IN_MS, MINUTE_IN_MS } from '#lib/constants/time.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { Market } from '#lib/types/market.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { formatSettleDate, formatSettlesIn } from '#lib/utils/market-settle.utils.ts';

	interface Props {
		market: Market;
		/** Translated title for the active locale; defaults to the original. */
		displayTitle?: string;
	}

	const { market, displayTitle }: Props = $props();

	const title = $derived(displayTitle ?? market.title);

	// Live countdown: minute-tick interval. Only runs while this back
	// panel is mounted (Svelte cleans up the timer on destroy). 60 s is
	// fine: the label tier doesn't shift faster than a minute.
	let nowTick = $state(Date.now());
	$effect(() => {
		const id = setInterval(() => {
			nowTick = Date.now();
		}, MINUTE_IN_MS);

		return () => clearInterval(id);
	});

	// Recomputes on each minute tick: "Settles in 12 days" / "in 5 hours".
	const settlesIn = $derived(
		formatSettlesIn({ expiryMs: Number(market.expiryDate), nowMs: nowTick, locale: $localeStore })
	);
	const settleDate = $derived(
		formatSettleDate({ expiryMs: Number(market.expiryDate), locale: $localeStore })
	);
	const countdownUrgent = $derived.by(() => {
		const ms = Number(market.expiryDate) - nowTick;

		return ms > 0 && ms <= DAY_IN_MS;
	});

	// The real headcount, including a genuine 0, when an outcome carries a
	// `totalPredictions` figure. No data path fills it today, so the segment
	// stays hidden rather than reading as a sample figure or a false 0.
	const hasOutcomeData = $derived(
		market.outcomes?.some(({ totalPredictions }) => nonNullish(totalPredictions)) ?? false
	);
	const predictorsCount = $derived(
		market.outcomes?.reduce((acc, outcome) => acc + (outcome.totalPredictions ?? 0), 0) ?? 0
	);
</script>

<h3 class="flow-back-title">{title}</h3>
<div class="flow-back-meta num">
	<span class="flow-back-countdown" class:is-urgent={countdownUrgent}>
		{settlesIn}
	</span>
	{#if countdownUrgent}
		<span class="flow-back-countdown-pulse" aria-hidden="true"></span>
	{/if}
	<span class="flow-meta-dot" aria-hidden="true">·</span>
	<span>{settleDate}</span>
	{#if hasOutcomeData}
		<span class="flow-meta-dot" aria-hidden="true">·</span>
		<span>
			{t({
				locale: $localeStore,
				key: 'card.predicting_count',
				params: { count: predictorsCount.toLocaleString() }
			})}
		</span>
	{/if}
</div>

<style lang="postcss">
	.flow-back-title {
		margin: 0;
		font-family: var(--font-display);
		font-size: clamp(1.15rem, 4.6vw, 1.45rem);
		font-weight: 600;
		line-height: 1.35;
		letter-spacing: -0.005em;
		color: var(--text-base);
	}

	/* Single editorial meta line: `Settles {date} · {countdown} ·
	   {N} predicting`: settlement, countdown, and headcount share one
	   dot-separated row rather than splitting onto separate lines. */
	.flow-back-meta {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
		margin: 0;
		font-size: var(--t-12);
		color: var(--text-muted);
		font-family: var(--font-mono);
		letter-spacing: 0.04em;
	}
	.flow-meta-dot {
		opacity: 0.5;
	}
	/* The countdown segment is the live, decision-relevant figure, so it
	   reads at full foreground brightness against the muted meta row,
	   and shifts to terracotta when the market is inside its final day. */
	.flow-back-countdown {
		color: var(--text-base);
		font-weight: 500;
	}
	.flow-back-countdown.is-urgent {
		color: var(--terracotta);
		font-weight: 600;
	}
	.flow-back-countdown-pulse {
		width: 6px;
		height: 6px;
		border-radius: var(--r-pill);
		background: var(--no);
		box-shadow: 0 0 0 0 color-mix(in srgb, var(--no) 60%, transparent);
		animation: countdownPulse 1.6s infinite;
	}
	@keyframes countdownPulse {
		0% {
			box-shadow: 0 0 0 0 color-mix(in srgb, var(--no) 60%, transparent);
		}
		60% {
			box-shadow: 0 0 0 6px transparent;
		}
		100% {
			box-shadow: 0 0 0 0 transparent;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.flow-back-countdown-pulse {
			animation: none;
		}
	}
</style>
