<script lang="ts">
	import { Bell } from '@lucide/svelte/icons';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { combinedInboxUnreadCount } from '#lib/stores/inbox.store.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { goto } from '$app/navigation';

	/**
	 * NotifBell: bell button + unread red-dot badge. Drop into any header;
	 * tapping it opens the Notifications inbox. The badge tracks the real
	 * `combinedInboxUnreadCount` (settled events + friend requests + seed
	 * history) and collapses to `9+` past nine so it never stretches the bar.
	 *
	 * A11y: a real `<button>` with an `aria-label` that announces the live
	 * unread count. The numeric badge itself is `aria-hidden` (the count is
	 * already in the label) and carries `aria-live` so assistive tech is told
	 * when fresh notifications arrive while the bell is on screen.
	 *
	 * `light` tints the icon cream so the bell reads on a dark hero band
	 * (the muted token disappears against those surfaces).
	 */
	interface Props {
		/** Render the bell in its cream variant: for placement over a dark
		 *  scrim (e.g. the profile hero's translucent control disc) where the
		 *  muted-text default would read too dim. */
		light?: boolean;
	}

	const { light = false }: Props = $props();

	const count = $derived($combinedInboxUnreadCount);
	const badge = $derived(count > 9 ? '9+' : String(count));

	const openNotifications = () => {
		void goto(resolveAppPath(AppPath.Notifications));
	};
</script>

<button
	class="notif-bell"
	class:is-light={light}
	aria-label={count > 0
		? t({ locale: $localeStore, key: 'a11y.notifications_unread', params: { count } })
		: t({ locale: $localeStore, key: 'a11y.notifications' })}
	onclick={openNotifications}
	type="button"
>
	<Bell aria-hidden="true" size={18} strokeWidth={1.7} />
	{#if count > 0}
		<span class="notif-bell-dot num" aria-hidden="true" aria-live="polite">{badge}</span>
	{/if}
</button>

<style lang="postcss">
	/* Mirrors the source `.notif-bell` / `.notif-dot`: a 36px ghost icon
	   button with a danger-coloured count pip pinned top-right, ringed by the
	   page background so it reads cleanly over any header. The dot's
	   entrance keyframe (`notif-dot-in`) is global in `app.css`. */
	.notif-bell {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: var(--r-10, 10px);
		color: var(--text-muted);
		background: transparent;
		cursor: pointer;
		transition:
			color 160ms var(--ease-vici, ease),
			background-color 160ms var(--ease-vici, ease);
	}

	.notif-bell:hover {
		color: var(--text-base);
		background: color-mix(in srgb, var(--text-base) 6%, transparent);
	}

	/* Cream variant: sits on the profile hero's translucent disc, over a dark
	   scrim, so it ignores the theme's muted-text default and stays legible. */
	.notif-bell.is-light {
		color: var(--parchment);
	}

	.notif-bell.is-light:hover {
		color: var(--parchment);
		background: color-mix(in srgb, var(--parchment) 14%, transparent);
	}

	.notif-bell-dot {
		position: absolute;
		top: 3px;
		right: 3px;
		min-width: 15px;
		height: 15px;
		padding: 0 3px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--r-pill);
		background: var(--no);
		color: var(--color-danger-foreground);
		font-size: 9px;
		font-weight: 700;
		line-height: 1;
		letter-spacing: 0;
		box-shadow: 0 0 0 2px var(--bg-base);
		animation: notif-dot-in 280ms cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	@media (prefers-reduced-motion: reduce) {
		.notif-bell-dot {
			animation: none;
		}
	}
</style>
