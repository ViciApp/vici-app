<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import MenagerieBadge from '#lib/components/menagerie/MenagerieBadge.svelte';
	import {
		MENAGERIE_BY_SLUG,
		type MenagerieSlug,
		type MenagerieTier
	} from '#lib/constants/menagerie.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { haptic } from '#lib/utils/haptics.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { menagerieConceptKey, menagerieTierColor } from '#lib/utils/menagerie.utils.ts';
	import { prefersReducedMotion } from '#lib/utils/reduced-motion.utils.ts';

	// The celebration moment. A freshly-crossed Menagerie tier: the backdrop dims
	// and blooms in the animal's colour, the badge springs in, the achievement is
	// named, then on dismiss the badge FLIES into the Profile nav (which pulses
	// to confirm it landed). One reveal at a time; the host advances the queue
	// via `onDone`. It NEVER mounts while a Flow character beat is on screen; the
	// host gates that.
	interface Props {
		slug: MenagerieSlug;
		tier: MenagerieTier;
		/** Called after the fly-to-nav lands: the host advances the queue. */
		onDone: () => void;
	}

	const { slug, tier, onDone }: Props = $props();

	const animal = $derived(MENAGERIE_BY_SLUG.get(slug));
	const tierColor = $derived(menagerieTierColor(tier));
	const isHero = $derived(animal?.hero === true);
	const isTop = $derived(tier === 'gold' || tier === 'irid');
	const conceptKey = $derived(menagerieConceptKey({ slug, tier }));

	// phase: 'in' (spring + content) → 'flying' (badge travels to nav) → done.
	let phase = $state<'in' | 'flying'>('in');
	let badgeWrap = $state<HTMLDivElement | null>(null);
	let flyEl = $state<HTMLDivElement | null>(null);

	let done = false;
	const finish = (): void => {
		if (done) {
			return;
		}

		done = true;
		onDone();
	};

	// Tracked timers so unmount mid-flight never fires a stray callback / haptic.
	const timers: ReturnType<typeof setTimeout>[] = [];
	const after = ({ ms, run }: { ms: number; run: () => void }): void => {
		timers.push(setTimeout(run, ms));
	};

	// Entrance haptics: punctuate the spring-in. Richer for top tiers so a gold /
	// iridescent unlock is felt as a layered flourish, mirroring the session-end
	// celebration. Gated on motion preference like every other animation here.
	onMount(() => {
		if (prefersReducedMotion()) {
			return;
		}

		haptic('firm-tap'); // badge impact
		// spring settles
		after({ ms: 560, run: () => haptic(isTop ? 'milestone-tap' : 'double-pulse') });
	});

	// Safety auto-advance if the reveal is left open a long time: never traps.
	onMount(() => {
		after({ ms: 9000, run: () => dismiss() });
	});

	onDestroy(() => {
		for (const id of timers) {
			clearTimeout(id);
		}
	});

	// Dismiss → fly the badge into the Profile nav item.
	const dismiss = (): void => {
		if (phase !== 'in' || done) {
			return;
		}

		const navBtn =
			document.querySelector<HTMLElement>('[data-nav="profile"]') ??
			document.querySelector<HTMLElement>('.pillnav-wrap');

		if (!badgeWrap || !navBtn) {
			finish();

			return;
		}

		const source = badgeWrap.getBoundingClientRect();
		const target = navBtn.getBoundingClientRect();
		const dx = target.left + target.width / 2 - (source.left + source.width / 2);
		const dy = target.top + target.height / 2 - (source.top + source.height / 2);

		if (flyEl) {
			flyEl.style.setProperty('--fly-dx', `${dx}px`);
			flyEl.style.setProperty('--fly-dy', `${dy}px`);
		}

		phase = 'flying';

		if (prefersReducedMotion()) {
			// No fly animation under reduced motion: pulse the nav and finish.
			navBtn.classList.add('nav-collect-pulse');
			haptic(isTop ? 'milestone-tap' : 'firm-tap');
			after({
				ms: 360,
				run: () => {
					navBtn.classList.remove('nav-collect-pulse');
					finish();
				}
			});

			return;
		}

		// Pulse the nav + haptic as the badge LANDS (aligned to the fly arrival),
		// so "caught it" is seen and felt together.
		after({
			ms: 500,
			run: () => {
				navBtn.classList.add('nav-collect-pulse');
				haptic(isTop ? 'milestone-tap' : 'firm-tap');
			}
		});
		after({
			ms: 950,
			run: () => {
				navBtn.classList.remove('nav-collect-pulse');
				finish();
			}
		});
	};

	const eyebrowKey = $derived(
		isHero && isTop ? 'menagerie.reveal.legendary' : 'menagerie.reveal.unlocked'
	);
