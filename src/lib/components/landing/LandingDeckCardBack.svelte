<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import type { Snippet } from 'svelte';
	import { VXP_DEFAULT_CALL_SIZE } from '#lib/constants/vxp-economy.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { LandingDeckCard } from '#lib/types/landing.ts';
	import { formatLongDate, formatProbability } from '#lib/utils/format.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import type { DeckTrend } from '#lib/utils/landing-deck.utils.ts';
	import { categoryLabel } from '#lib/utils/market-tags.utils.ts';
	import { formatWholeVxpMagnitude } from '#lib/utils/playground-display.utils.ts';

	interface Props {
		card: LandingDeckCard;
		/** Question and settlement clause in the reader's language. */
		title: string;
		resolution: string;
		/** Today's move, already worded; absent when nothing traded today. */
		moveLabel?: string;
		trend?: DeckTrend;
		/** The back is the face showing: it is exposed to assistive tech and its controls take focus. */
		shown?: boolean;
		backChart?: Snippet<[{ seriesId: string }]>;
		onflip?: () => void;
	}

	const {
		card,
		title,
		resolution,
		moveLabel,
		trend = 'flat',
		shown = false,
		backChart,
		onflip = () => {}
	}: Props = $props();

	const settlesLabel = $derived.by(() => {
		const date = formatLongDate({ date: card.market.expiryDate, locale: $localeStore });

		if (isNullish(card.entry.category)) {
			return t({ locale: $localeStore, key: 'landing.deck.back.settles_plain', params: { date } });
		}

		return t({
			locale: $localeStore,
			key: 'landing.deck.back.settles',
			params: {
				category: categoryLabel({
					category: card.entry.category,
					variant: 'full',
					locale: $localeStore
				}),
				date
			}
		});
	});
</script>

