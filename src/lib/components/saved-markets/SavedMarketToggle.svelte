<script lang="ts">
	import { Eye, Heart } from '@lucide/svelte/icons';
	import { PublicPath } from '#lib/constants/routes.constants.ts';
	import { userSignedIn } from '#lib/derived/user.derived.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import {
		isMarketSaved,
		preferencesStore,
		toggleSavedMarket
	} from '#lib/stores/preferences.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	type ToggleSize = 'sm' | 'md';
	type ToggleIcon = 'heart' | 'eye';
	type ToggleVariant = 'pill' | 'flow-ghost' | 'header-ghost';

	interface Props {
		/** Market id to bookmark / unbookmark. */
		marketId: string;
		/** Visual size variant.
		 *
		 *  - `sm` (default): compact 28×28 px circle, intended for inline
		 *    use in card headers.
		 *  - `md`: 36×36 px pill, intended for prominent app-bar slots
		 *    (see `MarketDetailHeader`).
		 */
		size?: ToggleSize;
		/** Glyph used for the affordance.
		 *
		 *  - `heart` (default): the bookmark heart used on market cards.
		 *  - `eye`: a "watch this market" eye, used in the detail
		 *    header where the control reads as add-to-watchlist.
		 */
		icon?: ToggleIcon;
		/** Treatment variant.
		 *
		 *  - `pill` (default): bordered laurel pill; the saved state fills
		 *    with the laurel wash.
		 *  - `flow-ghost`: borderless square (8 px radius) that sits flush
		 *    in a dense action row; transparent until hovered, and the
		 *    saved heart turns pink rather than laurel so it reads as a
		 *    personal watchlist mark next to the neutral share control
		 *    (see `FlowBackHeader`).
		 *  - `header-ghost`: the faint header icon-button look that sits
		 *    as one set with the back chevron and share control on the
		 *    detail app-bar (rounded rect, foreground wash + border); the
		 *    saved state reads via the laurel accent (see the market
		 *    detail page).
		 */
		variant?: ToggleVariant;
		/** Hard-stop the click from bubbling to a parent clickable surface
		 *  (e.g. a `<Card>` that navigates on click). Defaults to `true`
		 *  because both current call sites need it and forgetting is a
		 *  silent bug. */
		stopPropagation?: boolean;
	}

	const {
		marketId,
		size = 'sm',
		icon = 'heart',
		variant = 'pill',
		stopPropagation = true
	}: Props = $props();

	const saved = $derived(isMarketSaved({ marketId, prefs: $preferencesStore }));

	const onClick = (e: MouseEvent) => {
		if (stopPropagation) {
			e.stopPropagation();
		}

		// `/markets` and `/markets/[id]` are public surfaces; an anonymous
		// visitor tapping the heart should be routed to signin instead of
		// writing to an unattached `preferencesStore` whose value can't
		// persist back to a profile.
		if (!$userSignedIn) {
			void goto(resolve(PublicPath.SignIn));

			return;
		}

		toggleSavedMarket({ marketId });
	};

	const onKeydown = (e: KeyboardEvent) => {
		if (stopPropagation) {
			e.stopPropagation();
		}
	};
</script>

<!-- Shared save-toggle primitive used by FlowBackHeader, the
     Market detail app-bar, and any future surface that wants the same
     "save this market" affordance. The glyph (heart / eye) and treatment
     (pill / flow-ghost / header-ghost) are props, but the save logic,
     label, and aria are owned here so call sites can't drift on copy or
     behaviour. -->
<button
	class={['saved-market-toggle', `size-${size}`, `variant-${variant}`, saved && 'is-saved']}
	aria-label={t({ locale: $localeStore, key: saved ? 'card.unsave' : 'card.save' })}
	aria-pressed={saved}
	onclick={onClick}
	onkeydown={onKeydown}
	type="button"
