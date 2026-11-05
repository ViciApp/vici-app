<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { onMount } from 'svelte';
	import FlameChar from '#lib/components/characters/FlameChar.svelte';
	import OracleChar from '#lib/components/characters/OracleChar.svelte';
	import TricksterChar from '#lib/components/characters/TricksterChar.svelte';
	import ViciChar from '#lib/components/characters/ViciChar.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';
	import type { MotionBeatPayload } from '#lib/utils/motion-engine.utils.ts';
	import { prefersReducedMotion } from '#lib/utils/reduced-motion.utils.ts';
	import type { FlameStage } from '#lib/utils/streak.utils.ts';

	interface Props {
		beat: MotionBeatPayload;
		onDone: () => void;
	}

	const { beat, onDone }: Props = $props();

	// The engine's NONE/SPARK/… tier maps onto the Flame renderer's
	// lower-case stage names; the resolver never emits NONE for a beat
	// (it floors to SPARK), so `flame` is a safe fallback.
	const flameStage = $derived.by((): FlameStage => {
		switch (beat.tier) {
			case 'SPARK':
				return 'spark';
			case 'EMBER':
				return 'ember';
			case 'BLAZE':
				return 'blaze';
			case 'INFERNO':
				return 'inferno';
			default:
				return 'flame';
		}
	});

	// Hard beats stand BIGGEST in the empty slot: the Flame milestone, the
	// comeback opener, the first-contrarian moment, and every lifetime
	// volume milestone (`volume-*`). Everything else gets the soft size.
	const isHardBeat = $derived(
		beat.character === 'flame' ||
			beat.kind === 'comeback' ||
			beat.kind === 'first-contrarian' ||
			beat.kind.startsWith('volume-')
	);

	// Ambient (`ambient-10`) is intentionally minimal — a small character
	// pop with no copy / chips. Everything else carries the full stack.
	const isAmbient = $derived(beat.kind === 'ambient-10');

	// Large character in the gap: hard beats 168 px, soft beats 120 px,
	// ambient pops 44 px. The reward-moment characters stand big so the
	// celebratory pop reads as the payoff it is.
	const charSize = $derived(isAmbient ? 44 : isHardBeat ? 168 : 120);

	const nameKey = $derived.by((): MessageKey => {
		switch (beat.character) {
			case 'oracle':
				return 'motion.name.oracle';
			case 'trickster':
				return 'motion.name.trickster';
			case 'flame':
				return 'motion.name.flame';
			default:
				return 'motion.name.vici';
		}
	});

	const copy = $derived(
		isNullish(beat.copyKey) ? null : t({ locale: $localeStore, key: beat.copyKey })
	);
	const sub = $derived(
		isNullish(beat.subKey) ? null : t({ locale: $localeStore, key: beat.subKey })
	);
	const treat = $derived(
		isNullish(beat.treatKey) ? null : t({ locale: $localeStore, key: beat.treatKey })
	);
	const badge = $derived(
		isNullish(beat.badgeKey)
			? null
			: t({
					locale: $localeStore,
					key: 'motion.badge_label',
					params: { badge: t({ locale: $localeStore, key: beat.badgeKey }) }
				})
	);
	const titleUnlocked = $derived(
		isNullish(beat.titleCharacter)
			? null
			: t({ locale: $localeStore, key: 'motion.title_unlocked' })
	);

	// Eased count-up for the VXP coin chip (cubic ease-out). Reduced-motion
	// users jump straight to the final value — no rAF loop.
	let coinValue = $state(0);

	const cleanups: Array<() => void> = [];

	onMount(() => {
		const to = beat.bonusXp;

		if (to <= 0) {
			coinValue = to;
		} else if (prefersReducedMotion()) {
			coinValue = to;
		} else {
			let raf = 0;
			const dur = 520;
			const t0 = performance.now();

			const step = (now: number) => {
				const p = Math.min(1, (now - t0) / dur);
				coinValue = Math.round(to * (1 - Math.pow(1 - p, 3)));

				if (p < 1) {
					raf = requestAnimationFrame(step);
				}
			};

			raf = requestAnimationFrame(step);
			cleanups.push(() => cancelAnimationFrame(raf));
		}

		// Auto-dismiss after the beat's duration plus a short trail.
		const total = beat.duration_ms + 500;
		const id = setTimeout(onDone, total);

		cleanups.push(() => clearTimeout(id));

		return () => cleanups.forEach((fn) => fn());
	});
