<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import {
		LANDING_DECK_CLIP_TYPE_MP4,
		LANDING_DECK_CLIP_TYPE_WEBM,
		LANDING_DECK_DEFAULT_WIDE_FOCUS,
		LANDING_DECK_MEDIA
	} from '#lib/constants/landing.constants.ts';
	import type { LandingDeckSeries } from '#lib/types/landing.ts';
	import { deckSeamStops, focusY, type DeckViewport } from '#lib/utils/landing-deck.utils.ts';

	interface Props {
		entry: LandingDeckSeries;
		viewport: DeckViewport;
		/** Mount the clip over the still. Off for cards not on top, so their clip is not fetched early. */
		clip?: boolean;
		playing?: boolean;
		/** The still is the first thing the visitor sees: fetch it ahead of everything else. */
		priority?: boolean;
		/**
		 * Ask the browser for this entry's still before the image tag is even
		 * parsed, in the cut this screen will show. For the one image the page
		 * opens on; every other still and all clips load when their card needs them.
		 */
		preload?: boolean;
	}

	const {
		entry,
		viewport,
		clip = false,
		playing = false,
		priority = false,
		preload = false
	}: Props = $props();

	// Fold, unfold or rotate: the cut follows the window, upright or wide.
	const wide = $derived(viewport.width > viewport.height);
	const cut = $derived(LANDING_DECK_MEDIA[entry.media][wide ? 'wide' : 'tall']);
	const focus = $derived(wide ? (entry.wideFocus ?? LANDING_DECK_DEFAULT_WIDE_FOCUS) : '50% 50%');

	const seamBackground = $derived.by(() => {
		if (isNullish(entry.seam)) {
			return;
		}

		const tone = (alpha: number): string =>
			`color-mix(in srgb, var(--film-bg) ${Math.round(alpha * 100)}%, transparent)`;
		const stops = deckSeamStops({
			viewport,
			aspectRatio: cut.aspectRatio,
			focus: focusY(focus),
			seam: entry.seam
		});
		const solid = stops[stops.length - 1].alpha;

		return `linear-gradient(180deg, ${stops
			.map(({ alpha, offsetPx }) => `${tone(alpha)} ${offsetPx}px`)
			.join(', ')}, ${tone(solid)} 100%)`;
	});

	let video = $state<HTMLVideoElement>();
	// The clip that failed to load, so a rotation to the other cut tries again.
	let failedClip = $state<string>();
	const showClip = $derived(clip && failedClip !== cut.clipMp4);

	$effect(() => {
		if (isNullish(video)) {
			return;
		}

		if (!playing) {
			video.pause();

			return;
		}

		// Autoplay can be refused (data saver, low power): the still stays.
		video.play().catch(() => {});
	});
</script>

<svelte:head>
	{#if preload}
		<link
			as="image"
			fetchpriority="high"
			href={LANDING_DECK_MEDIA[entry.media].tall.stillWebp}
			media="(orientation: portrait)"
			rel="preload"
			type="image/webp"
		/>
		<link
			as="image"
			fetchpriority="high"
			href={LANDING_DECK_MEDIA[entry.media].wide.stillWebp}
			media="(orientation: landscape)"
			rel="preload"
			type="image/webp"
		/>
	{/if}
</svelte:head>

{#key cut}
	<picture>
		<source srcset={cut.stillWebp} type="image/webp" />
		<img
			style:object-position={focus}
			alt=""
			decoding={priority ? 'sync' : 'async'}
			draggable="false"
			fetchpriority={priority ? 'high' : 'low'}
			src={cut.stillJpg}
		/>
	</picture>
	{#if showClip}
		<!-- No poster: the still shows through until the clip has a frame, in
		     whichever image format the browser took. -->
		<video
			bind:this={video}
			style:object-position={focus}
			aria-hidden="true"
			disablepictureinpicture
			loop
			muted
			playsinline
			preload="auto"
			tabindex="-1"
		>
			<source src={cut.clipWebm} type={LANDING_DECK_CLIP_TYPE_WEBM} />
			<source
				onerror={() => (failedClip = cut.clipMp4)}
				src={cut.clipMp4}
				type={LANDING_DECK_CLIP_TYPE_MP4}
			/>
		</video>
	{/if}
	{#if nonNullish(seamBackground)}
		<div style:background={seamBackground} class="seam"></div>
	{/if}
{/key}

<style lang="postcss">
	img,
	video,
	.seam {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	img,
	video {
		object-fit: cover;
	}

	video {
		backface-visibility: hidden;
		transform: translateZ(0);
	}

	/* The first card settles in from a slight zoom. */
	:global(.landing-deck-card.is-first) img {
		transform: scale(1.06);
		transition: transform 1200ms var(--deck-ease);
	}

	:global(.landing-deck-card.is-first.is-in) img {
		transform: none;
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.landing-deck-card.is-first) img {
			transform: none;
			transition: none;
		}
	}
</style>
