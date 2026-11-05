<script lang="ts">
	import { isNullish } from '@dfinity/utils';
	import { X } from '@lucide/svelte/icons';
	import { onMount } from 'svelte';
	import {
		notificationDestination,
		notificationKindConfig
	} from '#lib/constants/notification-kind.constants.ts';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { track } from '#lib/services/analytics.services.ts';
	import {
		clearInboxToast,
		initInboxProgress,
		initInboxToasts,
		latestInboxToast
	} from '#lib/stores/inbox.store.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { goto } from '$app/navigation';

	/**
	 * NotifToastHost — slides a toast in from the top of the app shell when a
	 * genuinely NEW inbox item arrives (driven by `latestInboxToast`, which
	 * diffs live inbox snapshots — see `inbox.store.ts`). It auto-dismisses
	 * after a short dwell, can be tapped to open the item's destination, and
	 * carries a dismiss button.
	 *
	 * A11y: `role="status"` so assistive tech announces the arriving
	 * notification; the dismiss control is a labelled `<button>`. Decorative
	 * icons are `aria-hidden`. The icon resolves through the shared
	 * `NOTIFICATION_KIND_CONFIG` so the toast never drifts from the list rows.
	 */

	// Dwell windows mirror the source: begin the exit animation a beat before
	// the toast is removed so the `notif-pop-out` keyframe can play out.
	const VISIBLE_MS = 4600;
	const REMOVE_MS = 5000;
	const EXIT_MS = 360;

	let leaving = $state(false);
	let dwellTimer: ReturnType<typeof setTimeout> | undefined;
	let removeTimer: ReturnType<typeof setTimeout> | undefined;
	let exitTimer: ReturnType<typeof setTimeout> | undefined;

	const clearTimers = () => {
		if (dwellTimer) {
			clearTimeout(dwellTimer);
		}

		if (removeTimer) {
			clearTimeout(removeTimer);
		}

		if (exitTimer) {
			clearTimeout(exitTimer);
		}
	};

	// Arm the auto-dismiss whenever a new toast lands. Re-running on toast
	// identity change resets the dwell so a rapid second arrival gets its
	// full window.
	$effect(() => {
		const toast = $latestInboxToast;

		clearTimers();
		leaving = false;

		if (isNullish(toast)) {
			return;
		}

		dwellTimer = setTimeout(() => {
			leaving = true;
		}, VISIBLE_MS);

		removeTimer = setTimeout(() => {
			clearInboxToast();
		}, REMOVE_MS);

		return clearTimers;
	});

	// Start the arrival-toast diff and the streak/level progress-marker
	// maintenance on mount, unsubscribe both on destroy, so they only run
	// while the host is rendered (not at module scope).
	onMount(() => {
		const stopToasts = initInboxToasts();
		const stopProgress = initInboxProgress();

		return () => {
			stopToasts();
			stopProgress();
		};
	});

	const open = () => {
		// The destination may be a dynamic path (e.g. `/markets/<id>` when the
		// toast deep-links to a market), so we route through `goto` with the
		// raw string rather than the typed `resolve`.
		const toast = $latestInboxToast;
		clearInboxToast();

		if (isNullish(toast)) {
			void goto(AppPath.Notifications);

			return;
		}

		track({ name: 'notification_opened', label: toast.kind });
		void goto(notificationDestination({ kind: toast.kind, mid: toast.mid, href: toast.href }));
	};

	const dismiss = () => {
		leaving = true;
		exitTimer = setTimeout(() => {
			clearInboxToast();
		}, EXIT_MS);
	};
</script>

{#if $latestInboxToast}
	{@const toast = $latestInboxToast}
	{@const KindIcon = notificationKindConfig(toast.kind).icon}
	<div class="notif-pop" class:is-leaving={leaving} role="status">
		<!-- The card body is a button so the whole toast is tappable; the
		     dismiss control sits outside it to keep its own hit target. -->
		<button class="notif-pop-open" onclick={open} type="button">
			<span class="notif-pop-ic" aria-hidden="true">
				<KindIcon size={16} strokeWidth={1.8} />
			</span>
			<span class="notif-pop-text">
				<span class="notif-pop-title">{toast.title}</span>
				<span class="notif-pop-body">{toast.body}</span>
			</span>
		</button>
		<button
			class="notif-pop-x"
			aria-label={t({ locale: $localeStore, key: 'notifications.dismiss' })}
			onclick={dismiss}
			type="button"
		>
			<X aria-hidden="true" size={14} strokeWidth={1.8} />
		</button>
	</div>
{/if}

<style lang="postcss">
	/* Slide-in popup pinned below the safe-area top inset, spanning the
	   shell width. `notif-pop-in` / `notif-pop-out` are global keyframes in
	   `app.css` (the only notif styles that must be global). */
	.notif-pop {
		position: fixed;
		top: calc(env(safe-area-inset-top, 0px) + 8px);
		left: 12px;
		right: 12px;
		z-index: 70;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 11px 4px 11px 12px;
		background: var(--bg-elevated, var(--bg-surface));
		border: 1px solid var(--border-strong);
		border-radius: var(--r-14, 14px);
		box-shadow: 0 18px 44px -14px rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		animation: notif-pop-in 380ms cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	.notif-pop.is-leaving {
		animation: notif-pop-out 340ms var(--ease-vici, ease) both;
	}

	/* Centre the toast on wider viewports so it doesn't stretch edge to
	   edge — the shell content column is mobile-width. With both `left`
	   and `right` insets set, `margin-inline: auto` centres the capped
	   width without a `translateX`, leaving the `translateY` slide-in
	   keyframe free of transform conflicts. */
	@media (min-width: 32rem) {
		.notif-pop {
			max-width: 26rem;
			margin-inline: auto;
		}
	}

	.notif-pop-open {
		display: flex;
		align-items: center;
		gap: 12px;
		flex: 1;
		min-width: 0;
		padding: 0;
		background: transparent;
		border: 0;
		text-align: left;
		cursor: pointer;
	}

	.notif-pop-ic {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		flex: 0 0 auto;
		border-radius: var(--r-8, 9px);
		background: color-mix(in srgb, var(--color-primary) 14%, transparent);
		color: var(--color-primary);
	}

	.notif-pop-text {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
		flex: 1;
	}

	.notif-pop-title {
		font-size: 13.5px;
		font-weight: 600;
		color: var(--text-base);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.notif-pop-body {
		font-size: 12px;
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.notif-pop-x {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 auto;
		padding: 7px;
		border: 0;
		border-radius: var(--r-8, 8px);
		background: transparent;
		color: var(--fg-faint, var(--text-muted));
		cursor: pointer;
		transition:
			color 160ms var(--ease-vici, ease),
			background-color 160ms var(--ease-vici, ease);
	}

	.notif-pop-x:hover {
		color: var(--text-base);
		background: color-mix(in srgb, var(--text-base) 6%, transparent);
	}

	@media (prefers-reduced-motion: reduce) {
		.notif-pop,
		.notif-pop.is-leaving {
			animation: none;
		}
	}
</style>
