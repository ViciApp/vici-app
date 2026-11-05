<script lang="ts">
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { XpPop } from '#lib/types/flow.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	/**
	 * FlowXpPops — multi-pop manager for the centered VXP-grant envelopes.
	 * A routine swipe mints nothing (deflation-safe economy, see
	 * `docs/ai/frontend/design.md` §7.3), so every pop is a genuine engine
	 * award — the overtime finish or a lifetime-volume milestone — rendered
	 * as the laurel-ring bonus envelope with its paired serif-italic copy.
	 * The per-swipe commit confirmation is a separate surface (`XpToast`,
	 * owned by `FlowMode`); this aggregator owns position + fan-out.
	 */
	interface Props {
		pops: XpPop[];
	}

	const { pops }: Props = $props();
</script>

<div class="xp-pops" aria-hidden="true">
	{#each pops as pop (pop.id)}
		<div class="xp-pop xp-pop-bonus">
			{#if pop.copy}
				<span class="xp-pop-copy serif-italic">{pop.copy}</span>
			{/if}
			<span class="xp-pop-amount num">+{pop.amount}</span>
			<span class="xp-pop-label">
				{t({ locale: $localeStore, key: 'flow.feedback.vxp' })}
			</span>
		</div>
	{/each}
</div>

<style lang="postcss">
	.xp-pops {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 55;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.xp-pop {
		position: absolute;
		display: inline-flex;
		align-items: baseline;
		gap: 0.4rem;
		padding: 10px 16px;
		border-radius: var(--r-pill);
		font-family: var(--font-mono);
		font-size: 22px;
		font-weight: 900;
		letter-spacing: var(--tracking-tight);
		background: var(--bg-popover);
		color: var(--laurel);
		box-shadow: var(--shadow-card);
	}
	.xp-pop-label {
		font-size: var(--t-11);
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
		opacity: 0.7;
	}
	/* Bonus pop — milestone reward (rarity ladder). Laurel ring, larger
	   amount, paired serif-italic copy on top, longer dwell. */
	.xp-pop-bonus {
		flex-direction: column;
		gap: 4px;
		padding: 14px 22px;
		font-size: 30px;
		color: var(--color-primary);
		border: 2px solid var(--color-primary);
		background: var(--bg-popover);
		box-shadow:
			0 0 32px var(--laurel-glow),
			var(--shadow-card);
		animation:
			xpPopBonus 2.6s var(--ease-vici) forwards,
			none;
	}
	.xp-pop-copy {
		font-family: var(--font-serif);
		font-style: italic;
		font-size: 14px;
		font-weight: 400;
		color: var(--text-muted);
		letter-spacing: 0;
		text-transform: none;
		line-height: 1.1;
	}
	.xp-pop-amount {
		font-weight: 600;
	}
	@keyframes xpPopBonus {
		0% {
			transform: translateY(0) scale(0.7);
			opacity: 0;
		}
		15% {
			transform: translateY(-12px) scale(1.08);
			opacity: 1;
		}
		70% {
			transform: translateY(-90px) scale(1);
			opacity: 1;
		}
		100% {
			transform: translateY(-150px) scale(0.95);
			opacity: 0;
		}
	}
</style>