</script>

{#if animal}
	<div
		class="mr-root mr-{phase}"
		aria-label={t({
			locale: $localeStore,
			key: 'menagerie.reveal.aria',
			params: { name: t({ locale: $localeStore, key: animal.nameKey }) }
		})}
		aria-modal="true"
		role="dialog"
	>
		<!-- backdrop: a dark celebratory takeover in every theme -->
		<button
			class="mr-scrim"
			aria-label={t({ locale: $localeStore, key: 'menagerie.reveal.dismiss' })}
			onclick={dismiss}
			type="button"
		></button>

		<!-- colour bloom keyed to the animal -->
		<div
			style:background="radial-gradient(circle at center, var(--menagerie-{slug}) 0%, transparent
			62%)"
			class="mr-bloom"
		></div>

		{#if isTop}
			<div style:--ray={tierColor} class="mr-rays"></div>
		{/if}

		<div class="mr-stage">
			<div bind:this={flyEl} class="mr-badge-fly">
				<div bind:this={badgeWrap} class="mr-badge-wrap">
					<div class="mr-sparkles" aria-hidden="true">
						{#each [0, 1, 2, 3, 4, 5, 6] as i (i)}
							<i style:--i={i}></i>
						{/each}
					</div>
					<MenagerieBadge size={132} {slug} {tier} />
				</div>
			</div>

			<div class="mr-content">
				<div style:color={tierColor} class="mr-eyebrow">
					{t({ locale: $localeStore, key: eyebrowKey })}
				</div>
				<div class="mr-name">{t({ locale: $localeStore, key: animal.nameKey })}</div>
				<div class="mr-tierline">
					<span style:background={tierColor} class="mr-tier-dot"></span>
					<span style:color={tierColor}>
						{t({ locale: $localeStore, key: `menagerie.tier.${tier}` as const })}
					</span>
					{#if conceptKey}
						<span class="mr-concept">{t({ locale: $localeStore, key: conceptKey })}</span>
					{/if}
				</div>
				<div class="mr-oracle">
					“{t({ locale: $localeStore, key: animal.oracleKey })}”
				</div>
				<p class="mr-rule">{t({ locale: $localeStore, key: animal.ruleKey })}</p>
			</div>
		</div>

		<div class="mr-hint">{t({ locale: $localeStore, key: 'menagerie.reveal.hint' })}</div>
	</div>
{/if}

<style lang="postcss">
	/*
		The reveal is a celebratory takeover whose surfaces are driven by a local
		`--mr-*` token set: scrim, the foreground tiers (`--mr-fg` / `-dim` /
		`-mute`), and the badge-frame wash. The dark theme keeps the original
		near-black takeover; the light / peach overrides at the bottom of the
		block re-point those tokens so the celebration reads as a LIGHT takeover
		(otherwise the on-dark text looked blacked-out against the warm canvas).
		The colour bloom / rays use `mix-blend-mode: screen`, which the per-theme
		blend overrides keep legible either way.
	*/
	.mr-root {
		position: fixed;
		inset: 0;
		z-index: 200;
		display: grid;
		place-items: center;
		/* reserve the bottom-nav band so centered content never lands on it */
		padding-bottom: 88px;
		overflow: hidden;

		/* Dark-theme defaults: the near-black takeover. */
		--mr-scrim: rgba(10, 9, 8, 0.88);
		--mr-fg: #f2ecdc;
		--mr-fg-dim: rgba(242, 236, 220, 0.74);
		--mr-fg-mute: rgba(242, 236, 220, 0.52);
		--mr-border: rgba(242, 236, 220, 0.18);
		--mr-spark: #f2ecdc;
		--mr-frame-fill-a: rgba(242, 236, 220, 0.07);
		--mr-frame-fill-b: rgba(242, 236, 220, 0.015);
		--mr-frame-border: rgba(242, 236, 220, 0.05);
	}

	.mr-scrim {
		position: absolute;
		inset: 0;
		appearance: none;
		border: 0;
		padding: 0;
		cursor: pointer;
		background: var(--mr-scrim);
		backdrop-filter: blur(16px);
		-webkit-backdrop-filter: blur(16px);
		animation: mr-scrim-in 0.45s ease both;
	}

	@keyframes mr-scrim-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.mr-bloom {
		position: absolute;
		width: 150%;
		aspect-ratio: 1;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -58%) scale(0.4);
		opacity: 0;
		pointer-events: none;
		mix-blend-mode: screen;
		filter: blur(8px);
		animation: mr-bloom-in 1.1s cubic-bezier(0.16, 1, 0.3, 1) 0.08s forwards;
	}

	@keyframes mr-bloom-in {
		0% {
			opacity: 0;
			transform: translate(-50%, -58%) scale(0.35);
		}
		55% {
			opacity: 0.58;
		}
		100% {
			opacity: 0.42;
			transform: translate(-50%, -58%) scale(1);
		}
	}

	.mr-rays {
		position: absolute;
		top: 50%;
		left: 50%;
		width: 130%;
		aspect-ratio: 1;
		transform: translate(-50%, -58%);
		pointer-events: none;
		opacity: 0.5;
		background: repeating-conic-gradient(
			from 0deg at 50% 50%,
			var(--ray, #e2b842) 0deg 2deg,
			transparent 2deg 16deg
		);
		-webkit-mask: radial-gradient(circle at center, transparent 26%, #000 32%, transparent 62%);
		mask: radial-gradient(circle at center, transparent 26%, #000 32%, transparent 62%);
		mix-blend-mode: screen;
		animation:
			mr-rays-spin 22s linear infinite,
			mr-scrim-in 0.8s ease both;
	}

	@keyframes mr-rays-spin {
		to {
			transform: translate(-50%, -58%) rotate(360deg);
		}
	}

	.mr-stage {
		position: relative;
		z-index: 2;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 0 32px;
		text-align: center;
		/* let taps fall through to the full-screen scrim button so the whole
		   surface dismisses: "tap anywhere" */
		pointer-events: none;
	}

	.mr-badge-fly {
		--fly-dx: 0px;
		--fly-dy: 0px;
		will-change: transform, opacity;
	}

	.mr-in .mr-badge-fly {
		animation: mr-badge-spring 0.8s cubic-bezier(0.2, 1.25, 0.4, 1) both;
	}

	@keyframes mr-badge-spring {
		0% {
			opacity: 0;
			transform: scale(0.2) rotate(-14deg);
		}
		60% {
			opacity: 1;
		}
		100% {
			opacity: 1;
			transform: scale(1) rotate(0deg);
		}
	}

	.mr-flying .mr-badge-fly {
		animation: mr-badge-fly 0.62s cubic-bezier(0.5, 0, 0.75, 0.2) forwards;
	}

	@keyframes mr-badge-fly {
		0% {
			transform: translate(0, 0) scale(1);
			opacity: 1;
		}
		18% {
			transform: translate(0, -16px) scale(1.06);
			opacity: 1;
		}
		82% {
			transform: translate(var(--fly-dx), var(--fly-dy)) scale(0.16);
			opacity: 0.92;
		}
		100% {
			transform: translate(var(--fly-dx), var(--fly-dy)) scale(0.11);
			opacity: 0;
		}
	}

	.mr-badge-wrap {
		position: relative;
		display: grid;
		place-items: center;
		margin-bottom: 16px;
	}

	.mr-in .mr-badge-wrap {
		animation: mr-float 4s ease-in-out 1s infinite;
	}

	@keyframes mr-float {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-6px);
		}
	}

	.mr-sparkles {
		position: absolute;
		inset: -18px;
		pointer-events: none;
	}

	.mr-sparkles i {
		position: absolute;
		top: 50%;
		left: 50%;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--mr-spark);
		opacity: 0;
		transform: rotate(calc(var(--i) * 51.4deg)) translateX(0);
		animation: mr-spark 1.4s ease-out calc(0.5s + var(--i) * 0.06s) infinite;
	}

	@keyframes mr-spark {
		0% {
			opacity: 0;
			transform: rotate(calc(var(--i) * 51.4deg)) translateX(60px) scale(0.3);
		}
		35% {
			opacity: 1;
		}
		100% {
			opacity: 0;
			transform: rotate(calc(var(--i) * 51.4deg)) translateX(108px) scale(1);
		}
	}

	.mr-content {
		animation: mr-content-in 0.6s ease 0.28s both;
	}

	.mr-flying .mr-content {
		animation: mr-content-out 0.35s ease forwards;
	}

	@keyframes mr-content-in {
		from {
			opacity: 0;
			transform: translateY(14px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes mr-content-out {
		to {
			opacity: 0;
			transform: translateY(10px);
		}
	}

	.mr-eyebrow {
		font-family: var(--font-mono);
		font-size: 11px;
		letter-spacing: 0.22em;
		font-weight: 600;
	}

	.mr-name {
		font-size: 30px;
		font-weight: 600;
		letter-spacing: -0.02em;
		margin-top: 8px;
		color: var(--mr-fg);
	}

	.mr-tierline {
		display: inline-flex;
		align-items: center;
		gap: 9px;
		margin-top: 8px;
		font-family: var(--font-mono);
		font-size: 11px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.mr-tier-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
	}

	.mr-concept {
		color: var(--mr-fg-dim);
		padding-left: 9px;
		border-left: 1px solid var(--mr-border);
	}

	.mr-oracle {
		font-family: var(--font-serif, Georgia, serif);
		font-style: italic;
		font-size: 15px;
		color: var(--mr-fg-dim);
		margin-top: 10px;
	}

	.mr-rule {
		font-size: 13px;
		line-height: 1.5;
		color: var(--mr-fg-mute);
		max-width: 320px;
		margin: 8px auto 0;
	}

	.mr-hint {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 104px;
		z-index: 2;
		pointer-events: none;
		text-align: center;
		font-size: 11px;
		letter-spacing: 0.04em;
		color: var(--mr-fg-mute);
		opacity: 0.7;
		animation: mr-hint-in 0.6s ease 0.6s both;
	}

	@keyframes mr-hint-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 0.7;
		}
	}

	.mr-flying .mr-hint {
		animation: mr-hint-out 0.3s ease forwards;
	}

	@keyframes mr-hint-out {
		to {
			opacity: 0;
		}
	}

	/* nav item pulse when the badge lands: applied imperatively to the nav btn */
	:global(.nav-collect-pulse) {
		animation: nav-collect 0.55s cubic-bezier(0.2, 1.2, 0.4, 1);
	}

	@keyframes nav-collect {
		0% {
			transform: scale(1);
		}
		40% {
			transform: scale(1.32);
		}
		100% {
			transform: scale(1);
		}
	}

	/* Badge frame inside the reveal: driven by the same `--mr-*` tokens so it
	   tracks the takeover's tone (a light wash on dark, a soft ink wash on the
	   light / peach takeover). */
	.mr-root :global(.mb-frame) {
		background: linear-gradient(160deg, var(--mr-frame-fill-a), var(--mr-frame-fill-b));
		border: 1px solid var(--mr-frame-border);
	}

	/*
		Light / peach takeover. The scrim becomes a warm light wash and the
		foreground tiers / CTA flip to ink so the celebration reads on-light
		instead of blacked-out. The colour bloom / rays use `mix-blend-mode:
		screen` (designed for a dark base); on a light scrim that lightens to
		near-nothing, so we swap them to `multiply` to keep the animal's colour
		readable as a tint.
	*/
	:global([data-theme='light']) .mr-root,
	:global([data-theme='peach']) .mr-root {
		--mr-scrim: rgba(250, 246, 234, 0.9);
		--mr-fg: var(--text-base);
		--mr-fg-dim: var(--fg-dim);
		--mr-fg-mute: var(--text-muted);
		--mr-border: var(--border-strong);
		--mr-spark: var(--laurel-deep);
		--mr-frame-fill-a: rgba(61, 36, 25, 0.05);
		--mr-frame-fill-b: rgba(61, 36, 25, 0.012);
		--mr-frame-border: rgba(61, 36, 25, 0.06);
	}

	:global([data-theme='peach']) .mr-root {
		--mr-scrim: rgba(255, 234, 217, 0.92);
	}

	:global([data-theme='light']) .mr-bloom,
	:global([data-theme='peach']) .mr-bloom,
	:global([data-theme='light']) .mr-rays,
	:global([data-theme='peach']) .mr-rays {
		mix-blend-mode: multiply;
	}

	@media (prefers-reduced-motion: reduce) {
		.mr-bloom,
		.mr-rays,
		.mr-sparkles,
		.mr-in .mr-badge-wrap {
			animation: none !important;
		}

		.mr-in .mr-badge-fly {
			animation: mr-scrim-in 0.3s ease both;
		}
	}
</style>
