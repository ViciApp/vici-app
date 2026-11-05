<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import { onMount } from 'svelte';
	import ArenaStandingHero from '#lib/components/arena/ArenaStandingHero.svelte';
	import FriendsTab from '#lib/components/arena/FriendsTab.svelte';
	import BattlesInboxPage from '#lib/components/pages/BattlesInboxPage.svelte';
	import LeaguesPage from '#lib/components/pages/LeaguesPage.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';
	import { browser } from '$app/env';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	/**
	 * Arena — the three-tab page (Friends / Leagues /
	 * Battles) that anchors every cohort surface. Each tab embeds the
	 * existing page component with `embedded={true}` so their own
	 * appbars stay quiet. The page leads with the standing hero (its
	 * own eyebrow carries the context, e.g. GLOBAL RANK) directly above
	 * the tab strip — there's no page-title header.
	 *
	 * Friends is the default tab: entering /arena *without* `?tab=` (nav
	 * click, cold load, a bare bookmark) always opens Friends. Selecting a
	 * tab mirrors it into the URL via `replaceState` (see `selectTab`), so
	 * `?tab=` then acts as the tab pointer: `history.back()` from a
	 * drill-down (e.g. a battle opened off the Battles tab) restores the
	 * originating tab, and a reload/bookmark/share of the current URL
	 * reopens it (see `focusTabKey`). The tab is never written to storage —
	 * it lives only in the URL, so a fresh `/arena` always resets to Friends.
	 */

	type Tab = 'friends' | 'leagues' | 'battles';

	const TAB_LABEL_KEY: Record<Tab, MessageKey> = {
		friends: 'arena.tabs.friends',
		leagues: 'arena.tabs.leagues',
		battles: 'arena.tabs.battles'
	};

	let activeTab: Tab = $state('friends');

	// A `friend_request` inbox notification deep-links to
	// `/arena?request=<relationId>` (see `inbox.store.ts`). When present it
	// forces the Friends tab and `FriendsTab` scrolls the matching row into
	// view, so the recipient lands on the Accept affordance.
	const focusRequestKey = $derived(page.url.searchParams.get('request') ?? undefined);

	const isTab = (value: string | null): value is Tab =>
		value === 'friends' || value === 'leagues' || value === 'battles';

	// A back-nav fallback can target a specific tab via `/arena?tab=battles`
	// (e.g. closing a battle opened from a cold/deep link). It outranks the
	// Friends default, but a friend-request deep link still wins.
	const focusTabKey = $derived.by((): Tab | undefined => {
		const tab = page.url.searchParams.get('tab');

		return isTab(tab) ? tab : undefined;
	});

	onMount(() => {
		if (!browser) {
			return;
		}

		// A friend-request deep link forces Friends; otherwise a `?tab=`
		// back-nav target wins. Absent both, `activeTab` keeps its Friends
		// default — entry into Arena always opens Friends.
		if (nonNullish(focusRequestKey)) {
			activeTab = 'friends';

			return;
		}

		if (nonNullish(focusTabKey)) {
			activeTab = focusTabKey;
		}
	});

	// Catch a deep-link that arrives via client-side navigation (tapping the
	// inbox toast while already on /arena), where `onMount` won't re-run.
	$effect(() => {
		if (nonNullish(focusRequestKey)) {
			activeTab = 'friends';
		}
	});

	// Same catch for a `?tab=` deep-link arriving via client-side navigation.
	// A friend-request deep link still outranks it (matching onMount), so bail
	// while one is forcing the Friends tab.
	$effect(() => {
		if (nonNullish(focusRequestKey)) {
			return;
		}

		if (nonNullish(focusTabKey)) {
			activeTab = focusTabKey;
		}
	});

	const TABS: readonly Tab[] = ['friends', 'leagues', 'battles'] as const;

	// Switch tab and mirror it into the URL (`?tab=`) without a navigation, so
	// `history.back()` from a drill-down lands back on the tab it was opened
	// from. A one-shot `request` focus is dropped on the way — keeping it would
	// re-force Friends via the deep-link effect and trap the user there.
	const selectTab = (tab: Tab) => {
		activeTab = tab;

		if (!browser) {
			return;
		}

		const url = new URL(page.url.href);
		url.searchParams.set('tab', tab);
		url.searchParams.delete('request');
		goto(url, { shallow: true, replace: true, state: page.state });
	};
</script>

