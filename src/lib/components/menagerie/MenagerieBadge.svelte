<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import {
		MENAGERIE_BY_SLUG,
		MENAGERIE_PALETTES,
		MENAGERIE_WARM_SLUGS,
		type MenagerieSlug,
		type MenagerieTier
	} from '#lib/constants/menagerie.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { menagerieTierFor, type MenagerieStats } from '#lib/utils/menagerie.utils.ts';

	// The trophy-layer badge primitive: a squircle frame + per-animal aura + the
	// animal glyph (from <MenagerieSprite>), at any size / tier. A locked badge
	// desaturates the glyph and shows a small lock mark — the "soon" state.
	interface Props {
		slug: MenagerieSlug;
		/** Explicit tier. When omitted and `stats` is given, derived live. */
		tier?: MenagerieTier | null;
		/** Owner stats — used to derive the tier when `tier` is not passed. */
		stats?: MenagerieStats;
		/** Square edge length in px. */
		size?: number;
		/** Force the locked / "soon" state (overrides the resolved tier). */
		locked?: boolean;
		/** Show the small lock glyph when locked. */
		showLock?: boolean;
		/** Extra class on the badge root. */
		class?: string;
	}

	const {
		slug,
		tier,
		stats,
		size = 120,
		locked = false,
		showLock = true,
		class: className = ''
	}: Props = $props();

	const animal = $derived(MENAGERIE_BY_SLUG.get(slug));

	// Resolve tier: explicit prop > derived from stats > null (locked).
	const resolvedTier = $derived.by((): MenagerieTier | null => {
		if (nonNullish(tier)) {
			return tier;
		}

		if (stats) {
			return menagerieTierFor({ slug, stats });
		}

		return null;
	});

	const isLocked = $derived(locked || isNullish(resolvedTier));
	const isHero = $derived(animal?.hero === true);
	// Warm-bodied animals lose edge on the peach theme — flag them so the badge
	// frame deepens to keep them legible.
	const isWarm = $derived(MENAGERIE_WARM_SLUGS.has(slug));
	const auraColor = $derived(MENAGERIE_PALETTES[slug]?.body ?? 'var(--text-base)');

	const ariaLabel = $derived.by((): string => {
		const name = animal ? t({ locale: $localeStore, key: animal.nameKey }) : slug;

		if (isLocked || isNullish(resolvedTier)) {
			return t({ locale: $localeStore, key: 'menagerie.badge.aria_locked', params: { name } });
		}

		const tierName = t({
			locale: $localeStore,
			key: `menagerie.tier.${resolvedTier}` as const
		});

		return t({
			locale: $localeStore,
			key: 'menagerie.badge.aria_earned',
			params: { name, tier: tierName }
		});
	});
</script>

