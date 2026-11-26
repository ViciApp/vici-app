<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { untrack, type ComponentProps, type Snippet } from 'svelte';
	import LandingDeckCardBack from '#lib/components/landing/LandingDeckCardBack.svelte';
	import LandingDeckCardFront from '#lib/components/landing/LandingDeckCardFront.svelte';
	import LandingDeckHand from '#lib/components/landing/LandingDeckHand.svelte';
	import LandingDeckMedia from '#lib/components/landing/LandingDeckMedia.svelte';
	import LandingDeckStamps from '#lib/components/landing/LandingDeckStamps.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { marketDisplay } from '#lib/stores/market-translations.store.ts';
	import type { LandingDeckCard } from '#lib/types/landing.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import type {
		DeckCardFace,
		DeckPointerRelease,
		LandingDeckCardMotion
	} from '#lib/utils/landing-deck-motion.utils.ts';
	import {
		deckTodayMove,
		type DeckArm,
		type DeckCardFrame,
		type DeckTrend,
		type DeckViewport
	} from '#lib/utils/landing-deck.utils.ts';

	interface Props {
		card: LandingDeckCard;
		motion: LandingDeckCardMotion;
		/** `under` waits beneath the top card, `top` takes input, `out` is leaving with its stamp. */
		place: 'under' | 'top' | 'out';
		viewport: DeckViewport;
		reducedMotion: boolean;
		/** Transform the card rises from when it becomes the top card. */
		enterFrom?: string;
		/** The first card of the visit: it settles in and its prices count up. */
		first?: boolean;
		/** Whether the footage may be a clip at all (off for data saver and reduced motion). */
		clip?: boolean;
		playing?: boolean;
		hand?: ComponentProps<typeof LandingDeckHand>['phase'];
		/** Reduced-motion introduction: both stamps shown at once, nothing moves. */
		posed?: boolean;
		backChart?: Snippet<[{ seriesId: string }]>;
		onpress?: () => void;
		onrelease?: (release: DeckPointerRelease) => void;
		/** How far the card is toward a stamp, 0 to 1, on every frame it is the top card. */
		onprogress?: (progress: number) => void;
	}

	const {
		card,
		motion,
		place,
		viewport,
		reducedMotion,
		enterFrom,
		first = false,
		clip = false,
		playing = false,
		hand,
		posed = false,
		backChart,
		onpress = () => {},
		onrelease = () => {},
		onprogress = () => {}
	}: Props = $props();

	const PROMOTE_MS = 280;
	const PROMOTE_EASING = 'cubic-bezier(.23,1,.32,1)';
	const COUNT_UP_MS = 520;
	const POSED_STAMP_OPACITY = 0.9;

	let element = $state<HTMLDivElement>();
	let face = $state<DeckCardFace>(untrack(() => motion.face));
	let arm = $state<DeckArm>();
	let settledIn = $state(false);
	let counting = $state(false);
	let pointerId: number | undefined;

	const display = $derived($marketDisplay(card.market));

	const move = $derived(deckTodayMove({ history: card.history, yesPercent: card.yesPercent }));
	const moveTrend = $derived<DeckTrend>(
		isNullish(move) || move === 0 ? 'flat' : move > 0 ? 'up' : 'down'
	);
	const moveLabel = $derived.by(() => {
		if (isNullish(move)) {
			return;
		}

		if (move === 0) {
			return t({ locale: $localeStore, key: 'landing.deck.move_flat' });
		}

		return t({
			locale: $localeStore,
			key: move > 0 ? 'landing.deck.move_up' : 'landing.deck.move_down',
			params: { points: Math.abs(move) }
		});
	});

	const hit = $derived(face.exit === 'yes' || face.exit === 'no' ? face.exit : arm);

	const paint = (frame: DeckCardFrame): void => {
		if (isNullish(element)) {
			return;
		}

		const { style } = element;
		style.transform = frame.transform;
		style.setProperty('--deck-yes', String(frame.yesOpacity));
		style.setProperty('--deck-no', String(frame.noOpacity));
		style.setProperty('--deck-pass', String(frame.passOpacity));

		if (frame.arm !== arm) {
			({ arm } = frame);
		}

		if (untrack(() => place) === 'top') {
			onprogress(frame.progress);
		}
	};

	$effect(() => {
		const current = motion;
		current.onFace = (next) => (face = next);
		current.onFrame = paint;

		return () => {
			current.onFace = undefined;
			current.onFrame = undefined;
			current.stop();
		};
	});

	// Becoming the top card: rise from the resting size underneath to full
	// size. The inline transform takes over from the stylesheet's, which
	// only places a card that is still underneath.
	$effect(() => {
		if (place !== 'top' || isNullish(element)) {
			return;
		}

		const node = element;

		untrack(() => {
			node.style.transform = 'translate3d(0,0,0)';

			if (!reducedMotion && nonNullish(enterFrom)) {
				node.animate([{ transform: enterFrom }, { transform: 'translate3d(0,0,0) scale(1)' }], {
					duration: PROMOTE_MS,
					easing: PROMOTE_EASING
				});
			}

			if (!first) {
				return;
			}

			counting = !reducedMotion;
			// Two frames: the zoomed-in start has to paint before it can ease out.
			requestAnimationFrame(() => requestAnimationFrame(() => (settledIn = true)));
			setTimeout(() => (counting = false), COUNT_UP_MS + 80);
		});
	});

	$effect(() => {
		if (isNullish(element)) {
			return;
		}

		if (posed) {
			element.style.setProperty('--deck-yes', String(POSED_STAMP_OPACITY));
			element.style.setProperty('--deck-no', String(POSED_STAMP_OPACITY));

			return;
		}

		untrack(() => {
			if (place !== 'under') {
				motion.draw();
			}
		});
	});

	const noGesture = (target: EventTarget | null): boolean =>
		target instanceof Element && nonNullish(target.closest('[data-landing-deck-no-gesture]'));

	const point = ({ clientX, clientY }: PointerEvent) => ({
		x: clientX,
		y: clientY,
		at_ms: performance.now()
	});

	const onpointerdown = (event: PointerEvent): void => {
		if (place !== 'top' || nonNullish(pointerId) || noGesture(event.target)) {
			return;
		}

		if (event.pointerType === 'mouse' && event.button !== 0) {
			return;
		}

		onpress();
		({ pointerId } = event);
		// A card caught while it is still rising is caught where it is.
		element?.getAnimations().forEach((animation) => animation.cancel());
		motion.press(point(event));
		element?.setPointerCapture(event.pointerId);
	};

	const onpointermove = (event: PointerEvent): void => {
		if (event.pointerId === pointerId) {
			motion.drag(point(event));
		}
	};

	const onpointerup = (event: PointerEvent): void => {
		if (event.pointerId !== pointerId) {
			return;
		}

		pointerId = undefined;

		const release = motion.release();

		if (nonNullish(release)) {
			onrelease(release);
		}
	};
