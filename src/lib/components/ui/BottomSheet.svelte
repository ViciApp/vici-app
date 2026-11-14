<script lang="ts">
	import type { Snippet } from 'svelte';
	import { pinToVisualViewport } from '#lib/actions/pin-to-visual-viewport.ts';
	import SheetFooter from '#lib/components/ui/SheetFooter.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { createFocusTrap, type FocusTrap } from '#lib/utils/focus-trap.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { browser } from '$app/env';

	/**
	 * Bottom-sheet primitive: full-width sheet docked at the bottom of
	 * the viewport with a grip handle, blurred backdrop, and safe-area
	 * inset. Used by the leagues / worlds / battles surfaces in place of
	 * the centred {@link Modal} when a sheet treatment fits better.
	 *
	 * The component manages chrome only (scrim, grip, close affordance
	 * via `Escape` + backdrop click). Children own their own header
	 * copy + body layout: keep them short enough that the sheet doesn't
	 * exceed `max-height: 92vh`.
	 *
	 * Custom (non-native-dialog) sheet, so focus management is manual:
	 * `createFocusTrap` moves initial focus into the sheet on open,
	 * cycles Tab/Shift+Tab inside, and returns focus to the trigger on
	 * close. Native `<dialog>` users (see `Dialog.svelte`) get the same
	 * behaviour from the browser.
	 */
	interface Props {
		isOpen: boolean;
		children: Snippet;
		onClose: () => void;
		/**
		 * Per-sheet horizontal padding (CSS length) overriding the default
		 * side inset. Hosts that need a tighter design metric (e.g. the
		 * league create / join sheets at 22px) pass it here; every other
		 * sheet keeps the shared default by leaving it unset.
		 */
		sidePadding?: string;
		/**
		 * Optional non-scrolling footer pinned to the bottom of the sheet.
		 * Rendered through {@link SheetFooter} as a `flex-shrink: 0` sibling
		 * after the scrolling `.sheet-body`, so a primary CTA stays in view
		 * no matter how long the body grows; the body scrolls under it. The
		 * footer carries the docked-footer bottom inset itself (safe area +
		 * iOS bottom bar, via `--docked-footer-inset`); the sheet's own
		 * bottom inset collapses to the side metric when a footer is present
		 * so the inset isn't doubled. Leave unset for the legacy single-
		 * scroller layout (body owns the bottom inset).
		 */
		footer?: Snippet;
		/**
		 * Re-anchor the sheet as a centred modal card on ≥768px viewports:
		 * full rounded border, zoom-in entrance instead of a slide-up, grip
		 * hidden. Phone widths keep the standard bottom-docked treatment.
		 * One set of content, switched purely in CSS, for confirm-style
		 * surfaces that read better centred on desktop.
		 */
		desktopCentered?: boolean;
		/**
		 * `id` of a heading inside the sheet, wired to `aria-labelledby` on
		 * the dialog. Leave unset when the children carry no single title.
		 */
		labelledBy?: string;
	}

	const { isOpen, children, onClose, sidePadding, footer, desktopCentered, labelledBy }: Props =
		$props();

	let sheetEl = $state<HTMLDivElement | undefined>();
	let trap: FocusTrap | null = null;

	const close = () => {
		onClose();
	};

	const handleKeyDown = (event: KeyboardEvent) => {
		if (isOpen && event.key === 'Escape') {
			close();
		}
	};

	$effect(() => {
		if (!browser) {
			return;
		}

		if (isOpen && sheetEl) {
			trap = createFocusTrap(sheetEl);
			trap.activate();
		} else if (trap) {
			trap.deactivate();
			trap = null;
		}

		return () => {
			if (trap) {
				trap.deactivate();
				trap = null;
			}
		};
	});
</script>

<svelte:window onkeydown={handleKeyDown} />

