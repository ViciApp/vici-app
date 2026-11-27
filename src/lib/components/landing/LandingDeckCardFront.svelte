<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import CountUp from '#lib/components/ui/CountUp.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { LandingDeckCard } from '#lib/types/landing.ts';
	import { formatProbability } from '#lib/utils/format.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import {
		DECK_SPARKLINE_HEIGHT,
		DECK_SPARKLINE_WIDTH,
		deckSparkline,
		type DeckTrend
	} from '#lib/utils/landing-deck.utils.ts';
	import { categoryLabel } from '#lib/utils/market-tags.utils.ts';

	interface Props {
		card: LandingDeckCard;
		/** Question in the reader's language. */
		title: string;
		/** The 24-hour move, already worded; absent when nothing traded in it. */
		moveLabel?: string;
		trend?: DeckTrend;
		/** The front is covered by the back: hidden from assistive tech, out of the tab order. */
		covered?: boolean;
		/** Count the prices up from zero, for the first card of the visit. */
		countUp_ms?: number;
		onflip?: () => void;
	}

	const {
		card,
		title,
		moveLabel,
		trend = 'flat',
		covered = false,
		countUp_ms,
		onflip = () => {}
	}: Props = $props();

	const category = $derived(
		nonNullish(card.entry.category)
			? categoryLabel({ category: card.entry.category, variant: 'full', locale: $localeStore })
			: undefined
	);
	const sparkline = $derived(
		nonNullish(card.history) ? deckSparkline([...card.history.yes, card.yesPercent]) : undefined
	);
</script>

<div class="body" aria-hidden={covered} inert={covered}>
	<div>
		<span class="cat">
			{category ?? ''}
			{#if nonNullish(moveLabel)}
				<em class={trend}>
					{#if nonNullish(sparkline)}
						<svg
							class={sparkline.trend}
							aria-hidden="true"
							viewBox="0 0 {DECK_SPARKLINE_WIDTH} {DECK_SPARKLINE_HEIGHT}"
						>
							<polyline
								fill="none"
								points={sparkline.points}
								stroke="currentColor"
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.6"
							/>
							<circle cx={sparkline.end.x} cy={sparkline.end.y} fill="currentColor" r="2.2" />
						</svg>
					{/if}
					<span>{moveLabel}</span>
				</em>
			{/if}
		</span>
		<h2 class="question">{title}</h2>
		<!-- A pointer tap anywhere on the card already flips it and never
		     reaches this button as a click of its own; `detail` is 0 only for
		     a keyboard or assistive-tech activation, the one path that needs
		     the button. -->
		<button
			class="flip-key"
			onclick={(event) => {
				if (event.detail === 0) {
					onflip();
				}
			}}
			type="button"
		>
			{t({ locale: $localeStore, key: 'landing.deck.show_rule' })}
		</button>
	</div>
	<div class="prices">
		{#each [{ side: 'no', percent: 100 - card.yesPercent }, { side: 'yes', percent: card.yesPercent }] as { side, percent } (side)}
			<div class={side}>
				<b>
					{#if nonNullish(countUp_ms)}
						<CountUp duration_ms={countUp_ms} to={percent} />%
					{:else}
						{formatProbability(percent / 100)}
					{/if}
				</b>
				<span>
					{t({
						locale: $localeStore,
						key: side === 'yes' ? 'outcome.yes' : 'outcome.no'
					})}
				</span>
			</div>
		{/each}
	</div>
</div>

<style lang="postcss">
	.body {
		position: absolute;
		right: var(--deck-pad);
		bottom: calc(138px + env(safe-area-inset-bottom, 0px));
		left: var(--deck-pad);
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 24px;
		align-items: end;
		transition:
			opacity 300ms var(--deck-ease),
			transform 460ms var(--deck-ease);
	}

	/* The text of a card underneath waits out of sight and rises in when the
	   card takes the top. */
	:global(.landing-deck-card.is-under) .body {
		opacity: 0;
		transform: translateY(10px);
		transition: none;
	}

	:global(.landing-deck-card.is-out) .body {
		opacity: 0;
		transition: opacity 180ms var(--deck-ease);
	}

	:global(.landing-deck-card.is-back) .body {
		opacity: 0;
		transition: opacity 160ms var(--deck-ease);
	}

	:global(.landing-deck-card.is-flip3d) .body {
		transition: none;
	}

	.cat {
		display: block;
		margin-bottom: 14px;
		color: var(--film-accent);
		font: 600 15px/1 var(--font-display);
	}

	.cat em {
		display: inline-flex;
		gap: 8px;
		align-items: center;
		margin-left: 12px;
		color: var(--film-fg);
		font-style: normal;
		opacity: 0.75;
		vertical-align: middle;
		white-space: nowrap;
	}

	/* No category above a series the deck has no editorial entry for. */
	.cat em:first-child {
		margin-left: 0;
	}

	.cat em.up {
		color: var(--film-yes);
		opacity: 1;
	}

	.cat em.down {
		color: var(--film-no);
		opacity: 1;
	}

	/* The small line is coloured by its own direction; the words beside it
	   keep the 24-hour move's colour. */
	.cat svg {
		flex: none;
		width: 44px;
		height: 14px;
		overflow: visible;
	}

	.cat svg.up {
		color: var(--film-yes);
	}

	.cat svg.down {
		color: var(--film-no);
	}

	.cat svg.flat {
		color: var(--film-fg);
	}

	.question {
		max-width: 15ch;
		margin: 0;
		font: 800 clamp(30px, 5vw, 80px) / 0.96 var(--font-headline, var(--font-display));
		letter-spacing: -0.04em;
		text-shadow: 0 2px 30px color-mix(in srgb, var(--film-bg) 40%, transparent);
		text-wrap: balance;
	}

	.flip-key {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.flip-key:focus-visible {
		position: static;
		width: auto;
		height: auto;
		margin-top: 12px;
		overflow: visible;
		font: 500 13px/1 var(--font-display);
		outline: 2px solid var(--film-fg);
		outline-offset: 4px;
		clip-path: none;
	}

	.prices {
		display: flex;
		gap: clamp(18px, 3vw, 40px);
		align-items: end;
	}

	.prices > div {
		display: grid;
		gap: 6px;
		justify-items: center;
	}

	.prices b {
		font: 800 clamp(28px, 4.2vw, 68px) / 1 var(--font-headline, var(--font-display));
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.04em;
	}

	.prices span {
		font: 600 14px/1 var(--font-display);
		opacity: 0.85;
	}

	.prices .no b {
		color: var(--film-no);
	}

	.prices .yes b {
		color: var(--film-yes);
	}

	@media (max-width: 760px) {
		.body {
			grid-template-columns: 1fr;
			gap: 14px;
		}

		.prices {
			justify-content: space-between;
			width: 100%;
		}

		.question {
			max-width: none;
		}
	}

	@media (max-height: 560px) {
		.question {
			font-size: clamp(22px, 6vh, 40px);
		}

		.prices b {
			font-size: clamp(22px, 6vh, 36px);
		}

		.cat {
			margin-bottom: 6px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.body {
			transition: none;
		}
	}
</style>