</script>

<div
	style="--motion-beat-out-delay: {isAmbient ? 380 : beat.duration_ms}ms"
	class="motion-beat is-center motion-beat-{beat.character}"
	class:is-ambient={isAmbient}
	aria-live="polite"
	role="status"
>
	<div class="motion-beat-inner">
		<div class="motion-beat-char">
			{#if beat.character === 'oracle'}
				<OracleChar animate size={charSize} />
			{:else if beat.character === 'trickster'}
				<TricksterChar animate lightning size={charSize} />
			{:else if beat.character === 'flame'}
				<FlameChar animate size={charSize} stage={flameStage} />
			{:else}
				<ViciChar mood="happy" size={charSize} />
			{/if}
		</div>

		{#if !isAmbient}
			<div class="motion-beat-text">
				<span class="motion-beat-name allcaps">{t({ locale: $localeStore, key: nameKey })}</span>
				{#if nonNullish(copy)}
					<p class="motion-beat-copy serif-italic">{copy}</p>
				{/if}
				{#if coinValue > 0 || nonNullish(treat)}
					<p class="motion-beat-meta">
						{#if coinValue > 0}
							<span class="motion-beat-coin num">
								<span class="coin" aria-hidden="true"></span>+{coinValue} VXP
							</span>
						{/if}
						{#if nonNullish(treat)}
							<span class="motion-beat-treat">{treat}</span>
						{/if}
					</p>
				{/if}
				{#if nonNullish(badge)}
					<span class="motion-beat-badge allcaps">{badge}</span>
				{:else if nonNullish(titleUnlocked)}
					<span class="motion-beat-badge allcaps">{titleUnlocked}</span>
				{:else if nonNullish(sub)}
					<span class="motion-beat-sub allcaps">{sub}</span>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style lang="postcss">
	/* Centered-in-the-gap staging: the REAL character stands LARGE in the
	   empty slot — no pill chrome — with name / copy / chips / sub-label
	   stacked below and a soft radial glow behind. The card-out → gap →
	   next-card-rise sequence is orchestrated by FlowMode; this overlay
	   owns only the in-gap character moment. Global enter/exit keyframes
	   (`motion-beat-in` / `motion-beat-out`) live in `app.css`. */
	.motion-beat {
		position: absolute;
		top: 33%;
		left: 50%;
		transform: translate(-50%, 0);
		z-index: 40;
		pointer-events: none;
		opacity: 0;
		max-width: calc(100% - 2rem);
		/* Reward-moment exception to the no-overshoot rule: a big celebratory
		   springy pop-in replaces the plain center placement, then the
		   standard out-spring carries the character away. */
		animation:
			motion-beat-center-in 540ms cubic-bezier(0.34, 1.62, 0.5, 1) forwards,
			motion-beat-out 320ms ease-in forwards;
		animation-delay: 0s, var(--motion-beat-out-delay, 1100ms);
	}
	@keyframes motion-beat-center-in {
		0% {
			opacity: 0;
			transform: translate(-50%, 22px) scale(0.34);
		}
		46% {
			opacity: 1;
			transform: translate(-50%, -10px) scale(1.16);
		}
		66% {
			transform: translate(-50%, 2px) scale(0.94);
		}
		83% {
			transform: translate(-50%, -3px) scale(1.05);
		}
		100% {
			opacity: 1;
			transform: translate(-50%, 0) scale(1);
		}
	}

	.motion-beat.is-ambient {
		animation:
			motion-beat-in 280ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards,
			motion-beat-out 240ms ease-in forwards;
		animation-delay: 0s, var(--motion-beat-out-delay, 380ms);
	}

	@media (prefers-reduced-motion: reduce) {
		.motion-beat {
			/* Springs collapse to a plain opacity fade — no overshoot, no
			   travel — keeping the centred transform fixed at (-50%, 0). */
			animation:
				motion-beat-rm-in 200ms ease forwards,
				motion-beat-rm-out 200ms ease forwards;
			animation-delay: 0s, var(--motion-beat-out-delay, 1100ms);
		}
		.motion-beat.is-ambient {
			animation-delay: 0s, var(--motion-beat-out-delay, 380ms);
		}
	}
	@keyframes motion-beat-rm-in {
		from {
			opacity: 0;
			transform: translate(-50%, 0);
		}
		to {
			opacity: 1;
			transform: translate(-50%, 0);
		}
	}
	@keyframes motion-beat-rm-out {
		to {
			opacity: 0;
			transform: translate(-50%, 0);
		}
	}

	.motion-beat-inner {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5625rem;
	}

	.motion-beat-char {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.motion-beat-char::before {
		content: '';
		position: absolute;
		left: 50%;
		top: 50%;
		width: 300px;
		height: 300px;
		transform: translate(-50%, -50%);
		z-index: -1;
		border-radius: 50%;
		background: radial-gradient(circle, rgba(226, 184, 66, 0.16), transparent 64%);
	}
	.motion-beat.motion-beat-flame .motion-beat-char::before {
		width: 360px;
		height: 360px;
		background: radial-gradient(circle, rgba(240, 138, 60, 0.22), transparent 64%);
	}
	.motion-beat.motion-beat-trickster .motion-beat-char::before {
		background: radial-gradient(circle, rgba(255, 138, 122, 0.18), transparent 64%);
	}

	/* Lively idle — the character keeps celebrating while it holds the gap.
	   Starts once the pop-in has settled. The flame / trickster reward
	   moments hop harder with a scale pulse on top of the bob + tilt.
	   Ambient pops stay minimal: no continuous celebration loop. */
	.motion-beat:not(.is-ambient) .motion-beat-char {
		animation: beat-char-celebrate 1s ease-in-out 0.46s infinite;
		transform-origin: 50% 80%;
	}
	@keyframes beat-char-celebrate {
		0%,
		100% {
			transform: translateY(0) rotate(0deg);
		}
		20% {
			transform: translateY(-9px) rotate(-4deg);
		}
		40% {
			transform: translateY(-1px) rotate(0deg);
		}
		62% {
			transform: translateY(-6px) rotate(4deg);
		}
		80% {
			transform: translateY(0) rotate(1deg);
		}
	}
	.motion-beat.motion-beat-flame .motion-beat-char,
	.motion-beat.motion-beat-trickster .motion-beat-char {
		animation: beat-char-celebrate-hard 0.82s ease-in-out 0.46s infinite;
	}
	@keyframes beat-char-celebrate-hard {
		0%,
		100% {
			transform: translateY(0) rotate(0deg) scale(1);
		}
		18% {
			transform: translateY(-16px) rotate(-6deg) scale(1.08);
		}
		40% {
			transform: translateY(-2px) rotate(0deg) scale(1);
		}
		64% {
			transform: translateY(-11px) rotate(6deg) scale(1.06);
		}
		82% {
			transform: translateY(-2px) rotate(2deg) scale(1.02);
		}
	}

	/* The radial glow breathes in time with the celebration — reward beats
	   only; ambient pops keep the static glow with no breathing pulse. */
	.motion-beat:not(.is-ambient) .motion-beat-char::before {
		animation: beat-glow-pulse 1s ease-in-out 0.46s infinite;
	}
	@keyframes beat-glow-pulse {
		0%,
		100% {
			opacity: 0.55;
			transform: translate(-50%, -50%) scale(0.92);
		}
		50% {
			opacity: 1;
			transform: translate(-50%, -50%) scale(1.12);
		}
	}

	/* One-shot celebratory shockwave ring that fires once on entrance —
	   reward beats only. Ambient pops never spawn the ring. Tinted to match
	   the character; flame / trickster rings ride larger. */
	.motion-beat:not(.is-ambient) .motion-beat-char::after {
		content: '';
		position: absolute;
		left: 50%;
		top: 50%;
		z-index: -1;
		width: 132px;
		height: 132px;
		border-radius: 50%;
		border: 2px solid color-mix(in srgb, var(--char-oracle) 55%, transparent);
		transform: translate(-50%, -50%) scale(0.3);
		opacity: 0;
		animation: beat-ring 720ms ease-out 0.14s 1;
	}
	.motion-beat.motion-beat-flame .motion-beat-char::after {
		border-color: color-mix(in srgb, var(--char-flame) 60%, transparent);
		width: 160px;
		height: 160px;
	}
	.motion-beat.motion-beat-trickster .motion-beat-char::after {
		border-color: color-mix(in srgb, var(--char-trickster) 55%, transparent);
	}
	@keyframes beat-ring {
		0% {
			opacity: 0.85;
			transform: translate(-50%, -50%) scale(0.3);
		}
		70% {
			opacity: 0.22;
		}
		100% {
			opacity: 0;
			transform: translate(-50%, -50%) scale(2.3);
		}
	}

	/* Reduced-motion gate for the celebratory beat — the overshoot pop-in,
	   lively idle, glow breathing and shockwave ring all collapse to a
	   static state. The plain opacity fade (rm-in / rm-out below) still
	   carries the character in and out without travel or overshoot. */
	@media (prefers-reduced-motion: reduce) {
		.motion-beat:not(.is-ambient) .motion-beat-char,
		.motion-beat:not(.is-ambient) .motion-beat-char::before,
		.motion-beat:not(.is-ambient) .motion-beat-char::after {
			animation: none;
		}
		.motion-beat:not(.is-ambient) .motion-beat-char::after {
			display: none;
		}
	}

	.motion-beat-text {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 5px;
		min-width: 0;
	}

	.motion-beat-name {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.24em;
		color: var(--text-muted);
	}

	.motion-beat-copy {
		margin: 0;
		font-size: 30px;
		line-height: 1.08;
		max-width: 13ch;
		color: var(--color-accent);
	}
	.motion-beat.motion-beat-flame .motion-beat-copy {
		font-size: 34px;
		color: var(--char-flame, #f08a3c);
	}
	.motion-beat.motion-beat-trickster .motion-beat-copy {
		color: var(--char-trickster, #ff8a7a);
	}

	.motion-beat-meta {
		margin: 6px 0 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		flex-wrap: wrap;
	}

	/* Gold coin chip — the VXP grant riding along with the beat. */
	.motion-beat-coin {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-family: var(--font-mono);
		font-weight: 800;
		font-size: var(--text-eyebrow);
		color: #241c08;
		background: #e9c254;
		padding: 3px 9px 3px 6px;
		border-radius: 999px;
		box-shadow: 0 0 0 3px rgba(226, 184, 66, 0.16);
	}
	.motion-beat-coin .coin {
		width: 11px;
		height: 11px;
		border-radius: 50%;
		background: radial-gradient(circle at 35% 30%, #fff5cf, #e2b842 60%, #b8901f);
		box-shadow: inset 0 0 0 1px rgba(120, 90, 15, 0.4);
	}

	/* Coral treat chip — the non-currency wildcard reward. */
	.motion-beat-treat {
		display: inline-flex;
		font-family: var(--font-mono);
		font-weight: 800;
		font-size: var(--text-eyebrow);
		color: #2a1208;
		background: #ff9a8b;
		padding: 3px 10px;
		border-radius: 999px;
	}

	.motion-beat-badge {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 700;
		letter-spacing: 0.14em;
		color: var(--color-accent);
		margin-top: 2px;
	}

	.motion-beat-sub {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 600;
		letter-spacing: 0.14em;
		color: var(--text-muted);
		margin-top: 3px;
	}
</style>
