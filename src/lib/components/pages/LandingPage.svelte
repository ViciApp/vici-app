<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { onMount, tick } from 'svelte';
	import LandingDeck from '#lib/components/landing/LandingDeck.svelte';
	import LandingFooter from '#lib/components/landing/LandingFooter.svelte';
	import LandingMarkets from '#lib/components/landing/LandingMarkets.svelte';
	import LandingNav from '#lib/components/landing/LandingNav.svelte';
	import LandingPriceChart from '#lib/components/landing/LandingPriceChart.svelte';
	import {
		LANDING_DECK_SEEN_STORAGE_KEY,
		LANDING_FLOAT_WAIT_MS,
		LANDING_MARKETS_ACK_DELAY_MS,
		LANDING_SHARE_NUDGE_MS
	} from '#lib/constants/landing-page.constants.ts';
	import { resolveLandingLinkSeriesId } from '#lib/services/landing-link.services.ts';
	import { landingWaitlistSubmit } from '#lib/services/landing-waitlist.services.ts';
	import { landingCallsStore } from '#lib/stores/landing-calls.store.ts';
	import { landingClaimStore } from '#lib/stores/landing-claim.store.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { LandingCall } from '#lib/types/landing-call.ts';
	import type { LandingView } from '#lib/types/landing-claim.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { landLandingCard, liftLandingCard } from '#lib/utils/landing-float.utils.ts';
	import { prefersReducedMotion } from '#lib/utils/reduced-motion.utils.ts';
	import { has as hasStored, set as setStored } from '#lib/utils/storage.utils.ts';
	import { page } from '$app/state';

	/**
	 * The signed-out landing page: the card deck first, the Markets view
	 * behind the top bar's switch, and the claim capsule in the bar. After
	 * three calls the last card floats into Markets as its lead. Calls place
	 * no order: they are kept for the claim.
	 */

	// Read once: a visitor who touches the deck mid-visit is not re-introduced
	// to it, and one who has not is not cut short.
	const attract = !hasStored({ key: LANDING_DECK_SEEN_STORAGE_KEY });

	let root = $state<HTMLDivElement>();
	let marketsLayer = $state<HTMLDivElement>();
	let view = $state<LandingView>('cards');
	// The deck starts once the page knows which card leads (a `?m=` link).
	let deckReady = $state(false);
	let deckEmpty = $state(false);
	let leadSeriesId = $state<string>();
	// Markets loads from the visitor's first move on the page, so it is ready
	// when a card floats in, and the first paint does not wait on it.
	let marketsMounted = $state(false);
	let focusSeriesId = $state<string>();
	let shared = $state(false);

	let sharedTimer: ReturnType<typeof setTimeout> | undefined;
	let ackTimer: ReturnType<typeof setTimeout> | undefined;

	onMount(() => {
		void resolveLandingLinkSeriesId(page.url.search).then((seriesId) => {
			leadSeriesId = seriesId;
			deckReady = true;
		});

		return () => {
			clearTimeout(sharedTimer);
			clearTimeout(ackTimer);
		};
	});

	// Markets shows its lead once its markets have loaded; a lifted card holds
	// until then, for a moment at most.
	const whenLeadArt = async (): Promise<Element | undefined> => {
		const deadline_ms = performance.now() + LANDING_FLOAT_WAIT_MS;

		for (;;) {
			await tick();
			await new Promise(requestAnimationFrame);

			const art = marketsLayer?.querySelector('[data-landing-markets-lead-art]');

			if (nonNullish(art) || performance.now() > deadline_ms) {
				return art ?? undefined;
			}
		}
	};

	const openMarkets = async ({
		seriesId,
		source
	}: {
		seriesId?: string;
		source?: HTMLElement | null;
	} = {}): Promise<void> => {
		const card =
			nonNullish(source) && nonNullish(root) && !prefersReducedMotion()
				? liftLandingCard({ source, layer: root })
				: undefined;

		marketsMounted = true;
		focusSeriesId = seriesId ?? focusSeriesId;
		view = 'markets';

		if (isNullish(card)) {
			return;
		}

		landLandingCard({ card, target: await whenLeadArt() });
	};

	const onView = (next: LandingView): void => {
		if (next === view) {
			return;
		}

		if (next === 'cards') {
			view = 'cards';

			return;
		}

		// The card on screen floats into Markets; the deck keeps its own.
		const top = root?.querySelector<HTMLElement>('[data-landing-deck-card]:not([inert])');

		void openMarkets({ seriesId: top?.dataset.landingDeckCard, source: top });
	};

	const warmMarkets = (): void => {
		marketsMounted = true;
	};

	const onDeckDone = ({ seriesId }: { seriesId: string }): void => {
		void openMarkets({
			seriesId,
			source: root?.querySelector<HTMLElement>(`[data-landing-deck-card="${CSS.escape(seriesId)}"]`)
		});
	};

	const onDeckEmpty = (): void => {
		deckEmpty = true;
		void openMarkets();
	};

	const onMarketsCall = (call: LandingCall): void => {
		landingCallsStore.add(call);

		const ack = t({
			locale: $localeStore,
			key: call.side === 'yes' ? 'landing.page.ack_yes' : 'landing.page.ack_no',
			params: { pct: call.pricePercent }
		});

		clearTimeout(ackTimer);
		ackTimer = setTimeout(() => landingClaimStore.open({ ack }), LANDING_MARKETS_ACK_DELAY_MS);
	};

	const onMarketsClose = (): void => {
		if (!deckEmpty) {
			onView('cards');
		}
	};

	const onShare = (): void => {
		shared = true;
		clearTimeout(sharedTimer);
		sharedTimer = setTimeout(() => (shared = false), LANDING_SHARE_NUDGE_MS);
	};
