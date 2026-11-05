<script lang="ts">
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		yesPercent: number;
		noPercent: number;
		disabled?: boolean;
		onPick: (side: 'YES' | 'NO') => void;
	}

	const { yesPercent, noPercent, disabled = false, onPick }: Props = $props();
</script>

<!-- Floating YES/NO CTA bar. Tap a side to open the prediction sheet.
     The bar floats *above* the bottom navpill (`bottom: navpill height +
     safe-area`) so YES/NO is never hidden behind the tab bar and the
     navpill stays reachable. The gradient mask softens the seam where
     the bar meets the content above; the container is pointer-through so
     only the two buttons are tappable. -->
<div class="market-cta-bar">
	<button
		class="market-cta market-cta-yes"
		aria-label={t({ locale: $localeStore, key: 'market.detail.cta.predict_yes' })}
		{disabled}
		onclick={() => onPick('YES')}
		type="button"
	>
		<span class="market-cta-label">{t({ locale: $localeStore, key: 'outcome.yes' })}</span>
		<span class="num market-cta-pct">· {yesPercent}%</span>
	</button>
	<button
		class="market-cta market-cta-no"
		aria-label={t({ locale: $localeStore, key: 'market.detail.cta.predict_no' })}
		{disabled}
		onclick={() => onPick('NO')}
		type="button"
	>
		<span class="market-cta-label">{t({ locale: $localeStore, key: 'outcome.no' })}</span>
		<span class="num market-cta-pct">· {noPercent}%</span>
	</button>
</div>

<style lang="postcss">
	.market-cta-bar {
		position: fixed;
		left: 0;
		right: 0;
		/* Floats above the bottom navpill when present. `--navpill-h` is
		   set by the (app) layout to `88px` when `MobileNav` is rendered
		   (signed-in mobile) and `0px` otherwise (signed-out visitors,
		   desktop ≥56rem). This way signed-out visitors and desktop
		   users don't get a phantom 88px gap below the CTA. */
		bottom: calc(env(safe-area-inset-bottom, 0px) + var(--navpill-h, 0px));
		z-index: 40;
		display: flex;
		gap: 0.5rem;
		padding: 1.25rem 1rem 0.75rem;
		background: linear-gradient(180deg, transparent, var(--bg) 38%);
		pointer-events: none;
	}

	.market-cta-bar > .market-cta {
		pointer-events: auto;
	}

	.market-cta {
		flex: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		min-height: 3rem;
		padding: 0.75rem 1rem;
		border-radius: var(--r-12);
		font-size: var(--t-14);
		font-weight: 700;
		letter-spacing: 0.02em;
		cursor: pointer;
		transition:
			background-color var(--d-hover) var(--ease-vici),
			transform var(--d-hover) var(--ease-vici);
	}

	.market-cta:active {
		transform: scale(0.99);
	}

	.market-cta:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	.market-cta-yes {
		background: color-mix(in srgb, var(--yes) 10%, transparent);
		color: var(--yes);
		border: 1px solid var(--yes);
	}

	.market-cta-yes:hover:not(:disabled) {
		background: color-mix(in srgb, var(--yes) 16%, transparent);
	}

	.market-cta-no {
		background: color-mix(in srgb, var(--no) 10%, transparent);
		color: var(--no);
		border: 1px solid var(--no);
	}

	.market-cta-no:hover:not(:disabled) {
		background: color-mix(in srgb, var(--no) 16%, transparent);
	}

	.market-cta-label {
		text-transform: uppercase;
		letter-spacing: var(--tracking-allcaps);
	}

	.market-cta-pct {
		font-weight: 600;
	}

	@media (min-width: 768px) {
		.market-cta-bar {
			max-width: 36rem;
			margin: 0 auto;
		}
	}

	/* On desktop the pillnav is hidden (app.css hides `.pillnav-wrap` at
	   ≥56rem) and the layout already sets `--navpill-h: 0px` for signed-out
	   visitors, so the bottom offset naturally collapses to just the
	   safe-area. Pin the bar to a comfortable desktop bottom margin
	   instead of the mobile floor. */
	@media (min-width: 56rem) {
		.market-cta-bar {
			bottom: 2rem;
		}
	}
</style>