</script>

<!-- The drag is a pointer shortcut. Every action it performs has a real
     control: the deck's Yes / No / Pass buttons and the flip buttons on
     each face. -->
<div
	bind:this={element}
	class="landing-deck-card"
	class:is-back={face.back}
	class:is-first={first}
	class:is-flip3d={face.flip3d}
	class:is-grab={face.held}
	class:is-in={settledIn}
	class:is-out={place === 'out'}
	class:is-top={place === 'top'}
	class:is-under={place === 'under'}
	aria-hidden={place !== 'top'}
	data-landing-deck-card={card.entry.seriesId}
	inert={place !== 'top'}
	onpointercancel={onpointerup}
	{onpointerdown}
	{onpointermove}
	{onpointerup}
	role="presentation"
>
	<LandingDeckMedia
		clip={clip && place !== 'under'}
		entry={card.entry}
		playing={playing && place === 'top'}
		priority={first}
		{viewport}
	/>
	<div class="veil"></div>
	<div class="shade"></div>

	<LandingDeckCardFront
		{card}
		countUp_ms={counting ? COUNT_UP_MS : undefined}
		covered={face.back}
		{moveLabel}
		onflip={() => motion.toggleFlip()}
		title={display.title}
		trend={moveTrend}
	/>

	<LandingDeckCardBack
		{backChart}
		{card}
		{moveLabel}
		onflip={() => motion.toggleFlip()}
		resolution={display.resolution}
		shown={face.back && place === 'top'}
		title={display.title}
		trend={moveTrend}
	/>

	<LandingDeckStamps {hit} noEarns={card.noEarns} yesEarns={card.yesEarns} />

	{#if nonNullish(hand)}
		<LandingDeckHand phase={hand} />
	{/if}
</div>

<style lang="postcss">
	.landing-deck-card {
		position: absolute;
		inset: 0;
		overflow: hidden;
		background: var(--film-bg);
		color: var(--film-fg);
		cursor: grab;
		touch-action: none;
		transform-origin: 50% 60%;
		user-select: none;
		will-change: transform;
	}

	.is-grab {
		cursor: grabbing;
	}

	.is-top {
		z-index: 2;
	}

	.is-out {
		z-index: 3;
		pointer-events: none;
	}

	/* A card underneath is placed by the deck (it follows the top card's
	   progress); once it is on top its own inline transform takes over. */
	.is-under {
		z-index: 1;
		pointer-events: none;
		transform: var(--deck-under-transform);
	}

	.veil,
	.shade {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.veil {
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--film-bg) 50%, transparent) 0%,
			transparent 24%,
			transparent 38%,
			color-mix(in srgb, var(--film-bg) 88%, transparent) 76%,
			color-mix(in srgb, var(--film-bg) 98%, transparent) 100%
		);
	}

	.shade {
		background: var(--film-bg);
		opacity: 0;
		transition: opacity 260ms var(--deck-ease);
	}

	.is-under .shade {
		opacity: var(--deck-under-shade);
		transition: none;
	}

	/* 3D turn: the veil belongs to the front face. */
	.is-flip3d.is-back .veil {
		visibility: hidden;
	}

	@media (prefers-reduced-motion: reduce) {
		.shade {
			transition: none;
		}

		/* Nothing is thrown: a called card fades where it stands. */
		.is-out {
			opacity: 0;
			transition: opacity 200ms ease;
		}
	}
</style>