</script>

<svelte:window onkeydowncapture={warmMarkets} onpointerdowncapture={warmMarkets} />

<div bind:this={root} class="lp">
	<h1 class="sr-only">{t({ locale: $localeStore, key: 'landing.page.heading' })}</h1>

	<LandingNav
		canSwitch={!deckEmpty}
		nudge={shared ? t({ locale: $localeStore, key: 'landing.nav.shared' }) : undefined}
		onview={onView}
		submit={landingWaitlistSubmit}
		{view}
	/>

	<main>
		{#if deckReady && !deckEmpty}
			<LandingDeck
				active={view === 'cards'}
				{attract}
				{leadSeriesId}
				oncall={landingCallsStore.add}
				ondone={onDeckDone}
				onempty={onDeckEmpty}
				onengage={() => setStored({ key: LANDING_DECK_SEEN_STORAGE_KEY, value: true })}
			>
				{#snippet backChart({ seriesId })}
					<LandingPriceChart {seriesId} variant="card" />
				{/snippet}
			</LandingDeck>
		{/if}

		<div
			bind:this={marketsLayer}
			class="lp-markets"
			class:is-on={view === 'markets'}
			inert={view !== 'markets'}
		>
			{#if marketsMounted}
				<LandingMarkets
					calls={$landingCallsStore}
					{focusSeriesId}
					oncall={onMarketsCall}
					onclaim={() => landingClaimStore.open()}
					onclose={onMarketsClose}
					onshare={onShare}
				>
					{#snippet footer()}
						<LandingFooter
							oncards={deckEmpty ? undefined : () => onView('cards')}
							onclaim={() => landingClaimStore.open()}
						/>
					{/snippet}
				</LandingMarkets>
			{/if}
		</div>
	</main>
</div>

<style lang="postcss">
	.lp {
		--lp-out: cubic-bezier(0.23, 1, 0.32, 1);
		position: fixed;
		inset: 0;
		overflow: hidden;
		background: var(--ink);
		color: var(--parchment);
		color-scheme: dark;
	}

	.lp-markets {
		position: fixed;
		inset: 0;
		z-index: 20;
		opacity: 0;
		visibility: hidden;
		transition:
			opacity 200ms var(--lp-out),
			visibility 0s linear 200ms;
	}

	.lp-markets.is-on {
		opacity: 1;
		visibility: visible;
		transition: opacity 260ms var(--lp-out);
	}

	@media (prefers-reduced-motion: reduce) {
		.lp-markets,
		.lp-markets.is-on {
			transition: opacity 160ms ease;
		}
	}
</style>
