<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import ConsensusCompass from '#lib/components/market/ConsensusCompass.svelte';
	import FlowCardBack from '#lib/components/market/FlowCardBack.svelte';
	import FlowCardFooter from '#lib/components/market/FlowCardFooter.svelte';
	import MarketArtwork from '#lib/components/market/MarketArtwork.svelte';
	import MarketOddsSkeleton from '#lib/components/market/MarketOddsSkeleton.svelte';
	import MarketTranslationToggle from '#lib/components/market/MarketTranslationToggle.svelte';
	import SeededAvatarStack from '#lib/components/ui/SeededAvatarStack.svelte';
	import { DAY_IN_MS } from '#lib/constants/app.constants.ts';
	import { VXP_DEFAULT_STAKE } from '#lib/constants/vxp-economy.constants.ts';
	import { lookupWcMarketSubtitle } from '#lib/constants/wc-market-subtitles.constants.ts';
	import { daysToKickoff } from '#lib/derived/featured-event.derived.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { MarketMetadata } from '#lib/types/market-metadata.ts';
	import type {
		CategoryAccuracySignal,
		FollowedLeanSignal,
		PriorCallSignal
	} from '#lib/types/market-signals.ts';
	import type { MarketTranslation } from '#lib/types/market-translation.ts';
	import type { FlowAction, Market } from '#lib/types/market.ts';
	import { resolveFlowArtCategory, type FlowArtCategory } from '#lib/utils/flow-art.utils.ts';
	import {
		consensusPercent,
		consensusSide,
		formatWhyNowChip
	} from '#lib/utils/flow-card-display.utils.ts';
	import { haptic } from '#lib/utils/haptics.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { marketDisplayText } from '#lib/utils/market-translation.utils.ts';
	import { tagColor } from '#lib/utils/tag-color.utils.ts';

	interface Props {
		market: Market;
		onAction: (action: FlowAction) => void;
		signedIn: boolean;
		tradeAmount: string;
		interactive?: boolean;
		// When true, the parent has paused the deck (e.g. a sheet is
		// open) and the card desaturates / dims its faces.
		locked?: boolean;
		// Gates gesture entry without touching the card's visuals. FlowMode
		// holds this false for the first card's rise-in after the entry
		// overlay is dismissed, so the dismissing tap's trailing events
		// (desktop mouseup/click, and the synthetic mouse chain a touch
		// fires ~300 ms after touchend) can't leak into a tap-to-flip on the
		// card that mounts underneath. Default true keeps static / guided
		// usages unaffected.
		gesturesArmed?: boolean;
		// Generative-artwork category: a resolved macro (or the `wc`
		// tentpole). FlowMode resolves this from the market's stored tags;
		// FlowCard falls back to a hash-derived bucket when absent (static /
		// preview usages).
		category?: FlowArtCategory;
		// Optional editorial sub-line ("FOMC · rate-cut call"). When
		// undefined, FlowCard resolves one from metadata, the curated
		// WC-market table, or, as a last resort, the market description.
		subtitle?: string;
		// When set, the card has already been committed to a side and is
		// playing the commit-feedback beat before the parent unmounts it.
		// The matching swipe overlay locks to full opacity.
		committedAction?: FlowAction | null;
		metadata?: MarketMetadata;
		categoryAcc?: CategoryAccuracySignal;
		priorCall?: PriorCallSignal;
		followedLean?: FollowedLeanSignal;
		// Real, market-wide price history (0–100 YES series, oldest first)
		// for the back-face sparkline. Absent until FlowMode resolves it for
		// the focused card: the back face falls back to its seed shape.
		points?: number[];
		// Parallel x-fractions (0–1) placing each `points` entry on the time
		// axis. Present alongside real history; absent for the seed shape.
		pointXs?: number[];
		// Stake-ladder change callback. Wired through to FlowCardBack so a
		// tap on a rung writes back to FlowMode's bound stake.
		onStakeChange?: (next: string) => void;
		// Guided mode: the onboarding first-call surface reuses this exact
		// card so the in-product deck and the tutorial are pixel-identical.
		// In guided mode the card never flips (tap is inert) and swipe-up
		// SKIP is suppressed: the first call must commit a YES/NO, never
		// open depth or skip. The footer hint switches to "SWIPE TO CALL".
		guided?: boolean;
		// Resolved metadata translation for this market in the active locale,
		// or undefined when none exists (which gates the quick toggle). When
		// present and `showOriginal` is false, the title / subtitle / back-face
		// resolution render translated.
		translation?: MarketTranslation;
		// Per-card quick-toggle state, owned by the parent (FlowMode). True =
		// show the on-chain original even when a translation exists.
		showOriginal?: boolean;
		// Native label of the translation's language, for the "View in {lang}"
		// quick toggle. Absent when there is no translation.
		translatedLanguageLabel?: string;
		// Flip this one card between translated and original. No-op-safe when
		// absent (static / guided usages don't wire it).
		onToggleTranslation?: () => void;
		// Proactive stake warning resolved by FlowMode, surfaced on the
		// back-face slider. `'unaffordable'` = the selected size exceeds
		// spendable VXP; `'wont-finish'` = it would leave too little to fund
		// the rest of the sitting. Defaults to `'none'` so static / preview
		// usages render no warning.
		stakeWarning?: 'none' | 'unaffordable' | 'wont-finish';
	}

	const {
		market,
		onAction,
		signedIn,
		tradeAmount,
		interactive = true,
		locked = false,
		gesturesArmed = true,
		category,
		subtitle,
		committedAction = null,
		metadata,
		categoryAcc,
		priorCall,
		followedLean,
		points,
		pointXs,
		onStakeChange,
		guided = false,
		translation,
		showOriginal = false,
		translatedLanguageLabel,
		onToggleTranslation,
		stakeWarning = 'none'
	}: Props = $props();

	// Single source for the card's rendered text: translated unless the viewer
	// flipped this card to the original (or no translation exists). The
	// subtitle fallback below reads `display.description` / `display.resolution`
	// so it compares the same language the card is showing.
	const display = $derived(marketDisplayText({ market, translation, showOriginal }));

	const isCommitted = $derived(nonNullish(committedAction));

	// Swipe physics: rotation damping of 18 (drag.x / 18), commit
	// threshold of 100 px, settle delay of 220 ms after pointer-up
	// before the trade fires, firm-tap haptic on commit.
	const SWIPE_THRESHOLD = 100;
	const SKIP_THRESHOLD = 110;
	const SETTLE_MS = 220;
	const TAP_PX = 6;
	// Front-card subtitle is a single italic accent line; clamp the
	// description-derived fallback so it can't crowd the card body.
	const DESCRIPTION_SUBTITLE_MAX_LENGTH = 60;

	// Resolved category: single source of truth across the surface so
	// untagged markets hash identically here, in FlowMode, etc. An explicit
	// `category` (already resolved by FlowMode) wins; otherwise fall back to
	// the deterministic hash-of-id bucket.
	const resolvedCategory: FlowArtCategory = $derived(
		category ?? resolveFlowArtCategory({ tags: [], seed: market.id })
	);
	const catColor = $derived(tagColor(resolvedCategory));

	// Both faces are always rendered; a 3D `rotateY(180deg)` on the
	// flipper element swaps which face is visible. `.flow-face` has
	// `backface-visibility: hidden` so the hidden face is culled mid-
	// rotation.
	let flipped = $state(false);

	// Drag state: raw deltas, no Spring. Plain `{x, y, dragging}`
	// model with a `committedRef` one-shot latch reset on market
	// change so a fast double-swipe can't fire twice.
	let dragX = $state(0);
	let dragY = $state(0);
	let dragging = $state(false);
	let settling = $state(false);
	let startX = 0;
	let startY = 0;
	let movedDist = 0;
	let committedRef = false;

	const rotation = $derived(dragX / 18);
	const yesOpacity = $derived(Math.min(1, Math.max(0, dragX / 100)));
	const noOpacity = $derived(Math.min(1, Math.max(0, -dragX / 100)));
	const skipOpacity = $derived(Math.min(1, Math.max(0, -dragY / 90)));

	const overlayYes = $derived(committedAction === 'YES' ? 1 : yesOpacity);
	const overlayNo = $derived(committedAction === 'NO' ? 1 : noOpacity);
	const overlaySkip = $derived(committedAction === 'SKIP' ? 1 : skipOpacity);

	// Swipe overlays live on both faces but share one set of drag-driven
	// opacities. Gate each face's overlays to whichever side is showing
	// so the hidden face's big YES/NO words can't ghost through a dropped
	// `backface-visibility` frame on iOS (the mirrored-glyph garble seen
	// mid-flip). Signed-out users keep the existing half-strength dim.
	const overlayDim = $derived(signedIn ? 1 : 0.5);
	const frontOverlayYes = $derived(flipped ? 0 : overlayYes * overlayDim);
	const frontOverlayNo = $derived(flipped ? 0 : overlayNo * overlayDim);
	const frontOverlaySkip = $derived(flipped ? 0 : overlaySkip);
	const backOverlayYes = $derived(flipped ? overlayYes * overlayDim : 0);
	const backOverlayNo = $derived(flipped ? overlayNo * overlayDim : 0);

	// Crowd consensus is unknown until the book is read (or it was read and
	// is empty). When unknown we render an odds skeleton and suppress the
	// payout preview rather than fabricate a 50/50 split. `priceKnown` is the
	// single gate for every probability-derived surface on the card.
	const priceKnown = $derived(nonNullish(market.yesProbability));
	const crowdPct = $derived(consensusPercent(market));
	const crowdSide = $derived(consensusSide(market));
	const yesIsFav = $derived(nonNullish(crowdPct) && crowdPct >= 50);
	const noPct = $derived(nonNullish(crowdPct) ? 100 - crowdPct : undefined);

	// Payout preview: stake/(probability) − stake, clamped at p=0.05
	// to keep long-shots from rendering pathological numbers. Only computed
	// when the probability is known; otherwise the preview is suppressed.
	const stakeNum = $derived(Math.max(0, Number(tradeAmount) || 0));
	const winYes = $derived.by<number | undefined>(() => {
		if (isNullish(market.yesProbability)) {
			return;
		}

		return Math.max(1, Math.round(stakeNum / Math.max(0.05, market.yesProbability)) - stakeNum);
	});
	const winNo = $derived.by<number | undefined>(() => {
		if (isNullish(market.yesProbability)) {
			return;
		}

		return Math.max(1, Math.round(stakeNum / Math.max(0.05, 1 - market.yesProbability)) - stakeNum);
	});

	const sizeStake = $derived(Math.max(VXP_DEFAULT_STAKE, stakeNum));

	// Live countdown: days until expiry, displayed as a chip in the
	// meta row. Computed off `expiryDate` (ms). Urgency tiers:
	// ≤ 1 day = urgent, ≤ 7 = soon.
	const daysLeft = $derived.by(() => {
		const ms = Number(market.expiryDate) - Date.now();

		if (!Number.isFinite(ms) || ms <= 0) {
			return 0;
		}

		return Math.max(0, Math.ceil(ms / DAY_IN_MS));
	});
	const daysLeftUrgency = $derived(daysLeft <= 1 ? 'urgent' : daysLeft <= 7 ? 'soon' : '');

	// WC live-state suffix on the category tag; only event-named
	// milestones (MATCHDAY, KICKS OFF TOMORROW, KICKOFF WK). The numeric
	// "X DAYS" suffix is owned by the days-left chip alongside.
	const wcSuffixKey = $derived.by<
		'wc.matchday' | 'wc.kicks_off_tomorrow' | 'wc.kickoff_week' | undefined
	>(() => {
		if (resolvedCategory !== 'wc') {
			return;
		}

		const dtk = $daysToKickoff;

		if (isNullish(dtk)) {
			return 'wc.matchday';
		}

		if (dtk <= 1) {
			return 'wc.kicks_off_tomorrow';
		}

		if (dtk <= 7) {
			return 'wc.kickoff_week';
		}
	});

	// Friends-followed-lean line: when the user is following predictors
	// who've called this market, surface the YES/NO split. Falls back to
	// the predictors-count + momentum delta line.
	const followedYes = $derived(followedLean?.yes);
	const followedTotal = $derived(followedLean?.total ?? 10);
	const followedNo = $derived(
		nonNullish(followedYes) ? Math.max(0, followedTotal - followedYes) : undefined
	);
	const followedLeanText = $derived.by(() => {
		if (isNullish(followedYes) || isNullish(followedNo)) {
			return '';
		}

		const friendLabel = t({
			locale: $localeStore,
			key: followedYes === 1 ? 'card.followed_friend_singular' : 'card.followed_friend_plural'
		});

		return t({
			locale: $localeStore,
			key: 'card.followed_lean_template',
			params: {
				yesLabel: `${followedYes} ${friendLabel}`,
				noLabel: String(followedNo)
			}
		});
	});
	const predictorsCount = $derived(
		market.outcomes?.reduce((acc, o) => acc + (o.totalPredictions ?? 0), 0) ?? 0
	);

	// Per-market momentum delta: deterministic per market.id, drives
	// the "+N today" fallback line shown when the user has no
	// followed-friends data on this market. Range ~10..99 keeps the
	// number plausible without requiring a live aggregator.
	const momentumDelta = $derived.by(() => {
		const id = String(market.id);
		let hash = 0;

		for (let i = 0; i < id.length; i += 1) {
			hash = (hash * 31 + id.charCodeAt(i)) | 0;
		}

		return (Math.abs(hash) % 90) + 10;
	});

	const showPriorOnFront = $derived(Boolean(priorCall));
	const whyNowText = $derived(formatWhyNowChip(metadata?.whyNow));

	// The descriptive blurb is only a usable editorial accent when it
	// carries context distinct from the settlement clause. Markets
	// historically defaulted `resolution` to `description`, so when the two
	// are identical the description adds nothing the back card's RESOLVES
	// YES IF section doesn't already state: surfacing it as an italic
	// front-card line reads as a snippet, not an accent. Suppress it in
	// that case; otherwise trim the distinct blurb for the last-resort line.
	const descriptionSubtitle = $derived.by<string | undefined>(() => {
		const description = display.description.trim();

		if (description.length === 0 || description === display.resolution.trim()) {
			return;
		}

		// Curated subtitles sit around ~40–60 chars; the front-card row is
		// a single italic accent line, so a long description must be clamped
		// to avoid pushing into the card body. Trim on a word boundary and
		// append an ellipsis when truncated.
		if (description.length <= DESCRIPTION_SUBTITLE_MAX_LENGTH) {
			return description;
		}

		const clipped = description.slice(0, DESCRIPTION_SUBTITLE_MAX_LENGTH);
		const lastSpace = clipped.lastIndexOf(' ');
		const trimmed = (lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped).trimEnd();

		return `${trimmed}…`;
	});

	// Subtitle resolution order:
	//   1. Explicit `subtitle` prop (parent override)
	//   2. `metadata.subtitle` from the satellite (admin-curated)
	//   3. Curated WC-market lookup (`wc-market-subtitles.constants.ts`):
	//      the tentpole markets the deck ships with
	//   4. Description blurb; only when it differs from the settlement
	//      clause (see `descriptionSubtitle`); a pure resolution echo is
	//      suppressed so no description-derived line shows
	//   5. undefined → row is hidden
	const subtitleText = $derived(
		subtitle ?? metadata?.subtitle ?? lookupWcMarketSubtitle(market.id) ?? descriptionSubtitle
	);

	// Per-card reset: clear flip + latch + drag whenever the market
	// underneath changes (parent re-uses the slot during deck shuffle).
	$effect(() => {
		market.id;
		flipped = false;
		dragX = 0;
		dragY = 0;
		dragging = false;
		committedRef = false;
	});

	const fire = (side: FlowAction) => {
		if (committedRef) {
			return;
		}

		committedRef = true;
		onAction(side);
	};

	const isInteractiveTarget = (target: EventTarget | null): boolean => {
		const el = target as HTMLElement | null;

		if (isNullish(el)) {
			return false;
		}

		return Boolean(el.closest('button, a, input, textarea, select, [data-no-card-gesture]'));
	};

	const onPointerDown = (e: MouseEvent | TouchEvent) => {
		if (!interactive || isCommitted || !gesturesArmed) {
			return;
		}

		if (isInteractiveTarget(e.target)) {
			return;
		}

		const p = 'touches' in e ? e.touches[0] : e;
		startX = p.clientX;
		startY = p.clientY;
		movedDist = 0;
		dragging = true;
		settling = false;
	};

	const onPointerMove = (e: MouseEvent | TouchEvent) => {
		if (!dragging) {
			return;
		}

		const p = 'touches' in e ? e.touches[0] : e;
		const dx = p.clientX - startX;
		const dy = p.clientY - startY;
		movedDist = Math.max(movedDist, Math.hypot(dx, dy));

		if (flipped) {
			// Back of card: only react to clearly horizontal motion:
			// vertical scroll belongs to the panel body.
			if (Math.abs(dx) > Math.abs(dy) * 1.2 && Math.abs(dx) > 8) {
				dragX = dx;
				dragY = 0;
			}

			return;
		}

		dragX = dx;
		dragY = dy;
	};

	const commitWithSettle = ({
		side,
		exitX,
		exitY
	}: {
		side: FlowAction;
		exitX: number;
		exitY: number;
	}) => {
		dragX = exitX;
		dragY = exitY;
		dragging = false;
		settling = true;
		haptic('firm-tap');
		setTimeout(() => fire(side), SETTLE_MS);
	};

	const onPointerUp = () => {
		if (!dragging) {
			return;
		}

		dragging = false;
		settling = true;

		if (flipped) {
			// Back of card: tap returns to front; horizontal swipe still
			// commits a call; vertical motion (a scroll attempt) just
			// snaps the card back.
			if (movedDist < TAP_PX) {
				dragX = 0;
				dragY = 0;
				flipped = false;

				return;
			}

			if (dragX > SWIPE_THRESHOLD) {
				commitWithSettle({ side: 'YES', exitX: 600, exitY: 0 });

				return;
			}

			if (dragX < -SWIPE_THRESHOLD) {
				commitWithSettle({ side: 'NO', exitX: -600, exitY: 0 });

				return;
			}

			dragX = 0;
			dragY = 0;

			return;
		}

		if (movedDist < TAP_PX) {
			// Tap = flip to depth: disabled in guided mode, where the
			// first call must be a YES/NO commit (no depth, no flip).
			dragX = 0;
			dragY = 0;

			// Suppress flip in guided mode, and until the price is known:
			// the back face's community-read / stake sections all assume a
			// resolved probability, so flipping to a fabricated split would
			// surface a 50/50 the book never reported.
			if (!guided && priceKnown) {
				flipped = true;
			}

			return;
		}

		// Swipe-up SKIP takes priority when motion is clearly vertical,
		// suppressed in guided mode so the first call can't be skipped.
		if (!guided && dragY < -SKIP_THRESHOLD && Math.abs(dragX) < Math.abs(dragY) * 0.7) {
			commitWithSettle({ side: 'SKIP', exitX: dragX, exitY: -700 });

			return;
		}

		if (dragX > SWIPE_THRESHOLD) {
			commitWithSettle({ side: 'YES', exitX: 600, exitY: dragY });

			return;
		}

		if (dragX < -SWIPE_THRESHOLD) {
			commitWithSettle({ side: 'NO', exitX: -600, exitY: dragY });

			return;
		}

		dragX = 0;
		dragY = 0;
	};

	const closeBack = () => {
		flipped = false;
	};

	// Touch-end timestamp guard against the ghost-click chain. On mobile,
	// `touchend` is followed ~300 ms later by synthetic `mousedown` /
	// `mouseup` / `click` at the same coordinates. Without this guard the
	// touch-driven flip-to-back fires, the back-face's `onclick` then
	// catches the ghost-click and flips straight back to front: making
	// tap-to-flip look like a no-op on phones.
	let lastTouchEndAtMs = 0;
	const GHOST_CLICK_WINDOW_MS = 500;

	const onTouchEnd = (e: TouchEvent) => {
		// `preventDefault` on touchend is the canonical way to suppress
		// the synthetic mouse chain that would otherwise fire after a
		// gesture we just claimed. But blanket-preventing it ALSO kills
		// legitimate clicks on interactive children (back-face pegs,
		// share button, etc.): onPointerDown skips them, dragging stays
		// false, and the synthetic click would have been the only signal
		// they ever received. Gate the preventDefault on `dragging`: we
		// only suppress the synthetic chain when we actually drove a
		// swipe / tap-to-flip gesture.
		if (dragging && e.cancelable) {
			e.preventDefault();
		}

		lastTouchEndAtMs = performance.now();
		onPointerUp();
	};

	const closeBackOnTap = (e: MouseEvent) => {
		// Suppress the ghost-click that follows a touch-driven flip.
		// The back face's `pointer-events` flips to `auto` the moment
		// `flipped = true`, so the synthetic click would otherwise land
		// here and immediately revert the state.
		if (performance.now() - lastTouchEndAtMs < GHOST_CLICK_WINDOW_MS) {
			e.preventDefault();
			e.stopPropagation();

			return;
		}

		// Tap anywhere on the back panel returns to the front, except
		// when the tap lands on an interactive control (those use
		// `stopPropagation` or `[data-no-card-gesture]`).
		if (isInteractiveTarget(e.target)) {
			return;
		}

		flipped = false;
	};

	const headBackground = $derived(
		`linear-gradient(160deg, color-mix(in srgb, ${catColor} 18%, transparent) 0%, color-mix(in srgb, ${catColor} 7%, transparent) 60%, transparent 100%)`
	);
	const headBorder = $derived(`color-mix(in srgb, ${catColor} 22%, transparent)`);
	const backBackground = $derived(
		`linear-gradient(180deg, color-mix(in srgb, ${catColor} 14%, transparent), transparent 60%), linear-gradient(180deg, var(--bg-popover), var(--bg-surface))`
	);
