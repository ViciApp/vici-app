<script lang="ts">
	import { isNullish } from '@dfinity/utils';
	import { X } from '@lucide/svelte/icons';
	import { notificationKindConfig } from '#lib/constants/notification-kind.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { InboxNotification } from '#lib/types/inbox.ts';
	import { haptic } from '#lib/utils/haptics.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { prefersReducedMotion } from '#lib/utils/reduced-motion.utils.ts';

	/**
	 * NotifRow: a single notification card. Tap the body to open it (deep-link
	 * resolved by the parent), swipe left past the threshold to dismiss, or tap
	 * the unread dot to mark it read in place without navigating away.
	 *
	 * Pointer events cover both touch and mouse-drag. A drag that crossed the
	 * move slop suppresses the tap so swiping never accidentally opens the row.
	 *
	 * A11y: the row-open action and the mark-read dot are two separate real
	 * `<button>`s (never nested), so keyboard and assistive tech see two
	 * distinct controls. The dot is a labelled 28px box that, nudged into the
	 * row's padding, clears a 44px effective target. Decorative icons are
	 * `aria-hidden`.
	 */
	interface Props {
		notification: InboxNotification;
		onOpen: (notification: InboxNotification) => void;
		onDismiss: (notification: InboxNotification) => void;
		onMarkRead: (notification: InboxNotification) => void;
	}

	const { notification, onOpen, onDismiss, onMarkRead }: Props = $props();

	// Swipe geometry mirrors the source: 84px past which a release dismisses,
	// capped at a 132px pull; a right-pull is heavily resisted (×0.18) so the
	// row only ever wants to go left. The exit collapse runs ~230ms.
	const SWIPE_THRESHOLD_PX = 84;
	const MAX_PULL_PX = 132;
	const RIGHT_PULL_RESISTANCE = 0.18;
	const MOVE_SLOP_PX = 4;
	const EXIT_MS = 230;

	const KindIcon = $derived(notificationKindConfig(notification.kind).icon);

	let dx = $state(0);
	let leaving = $state(false);
	let dragging = $state(false);
	let startX: number | undefined;
	let moved = false;

	const armed = $derived(dx <= -SWIPE_THRESHOLD_PX);

	const onPointerDown = (event: PointerEvent) => {
		startX = event.clientX;
		moved = false;
		dragging = true;
		// Capture so move/up are still delivered if the pointer leaves the row
		// mid-swipe; without this a release outside the element strands
		// `dragging`/`startX`/`dx`.
		(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
	};

	const onPointerMove = (event: PointerEvent) => {
		if (isNullish(startX)) {
			return;
		}

		const delta = event.clientX - startX;

		if (Math.abs(delta) > MOVE_SLOP_PX) {
			moved = true;
		}

		dx = delta < 0 ? Math.max(delta, -MAX_PULL_PX) : delta * RIGHT_PULL_RESISTANCE;
	};

	const onPointerUp = (event: PointerEvent) => {
		(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);

		if (isNullish(startX)) {
			return;
		}

		startX = undefined;
		dragging = false;

		if (dx <= -SWIPE_THRESHOLD_PX) {
			leaving = true;
			haptic('firm-tap');

			if (prefersReducedMotion()) {
				onDismiss(notification);

				return;
			}

			setTimeout(() => onDismiss(notification), EXIT_MS);

			return;
		}

		dx = 0;
	};

	const onTap = (event: MouseEvent) => {
		// A drag that crossed the slop suppresses the tap-to-open.
		if (moved) {
			event.preventDefault();

			return;
		}

		onOpen(notification);
	};

	const markRead = (event: MouseEvent) => {
		// Stop the dot tap from bubbling into the row-open action.
		event.stopPropagation();
		haptic('light-tap');
		onMarkRead(notification);
	};
</script>

<div class="notif-swipe" class:is-leaving={leaving}>
	<div class="notif-swipe-bg" class:is-armed={armed} aria-hidden="true">
		<X size={16} strokeWidth={1.8} />
	</div>
	<!-- The swipe container owns the drag gesture (pointer-captured on down so a
	     release outside the row still settles it); the row-open action and the
	     mark-read dot are separate real buttons inside it, never nested. -->
	<div
		style:transform={`translateX(${dx}px)`}
		style:transition={dragging ? 'none' : `transform ${EXIT_MS}ms var(--ease-vici)`}
		class="notif-row"
		class:is-unread={notification.unread}
		onpointercancel={onPointerUp}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		role="presentation"
	>
		<button class="notif-row-action" onclick={onTap} type="button">
			<span class="notif-row-icon" aria-hidden="true">
				<KindIcon size={16} strokeWidth={1.8} />
			</span>
			<span class="notif-row-copy">
				<span class="notif-row-title">{notification.title}</span>
				<span class="notif-row-body">{notification.body}</span>
				<span class="notif-row-when num">{notification.when}</span>
			</span>
		</button>
		{#if notification.unread}
			<button
				class="notif-dot-tap"
				aria-label={t({ locale: $localeStore, key: 'notifications.mark_read_one' })}
				onclick={markRead}
				onpointerdown={(event) => event.stopPropagation()}
				type="button"
			>
				<span class="notif-unread-dot"></span>
			</button>
		{/if}
	</div>
</div>

<style lang="postcss">
	/* Swipe-to-dismiss row + mark-read dot. The armed red wash and the
	   collapse-on-leaving timings are ported 1:1 from the source `.notif-swipe`
	   block; colours are token-based so they adapt across themes. */
	.notif-swipe {
		position: relative;
		border-radius: var(--r-14, 14px);
		overflow: hidden;
		max-height: 200px;
		transition:
			max-height 0.24s var(--ease-vici),
			opacity 0.24s var(--ease-vici),
			margin 0.24s var(--ease-vici);
	}

	.notif-swipe.is-leaving {
		max-height: 0;
		opacity: 0;
		margin-top: -6px;
		pointer-events: none;
	}

	.notif-swipe-bg {
		position: absolute;
		inset: 0;
		border-radius: var(--r-14, 14px);
		background: color-mix(in srgb, var(--color-danger) 16%, transparent);
		display: flex;
		align-items: center;
		justify-content: flex-end;
		padding-right: 20px;
		color: var(--color-danger);
		transition:
			background 0.14s var(--ease-vici),
			color 0.14s var(--ease-vici);
	}

	.notif-swipe-bg.is-armed {
		background: color-mix(in srgb, var(--color-danger) 32%, transparent);
		color: var(--parchment);
	}

	.notif-row {
		position: relative;
		z-index: 1;
		will-change: transform;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.625rem;
		align-items: flex-start;
		width: 100%;
		padding: 0.875rem;
		border-radius: var(--r-14, 14px);
		border: 1px solid var(--border-base);
		background: var(--bg-surface);
		box-shadow: var(--shadow-card);
		color: var(--text-base);
		text-align: left;
		touch-action: pan-y;
	}

	/* The row-open action: an unstyled button that re-creates the original
	   icon + copy grid so the card chrome (border/bg/shadow on `.notif-row`)
	   and the dot stay siblings. */
	.notif-row-action {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.625rem;
		align-items: flex-start;
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		appearance: none;
		cursor: pointer;
	}

	.notif-row.is-unread {
		border-color: color-mix(in srgb, var(--accent) 30%, var(--border-base));
		background:
			linear-gradient(
				color-mix(in srgb, var(--accent) 5.5%, transparent),
				color-mix(in srgb, var(--accent) 5.5%, transparent)
			),
			var(--bg-surface);
	}

	.notif-row-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		flex: 0 0 auto;
		border-radius: var(--r-8, 8px);
		background: color-mix(in srgb, var(--parchment) 6%, transparent);
		color: var(--accent);
	}

	.notif-row-copy {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}

	.notif-row-title {
		font-size: var(--t-13);
		font-weight: 600;
		color: var(--text-base);
	}

	.notif-row-body {
		font-size: var(--t-12);
		color: var(--text-muted);
	}

	.notif-row-when {
		margin-top: 0.125rem;
		font-size: var(--t-11);
		color: var(--text-muted);
	}

	/* 28×28 tap zone, nudged into the row's padding so the effective target
	   (zone + surrounding padding) clears the 44px minimum. */
	.notif-dot-tap {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		margin: -6px -8px 0 0;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: none;
		appearance: none;
		flex: 0 0 auto;
		cursor: pointer;
	}

	.notif-dot-tap:hover {
		background: color-mix(in srgb, var(--accent) 12%, transparent);
	}

	.notif-unread-dot {
		width: 7px;
		height: 7px;
		border-radius: var(--r-pill, 999px);
		background: var(--accent);
	}

	@media (prefers-reduced-motion: reduce) {
		.notif-swipe {
			transition: none;
		}
	}
</style>
