<script lang="ts">
	import { ArrowLeft, Bell } from '@lucide/svelte/icons';
	import { onMount } from 'svelte';
	import NotifRow from '#lib/components/ui/NotifRow.svelte';
	import { notificationDestination } from '#lib/constants/notification-kind.constants.ts';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { track } from '#lib/services/analytics.services.ts';
	import { refreshFriendRelations } from '#lib/stores/friends.store.ts';
	import {
		combinedInboxStore,
		dismissInboxNotification,
		markAllInboxRead,
		markInboxRead
	} from '#lib/stores/inbox.store.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { InboxNotification } from '#lib/types/inbox.ts';
	import { haptic } from '#lib/utils/haptics.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { goBack, resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { goto } from '$app/navigation';

	const unread = $derived($combinedInboxStore.filter((item) => item.unread));
	const earlier = $derived($combinedInboxStore.filter((item) => !item.unread));
	const hasUnread = $derived(unread.length > 0);

	// Tap router: mark the card read, then deep-link to its market when one is
	// attached (`mid`), otherwise fall back to the kind's home surface — a
	// single source via `notificationDestination`. `goto` takes the raw string
	// because the market path is dynamic.
	const open = (notification: InboxNotification) => {
		markInboxRead(notification.id);
		track({ name: 'notification_opened', label: notification.kind });
		void goto(
			notificationDestination({
				kind: notification.kind,
				mid: notification.mid,
				href: notification.href
			})
		);
	};

	const dismiss = (notification: InboxNotification) => {
		dismissInboxNotification(notification.id);
		haptic('light-tap');
	};

	const markRead = (notification: InboxNotification) => {
		markInboxRead(notification.id);
	};

	const markAll = () => {
		markAllInboxRead();
		haptic('firm-tap');
	};

	onMount(() => {
		void refreshFriendRelations();
	});
</script>

<div class="notifications-page">
	<header class="notifications-appbar">
		<!-- Centered title with a text-only ghost back control on the left and a
		     ghost Mark-all-read on the right. Back returns to Flow. -->
		<button
			class="appbar-icon-btn"
			aria-label={t({ locale: $localeStore, key: 'notifications.back_flow' })}
			onclick={() => goBack(resolveAppPath(AppPath.Flow))}
			type="button"
		>
			<ArrowLeft aria-hidden="true" size={18} strokeWidth={1.8} />
		</button>
		<h1 class="notifications-title">{t({ locale: $localeStore, key: 'notifications.title' })}</h1>
		<!-- Rendered unconditionally so the layout doesn't reflow; disabled (and
		     dimmed) when there is nothing unread. -->
		<button
			class="notifications-mark-read allcaps"
			disabled={!hasUnread}
			onclick={markAll}
			type="button"
		>
			{t({ locale: $localeStore, key: 'notifications.mark_read' })}
		</button>
	</header>

	{#if $combinedInboxStore.length === 0}
		<!-- Polished empty state — dashed surface with serif-italic headline.
		     The bell icon is faint by design (no event to draw the eye). -->
		<div class="notifications-empty" aria-live="polite" role="status">
			<Bell class="notifications-empty-icon" aria-hidden="true" size={28} strokeWidth={1.4} />
			<p class="notifications-empty-title serif-italic">
				{t({ locale: $localeStore, key: 'notifications.empty.title' })}
			</p>
			<p class="notifications-empty-body">
				{t({ locale: $localeStore, key: 'notifications.empty.body' })}
			</p>
		</div>
	{:else}
		<div class="notifications-list">
			{#if unread.length > 0}
				<div class="notifications-section-head">
					<span class="eyebrow notifications-section-label is-new">
						{t({ locale: $localeStore, key: 'notifications.section.new' })}
					</span>
					<span class="num notifications-section-count">{unread.length}</span>
				</div>
				{#each unread as notification (notification.id)}
					<NotifRow {notification} onDismiss={dismiss} onMarkRead={markRead} onOpen={open} />
				{/each}
			{/if}

			{#if earlier.length > 0}
				<div class="notifications-section-head" class:has-spacer={unread.length > 0}>
					<span class="eyebrow notifications-section-label">
						{t({ locale: $localeStore, key: 'notifications.section.earlier' })}
					</span>
					<span class="num notifications-section-count">{earlier.length}</span>
				</div>
				{#each earlier as notification (notification.id)}
					<NotifRow {notification} onDismiss={dismiss} onMarkRead={markRead} onOpen={open} />
				{/each}
			{/if}
		</div>
	{/if}
</div>

<style lang="postcss">
	.notifications-page {
		padding: 0 1.25rem 6rem;
	}

	.notifications-appbar {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 0.5rem;
		padding: 0.25rem 0 1rem;
	}

	.notifications-title {
		margin: 0;
		font-size: var(--t-18);
		font-weight: 600;
		text-align: center;
		color: var(--text-base);
	}

	/* Text-only ghost — `btn btn-ghost t-eyebrow` appbar variant. */
	.notifications-mark-read {
		appearance: none;
		padding: 0.375rem 0.625rem;
		border: 0;
		background: transparent;
		font: inherit;
		font-size: var(--t-10);
		font-weight: 700;
		letter-spacing: var(--tracking-allcaps);
		color: var(--text-muted);
		cursor: pointer;
		transition: color var(--d-hover) var(--ease-vici);
	}

	.notifications-mark-read:not(:disabled):hover {
		color: var(--text-base);
	}

	.notifications-mark-read:disabled {
		cursor: default;
		opacity: 0.4;
	}

	.notifications-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		margin: 0;
		padding: 0;
	}

	/* Section header — `New` / `Earlier` eyebrow plus a count badge. The
	   Earlier head gets extra top padding when it sits below the New group. */
	.notifications-section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.125rem 0.125rem 0.25rem;
	}

	.notifications-section-head.has-spacer {
		padding-top: 0.875rem;
	}

	.notifications-section-label.is-new {
		color: var(--accent);
	}

	.notifications-section-count {
		font-size: var(--t-10);
		color: var(--text-muted);
	}

	.notifications-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 2.5rem 1.5rem;
		border: 1px dashed var(--border-base);
		border-radius: var(--r-12);
		background: transparent;
		text-align: center;
	}

	.notifications-empty :global(.notifications-empty-icon) {
		color: var(--parchment-faint);
		margin-bottom: 0.25rem;
	}

	.notifications-empty-title {
		margin: 0;
		font-size: var(--t-18);
		color: var(--text-base);
	}

	.notifications-empty-body {
		margin: 0;
		max-width: 24rem;
		font-size: var(--t-13);
		line-height: 1.55;
		color: var(--text-muted);
	}
</style>