</script>

<div class="flow-card-root" role="presentation">
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		style:transform="translate3d({dragX}px, {dragY}px, 0) rotate({rotation}deg)"
		style:transition={settling ? 'transform var(--d-enter) var(--ease-vici)' : 'none'}
		style:cursor={interactive ? (flipped ? 'default' : 'grab') : 'default'}
		class="flow-card"
		class:is-committed={isCommitted}
		class:is-flipped={flipped}
		class:is-grabbing={dragging}
		class:is-locked={locked}
		class:is-static={!interactive}
		onmousedown={onPointerDown}
		onmouseleave={onPointerUp}
		onmousemove={onPointerMove}
		onmouseup={onPointerUp}
		ontouchend={onTouchEnd}
		ontouchmove={onPointerMove}
		ontouchstart={onPointerDown}
	>
		<div class="flow-flipper" class:is-flipped={flipped}>
			<!-- ── FRONT FACE ─────────────────────────────────────── -->
			<div
				style:pointer-events={flipped ? 'none' : 'auto'}
				style:--cat-color={catColor}
				class="flow-face flow-face-front"
				aria-hidden={flipped}
			>
				<header
					style:background={headBackground}
					style:border-bottom-color={headBorder}
					class="flow-head"
				>
					<div class="flow-head-row">
						<div class="flow-head-tags">
							<span style:color={catColor} class="flow-cat-tag allcaps">
								{resolvedCategory}
								{#if wcSuffixKey}
									<span class="flow-cat-live">
										· {t({ locale: $localeStore, key: wcSuffixKey })}
									</span>
								{/if}
							</span>
							{#if daysLeft > 0}
								<span
									class="flow-days num"
									class:is-soon={daysLeftUrgency === 'soon'}
									class:is-urgent={daysLeftUrgency === 'urgent'}
									aria-label={t({
										locale: $localeStore,
										key: 'card.days_left_aria',
										params: { days: daysLeft }
									})}
								>
									{daysLeft}d
								</span>
							{/if}
						</div>
						<ConsensusCompass
							priceLoaded={market.priceLoaded}
							size={42}
							yesProbability={market.yesProbability}
						/>
					</div>

					{#if showPriorOnFront && priorCall}
						<p
							class="flow-whynow flow-whynow-prior"
							class:is-no={priorCall.side === 'NO'}
							class:is-yes={priorCall.side === 'YES'}
						>
							<span class="flow-whynow-dot" aria-hidden="true"></span>
							{t({ locale: $localeStore, key: 'card.you_called_eyebrow' })}
							<strong>{priorCall.side}</strong> · {priorCall.when}
						</p>
					{:else if whyNowText}
						<p class="flow-whynow">
							<span class="flow-whynow-dot" aria-hidden="true"></span>
							{whyNowText}
						</p>
					{/if}

					<h2 class="flow-card-title">{display.title}</h2>
					{#if subtitleText}
						<p class="flow-card-sub serif-italic acc">{subtitleText}</p>
					{/if}
					{#if nonNullish(translation) && nonNullish(translatedLanguageLabel) && nonNullish(onToggleTranslation)}
						<div class="flow-card-translation">
							<MarketTranslationToggle
								onToggle={onToggleTranslation}
								{showOriginal}
								{translatedLanguageLabel}
								variant="compact"
							/>
						</div>
					{/if}
				</header>

				<div class="flow-body">
					<!-- Friends social proof + live momentum. The avatar
				     stack always renders (4 seeded decorative circles);
				     the trailing text swaps between
				       (a) `N friends YES · M NO`: followedLean
				       (b) `K predicting · +D today`: predictors-count fallback
				       (c) empty: neither available -->
					<div class="flow-social num">
						<SeededAvatarStack borderColor="var(--bg-popover)" size={18} />
						{#if nonNullish(followedYes) && followedYes > 0}
							<span class="flow-followed-lean">{followedLeanText}</span>
						{:else if predictorsCount > 0}
							<span>
								{t({
									locale: $localeStore,
									key: 'card.predicting_count',
									params: { count: predictorsCount.toLocaleString() }
								})}
								<span class="flow-momentum-sep" aria-hidden="true">·</span>
								<span class="flow-momentum-delta text-yes">
									{t({
										locale: $localeStore,
										key: 'card.momentum_delta',
										params: { count: momentumDelta }
									})}
								</span>
							</span>
						{/if}
					</div>

					<!-- Edge-to-edge market artwork. No padding around the
				     frame: extends across the card body (`bleed` mode). -->
					<div class="flow-art-bleed">
						<MarketArtwork
							bleed
							category={resolvedCategory}
							seed={market.id}
							size={420}
							state="neutral"
							title={market.title}
						/>
					</div>

					<!-- Probability split: single bar with payout labels.
				     Replaces the dual-box layout to compress space and
				     surface upside without the misleading red 85% box.
				     When the probability is unknown the split + payout
				     preview are replaced by an odds skeleton: a pulsing
				     bar while the book loads, a neutral dash once it's
				     read but has no liquidity. Never a fabricated 50/50. -->
					<div class="flow-probs">
						{#if priceKnown && nonNullish(crowdPct) && nonNullish(noPct) && nonNullish(winNo) && nonNullish(winYes)}
							<div class="flow-probs-row">
								<div class="flow-probs-side flow-probs-side-no">
									<span class="flow-probs-pct num">{noPct}%</span>
									<span class="flow-probs-label text-no">NO</span>
								</div>
								<div class="flow-probs-track" aria-hidden="true">
									<div style:width="{noPct}%" class="flow-probs-fill-no"></div>
									<div style:width="{crowdPct}%" class="flow-probs-fill-yes"></div>
								</div>
								<div class="flow-probs-side flow-probs-side-yes">
									<span class="flow-probs-label text-yes">YES</span>
									<span class="flow-probs-pct num">{crowdPct}%</span>
								</div>
							</div>
							<div class="flow-probs-action-row">
								<div class="flow-probs-action flow-probs-action-no">
									<span class="flow-probs-arrow text-no" aria-hidden="true">←</span>
									<span class="flow-probs-payout num">
										+{winNo}
										<span class="flow-probs-payout-unit">VXP</span>
									</span>
									<span class="flow-probs-role allcaps">
										{yesIsFav
											? t({ locale: $localeStore, key: 'card.long_shot' })
											: t({ locale: $localeStore, key: 'card.favorite' })}
									</span>
								</div>
								<div class="flow-probs-action flow-probs-action-yes">
									<span class="flow-probs-role allcaps">
										{yesIsFav
											? t({ locale: $localeStore, key: 'card.favorite' })
											: t({ locale: $localeStore, key: 'card.long_shot' })}
									</span>
									<span class="flow-probs-payout num">
										+{winYes}
										<span class="flow-probs-payout-unit">VXP</span>
									</span>
									<span class="flow-probs-arrow text-yes" aria-hidden="true">→</span>
								</div>
							</div>
						{:else}
							<div class="flow-probs-row flow-probs-row-unknown">
								<MarketOddsSkeleton variant={market.priceLoaded ? 'empty' : 'loading'} />
							</div>
						{/if}
					</div>

					<!-- Foot: SIZE · VXP chip + tap/swipe hint. -->
					<FlowCardFooter {guided} {sizeStake} />
				</div>

				<!-- Swipe stamps: large centered YES / NO and a compact
			     top-center SKIP, fading in with drag progress. -->
				<div
					style:opacity={frontOverlayYes}
					class="flow-overlay flow-overlay-yes"
					aria-hidden="true"
				>
					{t({ locale: $localeStore, key: 'flow.action.yes' })}
				</div>
				<div style:opacity={frontOverlayNo} class="flow-overlay flow-overlay-no" aria-hidden="true">
					{t({ locale: $localeStore, key: 'flow.action.no' })}
				</div>
				<div
					style:opacity={frontOverlaySkip}
					class="flow-overlay flow-overlay-skip"
					aria-hidden="true"
				>
					{t({ locale: $localeStore, key: 'flow.action.skip' })}
				</div>
			</div>

			<!-- ── BACK FACE ─────────────────────────────────────── -->
			<div
				style:pointer-events={flipped ? 'auto' : 'none'}
				style:background={backBackground}
				style:--cat-color={catColor}
				class="flow-face flow-face-back"
				aria-hidden={!flipped}
				onclick={closeBackOnTap}
			>
				{#if nonNullish(crowdPct) && nonNullish(crowdSide)}
					<!-- Rendered only once the probability is known; the flip
				     gesture is itself gated on `priceKnown`, so the back
				     face never opens on a fabricated split. -->
					<FlowCardBack
						category={resolvedCategory}
						{categoryAcc}
						{crowdPct}
						{crowdSide}
						displayResolution={display.resolution}
						displayTitle={display.title}
						{followedLean}
						interactive={flipped}
						{market}
						{metadata}
						onClose={closeBack}
						{onStakeChange}
						{pointXs}
						{points}
						{priorCall}
						{stakeWarning}
						{tradeAmount}
					/>
				{/if}

				<!-- Back-face swipe still commits a call: corner stamps reuse
			     the front-face YES/NO treatment; the doubly-rotated back face
			     resolves forward-facing so they read correctly as-is. -->
				<div
					style:opacity={backOverlayYes}
					class="flow-overlay flow-overlay-yes flow-overlay-back"
					aria-hidden="true"
				>
					{t({ locale: $localeStore, key: 'flow.action.yes' })}
				</div>
				<div
					style:opacity={backOverlayNo}
					class="flow-overlay flow-overlay-no flow-overlay-back"
					aria-hidden="true"
				>
					{t({ locale: $localeStore, key: 'flow.action.no' })}
				</div>
			</div>
		</div>
	</div>
</div>

<style lang="postcss">
	.flow-card-root {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		/* Depth context for the 3D rotateY on `.flow-flipper`. The
		   `-webkit-` prefix is not optional on iOS: older Safari/WebKit
		   ignores the unprefixed `perspective`, so without it the rotation
		   has no depth and the flip degrades to an instant backface swap. */
		perspective: 1400px;
		-webkit-perspective: 1400px;
	}

	.flow-card {
		position: relative;
		width: 100%;
		height: 100%;
		user-select: none;
		/* `touch-action: none` keeps tap detection snappy: the browser
		   doesn't wait for a scroll-intent threshold before firing the
		   pointer events that drive drag / tap-to-flip. The back face's
		   own scrollable body sets its own `touch-action: pan-y` so
		   vertical scroll there still works. */
		touch-action: none;
		will-change: transform;
		/* The card carries a live `transform` (the drag translate / rotate),
		   which makes it a containing block for its descendants' 3D space.
		   WebKit flattens that space at any transformed ancestor whose
		   transform-style is the default `flat`, collapsing the flipper's
		   rotateY into this plane, so the flip renders as an instant
		   backface swap instead of an animated 3D rotation. Propagate the
		   3D context (rooted in `.flow-card-root`'s perspective) through to
		   `.flow-flipper` so the rotation keeps its depth on WebKit. */
		transform-style: preserve-3d;
		-webkit-transform-style: preserve-3d;
	}
	.flow-card.is-grabbing {
		cursor: grabbing !important;
	}
	.flow-card.is-static {
		cursor: default;
	}
	.flow-card.is-committed {
		cursor: default;
		pointer-events: none;
	}

	/* Locked state: parent (e.g. FlowMode) flips `locked` when a sheet
	   is open and gestures should pause. Both faces desaturate / dim. */
	.flow-card.is-locked .flow-face {
		filter: brightness(0.92) saturate(0.9);
		transition: filter 280ms var(--ease-vici);
	}

	/* 3D flip container: front and back faces share the same slot;
	   rotating the flipper 180° on Y reveals the back. `preserve-3d`
	   keeps the children in the same 3D space so backface-visibility
	   on the faces actually culls the hidden one. */
	.flow-flipper {
		position: absolute;
		inset: 0;
		/* Mirror `.flow-card`'s prefixed `preserve-3d`: this is the element
		   that actually rotates, and on iOS WebKit the unprefixed
		   `transform-style` alone is ignored: the faces then flatten into
		   one plane and `backface-visibility` culls discretely, so the flip
		   snaps to the other side with no visible rotation (the reported iOS
		   bug). The `-webkit-` prefix keeps the faces in shared 3D space. */
		transform-style: preserve-3d;
		-webkit-transform-style: preserve-3d;
		transition: transform 520ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	.flow-flipper.is-flipped {
		transform: rotateY(180deg);
	}

	.flow-face {
		position: absolute;
		inset: 0;
		overflow: hidden;
		/* Cull the away-facing side mid-rotation so the front doesn't
		   ghost through the back (and vice versa). */
		backface-visibility: hidden;
		-webkit-backface-visibility: hidden;
		/* 22 px corner radius: softer than the default card radius
		   for the swipeable Flow surface. */
		border-radius: 22px;
	}

	.flow-face-front {
		display: flex;
		flex-direction: column;
		background:
			radial-gradient(
				circle at 18% 0%,
				color-mix(in srgb, var(--cat-color) 18%, transparent),
				transparent 32%
			),
			linear-gradient(180deg, var(--bg-popover), var(--bg-surface));
		border: 1px solid var(--border-strong);
		box-shadow:
			0 12px 24px rgba(0, 0, 0, 0.3),
			0 32px 60px rgba(0, 0, 0, 0.2);
	}

	.flow-head {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 18px 20px 16px;
		border-bottom: 1px solid var(--border-base);
	}

	.flow-head-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.flow-head-tags {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}

	.flow-cat-tag {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 3px 7px;
		border-radius: 4px;
		background: color-mix(in srgb, var(--text-base) 6%, transparent);
		font-size: var(--text-micro);
		font-weight: 700;
		letter-spacing: 0.08em;
	}

	.flow-cat-live {
		font-size: 9.5px;
		letter-spacing: var(--tracking-allcaps);
		opacity: 0.85;
	}

	.flow-days {
		display: inline-flex;
		align-items: center;
		padding: 2px 8px;
		font-size: var(--text-eyebrow);
		font-weight: 600;
		letter-spacing: 0;
		color: var(--text-muted);
		background: color-mix(in srgb, var(--text-base) 5%, transparent);
		border: 1px solid color-mix(in srgb, var(--text-base) 10%, transparent);
		border-radius: var(--r-pill);
	}
	.flow-days.is-soon {
		color: var(--laurel);
	}
	.flow-days.is-urgent {
		color: var(--no);
		border-color: color-mix(in srgb, var(--no) 30%, var(--border-base));
		animation: flow-days-pulse 1.6s cubic-bezier(0.4, 0, 0.2, 1) infinite;
	}
	@media (prefers-reduced-motion: reduce) {
		.flow-days.is-urgent {
			animation: none;
		}
	}

	.flow-whynow {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin: 0;
		padding: 3px 9px 3px 8px;
		border-radius: var(--r-pill);
		border: 1px solid color-mix(in srgb, var(--text-base) 7%, transparent);
		background: color-mix(in srgb, var(--text-base) 4%, transparent);
		font-size: var(--text-eyebrow);
		font-weight: 500;
		color: var(--fg-dim);
		letter-spacing: 0;
	}
	.flow-whynow strong {
		font-weight: 700;
	}
	/* Prior-call eyebrow: a stronger, monospaced signal than the
	   curated why-now cue, tinted with the called side's color. */
	.flow-whynow-prior {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		padding: 3px 10px 3px 9px;
	}
	.flow-whynow-prior.is-yes {
		color: var(--yes);
		background: color-mix(in srgb, var(--yes) 10%, transparent);
		border-color: color-mix(in srgb, var(--yes) 32%, transparent);
	}
	.flow-whynow-prior.is-no {
		color: var(--no);
		background: color-mix(in srgb, var(--no) 10%, transparent);
		border-color: color-mix(in srgb, var(--no) 32%, transparent);
	}
	.flow-whynow-prior.is-yes .flow-whynow-dot {
		box-shadow: 0 0 6px color-mix(in srgb, var(--yes) 50%, transparent);
	}
	.flow-whynow-prior.is-no .flow-whynow-dot {
		box-shadow: 0 0 6px color-mix(in srgb, var(--no) 50%, transparent);
	}
	.flow-whynow-dot {
		width: 5px;
		height: 5px;
		border-radius: var(--r-pill);
		background: currentColor;
		flex-shrink: 0;
	}

	.flow-card-title {
		margin: 6px 0 0;
		font-family: var(--font-display);
		font-size: var(--text-h2);
		line-height: var(--leading-snug);
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--text-base);
		text-wrap: balance;
		overflow-wrap: anywhere;
	}

	.flow-card-sub {
		margin: 6px 0 0;
		font-size: 13.5px;
		line-height: 1.35;
		letter-spacing: 0;
		color: var(--fg-dim);
		/* Serif-italic accent: editorial sub-row. The global
		   `.serif-italic` utility also sets font-family + weight; this
		   duplicates a few props so the typography still reads when the
		   utility class is overridden by parent context. */
		font-family: var(--font-serif);
		font-style: italic;
		font-weight: 400;
	}

	/* Quiet language affordance directly under the title/subtitle, kept off
	   the card's gesture surface via `data-no-card-gesture`. */
	.flow-card-translation {
		margin-top: 6px;
	}

	.flow-momentum-sep {
		margin: 0 5px;
		opacity: 0.55;
	}
	.flow-momentum-delta {
		font-weight: 700;
	}

	/* 16 px gap between the friends row / artwork / probs / foot.
	   `.flow-probs` further down sets `margin-top: auto`, which parks
	   the probability split (and the foot directly beneath it) at the
	   bottom of the card body regardless of artwork height. The gap here
	   is the only separation between the probs block and the foot, so it
	   stays small-but-clear; `padding-bottom` parks the foot near the
	   card's bottom edge. */
	.flow-body {
		display: flex;
		flex-direction: column;
		gap: 16px;
		flex: 1 1 auto;
		min-height: 0;
		padding: 14px 0;
	}

	/* Single-line row: a fixed-size avatar stack followed by the
	   trailing predictor/followed-lean text. `min-width: 0` lets the
	   flex children shrink below their intrinsic width so a long
	   trailing string truncates with an ellipsis (see `.flow-social
	   > span`) instead of being chopped at the right edge by the
	   `.flow-face { overflow: hidden }` clip. The avatar stack is
	   pinned with `flex-shrink: 0` so the circles always stay fully
	   visible. */
	.flow-social {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		padding: 0 1.1rem;
		font-size: var(--t-12);
		color: var(--text-muted);
		letter-spacing: 0.02em;
	}

	.flow-social :global(.seeded-avatar-stack) {
		flex-shrink: 0;
	}

	/* Trailing text (predictors-count fallback or followed-lean
	   line). Truncates with an ellipsis when the row runs out of
	   width rather than overflowing the card body. */
	.flow-social > span {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.flow-followed-lean {
		font-weight: 600;
	}
	/* Edge-to-edge artwork frame: the FlowArtFrame's own rounded
	   corners come off so the body of the card hosts the art with no
	   side padding (`bleed` mode). The frame's height is fixed so the
	   title / probs row never reflow on layout changes. */
	/* Fixed 172 px artwork frame. The earlier
	   `clamp(140px, 22vw, 172px)` shrank the art on narrow viewports,
	   which made the card body collapse on phones and the probs row
	   crowd against the title. A constant height keeps the card
	   silhouette stable across breakpoints. */
	.flow-art-bleed {
		position: relative;
		width: 100%;
		height: 172px;
		overflow: hidden;
		border-top: 1px solid var(--border-base);
		border-bottom: 1px solid var(--border-base);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.flow-art-bleed :global(.flow-art) {
		width: 100%;
		height: 100%;
		max-width: none;
		border-radius: 0;
		box-shadow: none;
	}
	.flow-art-bleed :global(.flow-art > svg),
	.flow-art-bleed :global(.flow-art svg) {
		width: 100%;
		height: 100%;
	}

	/* `margin-top: auto` parks the split bar at the bottom edge of
	   the card body so it stays anchored to the foot regardless of
	   how tall the artwork frame ends up. */
	.flow-probs {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: auto 1.1rem 0;
		padding: 0 2px;
	}

	.flow-probs-row {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 10px;
	}

	/* Unknown-odds state: the skeleton bar / dash stands in for the
	   split + payout rows, centered so the card silhouette stays stable
	   whether the probability is known or still loading. */
	.flow-probs-row-unknown {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 22px;
	}

	.flow-probs-side {
		display: inline-flex;
		align-items: baseline;
		gap: 6px;
	}
	.flow-probs-side-no {
		justify-content: flex-start;
	}
	.flow-probs-side-yes {
		justify-content: flex-end;
	}

	.flow-probs-pct {
		font-size: 22px;
		font-weight: 600;
		letter-spacing: -0.02em;
		line-height: 1;
		color: var(--text-base);
	}
	.flow-probs-label {
		font-size: var(--t-11);
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.flow-probs-track {
		position: relative;
		display: flex;
		height: 8px;
		border-radius: var(--r-pill);
		overflow: hidden;
		background: var(--border-strong);
		box-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.1);
	}
	.flow-probs-fill-no {
		height: 100%;
		background: linear-gradient(90deg, var(--no), rgba(255, 107, 107, 0.45));
		transition: width 280ms var(--ease-vici);
	}
	.flow-probs-fill-yes {
		height: 100%;
		background: linear-gradient(90deg, rgba(79, 211, 161, 0.45), var(--yes));
		transition: width 280ms var(--ease-vici);
	}

	.flow-probs-action-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
		font-size: 10.5px;
	}
	.flow-probs-action {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		color: var(--text-muted);
	}
	.flow-probs-action-no {
		justify-content: flex-start;
	}
	.flow-probs-action-yes {
		justify-content: flex-end;
	}
	.flow-probs-arrow {
		font-family: var(--font-sans);
		font-size: 16px;
		line-height: 1;
		color: var(--color-accent);
	}
	.flow-probs-payout {
		display: inline-flex;
		align-items: baseline;
		gap: 3px;
		font-family: var(--font-mono);
		font-size: 13px;
		letter-spacing: -0.005em;
		color: var(--color-accent);
	}
	.flow-probs-payout-unit {
		font-size: 9.5px;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: var(--text-muted);
	}
	.flow-probs-role {
		font-size: 9px;
		font-weight: 600;
		letter-spacing: var(--tracking-allcaps);
		opacity: 0.75;
	}

	/* Swipe stamps that fade in with drag progress and read like a rubber
	   stamp slammed onto the card. YES / NO are large and centered; the word
	   fills the card face as the swipe commits, while SKIP stays a compact
	   glassy box riding top-center. The stamp box (border + radius + tilt)
	   carries the swipe intent. */
	.flow-overlay {
		position: absolute;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-display);
		line-height: 1;
		text-transform: uppercase;
		pointer-events: none;
		transform-origin: center;
		/* Settle the stamp in with a subtle pop; opacity is drag-driven. */
		transition:
			opacity 80ms linear,
			transform 120ms var(--ease-vici);
		z-index: 20;
	}
	/* Large centered YES / NO: anchored at the card center and tilted toward
	   their swipe edge (YES leans left for the right swipe, NO leans right for
	   the left). The same rule drives the back-face stamps (`.flow-overlay-back`
	   reuses these classes), so front and back read identically. */
	.flow-overlay-yes,
	.flow-overlay-no {
		top: 50%;
		left: 50%;
		font-size: 64px;
		font-weight: 800;
		letter-spacing: 0.12em;
		padding: 12px 22px;
		border: 4px solid currentColor;
		border-radius: 12px;
	}
	.flow-overlay-yes {
		color: var(--yes);
		transform: translate(-50%, -50%) rotate(-8deg);
	}
	.flow-overlay-no {
		color: var(--no);
		transform: translate(-50%, -50%) rotate(8deg);
	}
	.flow-overlay-skip {
		top: 18px;
		left: 50%;
		padding: 8px 12px;
		border: 2px solid currentColor;
		border-radius: 6px;
		font-size: 16px;
		font-weight: 800;
		letter-spacing: 0.22em;
		transform: translateX(-50%) scale(1.06);
		color: var(--text-base);
		/* Glassy scrim so the upward-swipe stamp reads over any artwork,
		   tinted from theme tokens to stay correct across dark/light/peach. */
		border-color: color-mix(in srgb, var(--text-base) 70%, transparent);
		background: color-mix(in srgb, var(--bg-base) 55%, transparent);
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
	}
	/* The back face is pre-rotated rotateY(180deg) and the flipper adds
	   another 180° when flipped, so back content already resolves
	   forward-facing (net 360°). The back stamps therefore inherit the
	   front-face YES/NO treatment as-is: lettering reads forward and the
	   word lands centered. Only the stacking order differs. */
	.flow-overlay-back {
		z-index: 25;
	}

	/* Reduced motion: drop the SKIP stamp's pop + the transform easing. The
	   centered YES / NO keep their tilt (it's the stamp's identity, not motion)
	   and just fade in on drag opacity alone. */
	@media (prefers-reduced-motion: reduce) {
		.flow-overlay {
			transition: opacity 80ms linear;
		}
		.flow-overlay-skip {
			transform: translateX(-50%);
		}
	}

	.flow-face-back {
		display: flex;
		flex-direction: column;
		/* Pre-rotated so the flipper's 180° rotateY brings it face-on. */
		transform: rotateY(180deg);
		border: 1px solid var(--border-strong);
		box-shadow:
			0 24px 52px rgba(0, 0, 0, 0.24),
			0 12px 24px rgba(0, 0, 0, 0.18);
	}

	@media (prefers-reduced-motion: reduce) {
		.flow-flipper {
			transition: none;
		}
	}
</style>
