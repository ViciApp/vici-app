<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import { ChevronDown } from '@lucide/svelte/icons';
	import { onDestroy, onMount } from 'svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { browser } from '$app/env';

	/**
	 * SwipeHint — bottom-of-deck affordance rail. Two chevron-pair sides
	 * (NO ↔ YES) drift outward on a ~1.7 s ping cycle while the centre
	 * dot pair calls out TAP / SKIP. Pure visual sugar — the actual
	 * gestures are wired in `FlowCard`.
	 */
	let t0 = $state(0);
	let raf: number | null = null;

	onMount(() => {
		if (!browser) {
			return;
		}

		const start = performance.now();

		const loop = (now: number) => {
			t0 = (now - start) / 1000;
			raf = requestAnimationFrame(loop);
		};

		raf = requestAnimationFrame(loop);
	});

	onDestroy(() => {
		if (nonNullish(raf) && browser) {
			cancelAnimationFrame(raf);
		}
	});

	// Ping wave 0..1 looping at 0.6 Hz; chevrons drift ±14 px, fade in/out
	// on a triangle wave.
	const ph = $derived((t0 * 0.6) % 1);
	const noOff = $derived(-ph * 14);
	const yesOff = $derived(ph * 14);
	const op = $derived(1 - Math.abs(ph - 0.5) * 1.4);
</script>

<div class="swipe-hint">
	<div class="swipe-hint-side no">
		<div style:opacity={op} style:transform={`translateX(${noOff}px)`} class="swipe-hint-chevs">
			<ChevronDown class="swipe-hint-chev no" size={14} strokeWidth={2.2} />
			<ChevronDown class="swipe-hint-chev no" size={14} strokeWidth={2.2} />
		</div>
		<span class="eyebrow no">{t({ locale: $localeStore, key: 'flow.swipe_hint.no' })}</span>
	</div>
	<div class="swipe-hint-mid">
		<div class="swipe-hint-dot" aria-hidden="true"></div>
		<div class="swipe-hint-stack">
			<span class="eyebrow mute">
				{t({ locale: $localeStore, key: 'flow.swipe_hint.tap' })}
			</span>
			<span class="eyebrow mute is-faint">
				{t({ locale: $localeStore, key: 'flow.swipe_hint.skip' })}
			</span>
		</div>
		<div class="swipe-hint-dot" aria-hidden="true"></div>
	</div>
	<div class="swipe-hint-side yes">
		<span class="eyebrow yes">{t({ locale: $localeStore, key: 'flow.swipe_hint.yes' })}</span>
		<div style:opacity={op} style:transform={`translateX(${yesOff}px)`} class="swipe-hint-chevs">
			<ChevronDown class="swipe-hint-chev yes" size={14} strokeWidth={2.2} />
			<ChevronDown class="swipe-hint-chev yes" size={14} strokeWidth={2.2} />
		</div>
	</div>
</div>

<style lang="postcss">
	/* Hide the affordance rail on small screens — the gestures it
	   labels (swipe left/right, tap, swipe up) eat vertical room that's
	   scarce on phones, and the labels are noise once the cards are the
	   only thing on screen. Desktop / wider viewports keep the rail as
	   a discoverability cue. Breakpoint mirrors the FlowMode card-wrap
	   sm breakpoint (640px) so the rail appears at the same width that
	   the card layout switches modes. */
	@media (max-width: 639px) {
		:global(.swipe-hint) {
			display: none;
		}
	}

	/* Chevrons inherit from `app.css .swipe-hint*` — local rules below
	   handle just the per-side rotation of the `@lucide/svelte` icons so
	   the down-chevron points outward (NO ⇒ left, YES ⇒ right) and the
	   per-side colour tint. */
	.swipe-hint-chevs {
		display: inline-flex;
	}
	.swipe-hint-chevs :global(.swipe-hint-chev.no) {
		transform: rotate(90deg);
		color: var(--no);
	}
	.swipe-hint-chevs :global(.swipe-hint-chev.no + .swipe-hint-chev.no) {
		opacity: 0.6;
	}
	.swipe-hint-chevs :global(.swipe-hint-chev.yes) {
		transform: rotate(-90deg);
		color: var(--yes);
	}
	.swipe-hint-chevs :global(.swipe-hint-chev.yes:first-child) {
		opacity: 0.6;
	}

	.swipe-hint-dot {
		width: 4px;
		height: 4px;
		border-radius: var(--r-pill);
		background: var(--fg-mute);
		opacity: 0.5;
	}
	.swipe-hint-stack {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		line-height: 1;
	}
	.swipe-hint-stack .eyebrow {
		font-size: 9px;
	}
	.swipe-hint-stack .eyebrow.is-faint {
		opacity: 0.7;
	}
</style>
