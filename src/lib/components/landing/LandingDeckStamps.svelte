<script lang="ts">
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { LandingDeckSide } from '#lib/types/landing.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { formatWholeVxpMagnitude } from '#lib/utils/playground-display.utils.ts';

	interface Props {
		yesEarns: number;
		noEarns: number;
		/** The stamp that is fully in and would commit on release. */
		hit?: LandingDeckSide;
	}

	const { yesEarns, noEarns, hit }: Props = $props();
</script>

<!-- Opacity follows the drag through `--deck-yes` / `--deck-no` /
     `--deck-pass`, which the card writes every frame. Decorative: the call
     itself is announced by the deck's status line. -->
<div class="stamp yes" class:hit={hit === 'yes'} aria-hidden="true">
	{t({ locale: $localeStore, key: 'outcome.yes' })}
	<small>
		{t({
			locale: $localeStore,
			key: 'landing.deck.earns',
			params: { amount: formatWholeVxpMagnitude(yesEarns) }
		})}
	</small>
</div>
<div class="stamp no" class:hit={hit === 'no'} aria-hidden="true">
	{t({ locale: $localeStore, key: 'outcome.no' })}
	<small>
		{t({
			locale: $localeStore,
			key: 'landing.deck.earns',
			params: { amount: formatWholeVxpMagnitude(noEarns) }
		})}
	</small>
</div>
<div class="stamp pass" aria-hidden="true">
	{t({ locale: $localeStore, key: 'flow.action.pass' })}
</div>

<style lang="postcss">
	.stamp {
		position: absolute;
		top: calc(clamp(128px, 24%, 190px) + env(safe-area-inset-top, 0px));
		padding: 10px 20px;
		border: 4px solid currentColor;
		border-radius: 10px;
		background: color-mix(in srgb, var(--film-bg) 30%, transparent);
		font: 800 clamp(34px, 6vw, 88px) / 1 var(--font-headline, var(--font-display));
		letter-spacing: 0.08em;
		text-transform: uppercase;
		opacity: 0;
		pointer-events: none;
		scale: 0.9;
		transition: scale 180ms var(--deck-ease);
	}

	.stamp.hit {
		scale: 1.06;
	}

	.stamp.yes {
		left: clamp(16px, 4vw, 48px);
		color: var(--film-yes);
		rotate: -12deg;
		opacity: var(--deck-yes, 0);
	}

	.stamp.no {
		right: clamp(16px, 4vw, 48px);
		color: var(--film-no);
		rotate: 12deg;
		opacity: var(--deck-no, 0);
	}

	.stamp.pass {
		top: auto;
		bottom: 52%;
		left: 50%;
		translate: -50% 0;
		color: var(--film-fg);
		font-size: clamp(24px, 3.4vw, 48px);
		rotate: -4deg;
		opacity: var(--deck-pass, 0);
	}

	small {
		display: block;
		margin-top: 8px;
		font: 600 clamp(13px, 1.1vw, 16px) / 1 var(--font-display);
		letter-spacing: 0;
		text-transform: none;
	}

	@media (max-height: 560px) {
		.stamp.yes,
		.stamp.no {
			top: calc(22% + env(safe-area-inset-top, 0px));
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.stamp {
			transition: none;
		}
	}

	/* 3D turn: the stamps belong to the front face. */
	:global(.landing-deck-card.is-flip3d.is-back) .stamp {
		visibility: hidden;
	}
</style>
