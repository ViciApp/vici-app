<script lang="ts">
	import { X } from '@lucide/svelte';
	import { fly } from 'svelte/transition';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { prefersReducedMotion } from '#lib/utils/reduced-motion.utils.ts';

	/**
	 * SurfaceTip — a small, non-blocking first-visit tip pinned just above the
	 * floating pillnav. Slides in (respecting `prefers-reduced-motion`),
	 * announces itself as `role="status"` (never modal, never traps focus,
	 * never blocks the content or tab bar below it), and is dismissed via its
	 * lucide `X` button. Copy and the dismiss `aria-label` come from i18n; the
	 * leading accent dot is a styled element, not an emoji.
	 *
	 * Layer 2 of the first-run tutorial system — see `SurfaceTipHost`, which
	 * owns the route gating, the per-surface seen flags, and the analytics.
	 */
	interface Props {
		title: string;
		body: string;
		onDismiss: () => void;
	}

	const { title, body, onDismiss }: Props = $props();

	const enter = $derived(prefersReducedMotion() ? { duration: 0 } : { y: 16, duration: 320 });
	const leave = $derived(prefersReducedMotion() ? { duration: 0 } : { y: 16, duration: 200 });
</script>

<div class="surface-tip" aria-live="polite" role="status" in:fly={enter} out:fly={leave}>
	<span class="surface-tip-dot" aria-hidden="true"></span>
	<div class="surface-tip-body">
		<p class="surface-tip-title">{title}</p>
		<p class="surface-tip-text">{body}</p>
	</div>
	<button
		class="surface-tip-close"
		aria-label={t({ locale: $localeStore, key: 'tip.dismiss.aria' })}
		onclick={onDismiss}
		type="button"
	>
		<X size={16} />
	</button>
</div>

<style lang="postcss">
	/* Anchored just above the floating pillnav (`.pillnav-wrap`:
	   `position: fixed; bottom: 0; z-index: 50`). Sits one notch below it so
	   the tab bar always wins the tap; `pointer-events` are scoped to the card
	   so the surrounding gutter stays click-through. */
	.surface-tip {
		position: fixed;
		left: 14px;
		right: 14px;
		bottom: calc(env(safe-area-inset-bottom, 0px) + 92px);
		z-index: 49;
		display: flex;
		align-items: flex-start;
		gap: 10px;
		max-width: 30rem;
		margin: 0 auto;
		padding: 12px 14px;
		border: 1px solid rgba(242, 236, 220, 0.14);
		border-radius: var(--radius-nav);
		background: rgba(20, 18, 15, 0.86);
		-webkit-backdrop-filter: blur(16px);
		backdrop-filter: blur(16px);
		box-shadow:
			0 18px 32px -16px rgba(0, 0, 0, 0.55),
			inset 0 1px 0 rgba(242, 236, 220, 0.06);
		pointer-events: auto;
	}

	:global([data-theme='light']) .surface-tip {
		background: rgba(250, 247, 235, 0.92);
		border-color: rgba(14, 13, 11, 0.1);
		box-shadow:
			0 18px 32px -16px rgba(14, 13, 11, 0.18),
			inset 0 1px 0 rgba(255, 255, 255, 0.55);
	}

	:global([data-theme='peach']) .surface-tip {
		background: rgba(255, 243, 232, 0.92);
		border-color: rgba(61, 36, 25, 0.12);
		box-shadow:
			0 18px 32px -16px rgba(61, 36, 25, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.45);
	}

	.surface-tip-dot {
		flex: none;
		width: 8px;
		height: 8px;
		margin-top: 5px;
		border-radius: var(--r-pill);
		background: var(--accent, var(--color-primary));
		box-shadow: 0 0 8px rgba(226, 184, 66, 0.55);
	}

	.surface-tip-body {
		flex: 1 1 auto;
		min-width: 0;
	}

	.surface-tip-title {
		margin: 0;
		color: var(--fg, var(--text-base));
		font-size: 0.875rem;
		font-weight: 600;
		line-height: 1.3;
	}

	.surface-tip-text {
		margin: 2px 0 0;
		color: var(--fg-faint, var(--text-muted));
		font-size: 0.8125rem;
		line-height: 1.4;
	}

	.surface-tip-close {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		margin: -2px -4px 0 0;
		appearance: none;
		border: 0;
		border-radius: var(--r-pill);
		background: transparent;
		color: var(--fg-faint, var(--text-muted));
		cursor: pointer;
		transition: color 180ms var(--ease-vici, ease);
	}

	.surface-tip-close:hover {
		color: var(--fg, var(--text-base));
	}

	.surface-tip-close:focus-visible {
		outline: 2px solid var(--accent, var(--color-primary));
		outline-offset: 2px;
	}

	@media (prefers-reduced-motion: reduce) {
		.surface-tip {
			transition: none;
		}
	}
</style>