<div class="back" aria-hidden={!shown} inert={!shown}>
	<div class="in">
		<div class="lead">
			<span class="cat">
				{settlesLabel}
			</span>
			<p class="question">{title}</p>
			<p class="price">
				<span class="says">{t({ locale: $localeStore, key: 'landing.deck.back.crowd_says' })}</span>
				<b>{formatProbability(card.yesPercent / 100)}</b>
				<span>{t({ locale: $localeStore, key: 'landing.deck.yes' })}</span>
				{#if nonNullish(moveLabel)}
					<em class={trend}>{moveLabel}</em>
				{/if}
			</p>
			{#if nonNullish(backChart)}
				<!-- A press inside the chart reads the chart: the card neither
				     drags nor flips from here. -->
				<div class="chart" data-landing-deck-no-gesture>
					{@render backChart({ seriesId: card.entry.seriesId })}
				</div>
			{/if}
		</div>
		<div class="facts">
			<p class="returns">
				{t({
					locale: $localeStore,
					key: 'landing.deck.back.returns',
					params: {
						size: VXP_DEFAULT_CALL_SIZE,
						yes: formatWholeVxpMagnitude(card.yesEarns),
						no: formatWholeVxpMagnitude(card.noEarns)
					}
				})}
			</p>
			<dl>
				<div>
					<dt>{t({ locale: $localeStore, key: 'landing.deck.back.rule' })}</dt>
					<dd>{resolution}</dd>
				</div>
				<div>
					<dt>{t({ locale: $localeStore, key: 'market.detail.resolution.source_label' })}</dt>
					<dd>{t({ locale: $localeStore, key: 'market.detail.resolution.source_value' })}</dd>
				</div>
			</dl>
			<!-- A pointer tap anywhere on the card already flips it back and
			     never reaches this button as a click of its own; `detail` is 0
			     only for a keyboard or assistive-tech activation, the one path
			     that needs the button. -->
			<button
				class="flip"
				onclick={(event) => {
					if (event.detail === 0) {
						onflip();
					}
				}}
				type="button"
			>
				{t({ locale: $localeStore, key: 'landing.deck.back.flip_back' })}
			</button>
		</div>
	</div>
</div>

<style lang="postcss">
	.back {
		position: absolute;
		inset: 0;
		display: grid;
		grid-template-rows: minmax(0, 1fr);
		align-items: end;
		padding: calc(72px + env(safe-area-inset-top, 0px)) var(--deck-pad)
			calc(138px + env(safe-area-inset-bottom, 0px));
		background: color-mix(in srgb, var(--film-bg) 72%, transparent);
		backdrop-filter: blur(22px) saturate(120%);
		opacity: 0;
		pointer-events: none;
		transition: opacity 280ms var(--deck-ease);
	}

	.in {
		display: flex;
		flex-direction: column;
		gap: 14px;
		width: 100%;
		max-width: 30em;
		min-height: 0;
		max-height: 100%;
		transform: translateY(10px);
		transition: transform 420ms var(--deck-ease);
	}

	:global(.landing-deck-card.is-back) .back {
		opacity: 1;
	}

	:global(.landing-deck-card.is-back) .in {
		transform: none;
	}

	:global(.landing-deck-card.is-out) .back {
		opacity: 0;
		transition: opacity 180ms var(--deck-ease);
	}

	/* 3D turn: the back is a solid face on the far side of the card. */
	:global(.landing-deck-card.is-flip3d) .back {
		background: var(--film-back);
		backdrop-filter: none;
		transform: rotateY(180deg);
		transition: none;
	}

	:global(.landing-deck-card.is-flip3d) .in {
		transform: none;
		transition: none;
	}

	/* Phones read one column: the two groups dissolve into it. */
	.lead,
	.facts {
		display: contents;
	}

	.lead > *,
	.facts > * {
		flex: none;
	}

	.cat {
		display: block;
		margin-bottom: 14px;
		color: var(--film-accent);
		font: 600 15px/1 var(--font-display);
	}

	.question {
		margin: 0;
		font: 600 clamp(15px, 1.5vw, 18px) / 1.3 var(--font-display);
		opacity: 0.85;
		text-wrap: pretty;
	}

	.price {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 6px 12px;
		margin: 0;
	}

	.price b {
		font: 800 clamp(40px, 6vw, 64px) / 0.9 var(--font-headline, var(--font-display));
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.045em;
	}

	.price span {
		font: 500 15px/1.2 var(--font-display);
		opacity: 0.75;
	}

	.price .says {
		flex-basis: 100%;
	}

	.price em {
		margin-left: auto;
		font: 700 14px/1.2 var(--font-display);
		font-style: normal;
		font-variant-numeric: tabular-nums;
	}

	.price em.up {
		color: var(--film-yes);
	}

	.price em.down {
		color: var(--film-no);
	}

	/* The chart gives up height first, so the back always clears the top bar. */
	.in .chart {
		position: relative;
		flex: 0 1 clamp(96px, 20vh, 170px);
		min-height: 64px;
		margin-right: 6px;
	}

	:global(.landing-deck-card.is-back) .chart {
		pointer-events: auto;
	}

	.returns {
		margin: 0;
		padding: 12px 14px;
		border-radius: 12px;
		background: color-mix(in srgb, var(--film-fg) 8%, transparent);
		font: 500 15px/1.4 var(--font-display);
		font-variant-numeric: tabular-nums;
	}

	dl {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 10px;
		margin: 0;
		padding-top: 14px;
		border-top: 1px solid color-mix(in srgb, var(--film-fg) 20%, transparent);
	}

	dt {
		margin-bottom: 4px;
		font: 500 13px/1 var(--font-display);
		opacity: 0.6;
	}

	dd {
		margin: 0;
		font: 500 14px/1.35 var(--font-display);
	}

	.flip {
		align-self: flex-start;
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		font: 500 13px/1 var(--font-display);
		opacity: 0.55;
		cursor: inherit;
	}

	.flip:focus-visible {
		outline: 2px solid var(--film-fg);
		outline-offset: 4px;
		opacity: 1;
	}

	@media (max-height: 740px) {
		.question {
			display: none;
		}

		.in {
			gap: 10px;
		}
	}

	@media (max-height: 600px) {
		.in .chart {
			flex-basis: 76px;
		}

		.price b {
			font-size: 36px;
		}

		.flip {
			display: none;
		}
	}

	/* An unfolded phone or a tablet held upright: the column sits centred. */
	@media (min-width: 560px) and (max-width: 899px) {
		.in {
			justify-self: center;
			max-width: 34em;
			margin-right: auto;
			margin-left: auto;
		}
	}

	/* Wide screens: two columns that end on the same line. Left, the
	   question, the price and the chart; right, the return and the rule. */
	@media (min-width: 900px) {
		.back {
			padding-right: clamp(32px, 6vw, 96px);
			padding-left: clamp(32px, 6vw, 96px);
		}

		.in {
			display: grid;
			grid-template-rows: minmax(0, 1fr);
			grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
			column-gap: clamp(48px, 7vw, 120px);
			align-items: end;
			max-width: 1180px;
			margin: 0 auto;
		}

		.lead,
		.facts {
			display: flex;
			flex-direction: column;
			min-height: 0;
			max-height: 100%;
		}

		.lead {
			gap: 20px;
		}

		.facts {
			gap: 18px;
		}

		.question {
			display: block;
			max-width: 24ch;
			font: 700 clamp(22px, 2.2vw, 32px) / 1.15 var(--font-headline, var(--font-display));
			letter-spacing: -0.03em;
			opacity: 1;
		}

		.price b {
			font-size: clamp(56px, 6.4vw, 88px);
		}

		.price .says {
			flex-basis: auto;
		}

		.in .chart {
			flex: 0 1 clamp(170px, 36vh, 340px);
			min-height: 90px;
		}

		.returns {
			padding: 16px 18px;
			font-size: 16px;
		}

		dl {
			gap: 14px;
			padding-top: 18px;
		}

		dd {
			font-size: 15px;
		}
	}

	@media (min-width: 900px) and (max-height: 600px) {
		.flip {
			display: none;
		}

		.question {
			font-size: 20px;
		}

		.price b {
			font-size: 48px;
		}

		.lead {
			gap: 14px;
		}

		.facts {
			gap: 12px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.back,
		.in {
			transition: none;
		}
	}

	@media (prefers-reduced-transparency: reduce) {
		.back {
			background: color-mix(in srgb, var(--film-bg) 94%, transparent);
			backdrop-filter: none;
		}
	}
</style>