{#if isOpen}
	<div
		class="sheet-scrim"
		class:desktop-centered={desktopCentered}
		aria-label={t({ locale: $localeStore, key: 'a11y.close_modal' })}
		onclick={close}
		onkeydown={(e) => e.key === 'Escape' && close()}
		role="presentation"
		use:pinToVisualViewport
	>
		<div
			bind:this={sheetEl}
			style:--sheet-side-padding={sidePadding}
			class="sheet"
			class:desktop-centered={desktopCentered}
			class:has-footer={Boolean(footer)}
			aria-labelledby={labelledBy}
			aria-modal="true"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => {
				// Keys are swallowed so outer surfaces stay inert while the sheet
				// is open, which also keeps Escape from the `svelte:window`
				// listener (focus lives inside the sheet via the trap), so close
				// on it here.
				e.stopPropagation();

				if (e.key === 'Escape') {
					close();
				}
			}}
			role="dialog"
			tabindex="-1"
		>
			<div class="sheet-grip" aria-hidden="true"></div>
			<div class="sheet-body">
				{@render children()}
			</div>
			{#if footer}
				<SheetFooter base="0px">
					{@render footer()}
				</SheetFooter>
			{/if}
		</div>
	</div>
{/if}

<style lang="postcss">
	:global(body:has(.sheet)) {
		overflow: hidden;
	}

	/* Hide the floating mobile pill-nav (`.pillnav-wrap`, fixed bottom,
	 * z-index 50) whenever a sheet is open. It sits at the same lower
	 * edge as the sheet and clips the actions row on short viewports
	 * (e.g. with the soft keyboard open), and isn't usable from inside
	 * a modal flow anyway. */
	:global(body:has(.sheet) .pillnav-wrap) {
		display: none;
	}

	.sheet-scrim {
		position: fixed;
		/* `use:pinToVisualViewport` sizes this to the *actually-visible* region
		 * (inline `top`/`left`/`width`/`height` from `window.visualViewport`),
		 * which is the only reliable measure on iOS. A fixed `inset: 0` resolves
		 * against the *large* layout viewport (toolbars retracted) and iOS Chrome
		 * doesn't honour `100dvh`, so the sheet, docked at this scrim's bottom
		 * via `flex-end`, would land behind the bottom toolbar and clip its CTA.
		 * `visualViewport.height` also excludes the on-screen keyboard, so
		 * the same pin lifts the sheet above the keyboard; no `--kb-inset`
		 * needed. The `100dvh`/`100vh` here is the desktop / no-`visualViewport`
		 * fallback. */
		top: 0;
		left: 0;
		right: 0;
		height: 100vh; /* fallback for engines without `dvh` / visualViewport */
		height: 100dvh;
		z-index: 80;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		align-items: center;
		background: rgba(14, 13, 11, 0.62);
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
		animation: friend-sheet-fade-in var(--d-state) ease-out both;
	}

	.sheet {
		display: flex;
		flex-direction: column;
		width: 100%;
		max-width: 32rem;
		/* Fill at most 92% of the scrim so the grip + body stay within the
		 * visible area and the body scrolls inside. `%` resolves against the
		 * scrim, which always has a definite height, the inline `visualViewport`
		 * pin (which also shrinks it when the keyboard opens) or the `100dvh` /
		 * `100vh` CSS fallback, so no `dvh`/`vh` cap is needed here (and a `dvh`
		 * cap would be wrong on iOS Chrome, which doesn't honour it). */
		max-height: 92%;
		/* Side inset defaults to the shared 1.1rem; hosts can override just
		 * the horizontal padding via `--sheet-side-padding` (the `sidePadding`
		 * prop) without disturbing the top / safe-area-bottom metrics. */
		padding: 0.5rem var(--sheet-side-padding, 1.1rem) calc(1.1rem + var(--docked-footer-inset));
		background: var(--bg-popover);
		border-top: 1px solid var(--border-base);
		border-top-left-radius: 22px;
		border-top-right-radius: 22px;
		box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.4);
		animation: friend-sheet-slide-up 280ms var(--ease-vici) both;
	}

	/* Desktop-centred variant: re-anchor the same panel to the viewport
	 * centre with a full rounded card and a zoom-in entrance rather than
	 * a slide-up. The grip handle is a bottom-sheet affordance only. */
	@media (min-width: 768px) {
		.sheet-scrim.desktop-centered {
			justify-content: center;
			padding: 1rem;
		}

		.sheet.desktop-centered {
			max-width: 28rem;
			max-height: 90vh; /* fallback for engines without `dvh` */
			max-height: 90dvh;
			padding: 1.5rem;
			border: 1px solid var(--border-base);
			border-radius: 12px;
			box-shadow: var(--shadow-modal);
			animation: sheet-zoom-in 200ms var(--ease-vici) both;
		}

		.sheet.desktop-centered .sheet-grip {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.sheet-scrim,
		.sheet,
		.sheet.desktop-centered {
			animation: none;
		}
	}

	@keyframes sheet-zoom-in {
		from {
			opacity: 0;
			transform: scale(0.96);
		}
	}

	.sheet-grip {
		align-self: center;
		width: 36px;
		height: 4px;
		margin: 0.25rem 0 0.7rem;
		border-radius: var(--r-pill);
		background: color-mix(in srgb, var(--text-muted) 50%, transparent);
	}

	.sheet-body {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		/* A scroll container clips on BOTH axes (`overflow-x` can't stay
		 * `visible` once `overflow-y` is `auto`), which shears off any glow /
		 * shadow a child paints past the body's left or right edge: e.g. the
		 * menagerie badge aura in the achievement detail sheet. Reclaim the
		 * side-inset metric as bleed room: widen the scroll container by
		 * `--sheet-side-padding` per side and re-apply the same metric as
		 * padding, so content lands exactly where it did but the clip boundary
		 * moves outward by that amount. (On the desktop-centered variant the
		 * sheet padding is 1.5rem, so the body stops short of the sheet edge:
		 * the bleed room is still the full side-inset metric.) */
		margin-inline: calc(-1 * var(--sheet-side-padding, 1.1rem));
		padding-inline: var(--sheet-side-padding, 1.1rem);
	}

	/* When a `footer` snippet is present the safe-area bottom inset moves
	 * onto the docked `SheetFooter` (the element actually at the edge), so
	 * drop it from the sheet's own padding to avoid doubling the gap. The
	 * footer re-applies it via `--docked-footer-inset`. */
	.sheet.has-footer {
		padding-bottom: 1.1rem;
	}
</style>
