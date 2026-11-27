<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { onMount, untrack, type ComponentProps, type Snippet } from 'svelte';
	import LandingDeckArt from '#lib/components/landing/LandingDeckArt.svelte';
	import LandingDeckBar from '#lib/components/landing/LandingDeckBar.svelte';
	import LandingDeckCard from '#lib/components/landing/LandingDeckCard.svelte';
	import LandingDeckLines from '#lib/components/landing/LandingDeckLines.svelte';
	import {
		LANDING_DECK_ATTRACT_DROP_PX,
		LANDING_DECK_ATTRACT_RESUME_MS,
		LANDING_DECK_ATTRACT_START_MS,
		LANDING_DECK_CALLS_TO_DONE,
		LANDING_DECK_CLAIM_DELAY_MS,
		LANDING_DECK_CLIP_REST_PX,
		LANDING_DECK_CLIP_WAKE_MS,
		LANDING_DECK_EXIT_MS,
		LANDING_DECK_NUDGE_EVERY_MS,
		LANDING_DECK_NUDGE_IDLE_MS,
		LANDING_DECK_NUDGE_PX,
		LANDING_DECK_NUDGE_RETURN_MS,
		LANDING_DECK_RETURNING_HINT_MS,
		LANDING_DECK_SERIES,
		LANDING_DECK_STATUS_MS
	} from '#lib/constants/landing.constants.ts';
	import { VXP_DEFAULT_CALL_SIZE } from '#lib/constants/vxp-economy.constants.ts';
	import { LandingDeckFeed } from '#lib/stores/landing-deck-feed.svelte.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { hydrate as hydrateMarketTranslations } from '#lib/stores/market-translations.store.ts';
	import type { LandingDeckCall, LandingDeckSide } from '#lib/types/landing.ts';
	import { haptic } from '#lib/utils/haptics.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import {
		LandingDeckCardMotion,
		type DeckExit,
		type DeckPointerRelease
	} from '#lib/utils/landing-deck-motion.utils.ts';
	import { LandingDeckTable, type DeckItem } from '#lib/utils/landing-deck-table.utils.ts';
	import {
		deckAttractAmplitude,
		deckSidePercent,
		deckUnderFrame,
		landingDeckSeries,
		type DeckViewport
	} from '#lib/utils/landing-deck.utils.ts';
	import { formatWholeVxpMagnitude } from '#lib/utils/playground-display.utils.ts';
	import { prefersReducedMotion } from '#lib/utils/reduced-motion.utils.ts';

	interface Props {
		/** First visit: introduce the gesture before handing the card over. */
		attract?: boolean;
		/**
		 * The deck is the view in front. When another view covers it, pass
		 * `false`: the clip rests and the keyboard shortcuts stand down.
		 */
		active?: boolean;
		/** Price chart for the back of a card; the slot stays empty without it. */
		backChart?: Snippet<[{ seriesId: string }]>;
		oncall?: (call: LandingDeckCall) => void;
		/**
		 * The call that completes the deck. When set, that card is not thrown:
		 * it holds where the visitor left it for the duration of this call, as
		 * `[data-landing-deck-card="<seriesId>"]`, so the page can copy it and
		 * carry the copy into its next view. The deck drops its own on the
		 * next frame. In a copy, the picture is the card's `picture`, `video`
		 * and `[data-landing-deck-art]` children and `[data-landing-deck-veil]`
		 * is the shade over it; every other child is the card's text.
		 */
		ondone?: (last: { seriesId: string }) => void;
		/** The claim, offered once the deck is complete. Without it no claim is shown. */
		onclaim?: () => void;
		/** The visitor's first input while the introduction is showing. */
		onengage?: () => void;
		/**
		 * Every series was read and none can be shown, or a refresh took the
		 * last showable card off a deck already in play.
		 */
		onempty?: () => void;
		/**
		 * A series to open on, ahead of the curated ones (which follow, none
		 * twice). It need not be one of them: without footage it shows the
		 * market's own artwork. Leading with a series skips the introduction.
		 */
		leadSeriesId?: string;
	}

	const {
		attract = true,
		active = true,
		backChart,
		oncall = () => {},
		ondone,
		onclaim,
		onengage = () => {},
		onempty = () => {},
		leadSeriesId
	}: Props = $props();

	const reducedMotion = $derived(prefersReducedMotion());

	let innerWidth = $state(0);
	let innerHeight = $state(0);
	const viewport = $derived<DeckViewport>({ width: innerWidth, height: innerHeight });
	const readViewport = (): DeckViewport => ({
		width: window.innerWidth,
		height: window.innerHeight
	});

	// Read when the deck starts: the page decides the lead before mounting it.
	const series = $derived(landingDeckSeries({ curated: LANDING_DECK_SERIES, leadSeriesId }));
	const feed = $derived(new LandingDeckFeed(series));
	// A visitor who followed a link to one question came for that question.
	const introduce = $derived(attract && isNullish(leadSeriesId));

	let stage = $state<HTMLDivElement>();
	let items = $state.raw<readonly DeckItem[]>([]);
	let started = $state(false);
	let calls = $state.raw<LandingDeckCall[]>([]);
	let hint = $state(false);
	let status = $state<string>();
	let hand = $state<ComponentProps<typeof LandingDeckCard>['hand']>();
	let posed = $state(false);
	let clipAllowed = $state(false);
	let clipResting = $state(false);

	let underProgress = 0;
	let demo = false;
	let lastInput_ms = 0;
	let demoTimers: ReturnType<typeof setTimeout>[] = [];
	let statusTimer: ReturnType<typeof setTimeout> | undefined;
	let nudgeTimer: ReturnType<typeof setTimeout> | undefined;
	let wakeTimer: ReturnType<typeof setTimeout> | undefined;

	const table = new LandingDeckTable({
		onchange: (next) => (items = next),
		newMotion: () => {
			const motion = new LandingDeckCardMotion({
				viewport: readViewport,
				reducedMotion: () => reducedMotion
			});

			motion.onArm = (arm) => {
				if (nonNullish(arm)) {
					haptic('light-tap');
				}
			};

			return motion;
		}
	});

	const topItem = (): DeckItem | undefined => table.top;

	const setUnderProgress = (progress: number): void => {
		underProgress = progress;

		const { transform, shade } = deckUnderFrame(progress);
		stage?.style.setProperty('--deck-under-transform', transform);
		stage?.style.setProperty('--deck-under-shade', String(shade));
	};

	/** The card underneath becomes the top card and a fresh one is laid under it. */
	const promote = (leaving?: DeckItem): void => {
		table.promote({
			cards: feed.cards,
			leaving,
			enterFrom: deckUnderFrame(underProgress).transform
		});
		setUnderProgress(0);
	};

	/** A refresh can take cards off the table, and empty it. */
	const reconcile = (cards: typeof feed.cards): void => {
		if (table.reconcile(cards)) {
			clearDemoTimers();
			demo = false;
			hand = undefined;
			onempty();
		}
	};

	const say = (line: string): void => {
		hint = false;
		status = line;
		clearTimeout(statusTimer);
		statusTimer = setTimeout(() => (status = undefined), LANDING_DECK_STATUS_MS);
	};

	const armNudge = (): void => {
		clearTimeout(nudgeTimer);

		if (calls.length > 0 || reducedMotion) {
			return;
		}

		nudgeTimer = setTimeout(() => {
			const motion = topItem()?.motion;
			const idle = performance.now() - lastInput_ms > LANDING_DECK_NUDGE_IDLE_MS;

			if (nonNullish(motion) && active && idle && !motion.face.held) {
				motion.lean({ x: LANDING_DECK_NUDGE_PX, y: 0, response: 0.7, damping: 0.9 });
				setTimeout(() => motion.lean({ x: 0, y: 0, response: 0.6 }), LANDING_DECK_NUDGE_RETURN_MS);
			}

			armNudge();
		}, LANDING_DECK_NUDGE_EVERY_MS);
	};

	const clearDemoTimers = (): void => {
		demoTimers.forEach(clearTimeout);
		demoTimers = [];
	};

	const later = ({ run, ms }: { run: () => void; ms: number }): void => {
		demoTimers.push(setTimeout(run, ms));
	};

	const liftHand = (): void => {
		if (isNullish(hand)) {
			return;
		}

		hand = 'leaving';
		setTimeout(() => {
			if (hand === 'leaving') {
				hand = undefined;
			}
		}, 300);
	};

	// The introduction: a hand rocks the first card right to a full Yes
	// stamp, left to a full No stamp, then sets it down. It never calls.
	const rock = (): void => {
		const motion = topItem()?.motion;

		if (isNullish(motion) || !demo) {
			return;
		}

		const amplitude = deckAttractAmplitude(window.innerWidth);

		hand = 'arriving';
		later({ run: () => (hand = 'pressing'), ms: 520 });
		later({
			run: () => motion.lean({ x: amplitude, y: LANDING_DECK_ATTRACT_DROP_PX, response: 0.85 }),
			ms: 760
		});
		later({
			run: () => motion.lean({ x: -amplitude, y: LANDING_DECK_ATTRACT_DROP_PX, response: 1 }),
			ms: 2250
		});
		later({ run: () => motion.lean({ x: 0, y: 0, response: 0.8 }), ms: 3900 });
		later({
			run: () => {
				liftHand();
				hint = true;
			},
			ms: 4700
		});
	};

	/** Any input from the visitor ends the introduction, wherever it is. */
	const takeover = (): void => {
		lastInput_ms = performance.now();
		hint = false;
		liftHand();

		if (posed) {
			posed = false;
			onengage();
		}

		if (!demo) {
			return;
		}

		demo = false;
		clearDemoTimers();
		onengage();
		armNudge();
	};

	const start = (): void => {
		if (!table.deal({ cards: feed.cards, enterFrom: deckUnderFrame(underProgress).transform })) {
			return;
		}

		started = true;
		setUnderProgress(0);

		if (introduce && !reducedMotion) {
			demo = true;
			later({ run: rock, ms: LANDING_DECK_ATTRACT_START_MS });

			return;
		}

		if (introduce) {
			posed = true;
			hand = 'still';
			hint = true;

			return;
		}

		if (!reducedMotion) {
			hint = true;
			setTimeout(() => (hint = false), LANDING_DECK_RETURNING_HINT_MS);
		}

		armNudge();
	};

	const leave = ({
		exit,
		velocity,
		handover = false
	}: {
		exit: DeckExit;
		velocity?: number;
		handover?: boolean;
	}): DeckItem | undefined => {
		const item = topItem();

		if (isNullish(item) || item.motion.gone) {
			return;
		}

		item.motion.exit({ exit, velocity, fly: !handover });
		promote(item);

		if (handover) {
			requestAnimationFrame(() => table.drop(item.key));
		} else {
			setTimeout(() => table.drop(item.key), LANDING_DECK_EXIT_MS);
		}

		return item;
	};

	const call = ({ side, velocity }: { side: LandingDeckSide; velocity?: number }): void => {
		const card = feed.card(topItem()?.seriesId ?? '');
		const completes = calls.length === LANDING_DECK_CALLS_TO_DONE - 1;
		const handover = completes && nonNullish(ondone);
		const item = leave({ exit: side, velocity, handover });

		if (isNullish(item) || isNullish(card)) {
			return;
		}

		const made: LandingDeckCall = {
			seriesId: card.entry.seriesId,
			side,
			pricePercent: deckSidePercent({ card, side }),
			atMs: Date.now()
		};
		calls = [...calls, made];
		haptic('firm-tap');
		clearTimeout(nudgeTimer);
		oncall(made);

		if (handover) {
			hint = false;
			status = undefined;
			ondone?.({ seriesId: made.seriesId });

			return;
		}

		say(
			t({
				locale: $localeStore,
				key: side === 'yes' ? 'landing.deck.called_yes' : 'landing.deck.called_no',
				params: {
					size: VXP_DEFAULT_CALL_SIZE,
					amount: formatWholeVxpMagnitude(side === 'yes' ? card.yesEarns : card.noEarns)
				}
			})
		);

		// With no next view to move to, the claim itself is the next step.
		if (completes && nonNullish(onclaim)) {
			setTimeout(onclaim, LANDING_DECK_CLAIM_DELAY_MS);
		}
	};

	const pass = (velocity?: number): void => {
		if (isNullish(leave({ exit: 'pass', velocity }))) {
			return;
		}

		say(t({ locale: $localeStore, key: 'landing.deck.passed' }));
		haptic('soft-tick');
	};

	const flip = (): void => {
		const motion = topItem()?.motion;

		if (isNullish(motion) || motion.gone) {
			return;
		}

		motion.toggleFlip();

		if (motion.face.flipped) {
			haptic('light-tap');
		}
	};

	const onrelease = (release: DeckPointerRelease): void => {
		if (release.kind === 'tap') {
			flip();
		} else if (release.kind === 'call') {
			call({ side: release.side, velocity: release.velocity });
		} else if (release.kind === 'pass') {
			pass(release.velocity);
		}
	};

	const KEY_ACTIONS: Record<string, () => void> = {
		ArrowRight: () => call({ side: 'yes' }),
		ArrowLeft: () => call({ side: 'no' }),
		p: () => pass(),
		P: () => pass(),
		ArrowUp: flip,
		ArrowDown: flip,
		' ': flip
	};

	const onkeydown = (event: KeyboardEvent): void => {
		const action = KEY_ACTIONS[event.key];
		const target = event.target instanceof Element ? event.target : undefined;
		const typing = nonNullish(target?.closest('input, textarea, select, [contenteditable]'));
		const modified = event.altKey || event.ctrlKey || event.metaKey;

		if (isNullish(action) || !active || !started || typing || modified || event.defaultPrevented) {
			return;
		}

		// Space on a focused control presses that control.
		if (event.key === ' ' && nonNullish(target?.closest('button, a'))) {
			return;
		}

		if (action === flip) {
			event.preventDefault();
		}

		takeover();
		action();
	};

	const wakeClip = (): void => {
		clearTimeout(wakeTimer);
		wakeTimer = setTimeout(() => {
			const motion = topItem()?.motion;

			if (
				nonNullish(motion) &&
				(motion.face.held || Math.abs(motion.x) >= LANDING_DECK_CLIP_REST_PX)
			) {
				wakeClip();

				return;
			}

			clipResting = false;
		}, LANDING_DECK_CLIP_WAKE_MS);
	};

	// A press anywhere rests the clip: decoding it must not cost the drag a frame.
	const restClip = (): void => {
		clearTimeout(wakeTimer);
		clipResting = true;
	};

	const onvisibilitychange = (): void => {
		if (document.hidden) {
			restClip();
		} else {
			wakeClip();
		}

		if (!demo) {
			return;
		}

		clearDemoTimers();
		hand = undefined;
		topItem()?.motion.settle();

		if (!document.hidden) {
			later({ run: rock, ms: LANDING_DECK_ATTRACT_RESUME_MS });
		}
	};

	onMount(() => {
		const { connection } = navigator as Navigator & {
			connection?: { saveData?: boolean; effectiveType?: string };
		};
		const constrained = connection?.saveData === true || /2g/.test(connection?.effectiveType ?? '');
		clipAllowed = !reducedMotion && !constrained;

		setUnderProgress(0);
		void hydrateMarketTranslations(series.map(({ seriesId }) => seriesId));

		const stopFeed = feed.start();

		return () => {
			stopFeed();
			clearDemoTimers();
			[statusTimer, nudgeTimer, wakeTimer].forEach(clearTimeout);
		};
	});

	$effect(() => {
		if (!feed.ready || started) {
			return;
		}

		if (feed.cards.length === 0) {
			untrack(onempty);

			return;
		}

		untrack(start);
	});

	$effect(() => {
		const { cards } = feed;

		// The table is read and rewritten untracked: only the feed reruns this.
		if (started) {
			untrack(() => reconcile(cards));
		}
	});