>
	<span class="saved-market-icon">
		{#if icon === 'eye'}
			<Eye aria-hidden="true" size={size === 'md' ? 16 : 14} strokeWidth={1.8} />
		{:else}
			<Heart
				aria-hidden="true"
				fill={saved ? 'currentColor' : 'none'}
				size={size === 'md' ? 16 : 14}
				strokeWidth={2}
			/>
		{/if}
	</span>
</button>

<style lang="postcss">
	.saved-market-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--border-base);
		border-radius: var(--r-pill);
		color: color-mix(in srgb, var(--text-muted) 80%, transparent);
		cursor: pointer;
		transition:
			background-color var(--d-hover) var(--ease-vici),
			border-color var(--d-hover) var(--ease-vici),
			color var(--d-hover) var(--ease-vici);
	}

	.saved-market-toggle:hover {
		border-color: color-mix(in srgb, var(--laurel) 40%, transparent);
		color: var(--laurel);
	}

	.saved-market-toggle.is-saved {
		border-color: color-mix(in srgb, var(--laurel) 40%, transparent);
		background: var(--laurel-glow);
		color: var(--laurel);
	}

	.size-sm {
		width: 1.75rem;
		height: 1.75rem;
	}

	.size-md {
		width: 2.25rem;
		height: 2.25rem;
		background: color-mix(in srgb, var(--bg-surface) 84%, transparent);
		color: var(--text-muted);
	}

	/* Flow-ghost treatment: a borderless 8 px-radius square that reads
	   as a neutral icon affordance until interacted with. Saved state
	   turns the heart pink so a watchlisted card is unmistakable next to
	   the neutral share control in the dense flow-back action row. Keeps
	   the square `.size-*` footprint. */
	.variant-flow-ghost {
		border: 1px solid transparent;
		border-radius: var(--r-8);
		background: transparent;
		color: var(--text-muted);
	}
	.variant-flow-ghost:hover {
		border-color: transparent;
		background: color-mix(in srgb, var(--parchment) 6%, transparent);
		color: var(--text-base);
	}
	.variant-flow-ghost.is-saved {
		border-color: transparent;
		background: transparent;
		color: #ff6b8a;
	}

	/* Header-ghost treatment: the faint header icon-button look that
	   matches the back chevron and share control on the detail app-bar.
	   The fill is a foreground wash so it adapts across themes (dark /
	   light / peach) rather than a hardcoded dark-only rgba. Drops the
	   fixed square footprint in favour of the icon-button padding so it
	   reads as a rounded rect, not a circle. */
	.variant-header-ghost {
		width: auto;
		height: auto;
		padding: 8px 10px;
		border-radius: var(--r-12);
		background: color-mix(in srgb, var(--text-base) 6%, transparent);
		color: var(--text-base);
	}

	.variant-header-ghost:hover {
		border-color: var(--border-strong);
		background: color-mix(in srgb, var(--text-base) 11%, transparent);
		color: var(--text-base);
	}

	/* Saved state keeps the laurel accent so "watching" stays legible,
	   in the ghost idiom (subtle laurel wash + border, no full pill). */
	.variant-header-ghost.is-saved {
		border-color: color-mix(in srgb, var(--laurel) 40%, transparent);
		background: var(--laurel-glow);
		color: var(--laurel);
	}

	/* Heart-pop envelope on save toggle: visual punch that
	   substitutes for the haptic on iOS Safari (Vibration API
	   absent there). */
	.saved-market-icon {
		display: inline-flex;
	}
	.saved-market-toggle.is-saved .saved-market-icon {
		animation: heart-pop var(--d-enter) cubic-bezier(0.22, 1, 0.36, 1) both;
	}
	.saved-market-toggle:active {
		transform: scale(0.92);
	}

	@media (prefers-reduced-motion: reduce) {
		.saved-market-toggle.is-saved .saved-market-icon {
			animation: none;
		}
		.saved-market-toggle:active {
			transform: none;
		}
	}
</style>
