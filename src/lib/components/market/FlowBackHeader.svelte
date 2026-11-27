<script lang="ts">
	import { Share } from '@lucide/svelte/icons';
	import { clickOutside } from '#lib/actions/click-outside.ts';
	import ChallengeShareButton from '#lib/components/market/ChallengeShareButton.svelte';
	import SharePopover from '#lib/components/market/SharePopover.svelte';
	import SavedMarketToggle from '#lib/components/saved-markets/SavedMarketToggle.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { notificationsStore } from '#lib/stores/notification.store.ts';
	import type { PriorCallSignal } from '#lib/types/market-signals.ts';
	import type { Market } from '#lib/types/market.ts';
	import type { FlowArtCategory } from '#lib/utils/flow-art.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { categoryLabel } from '#lib/utils/market-tags.utils.ts';

	interface Props {
		market: Market;
		category: FlowArtCategory;
		priorCall?: PriorCallSignal;
		/** Translated title for the active locale; defaults to the original. */
		displayTitle?: string;
	}

	const { market, category, priorCall, displayTitle }: Props = $props();

	// FlowCard back is a full / detail surface: render the localized
	// category label ("World Cup") rather than the raw `wc` id. CSS
	// uppercases it (.allcaps) where the design shouts.
	const catLabel = $derived(categoryLabel({ category, variant: 'full', locale: $localeStore }));

	// Share popover toggle: anchored above the share button. The
	// popover handles native / clipboard / channel paths itself; this
	// component owns just the open/close state and the toast we show
	// on successful clipboard copy.
	let shareOpen = $state(false);

	let shareButton = $state<HTMLButtonElement | undefined>();

	const toggleShare = () => {
		shareOpen = !shareOpen;
	};

	// The popover closes itself on Escape or once a share completes: focus
	// returns to the toggle that opened it.
	const closeShare = () => {
		shareOpen = false;
		shareButton?.focus();
	};

	// A click elsewhere only dismisses: focus stays where the user put it.
	const dismissShare = () => {
		shareOpen = false;
	};

	// Called on a successful copy (no arg) or a saved-card fallback (the
	// "Card saved: post it" message is passed through). The popover owns
	// the channel logic; we only surface the resulting toast.
	const onCopied = (message?: string) => {
		notificationsStore.add({
			title: t({ locale: $localeStore, key: 'market.detail.share.copied_title' }),
			message: message ?? t({ locale: $localeStore, key: 'market.detail.share.copied' }),
			type: 'success'
		});
	};
</script>

<header class="flow-back-head">
	<span class="allcaps flow-back-cat">{catLabel}</span>
	<div class="flow-back-actions" data-no-card-gesture="true">
		<ChallengeShareButton {market} title={displayTitle ?? market.title} variant="flow" />
		<SavedMarketToggle marketId={market.id} size="sm" variant="flow-ghost" />
		<!-- The toggle sits inside the outside-click boundary so tapping it
		     while open closes once instead of closing and reopening. -->
		<div class="flow-back-share-anchor" use:clickOutside={dismissShare}>
			<button
				bind:this={shareButton}
				class="flow-back-share"
				class:is-active={shareOpen}
				aria-expanded={shareOpen}
				aria-haspopup="dialog"
				aria-label={t({ locale: $localeStore, key: 'market.detail.share.label' })}
				onclick={toggleShare}
				type="button"
			>
				<Share aria-hidden="true" size={16} strokeWidth={1.8} />
			</button>
			{#if shareOpen}
				<SharePopover
					{category}
					{displayTitle}
					{market}
					onClose={closeShare}
					{onCopied}
					priorCall={priorCall ? { side: priorCall.side } : null}
				/>
			{/if}
		</div>
	</div>
</header>

<style lang="postcss">
	.flow-back-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 1.125rem 1.25rem 0.75rem;
		border-bottom: 1px solid var(--border-base);
	}

	/* Category chip: a subtle neutral pill (parchment-wash background)
	   with category-colored ink, rather than a plain colored label. */
	.flow-back-cat {
		display: inline-flex;
		align-items: center;
		padding: 3px 7px;
		border-radius: 4px;
		background: color-mix(in srgb, var(--text-base) 8%, transparent);
		font-size: var(--t-10);
		color: var(--cat-color);
		font-weight: 700;
		letter-spacing: var(--tracking-allcaps);
	}

	.flow-back-actions {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		flex-shrink: 0;
	}

	/* Share-pop anchor button: a borderless ghost control that matches
	   the saved-market toggle beside it: transparent until hovered, then
	   a faint parchment wash with full-brightness ink. It stays inline
	   here because the popover is anchored relative to
	   `.flow-back-actions`, so the button can't take its own offset
	   parent. */
	.flow-back-share {
		display: inline-flex;
		width: 1.75rem;
		height: 1.75rem;
		align-items: center;
		justify-content: center;
		border: 1px solid transparent;
		border-radius: var(--r-8);
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition:
			background-color var(--d-hover) var(--ease-vici),
			border-color var(--d-hover) var(--ease-vici),
			color var(--d-hover) var(--ease-vici);
	}
	/* No box of its own: the popover keeps `.flow-back-actions` as its
	   positioning anchor and the button keeps its place in the row. */
	.flow-back-share-anchor {
		display: contents;
	}

	.flow-back-share:hover,
	.flow-back-share.is-active {
		background: color-mix(in srgb, var(--text-base) 6%, transparent);
		color: var(--text-base);
	}
</style>