</script>

<svelte:window {onkeydown} bind:innerWidth bind:innerHeight />
<svelte:document
	onpointercancelcapture={wakeClip}
	onpointerdowncapture={restClip}
	onpointerupcapture={wakeClip}
	{onvisibilitychange}
/>

<section
	class="landing-deck"
	aria-label={t({ locale: $localeStore, key: 'landing.deck.region_aria' })}
	inert={!active}
>
	<div bind:this={stage} class="stage">
		{#if !started && (!feed.ready || feed.cards.length > 0)}
			<!-- The film is up before the first price is: the first card's
			     still stands in until its series has loaded. -->
			<LandingDeckArt entry={series[0]} preload priority {viewport} />
		{/if}
		{#each items as item (item.key)}
			{@const card = feed.card(item.seriesId)}
			{#if nonNullish(card)}
				<LandingDeckCard
					{backChart}
					{card}
					clip={clipAllowed}
					enterFrom={item.enterFrom}
					first={item.first}
					hand={item.place === 'top' ? hand : undefined}
					motion={item.motion}
					onpress={takeover}
					onprogress={setUnderProgress}
					{onrelease}
					place={item.place}
					playing={active && !clipResting}
					posed={posed && item.place === 'top'}
					{reducedMotion}
					{viewport}
				/>
			{/if}
		{/each}
	</div>

	{#if started}
		<LandingDeckLines
			claim={nonNullish(onclaim) && calls.length >= LANDING_DECK_CALLS_TO_DONE}
			{hint}
			{onclaim}
			{status}
		/>
		<LandingDeckBar
			calls={calls.length}
			oncall={(side) => {
				takeover();
				call({ side });
			}}
			onpass={() => {
				takeover();
				pass();
			}}
		/>
	{/if}
</section>

<style lang="postcss">
	.landing-deck {
		--deck-ease: cubic-bezier(0.23, 1, 0.32, 1);
		--deck-pad: clamp(16px, 3vw, 32px);

		position: fixed;
		inset: 0;
		isolation: isolate;
		overflow: hidden;
		background: var(--film-bg);
		color: var(--film-fg);
		color-scheme: dark;
		overscroll-behavior: none;
		touch-action: none;
		-webkit-tap-highlight-color: transparent;
	}

	.stage {
		position: absolute;
		inset: 0;
		z-index: 1;
	}
</style>