<div class="arena-page">
	<ArenaStandingHero onSelectTab={selectTab} />

	<div class="arena-tabs" aria-label="Arena sections" role="tablist">
		{#each TABS as tab (tab)}
			<button
				class="arena-tab"
				class:is-active={activeTab === tab}
				aria-selected={activeTab === tab}
				onclick={() => selectTab(tab)}
				role="tab"
				type="button"
			>
				{t({ locale: $localeStore, key: TAB_LABEL_KEY[tab] })}
			</button>
		{/each}
	</div>

	<div class="arena-panel" role="tabpanel">
		<!-- Defend against malformed / legacy profile data: a single friend
		     row with an out-of-shape value could throw while rendering the
		     active tab. Because the app is `ssr=false`, an unhandled throw
		     escalates to the SvelteKit client error page (full-screen 500).
		     The boundary keeps any residual data-shape failure inline so the
		     rest of the Arena shell (hero + tab strip) stays usable. -->
		<svelte:boundary>
			{#if activeTab === 'friends'}
				<FriendsTab {focusRequestKey} />
			{:else if activeTab === 'leagues'}
				<LeaguesPage embedded />
			{:else if activeTab === 'battles'}
				<BattlesInboxPage embedded />
			{/if}

			{#snippet failed(_error, reset)}
				<div class="arena-boundary" role="alert">
					<p class="arena-boundary-title">
						{t({ locale: $localeStore, key: 'arena.boundary.title' })}
					</p>
					<p class="arena-boundary-body">
						{t({ locale: $localeStore, key: 'arena.boundary.body' })}
					</p>
					<button class="arena-boundary-retry" onclick={reset} type="button">
						{t({ locale: $localeStore, key: 'arena.boundary.retry' })}
					</button>
				</div>
			{/snippet}
		</svelte:boundary>
	</div>
</div>

<style lang="postcss">
	.arena-page {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		/* No page-title header: the standing hero leads the page, so a small
		   top inset keeps it off the chrome. The scroll viewport already
		   reserves bottom-nav clearance (`--bn-clear`), so no extra
		   padding-bottom is needed here. */
		padding: 0.5rem 1.25rem 0;
	}

	/* Segmented-control tab strip: the container carries a tinted
	   surface + border + radius; each tab flexes to share the row;
	   the active one looks like a raised pill (bg-elevated + soft
	   inset highlight + shadow). */
	.arena-tabs {
		display: flex;
		gap: 4px;
		padding: 3px;
		background: color-mix(in srgb, var(--text-base) 5%, transparent);
		border: 1px solid var(--border-base);
		border-radius: 10px;
	}

	.arena-tab {
		appearance: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: 1;
		/* ≥44px tap target on the segmented tab control. */
		min-height: 44px;
		padding: 0.55rem 0.75rem;
		font: inherit;
		font-size: var(--t-13);
		font-weight: 500;
		color: var(--text-muted);
		background: transparent;
		border: 0;
		border-radius: 7px;
		cursor: pointer;
		white-space: nowrap;
		transition:
			background-color var(--d-state) cubic-bezier(0.22, 1, 0.36, 1),
			color var(--d-state) cubic-bezier(0.22, 1, 0.36, 1);
	}

	.arena-tab:hover {
		color: var(--text-base);
	}

	.arena-tab.is-active {
		color: var(--text-base);
		background: var(--bg-popover);
		box-shadow:
			0 1px 0 color-mix(in srgb, var(--text-base) 4%, transparent) inset,
			0 1px 2px rgba(0, 0, 0, 0.16);
	}

	.arena-tab:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--color-primary) 55%, transparent);
		outline-offset: 2px;
	}

	.arena-panel {
		flex: 1;
	}

	/* Inline fallback for the tab boundary — a quiet card, not a
	   full-screen error, so the surrounding Arena shell stays usable. */
	.arena-boundary {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		align-items: flex-start;
		margin: 1.5rem 0;
		padding: 1rem 1.1rem;
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		background: var(--bg-popover);
	}

	.arena-boundary-title {
		margin: 0;
		color: var(--text-base);
		font-size: var(--t-14);
		font-weight: 600;
	}

	.arena-boundary-body {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--t-13);
		line-height: var(--leading-snug);
	}

	.arena-boundary-retry {
		margin-top: 0.35rem;
		padding: 0.45rem 0.9rem;
		border: 1px solid color-mix(in srgb, var(--color-primary) 35%, var(--border-base));
		border-radius: var(--r-pill);
		background: color-mix(in srgb, var(--color-primary) 10%, transparent);
		color: var(--color-primary);
		font-size: var(--t-12);
		font-weight: 700;
		cursor: pointer;
		transition: background var(--d-state) ease;
	}

	.arena-boundary-retry:hover {
		background: color-mix(in srgb, var(--color-primary) 18%, transparent);
	}
</style>