{#if animal}
	<div
		style:--mb-size="{size}px"
		class="mbadge {className}"
		class:mb-gold={!isLocked && resolvedTier === 'gold'}
		class:mb-hero={isHero}
		class:mb-irid={!isLocked && resolvedTier === 'irid'}
		class:mb-locked={isLocked}
		class:mb-silver={!isLocked && resolvedTier === 'silver'}
		class:mb-warm={isWarm}
		class:mb-wood={!isLocked && resolvedTier === 'wood'}
		aria-label={ariaLabel}
		role="img"
	>
		{#if !isLocked}
			<div style:background={auraColor} class="mb-aura"></div>
		{/if}
		<div class="mb-frame"></div>
		<svg class="mb-animal" aria-hidden="true" viewBox="0 0 100 100">
			<use href="#menagerie-{slug}"></use>
		</svg>
		{#if isLocked && showLock}
			<div class="mb-lockmark" aria-hidden="true">
				<svg
					fill="none"
					stroke="currentColor"
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2.4"
					viewBox="0 0 24 24"
				>
					<rect height="10" rx="2" width="16" x="4" y="11"></rect>
					<path d="M8 11V7a4 4 0 0 1 8 0v4"></path>
				</svg>
			</div>
		{/if}
	</div>
{/if}

<style lang="postcss">
	.mbadge {
		position: relative;
		width: var(--mb-size, 120px);
		height: var(--mb-size, 120px);
		display: grid;
		place-items: center;
		flex: none;
	}

	.mbadge svg.mb-animal {
		width: calc(var(--mb-size, 120px) * 0.65);
		height: calc(var(--mb-size, 120px) * 0.65);
		position: relative;
		z-index: 2;
		overflow: visible;
	}

	.mb-frame {
		position: absolute;
		inset: 0;
		border-radius: calc(var(--mb-size, 120px) * 0.25);
		z-index: 1;
		background: linear-gradient(160deg, rgba(242, 236, 220, 0.07), rgba(242, 236, 220, 0.015));
		box-shadow:
			inset 0 0 0 1.5px rgba(242, 236, 220, 0.16),
			inset 0 2px 0 rgba(242, 236, 220, 0.1),
			0 10px 26px -14px rgba(0, 0, 0, 0.7);
		border: 1px solid rgba(242, 236, 220, 0.05);
	}

	.mb-aura {
		position: absolute;
		inset: -6px;
		border-radius: calc(var(--mb-size, 120px) * 0.28);
		z-index: 0;
		filter: blur(11px);
		opacity: 0.55;
	}

	/* ── Tier frames ── */
	.mbadge.mb-wood .mb-frame {
		box-shadow:
			inset 0 0 0 2px #9a6a3e,
			inset 0 2px 0 rgba(242, 236, 220, 0.08),
			0 10px 24px -14px rgba(0, 0, 0, 0.7);
	}

	.mbadge.mb-silver .mb-frame {
		box-shadow:
			inset 0 0 0 2px #b8bcc4,
			inset 0 2px 0 rgba(255, 255, 255, 0.2),
			0 10px 24px -14px rgba(0, 0, 0, 0.7);
	}

	.mbadge.mb-gold .mb-frame {
		box-shadow:
			inset 0 0 0 2.5px var(--laurel, #e2b842),
			inset 0 2px 0 rgba(255, 255, 255, 0.22),
			0 12px 28px -12px rgba(226, 184, 66, 0.4);
	}

	.mbadge.mb-irid .mb-frame {
		box-shadow: 0 12px 30px -10px rgba(120, 91, 196, 0.45);
		background:
			linear-gradient(160deg, rgba(242, 236, 220, 0.1), rgba(242, 236, 220, 0.02)) padding-box,
			conic-gradient(from 200deg, #e2b842, #4fd3a1, #6b9fff, #9e4e84, #e2b842) border-box;
		border: 2.5px solid transparent;
	}

	.mbadge.mb-hero .mb-frame::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		box-shadow: inset 0 0 22px -6px rgba(255, 255, 255, 0.18);
	}

	/* ── Idle tier motion: gold + iridescent get a slow specular sweep; irid also
	   shifts its rainbow border's hue; gold breathes. Wood / silver stay calm,
	   locked never animates. Reduced-motion kills all of it (bottom of file). */
	.mbadge.mb-gold .mb-frame::before,
	.mbadge.mb-irid .mb-frame::before {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		pointer-events: none;
		z-index: 1;
		background: linear-gradient(
			120deg,
			transparent 40%,
			rgba(255, 255, 255, 0.5) 50%,
			transparent 60%
		);
		background-size: 300% 100%;
		background-position: 130% 0;
		opacity: 0.55;
		mix-blend-mode: screen;
		animation: mb-shine 6s ease-in-out infinite;
	}

	.mbadge.mb-irid .mb-frame::before {
		animation-delay: 1.7s;
		opacity: 0.7;
	}

	@keyframes mb-shine {
		0% {
			background-position: 130% 0;
		}
		22% {
			background-position: -30% 0;
		}
		100% {
			background-position: -30% 0;
		}
	}

	.mbadge.mb-irid .mb-frame {
		animation: mb-irid-hue 7s linear infinite;
	}

	@keyframes mb-irid-hue {
		to {
			filter: hue-rotate(360deg);
		}
	}

	.mbadge.mb-gold .mb-frame {
		animation: mb-gold-breathe 5.5s ease-in-out infinite;
	}

	@keyframes mb-gold-breathe {
		0%,
		100% {
			box-shadow:
				inset 0 0 0 2.5px var(--laurel, #e2b842),
				inset 0 2px 0 rgba(255, 255, 255, 0.22),
				0 12px 28px -12px rgba(226, 184, 66, 0.4);
		}
		50% {
			box-shadow:
				inset 0 0 0 2.5px var(--laurel, #e2b842),
				inset 0 2px 0 rgba(255, 255, 255, 0.28),
				0 14px 34px -12px rgba(226, 184, 66, 0.6);
		}
	}

	/* ── Locked / "soon" ── */
	.mbadge.mb-locked svg.mb-animal {
		filter: grayscale(1) brightness(0.42);
		opacity: 0.5;
	}

	.mbadge.mb-locked .mb-frame {
		box-shadow:
			inset 0 0 0 1.5px rgba(242, 236, 220, 0.1),
			0 8px 20px -16px rgba(0, 0, 0, 0.6);
		background: rgba(242, 236, 220, 0.02);
	}

	.mb-lockmark {
		position: absolute;
		z-index: 3;
		right: 8%;
		bottom: 8%;
		width: 26%;
		height: 26%;
		min-width: 16px;
		min-height: 16px;
		border-radius: 50%;
		background: #16140f;
		border: 1px solid rgba(242, 236, 220, 0.14);
		display: grid;
		place-items: center;
		color: rgba(242, 236, 220, 0.5);
	}

	.mb-lockmark svg {
		width: 56%;
		height: 56%;
	}

	/* ── Light / peach theme frame strokes ── */
	:global([data-theme='light']) .mb-frame {
		box-shadow:
			inset 0 0 0 1.5px rgba(14, 13, 11, 0.16),
			inset 0 2px 0 rgba(255, 255, 255, 0.5),
			0 8px 20px -14px rgba(14, 13, 11, 0.4);
		background: linear-gradient(160deg, rgba(14, 13, 11, 0.04), transparent);
		border-color: rgba(14, 13, 11, 0.05);
	}

	:global([data-theme='peach']) .mb-frame {
		box-shadow:
			inset 0 0 0 1.5px rgba(61, 36, 25, 0.18),
			inset 0 2px 0 rgba(255, 255, 255, 0.55),
			0 8px 20px -14px rgba(61, 36, 25, 0.4);
		background: linear-gradient(160deg, rgba(61, 36, 25, 0.05), transparent);
		border-color: rgba(61, 36, 25, 0.06);
	}

	/* Warm-bodied animals lose edge on peach — deepen aura + stroke. */
	:global([data-theme='peach']) .mbadge.mb-warm .mb-aura {
		opacity: 0.8;
		filter: blur(9px);
		inset: -3px;
	}

	:global([data-theme='peach']) .mbadge.mb-warm .mb-frame {
		box-shadow:
			inset 0 0 0 2px rgba(61, 36, 25, 0.28),
			inset 0 2px 0 rgba(255, 255, 255, 0.55),
			0 8px 20px -14px rgba(61, 36, 25, 0.45);
	}

	@media (prefers-reduced-motion: reduce) {
		.mbadge .mb-frame::before,
		.mbadge.mb-irid .mb-frame,
		.mbadge.mb-gold .mb-frame {
			animation: none !important;
		}
	}
</style>
