<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { onMount, onDestroy, untrack } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { fade, fly } from 'svelte/transition';
	import { tradeErrorMessage } from '#lib/canisters/clearing.errors.ts';
	import FlowBottomBar from '#lib/components/market/FlowBottomBar.svelte';
	import FlowCard from '#lib/components/market/FlowCard.svelte';
	import FlowComboBanner from '#lib/components/market/FlowComboBanner.svelte';
	import FlowDailyCap from '#lib/components/market/FlowDailyCap.svelte';
	import FlowEmptyDeck from '#lib/components/market/FlowEmptyDeck.svelte';
	import FlowEnd from '#lib/components/market/FlowEnd.svelte';
	import FlowEntry from '#lib/components/market/FlowEntry.svelte';
	import FlowOutOfFunds from '#lib/components/market/FlowOutOfFunds.svelte';
	import FlowStreakBreakBanner from '#lib/components/market/FlowStreakBreakBanner.svelte';
	import FlowTopBar from '#lib/components/market/FlowTopBar.svelte';
	import FlowXpPops from '#lib/components/market/FlowXpPops.svelte';
	import MotionBeat from '#lib/components/market/MotionBeat.svelte';
	import SwipeHint from '#lib/components/market/SwipeHint.svelte';
	import XpToast from '#lib/components/market/XpToast.svelte';
	import FlowCoach from '#lib/components/onboarding/FlowCoach.svelte';
	import A2hsSheet from '#lib/components/pwa/A2hsSheet.svelte';
	import { ZERO } from '#lib/constants/app.constants.ts';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { VXP_TOKEN } from '#lib/constants/tokens/tokens.ic.constants.ts';
	import { isVxpLadderStake, VXP_MIN_STAKE } from '#lib/constants/vxp-economy.constants.ts';
	import { balanceDomain } from '#lib/derived/balance-domain.derived.ts';
	import { featuredEvent, featuredEventActive } from '#lib/derived/featured-event.derived.ts';
	import { guestMode } from '#lib/derived/guest.derived.ts';
	import { playgroundFlowTradeUnitLabel } from '#lib/derived/playground.derived.ts';
	import { minuteTick_ms } from '#lib/derived/time.derived.ts';
	import { vxpSpendable } from '#lib/derived/vxp-holdings.derived.ts';
	import { track } from '#lib/services/analytics.services.ts';
	import { prepareFlow, type PreparedFlow } from '#lib/services/flow-prep.services.ts';
	import { flowTradeService } from '#lib/services/flow.services.ts';
	import { persistDailyStreak, recordFlowSwipe } from '#lib/services/profile.services.ts';
	import { loadMarketPriceCandles } from '#lib/services/trade.services.ts';
	import { canInstall, shouldAutoPrompt } from '#lib/stores/a2hs.store.ts';
	import { collateralsStore } from '#lib/stores/collaterals.store.ts';
	import { showCompanion } from '#lib/stores/companion.store.ts';
	import { setFlowBeatActive } from '#lib/stores/flow-beat.store.ts';
	import { advanceFlow, peekFlow } from '#lib/stores/flow.store.ts';
	import { recordGuestPick } from '#lib/stores/guest.store.ts';
	import { markResolutionsSeen, maturedResolutions } from '#lib/stores/inbox.store.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { marketLanguagePreference } from '#lib/stores/market-language.store.ts';
	import {
		hydrate as hydrateMarketTranslations,
		marketTranslations
	} from '#lib/stores/market-translations.store.ts';
	import { notificationsStore } from '#lib/stores/notification.store.ts';
	import { preferencesStore } from '#lib/stores/preferences.store.ts';
	import { userStore } from '#lib/stores/user.store.ts';
	import type { FlowEntryMethod, ResolutionRevealData, XpPop } from '#lib/types/flow.ts';
	import type { MarketMetadata } from '#lib/types/market-metadata.ts';
	import type { UserMarketSignals } from '#lib/types/market-signals.ts';
	import type { CallSide, FlowAction, Market, MarketId } from '#lib/types/market.ts';
	import { isViciXp } from '#lib/utils/balance-domain.utils.ts';
	import {
		applyDailyGoalBump,
		DAILY_GOAL_TARGET,
		reconcileDailyGoalOnEntry,
		rolloverDailyGoal,
		writeDailyGoalMirror
	} from '#lib/utils/daily-goal.utils.ts';
	import { resolveFlowArtCategory } from '#lib/utils/flow-art.utils.ts';
	import { consumePinnedFlowMarket } from '#lib/utils/flow-pin.utils.ts';
	import {
		canExtendSession,
		isDailyCapReached,
		isOvertimeSession,
		maxCallsFor,
		sittingGoalFor
	} from '#lib/utils/flow-session.utils.ts';
	import {
		flowBeat,
		flowSummary,
		flowTick,
		flowWild,
		resumeFlowSound,
		unlockFlowSound
	} from '#lib/utils/flow-sound.utils.ts';
	import { probabilityToPercent } from '#lib/utils/format.utils.ts';
	import { haptic, hapticForBeat } from '#lib/utils/haptics.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import type { MarketPriceSeries } from '#lib/utils/market-price-history.utils.ts';
	import {
		marketDisplayText,
		translatedLanguageLabel
	} from '#lib/utils/market-translation.utils.ts';
	import {
		DAILY_HARD_CAP,
		recordMotionSwipe,
		type MotionBeatPayload
	} from '#lib/utils/motion-engine.utils.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { parseToken, tokenBaseUnitsToUsdBaseUnits } from '#lib/utils/parse.utils.ts';
	import { prefersReducedMotion } from '#lib/utils/reduced-motion.utils.ts';
	import {
		applyDailyStreakBump,
		stageForStreak,
		type FlameStage
	} from '#lib/utils/streak.utils.ts';
	import { assertViciXpHumanPremium } from '#lib/utils/trade.utils.ts';
	import { vxpBaseUnits } from '#lib/utils/vxp-amount.utils.ts';
	import { goto } from '$app/navigation';

	// Daily goal: a per-user count of predictions committed today,
	// hydrated from the profile and rolled over to 0 on a new local day.
	// The day's target is the standard ten; the user can opt into overtime
	// (Push-to-15) to extend the SESSION to the daily hard cap. Progress is
	// capped at 100 % so the bar / percent never overflows. The day's
	// target (`DAILY_GOAL_TARGET`) is shared with the dashboard resume card.

	// Calls already committed toward today's goal BEFORE this sitting:
	// the cumulative daily count snapshotted on entry (after the
	// profile / mirror reconciliation in `onMount`). The day's goal is a
	// persisted running total, not a per-visit counter: a sitting resumes
	// from this baseline rather than restarting at 0, so progress survives
	// navigation (#485) and the daily hard cap holds across sittings (#484).
	let sessionBaseline = $state(0);
	// The user opted into overtime (Push-to-15) on FlowEnd, lifting this
	// sitting's ceiling to the daily hard cap so the deck continues past
	// the daily ten and the engine's overtime beats fire.
	let pushedToOvertime = $state(false);

	// This sitting's ceiling for the cumulative daily count, and the swipes
	// it may still place (the ceiling less what the day already carried in).
	// `advance()` ends the run on the SESSION counter (`callsCount`) reaching
	// `maxCalls`, which is exactly the cumulative daily count reaching
	// `sittingGoal`, so the cap holds regardless of how many times Flow is
	// re-entered today. See `flow-session.utils` for the arithmetic.
	const sittingGoal = $derived(sittingGoalFor({ baseline: sessionBaseline, pushedToOvertime }));
	const maxCalls = $derived(maxCallsFor({ sittingGoal, baseline: sessionBaseline }));

	let markets = $state<Market[]>([]);
	let currentIndex = $state(0);
	let loading = $state(true);
	// Entry beat: the full-bleed frosted FlowEntry overlay sits over the deck
	// until the session begins. It carries the deck-shuffle loading state AND
	// the "while you were away" digest. A no-op digest (`count === 0`) renders
	// the deck-shuffle beat, which auto-enters the moment the deck is ready (a
	// brief branded moment, no required tap); a real digest waits for the user
	// (tap-anywhere / CTA, with a safety auto-enter). See FlowEntry.
	let entered = $state(false);
	// Deck gestures stay disarmed until the first card has risen in after
	// entry. The entry overlay enters on `pointerdown`, so the dismissing
	// tap's trailing events: desktop `mouseup`/`click`, and the synthetic
	// mouse chain a touch fires ~300 ms after `touchend`: would otherwise
	// land on the freshly-mounted FlowCard and register as a tap-to-flip.
	// 480 ms clears both windows and the 440 ms rise-in animation.
	let deckGesturesArmed = $state(false);
	const ENTRY_GESTURE_GUARD_MS = 480;

	// Arm deck gestures once the entry transition's trailing events have
	// drained (see above). Driven by `entered` so the timer is cleared if
	// FlowMode unmounts mid-window.
	$effect(() => {
		if (!entered) {
			return;
		}

		const timer = setTimeout(() => (deckGesturesArmed = true), ENTRY_GESTURE_GUARD_MS);

		return () => clearTimeout(timer);
	});

	// The away-digest while the entry gate is open. Tracks the live store so
	// a late trade-history fetch still populates the recap; the moment the
	// user enters, `markResolutionsSeen` empties it and the overlay unmounts
	// in the same tick, so the recap never blanks under the deck (Svelte
	// freezes the last render for the `out:fade`). `ResolutionRevealData` is
	// the shared shape the Dashboard banner / ResolutionReveal also consume.
	const liveDigest = $derived<ResolutionRevealData>($maturedResolutions);
	let tradeAmount = $state('1.0');
	let callsCount = $state(0);
	// VXP locked at risk across this session's calls; the FlowEnd "Called"
	// stat. Accumulates each committed YES / NO stake; reset on continuation.
	let sessionStaked = $state(0);
	// Clearing-margin base units the session has already sent to the engine.
	// The funds gate needs it because store refreshes are batched to session
	// end (see FlowTradeService): `$vxpSpendable` alone goes stale after the
	// first call. A failed call subtracts itself back out.
	let sessionCommittedUsd = $state(ZERO);
	let completed = $state(false);

	// Install nudge on the summary. The FlowEnd row shows only when the app
	// can be installed AND the trigger thresholds hold for the user's lifetime
	// call count (`totalTrades`): primary at >= 15, fallback at >= 10 on a
	// 2nd+ session, never in cool-off / installed / already-shown. `a2hsSheetOpen`
	// owns the shared install sheet, opened from the row.
	let a2hsSheetOpen = $state(false);
	const showInstallNudge = $derived(
		$canInstall && shouldAutoPrompt($userStore.profile?.totalTrades ?? 0)
	);

	// `nowMs` tracks the shared one-minute heartbeat while the session is in
	// flight (minute precision is plenty for a day rollover), but freezes once
	// `completed` flips true so the FlowEnd takeover's Push-to-15 eligibility
	// (a `dailyGoalDone` consumer) can't shift under the user near midnight,
	// matching the prior 1s ticker that stopped on `completed`.
	let nowMs = $state(Date.now());
	$effect(() => {
		if (completed) {
			return;
		}

		nowMs = $minuteTick_ms;
	});
	// `seriesId → stored tags` lookup loaded once on mount; consumed by the
	// FlowCard render loop to drive the per-card generative artwork (which
	// resolves the primary macro: see `resolveFlowArtCategory`).
	let marketTagMap = $state<Record<string, string[]>>({});
	let marketMetadataMap = $state<Map<MarketId, MarketMetadata>>(new Map());
	// Real, market-wide 7d price history (0–100 YES series + time-axis
	// x-fractions) for the cards the viewer actually lands on, keyed by market
	// id. Only the focused card renders, so this fills one bounded candle
	// query at a time (never the whole deck up front), and a market the viewer
	// never reaches is never fetched. Absent entries leave the back-face
	// sparkline on its seed shape.
	const priceHistoryById = new SvelteMap<MarketId, MarketPriceSeries>();
	// Markets with a price-history fetch in flight. The cache key only lands
	// once the request resolves, so without this an away-and-back swipe could
	// re-fire the effect and issue a duplicate query for the same market. Read
	// via `untrack` below so add/delete don't themselves re-trigger the effect
	// (a tracked delete would re-fire and refetch on persistent failure).
	const priceHistoryInFlight = new SvelteSet<MarketId>();
	let userSignals = $state<UserMarketSignals>({
		categoryAcc: {},
		priorCalls: {},
		followedLean: {}
	});

	let exitX = $state(0);
	let exitY = $state(0);

	// Commit-feedback beat: the outgoing card holds for 80 ms with edge
	// tint locked at full intensity before it flies off-screen. 80 ms
	// is the upper bound of the reactive-motion budget (80–150 ms); past
	// 200 ms the swipe rhythm breaks and the lag becomes the experience.
	//
	// Bound to the committed market's id so that once `advance()` shifts
	// the deck, the *next* card never inherits the committed state; the
	// outgoing card keeps it for the duration of its exit transition.
	let committedAction = $state<FlowAction | null>(null);
	let committedMarketId = $state<string | null>(null);
	const COMMIT_FEEDBACK_MS = 80;
	const COMMIT_RESET_MS = 600;

	let streak = $state(0);
	let xp = $state(0);
	let lastStreakShown = $state(0);

	// Daily-streak engine: read from the persisted profile on entry,
	// bump locally on the first swipe of a new local day. The Flow top
	// bar shows the resulting Flame stage; on break we fire the low-thud
	// haptic and a single-line banner ("Blaze ended", etc.).
	// (Server-side persistence on session end is a separate follow-up.)
	let dailyStreak = $state(0);
	let lastActiveDay = $state<string | undefined>(undefined);
	// Daily-goal counter + the local day it belongs to. Hydrated from the
	// profile on mount and recorded server-side after every committed
	// prediction, so the goal survives a refresh and resets when the day
	// rolls over.
	let dailyGoalCount = $state(0);
	let dailyGoalDate = $state<string | undefined>(undefined);
	let hasMarkedActiveThisSession = false;
	// Set on the first swipe of a session that resumes after a broken
	// streak. Drives the no-shame "comeback" opener (distinct from the
	// daily welcome-back) in the motion engine for the rest of the session,
	// and the FlowEnd "comeback" variant. `$state` so the FlowEnd prop
	// reactively picks up the mid-session flip.
	let isComeback = $state(false);
	let streakBreakBanner = $state<{ stage: FlameStage } | null>(null);
	let flowPaused = $state(false);
	let activeMotionBeat = $state<MotionBeatPayload | null>(null);

	// Broadcast "a Flow character beat is on screen" to the achievement
	// celebration host so a freshly-crossed Menagerie tier reveal is held until
	// the beat clears (card → character beat → trophy). A centered character
	// beat or the session-end takeover both count as a beat. Cleared on unmount
	// so a reveal never stays gated after leaving Flow.
	$effect(() => {
		const beatOnScreen = nonNullish(activeMotionBeat) || completed;
		setFlowBeatActive(beatOnScreen);
	});

	$effect(() => () => setFlowBeatActive(false));

	// Per-swipe commit pop: "CALLED YES · {stake} IN PLAY (+bonus VXP)".
	// Fires on every committed YES / NO swipe (SKIP renders nothing). A
	// swipe PLACES a call; the pop confirms the act, it does not imply a
	// payout. `key` remounts the component on consecutive commits so the
	// `xp-toast-pop` envelope replays. Self-dismisses ~1 s after mount.
	interface CommitToast {
		side: CallSide;
		stake: number;
		bonus: number;
		key: number;
	}
	let commitToast = $state<CommitToast | null>(null);
	let commitToastKeySeq = $state(0);

	const flameStage: FlameStage = $derived(stageForStreak(dailyStreak));

	let xpPops = $state<XpPop[]>([]);
	let popCounter = 0;

	// Local alias: every haptic in this file maps to a named pattern
	// from `haptics.utils.ts`. Naming kept minimal so existing call
	// sites read the same way.
	const vibrate = haptic;

	// Daily-goal progress for the top-bar chip. Roll over against the live
	// `nowMs` tick (not just the stored values) so a session left open across
	// local midnight resets the chip to 0 without waiting for the next
	// prediction.
	const dailyGoalDone = $derived(
		rolloverDailyGoal({ done: dailyGoalCount, date: dailyGoalDate, now: new Date(nowMs) })
	);

	// Keep the sitting baseline honest across a local-midnight rollover. The
	// baseline is snapshotted on entry, but a sitting opened just before
	// midnight would otherwise carry yesterday's count into the new day and
	// shrink `maxCalls`. While this sitting hasn't placed a call yet
	// (`callsCount === 0`), re-snapshot against the live `nowMs` day so the
	// rollover resets the baseline to the new day's count; once a call lands
	// the baseline freezes (the run owns its ceiling for the rest of the
	// sitting).
	$effect(() => {
		if (callsCount > 0) {
			return;
		}

		const rolled = rolloverDailyGoal({
			done: dailyGoalCount,
			date: dailyGoalDate,
			now: new Date(nowMs)
		});

		if (rolled !== untrack(() => sessionBaseline)) {
			sessionBaseline = rolled;
		}
	});

	// Daily hard-cap gate: once the day's calls reach the hard cap (15)
	// across sessions, opening Flow shows a "come back tomorrow" takeover
	// (not a fresh deck) so the 15/day model holds. Suppressed mid-session
	// (`callsCount === 0` means this run hasn't placed a call yet).
	const dailyCapReached = $derived(isDailyCapReached(dailyGoalDone));

	// Per-swipe count records are serialised through this FIFO chain. Firing
	// them concurrently (fast swiping) let out-of-order replies overwrite the
	// optimistic count, the visible dip, and let a session that left Flow
	// mid-flight re-read a stale-low count and re-open the daily cap. Chaining
	// keeps replies ordered; reconciliation only ever raises today's count.
	let dailyGoalRecordChain: Promise<void> = Promise.resolve();

	const enqueueDailyGoalRecord = (dayKey: string): void => {
		dailyGoalRecordChain = dailyGoalRecordChain
			.catch(() => undefined)
			.then(() => recordFlowSwipe({ dayKey }))
			.then(({ dailyGoalDone: serverDone, dailyGoalDate: serverDate }) => {
				// Mirror the authoritative server field regardless of day: the
				// FIFO chain resolves replies in enqueue order, so the profile
				// write stays monotonic in time and reflects the latest record.
				userStore.update((s) =>
					s.profile
						? {
								...s,
								profile: {
									...s.profile,
									dailyGoalDone: serverDone,
									dailyGoalDate: serverDate
								}
							}
						: s
				);

				// Reconcile the live count / mirror against this record's OWN
				// day, not the live `dailyGoalDate`. If the session swiped
				// across local midnight while this call was in flight,
				// `dailyGoalDate` has already advanced to the new day; a reply
				// for the elapsed day is stale and must not clobber it.
				if (dayKey !== dailyGoalDate) {
					return;
				}

				// Monotonic: a reply can only raise today's count, never fall
				// below the optimistic value the user already sees.
				dailyGoalCount = Math.max(dailyGoalCount, serverDone);
				writeDailyGoalMirror({ done: dailyGoalCount, date: dailyGoalDate });
			})
			.catch((e: unknown) => {
				// Non-fatal: the optimistic bump (capped at the hard cap) stands,
				// so a dropped record only ever leaves the count too HIGH; the
				// safe direction for the cap, and the next successful record
				// reconciles it. Never clamp DOWN: that was the dip, and it
				// briefly re-opened the cap.
				console.warn('Flow swipe record failed (non-fatal):', e);
			});
	};

	// Clearing-margin base units of the cheapest possible call; the smallest
	// VXP ladder rung. A user whose spendable margin can't cover even this can
	// afford NO further prediction this session, so the per-card funds gate
	// would block every YES / NO from here on (see `handleAction`). Computed
	// once: the floor is fixed, only the spendable side moves.
	const MIN_STAKE_MARGIN_USD = tokenBaseUnitsToUsdBaseUnits({
		amount: vxpBaseUnits(VXP_MIN_STAKE),
		tokenDecimals: VXP_TOKEN.decimals
	});

	// Out-of-funds takeover gate: the user has entered the deck but every
	// spendable VXP is already committed to open predictions, so no further
	// call this session can be funded (the same shortfall the per-card funds
	// gate catches, generalised to the cheapest stake). Rather than strand the
	// user on cards they can't act on: whether they hit the wall on entry or
	// part-way through: surface a takeover with explicit exits.
	// Scoped to the VXP domain: `collateralsStore` presence is the signed-in /
	// loaded check (see the funds gate), the playground domains (USD / ICP) use
	// fractional sub-rung stakes the VXP floor doesn't model. Held off while
	// `completed` (a run that met its goal earns FlowEnd, not this) and while a
	// gating beat plays (`flowPaused`) so it never flashes between cards.
	const outOfFunds = $derived(
		entered &&
			!completed &&
			!flowPaused &&
			isViciXp($balanceDomain) &&
			nonNullish($collateralsStore) &&
			$vxpSpendable - sessionCommittedUsd < MIN_STAKE_MARGIN_USD
	);

	onMount(async () => {
		document.body.classList.add('overflow-hidden');

		flowTradeService.startSession();

		try {
			// Pre-warmed deck from `flow.store`: populated on app
			// init and refreshed in the background on input changes.
			// `peekFlow` validates the cached payload against the
			// session's current balance domain and featured-event
			// scope; a mismatch (a rebuild for the new inputs is
			// still in flight) or a cold start falls through to an
			// on-demand build so the user never sees markets from
			// the previous scope.
			// A market parked by a shared prediction link (see
			// `consumePinnedFlowMarket`). Consume it once so it surfaces as the
			// first card of *this* entry only. When set we skip the pre-warmed
			// cache, it was built without the pin, and pay an on-demand build
			// so the shared market can lead the deck. Dropped by `prepareFlow`
			// if the viewer already called it.
			const pinnedMarketId = consumePinnedFlowMarket();
			const expectedTag = $featuredEventActive ? $featuredEvent.categoryTag : undefined;
			const cached = isNullish(pinnedMarketId)
				? peekFlow({
						domain: $balanceDomain,
						featuredEventTag: expectedTag
					})
				: undefined;
			const prepared: PreparedFlow = nonNullish(cached)
				? cached
				: await prepareFlow({
						domain: $balanceDomain,
						featuredEventTag: expectedTag,
						signedIn: nonNullish($userStore.user),
						pinnedMarketId
					});

			({
				markets,
				tagMap: marketTagMap,
				metadataById: marketMetadataMap,
				signals: userSignals
			} = prepared);

			// One bulk read for the whole deck so each card resolves its
			// translation overlay from cache rather than firing a per-series
			// fetch as the viewer swipes.
			void hydrateMarketTranslations(markets.map((m) => m.id));

			const { profile } = $userStore;

			if (nonNullish(profile)) {
				dailyStreak = profile.dailyStreak ?? 0;
				({ lastActiveDay } = profile);
			}

			// Seed the daily-goal count from the higher of the server value
			// and the localStorage mirror (see `reconcileDailyGoalOnEntry`):
			// the server count is authoritative, but a fast-swiping session
			// can leave Flow with per-swipe records still in flight, so the
			// freshly-read profile may lag the optimistic mirror. Taking the
			// max never lets a re-entry read below what the user committed,
			// so bouncing in and out of Flow can't re-open the hard cap.
			const reconciledGoal = reconcileDailyGoalOnEntry({
				done: profile?.dailyGoalDone ?? 0,
				date: profile?.dailyGoalDate
			});
			dailyGoalCount = reconciledGoal.done;
			dailyGoalDate = reconciledGoal.date;

			// Snapshot the cumulative daily count this sitting resumes from.
			// Rolled over against the current day so a stale stored date reads
			// as a fresh 0-baseline. Drives `sittingGoal` / `maxCalls`, so the
			// sitting grants only the day's remaining headroom (#484/#485).
			sessionBaseline = rolloverDailyGoal({
				done: reconciledGoal.done,
				date: reconciledGoal.date
			});

			const fromProfile = $userStore.profile?.preferences?.defaultAmount?.flow;

			if (isViciXp($balanceDomain)) {
				// Restore the user's last Flow stake from their profile,
				// but reject it (and fall back to `VXP_MIN_STAKE`) if it
				// isn't a current ladder rung: the ladder may have been
				// reshuffled since the value was persisted.
				const candidate = Number(fromProfile);

				tradeAmount = isVxpLadderStake(candidate) ? String(candidate) : String(VXP_MIN_STAKE);
			} else if (fromProfile) {
				tradeAmount = fromProfile;
			}
		} catch (e: unknown) {
			console.error('Failed to load Flow queue', e);
		} finally {
			loading = false;
		}
	});

	onDestroy(() => {
		document.body.classList.remove('overflow-hidden');
		void flowTradeService.endSession();

		// Product analytics: the user opened the deck (`entered`) but left
		// before reaching FlowEnd (`!completed`): a mid-deck abandon. `count`
		// carries how many calls were placed before leaving (0 = a pure
		// look-and-leave) and `step` the card index reached. A bounce at the
		// entry beat (`entered === false`) is not an abandon and fires nothing.
		// Neither is leaving mid-overtime: Push-to-15 (`pushedToOvertime`)
		// flips `completed` back to false to continue the deck, but that
		// session already reached FlowEnd (and emitted `flow_completed`) once.
		if (entered && !completed && !pushedToOvertime) {
			track({
				name: 'flow_abandoned',
				source: 'flow',
				count: callsCount,
				step: currentIndex
			});
		}

		if (nonNullish(gatingBeatTimer)) {
			clearTimeout(gatingBeatTimer);
		}

		// Promote the pre-built follow-up deck and rebuild a fresh
		// `next` excluding the markets just shown: re-entering /flow
		// opens on an unseen deck without a network round-trip.
		//
		// Only on a session that made progress. A no-op visit (open
		// /flow, swipe nothing, leave) must not advance: `advanceFlow`
		// promotes a `next` deck that excludes the entire current deck,
		// so burning it here would surface markets the user never saw,
		// or, on a small inventory, an empty follow-up deck; the next
		// time they enter Flow.
		if (callsCount > 0) {
			advanceFlow();
		}
	});

	// Arm the iOS Web Audio gesture-unlock for the lifetime of the Flow
	// session. Most cues (deferred beats, the summary chord) fire from
	// timers, not gestures, so priming once on the first touch is what
	// makes them audible on strict iOS WebKit. The effect returns the
	// listener-teardown, so it's removed when Flow unmounts.
	$effect(() => unlockFlowSound());

	// Resume the audio route the moment sound is re-enabled mid-session so
	// the next cue plays without waiting for a fresh gesture. Reads the
	// reactive flag directly so the effect re-runs on every toggle.
	$effect(() => {
		if ($preferencesStore.soundEnabled) {
			resumeFlowSound();
		}
	});

	// Spawns a centered VXP-grant pop. Only genuine engine mints (overtime
	// finish, lifetime milestones) reach this; a routine swipe mints
	// nothing (deflation-safe economy, see `docs/ai/frontend/design.md`
	// §7.3), so every pop carries a real VXP award.
	const spawnXpPop = ({ amount, copy }: { amount: number; copy?: string }) => {
		const id = ++popCounter;
		xpPops = [...xpPops, { id, amount, copy }];

		// Bonus pops linger (paired copy needs to read).
		setTimeout(() => {
			xpPops = xpPops.filter((p) => p.id !== id);
		}, 2600);
	};

	const finishCommitAdvance = () => {
		setTimeout(() => {
			advance();
		}, COMMIT_FEEDBACK_MS);
		setTimeout(() => {
			committedAction = null;
			committedMarketId = null;
		}, COMMIT_RESET_MS);
	};

	let gatingBeatTimer: ReturnType<typeof setTimeout> | null = null;

	const onMotionBeatDone = () => {
		const wasPaused = flowPaused;
		activeMotionBeat = null;
		flowPaused = false;

		if (wasPaused) {
			// Advance synchronously the instant the gap closes; the committed
			// card already flew out when the deck paused, so there is no
			// commit-feedback hold to wait on here. Deferring (as the
			// non-gating commit path does) would let the just-vacated slot
			// re-render the committed card for the delay window (`flowPaused`
			// is now false) before `advance` shifts it away; a flash. Reset
			// the committed marker too so the next card never inherits it.
			// `advance` bumps `currentIndex`, which remounts the keyed card slot
			// and replays the rise over the empty gap the character vacated.
			committedAction = null;
			committedMarketId = null;
			advance();
		}
	};

	// The stake's clearing-margin cost in USD base units (1 token ≈ 1 USD),
	// mirroring the order sizing in `executeOutcomeTrade`. Fails open to
	// `ZERO`: an unparsable amount is the engine's call to reject, not the
	// gate's.
	const stakeMarginUsd = (market: Market): bigint => {
		try {
			return tokenBaseUnitsToUsdBaseUnits({
				amount: parseToken({
					value: String(tradeAmount).trim(),
					unitName: market.token.decimals
				}),
				tokenDecimals: market.token.decimals
			});
		} catch {
			return ZERO;
		}
	};

	const handleAction = (action: FlowAction) => {
		if (completed || flowPaused) {
			return;
		}

		// Ignore double-commits during the 80 ms feedback window.
		if (nonNullish(committedMarketId)) {
			return;
		}

		const currentMarket = markets[currentIndex];

		if (!currentMarket) {
			return;
		}

		// Product analytics: the swipe is the core Layer Zero funnel step.
		track({ name: 'flow_swipe', source: 'flow', marketId: currentMarket.id, label: action });

		// Funds gate: a YES / NO stakes real collateral, and the engine
		// rejects a call the spendable margin can't cover. Catch that here,
		// BEFORE the card commits, so the deck never celebrates a prediction
		// that can't be placed. `collateralsStore` only populates for an
		// authenticated identity (see LoaderCollaterals), so its presence is
		// both the signed-in check and the loaded check; while it's absent
		// there is nothing to gate on and the engine stays the authority.
		if (
			action !== 'SKIP' &&
			nonNullish($collateralsStore) &&
			$vxpSpendable - sessionCommittedUsd < stakeMarginUsd(currentMarket)
		) {
			vibrate('low-thud');
			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'flow.notification.insufficient_title' }),
				message: t({ locale: $localeStore, key: 'flow.notification.insufficient_message' }),
				type: 'error'
			});

			return;
		}

		if (action === 'YES') {
			exitX = 500;
			exitY = 20;
			vibrate('firm-tap');
		} else if (action === 'NO') {
			exitX = -500;
			exitY = 20;
			vibrate('firm-tap');
		} else if (action === 'SKIP') {
			exitX = 0;
			exitY = -500;
			// Skip is a negative-state: softer beat than YES / NO so the
			// rhythm reads "passed" not "committed".
			vibrate('soft-tick');
		}

		// Lock the outgoing card into its commit-feedback beat. Drag is
		// disabled in FlowCard for the matching market.id; the matching
		// edge tint and directional label go to full opacity.
		committedAction = action;
		committedMarketId = currentMarket.id;

		// Daily-streak bump: fires once per session on the first
		// committed swipe. Any of YES / NO / SKIP qualifies (streak
		// progresses on any swipe).
		if (!hasMarkedActiveThisSession) {
			const bump = applyDailyStreakBump({ streak: dailyStreak, lastActiveDay });
			({ streak: dailyStreak, lastActiveDay } = bump);
			hasMarkedActiveThisSession = true;

			// Persist server-side once per session: survives refresh.
			// Best-effort; on failure, the local values still drive the
			// rest of the session and the next session re-runs the bump.
			if (bump.bumped) {
				const principal = $userStore.user?.key;
				const persistedDay = lastActiveDay;
				const persistedStreak = dailyStreak;

				if (nonNullish(principal) && nonNullish(persistedDay)) {
					void persistDailyStreak({
						principal,
						dailyStreak: persistedStreak,
						lastActiveDay: persistedDay
					})
						.then((data) => {
							userStore.update((s) => ({ ...s, profile: data }));
						})
						.catch((e: unknown) => {
							console.warn('Daily-streak persistence failed (non-fatal):', e);
						});
				}
			}

			if (bump.transition === 'break') {
				isComeback = true;
				const previousStage = stageForStreak(Math.max(1, $userStore.profile?.dailyStreak ?? 0));
				streakBreakBanner = { stage: previousStage };
				vibrate('low-thud');
				setTimeout(() => {
					streakBreakBanner = null;
				}, 3200);
			}
		}

		if (action === 'SKIP') {
			// Skip is a no-op for the session combo: it doesn't bump
			// (skip isn't a call) and doesn't reset (skip is neutral:
			// it's not a win and not a loss). The daily streak still
			// bumps via `applyDailyStreakBump` above; streak progresses
			// on any swipe, YES / NO / SKIP all count at that layer.
			recordMotionSwipe({
				side: 'SKIP',
				dailyDone: sessionBaseline + callsCount,
				dailyTarget: sittingGoal,
				dailyJustCompleted: false,
				dayStreak: dailyStreak
			});
			finishCommitAdvance();

			return;
		}

		const stakeHuman = Number(tradeAmount) || 0;
		const stakeUsd = stakeMarginUsd(currentMarket);

		// Guest preview branch: a guest pick never reaches the engine. We
		// record it as an in-session preview pick (marketId / side only, no
		// stake) purely to power the conversion cadence, and skip `placeOrder`
		// / the identity call entirely. Free guest play therefore can't move
		// market prices. The session-stake accounting and the funds gate are
		// member-only (the guest has no balance), so they are bypassed here.
		if ($guestMode) {
			const guestPickNumber = recordGuestPick({ marketId: currentMarket.id, side: action });

			// `position_taken` with `source: 'guest_flow'` separates guest
			// activity from member activity without a new event; `count` is the
			// persisted session pick number (the cadence counter), so it stays
			// consistent across a reload rather than tracking this sitting's
			// in-memory `callsCount`.
			track({
				name: 'position_taken',
				source: 'guest_flow',
				marketId: currentMarket.id,
				label: action,
				count: guestPickNumber
			});

			callsCount += 1;
			streak += 1;
			flowTick();
			finishCommitAdvance();

			return;
		}

		sessionCommittedUsd += stakeUsd;

		const executeTrade = async () => {
			try {
				if (isViciXp(currentMarket.balanceDomain)) {
					assertViciXpHumanPremium({ amountStr: tradeAmount });
				}

				await flowTradeService.executeTrade({
					market: currentMarket,
					action,
					amount: tradeAmount
				});
			} catch (e: unknown) {
				// The call never reached the book: pull its stake back out of
				// the session tallies so the FlowEnd "Called" stat and the funds
				// gate only count predictions that actually hold collateral.
				sessionStaked = Math.max(0, sessionStaked - stakeHuman);
				sessionCommittedUsd =
					sessionCommittedUsd > stakeUsd ? sessionCommittedUsd - stakeUsd : ZERO;

				const { key, params } = tradeErrorMessage(e);

				notificationsStore.add({
					title: t({ locale: $localeStore, key: 'flow.notification.trade_failed_title' }),
					message: t({
						locale: $localeStore,
						key: 'flow.notification.trade_failed_message',
						params: {
							title: marketDisplayText({
								market: currentMarket,
								translation: $marketTranslations.get(currentMarket.id),
								showOriginal: flowShowOriginal
							}).title.slice(0, 30),
							error: t({ locale: $localeStore, key, params })
						}
					}),
					type: 'error'
				});
			}
		};

		void executeTrade();

		callsCount += 1;
		streak += 1;
		// Tally the stake now at risk for the FlowEnd "Called" stat.
		sessionStaked += stakeHuman;

		// Daily-goal bump: every committed YES / NO counts toward the
		// day's goal (skips returned early above). The OPTIMISTIC local bump
		// runs first so the in-session cadence / cap takeover react instantly;
		// it rolls over to a fresh day if needed and caps at the hard cap.
		// This is the cross-session streak / hard-cap source; the engine's
		// beat cadence runs off the per-session counter below.
		const goalBump = applyDailyGoalBump({
			done: dailyGoalCount,
			date: dailyGoalDate,
			// Count up to the daily hard cap (15) so the cross-session
			// "come back tomorrow" gate fires after a full overtime day; the
			// streak still completes at the daily ten via the streak engine.
			target: DAILY_HARD_CAP
		});
		dailyGoalCount = goalBump.done;
		dailyGoalDate = goalBump.date;

		// Synchronous, offline-safe mirror: written before the server
		// round-trip below so the daily hard cap survives a refresh that
		// races the record, and so a re-entry mid-flight reads the optimistic
		// high-water rather than a lagging server count (see
		// `reconcileDailyGoalOnEntry`).
		writeDailyGoalMirror(goalBump);

		const goalPrincipal = $userStore.user?.key;

		// Record the swipe SERVER-side: the satellite owns the count. Chained
		// through the FIFO queue so fast swiping can't fire records
		// concurrently; the reply only ever raises today's count.
		if (nonNullish(goalPrincipal)) {
			enqueueDailyGoalRecord(goalBump.date);
		}

		// Per-swipe sound cue: one tick per committed call (YES / NO).
		// SKIP returned early above and is intentionally silent, mirroring
		// the haptic channel. On iOS Safari (no Vibration API) this tick is
		// the only swipe feedback the user gets.
		flowTick();

		if (streak === 3 || streak === 5 || streak === 10) {
			const shown = streak;
			lastStreakShown = shown;
			vibrate('triple-tap');
			setTimeout(() => {
				if (lastStreakShown === shown) {
					lastStreakShown = 0;
				}
			}, 2400);
		}

		// A call is "contrarian" only against a known crowd consensus. With an
		// unknown probability (book unread / no liquidity) there's no consensus
		// to lean against, so the swipe is treated as neutral (not contrarian)
		// rather than assuming a 50/50 split; the motion engine still receives
		// a definite boolean.
		const yesProb = currentMarket.yesProbability;
		const isContrarian = nonNullish(yesProb) && (yesProb <= 0.25 || yesProb >= 0.75);

		// The motion engine's cadence (rhythm 3 / 5 / 8, overtime 11 / 13, and
		// the daily / overtime-complete beat) keys off the CUMULATIVE daily
		// call number, not this sitting's count, so a sitting resumed mid-day
		// continues the day's rhythm from where it left off instead of
		// replaying call #1's schedule, and the overtime beats land on the
		// real 11th / 13th call of the day. `dailyGoalDone` (already bumped for
		// this swipe above, capped at the hard cap) is that cumulative number;
		// `sittingGoal` is the day's ceiling: 15 in overtime, so
		// `dailyTarget >= DAILY_HARD_CAP` flips the engine into overtime and the
		// calls-11 / 13 beats plus the overtime-complete +25 VXP fire.
		const dailyDone = goalBump.done; // this swipe included (bumped above)
		const dailyJustCompleted = dailyDone >= sittingGoal;

		const motion = recordMotionSwipe({
			side: action,
			isContrarian,
			dailyDone,
			dailyTarget: sittingGoal,
			dailyJustCompleted,
			dayStreak: dailyStreak,
			isComeback,
			// Seed the engine's lifetime-volume milestones from the REAL
			// profile count (`totalTrades`, our lifetime call count) so
			// milestone thresholds and the milestone count-up reflect actual
			// lifetime activity. The engine treats it as a FLOOR merged with
			// its own persisted tally: `totalTrades` is recomputed from
			// trade history on profile syncs, not bumped per swipe, so it
			// lags in-session and alone would replay the same milestone
			// every swipe. `totalTrades` is the count BEFORE this swipe; the
			// engine accounts for the current swipe internally.
			lifetimeCalls: $userStore.profile?.totalTrades
		});

		// Whether this swipe also lands on a gating beat. When it does, the
		// centered MotionBeat already owns the slot: suppress the centered
		// bonus pop so the two don't stack in the same area.
		const hasGatingBeat = nonNullish(motion.beat) && motion.beat.kind !== 'ambient-10';

		// A swipe mints no VXP: the economy is deflation-safe (see
		// `docs/ai/frontend/design.md` §7.3). Real VXP is credited only by
		// the motion engine's genuine grants (overtime finish, lifetime
		// milestones), surfaced below; the session combo drives haptics and
		// the streak banner only, never a per-swipe payout.
		if (motion.bonusXp > 0) {
			xp += motion.bonusXp;

			const popCopy = nonNullish(motion.beat?.copyKey)
				? t({ locale: $localeStore, key: motion.beat.copyKey })
				: undefined;

			// Suppress centered bonus pop too when a gating beat will fill
			// the center; the XpToast bonus chip already carries the amount.
			if (!hasGatingBeat) {
				spawnXpPop({
					amount: motion.bonusXp,
					copy: popCopy
				});
			}
		}

		// Per-swipe commit pop: every committed YES / NO. Confirms the
		// call was placed ("CALLED YES · {stake} IN PLAY") with the stake
		// now at risk; a genuine milestone / streak bonus rides along as a
		// trailing chip. Light and non-blocking: runs over the card-out,
		// the gap beat, and the next card's rise alike.
		commitToastKeySeq += 1;
		commitToast = {
			side: action,
			stake: stakeHuman,
			bonus: motion.bonusXp,
			key: commitToastKeySeq
		};

		// Beat-aware haptic envelope mapped from `beat.kind`. Fires paired
		// with the beat's REVEAL, not the swipe commit: see below. On the
		// first-call beat the `firm-tap` swipe-commit haptic has already
		// fired upstream; that envelope is itself celebratory, so the commit
		// + beat firing back-to-back is intentional.
		const beatHaptic = hapticForBeat(motion.beat?.kind);

		// The beat's haptic + sound cue are paired with the moment the
		// character is revealed, not the swipe commit, so the "thunk" lands
		// on the pop rather than on the empty-slot gap. A wildcard treat
		// plays the playful arpeggio; otherwise a gating beat (any non-ambient
		// beat) plays the bigger "hard" figure and the ambient `ambient-10`
		// pop plays the soft beat.
		const fireBeatCue = () => {
			if (beatHaptic) {
				vibrate(beatHaptic);
			}

			if (motion.beat) {
				if (motion.beat.kind === 'wildcard') {
					flowWild();
				} else {
					flowBeat(motion.beat.kind !== 'ambient-10');
				}
			}
		};

		// A real beat plays IN THE GAP. The deck holds (`flowPaused`): the
		// called card flies out, the empty slot opens, then the REAL
		// character stands large & centered in it: name · copy · coin /
		// treat chips · sub-label: before the next card rises over.
		// `flowPaused` flips now so the outgoing card hides and drag locks;
		// the centered beat is revealed 250 ms later so the card-out clears
		// the slot first, and the haptic + sound cue fire WITH that reveal.
		// Ambient (`ambient-10`) is a soft pop that never gates; it advances
		// immediately, with its cue paired to its immediate reveal. Advance is
		// deferred to `onMotionBeatDone` for gating beats.
		if (motion.beat && motion.beat.kind !== 'ambient-10') {
			const gatingBeat = motion.beat;
			flowPaused = true;

			if (nonNullish(gatingBeatTimer)) {
				clearTimeout(gatingBeatTimer);
			}

			gatingBeatTimer = setTimeout(() => {
				activeMotionBeat = gatingBeat;
				fireBeatCue();
				gatingBeatTimer = null;
			}, 250);

			return;
		}

		if (motion.beat) {
			activeMotionBeat = motion.beat;
			fireBeatCue();
		}

		// Non-gating commit: the per-swipe `XpToast` above is the feedback;
		// no full-stage overlay (it would double-stack with the toast / the
		// ambient pop). The deck advances after the short commit-feedback
		// beat. SKIP returned earlier with its own quick chip.
		finishCommitAdvance();
	};

	const advance = () => {
		// End the run when the SITTING is spent: either the deck is exhausted
		// or this sitting has placed its share of the day's headroom
		// (`maxCalls = sittingGoal - sessionBaseline`). Since `callsCount` is
		// this sitting's count, `callsCount < maxCalls` is exactly
		// `sessionBaseline + callsCount < sittingGoal`: the cumulative daily
		// count below the day's ceiling, so the hard cap holds no matter how
		// many sittings the day is split across (#484).
		if (currentIndex < markets.length - 1 && callsCount < maxCalls) {
			currentIndex += 1;
		} else {
			completed = true;
			// Product analytics: the session reached FlowEnd (the deck/sitting
			// goal was spent rather than abandoned mid-deck). `count` carries the
			// calls placed this sitting; `label` separates an overtime finish
			// from a regular one.
			track({
				name: 'flow_completed',
				source: 'flow',
				count: callsCount,
				label: overtimeSession ? 'overtime' : 'regular'
			});
			vibrate('celebration');
			// Session-summary sound cue: the rising four-note chord that
			// closes out a Flow session, played as FlowEnd takes over.
			flowSummary();
		}
	};

	// Whether the day's sitting goal is the hard cap (15); the day entered
	// in overtime or the user opted in via Push-to-15. Drives the FlowEnd
	// "overtime" variant.
	const overtimeSession = $derived(isOvertimeSession(sittingGoal));

	// Push-to-15 is offered only on a regular (non-overtime) day that still
	// has deck inventory to continue into: never once the hard cap is in
	// play. `callsCount` reached `maxCalls` for FlowEnd to show. Also gated on
	// `dailyGoalDone < DAILY_HARD_CAP`: a user who entered Flow with the day
	// already at the cap has no cross-session headroom left and must come
	// back tomorrow.
	const canExtend = $derived(
		canExtendSession({
			overtimeSession,
			hasMoreCards: currentIndex < markets.length - 1,
			dailyGoalDone
		})
	);

	// "Push to 15 →": lift this sitting's goal to the daily hard cap,
	// dismiss the takeover, and rise the next card so the deck continues
	// into overtime. `sittingGoal` becomes `DAILY_HARD_CAP`, so `maxCalls`
	// (`DAILY_HARD_CAP - sessionBaseline`) covers exactly the day's remaining
	// headroom: total daily calls (cross-session) never exceed the cap.
	//
	// For a fresh-day user (sessionBaseline = 0): maxCalls goes 10 → 15, and
	// `dailyTarget = sittingGoal = 15 >= DAILY_HARD_CAP` keeps the engine in
	// overtime mode so the calls-11 / 13 beats and the overtime-complete
	// +25 VXP fire correctly. For a user who carried prior calls in, the
	// overtime arc is proportionally shorter: intentional, the cap stays 15.
	const handleExtend = () => {
		pushedToOvertime = true;
		completed = false;
		currentIndex += 1;
	};

	const backToMarkets = () => {
		goto(resolveAppPath(AppPath.Home));
	};

	// Enter Flow: the entry beat cleared (deck-mode auto-enter, the digest
	// safety net, a tap-anywhere, or the CTA). Settle the matured calls
	// (acknowledge them so the Dashboard banner / bell badge clear in
	// lockstep) and reveal the deck. `markResolutionsSeen`
	// empties `liveDigest`, but flipping `entered` removes the overlay in
	// the same tick: Svelte freezes the last-rendered digest for the
	// `out:fade`, so the recap never flips to deck-shuffle mid-transition.
	const enterFlow = (entry: FlowEntryMethod) => {
		// Product analytics: the open of a Flow session, the funnel's top.
		// `label` separates a deliberate tap from a timer-driven auto-enter;
		// `ok` flags whether the user had already met today's daily goal before
		// this session began (a "bonus"/overtime open vs. a first-of-the-day
		// open). Snapshotted before `markResolutionsSeen` so the daily count is
		// the pre-session value. Fire-and-forget; never blocks the reveal.
		track({
			name: 'flow_session_started',
			source: 'flow',
			label: entry,
			ok: dailyGoalDone >= DAILY_GOAL_TARGET
		});

		markResolutionsSeen();
		entered = true;
	};

	// "Back to dashboard →": close the takeover and return to the
	// dashboard. The session's calls are already placed (the FlowEnd is a
	// summary, not a commit step); this only picks where the user goes next.
	const handleClose = () => {
		goto(resolveAppPath(AppPath.Dash));
	};

	// The back-face peg-rail owns stake selection on the VXP balance
	// domain. The playground domains (USD / ICP) use fractional amounts
	// that the peg-rail doesn't cover, so we keep a small bottom-bar
	// stepper for those: see `playgroundOnly` gate around `FlowBottomBar`
	// in the template.
	const playgroundOnly = $derived(!isViciXp($balanceDomain));

	const incrementAmount = (direction: 1 | -1) => {
		const step = 0.1;
		const min = 0.1;
		const current = Number(tradeAmount) || 0;
		const next = Math.max(min, Number((current + direction * step).toFixed(2)));
		tradeAmount = String(next);
	};

	const currentCard = $derived(markets[currentIndex]);

	// Spendable margin left for THIS card once the session's in-flight
	// commitments are subtracted (store refreshes are batched to session end,
	// so `$vxpSpendable` alone goes stale after the first call).
	const spendableNow = $derived($vxpSpendable - sessionCommittedUsd);

	// Proactive stake warning surfaced at amount-selection time on the
	// back-face slider: distinct from the block-on-swipe funds gate, which
	// only fires once the user throws the card. Resolved to a single state so
	// the slider renders one line. Scoped to a signed-in, loaded, VXP-domain
	// run with a card on screen (the playground domains use sub-rung stakes the
	// VXP floor doesn't model; `collateralsStore` presence is the signed-in /
	// loaded check, mirroring the funds gate).
	const stakeWarning = $derived.by<'none' | 'unaffordable' | 'wont-finish'>(() => {
		if (isNullish($collateralsStore) || !isViciXp($balanceDomain) || isNullish(currentCard)) {
			return 'none';
		}

		const thisStake = stakeMarginUsd(currentCard);

		// The selected size already exceeds what's spendable; the swipe would
		// be rejected by the funds gate. Warn before they throw it.
		if (thisStake > spendableNow) {
			return 'unaffordable';
		}

		// Affordable now, but committing it would leave too little to fund the
		// predictions still needed to finish the sitting (min stake each).
		const remainingAfterThis = Math.max(0, maxCalls - callsCount - 1);

		if (
			remainingAfterThis > 0 &&
			spendableNow - thisStake < BigInt(remainingAfterThis) * MIN_STAKE_MARGIN_USD
		) {
			return 'wont-finish';
		}

		return 'none';
	});

	// Defensive: the active-deck branch renders `currentCard` (markets[currentIndex]).
	// If `currentIndex` ever overruns the deck while the session is still live
	// (entered, not completed, deck non-empty), `currentCard` is nullish and the
	// card slot would paint an empty / black stage with no way forward. Fall the
	// session through to the FlowEnd takeover instead so the user always has an
	// exit. This is a safety net for an index-overflow we don't expect to hit,
	// not the root fix.
	const activeDeckStranded = $derived(
		entered && !completed && markets.length > 0 && isNullish(currentCard)
	);

	// Resolved translation overlay for the focused card (or undefined when the
	// market has no translation for the active locale): gates the card's quick
	// toggle and feeds its display text.
	const currentTranslation = $derived(
		nonNullish(currentCard) ? $marketTranslations.get(currentCard.id) : undefined
	);

	// Per-card quick-toggle state. Seeds from the global preference and resets
	// to that default whenever the focused card changes (a flip is local to the
	// card the viewer is on and doesn't change the preference).
	let flowShowOriginal = $state($marketLanguagePreference === 'original');
	$effect(() => {
		currentIndex;
		$marketLanguagePreference;
		flowShowOriginal = $marketLanguagePreference === 'original';
	});

	const onToggleFlowTranslation = () => {
		flowShowOriginal = !flowShowOriginal;

		if (nonNullish(currentCard)) {
			track({
				name: 'market_translation_toggled',
				marketId: currentCard.id,
				source: 'deck',
				label: flowShowOriginal ? 'original' : 'translated'
			});
		}
	};

	// Lazily fetch the focused card's real price history the first time it's
	// reached (cached by id, so re-visiting is instant). Independent of the
	// viewer: it's the same series for everyone, so it loads regardless of
	// sign-in. Fails open: any error leaves the entry absent, so the back
	// face stays on its seed-based sparkline.
	$effect(() => {
		const id = currentCard?.id;

		if (isNullish(id) || priceHistoryById.has(id) || untrack(() => priceHistoryInFlight.has(id))) {
			return;
		}

		priceHistoryInFlight.add(id);

		void loadMarketPriceCandles({
			seriesId: id,
			period: '7d',
			onLoad: ({ response }) => {
				priceHistoryById.set(id, response);
			}
		})
			.catch(() => {
				// Leave the entry absent → back face keeps its seed sparkline.
			})
			.finally(() => {
				priceHistoryInFlight.delete(id);
			});
	});

	// Trickster appears on the active card when the YES probability is
	// strongly skewed (≤ 25 % or ≥ 75 %), i.e. when committing on this
	// card would put the user in the minority on a contrarian call.
	// Trickster owns this surface alone (defended territory); no other
	// per-card ambient beat pre-empts it.
	const trickstered = new SvelteSet<string>();

	$effect(() => {
		const m = markets[currentIndex];

		if (isNullish(m) || trickstered.has(m.id)) {
			return;
		}

		// No consensus yet when the probability is unknown (book unread /
		// no liquidity): there's no minority side to nudge against, so the
		// Trickster contrarian beat stays quiet rather than asserting 50/50.
		const yes = m.yesProbability;

		if (isNullish(yes)) {
			return;
		}

		const consensusSide = yes >= 0.75 ? 'YES' : yes <= 0.25 ? 'NO' : null;

		if (isNullish(consensusSide)) {
			return;
		}

		const minorityPct = probabilityToPercent(Math.min(yes, 1 - yes));
		showCompanion({
			who: 'trickster',
			line: t({
				locale: $localeStore,
				key: 'flow.companion.trickster',
				params: { pct: minorityPct }
			}),
			anchor: 'br',
			dwell_ms: 2800,
			lightning: true
		});
		trickstered.add(m.id);
	});

	// Top bar deck-scope label: when the featured event is active the
	// deck is filtered to it (e.g. "WORLD CUP"); otherwise fall back
	// to a neutral all-markets label. Prefers `shortTitle` over
	// `title` so the chip stays narrow (a full "2026 FIFA WORLD CUP"
	// crowds the streak chip out of the row). Uppercased to match
	// the chip's allcaps tracking.
	const topBarCategoryLabel = $derived.by(() => {
		if ($featuredEventActive) {
			const e = $featuredEvent;

			return (e.shortTitle ?? e.title).toUpperCase();
		}

		return t({ locale: $localeStore, key: 'flow.deck.all_markets' });
	});
</script>

<div
	class="flow-shell bg-background"
	class:is-active={!completed && (loading || markets.length > 0)}
	class:is-paused={flowPaused}
>
	{#if !loading && markets.length === 0}
		<!-- Fetch resolved to an empty deck: surface the empty state directly
		     rather than gating it behind the entry overlay. -->
		<FlowEmptyDeck onBackToMarkets={backToMarkets} />
	{:else if entered && dailyCapReached && callsCount === 0}
		<!-- Daily hard cap already met today (across sessions). Opening Flow
		     shows the "come back tomorrow" takeover, not a fresh deck. -->
		<FlowDailyCap hardCap={DAILY_HARD_CAP} onClose={handleClose} />
	{:else if outOfFunds}
		<!-- Every spendable VXP is already in play on open predictions, so no
		     further call this session can be funded. Surface the out-of-funds
		     takeover with explicit exits instead of stranding the user on cards
		     the funds gate would block. -->
		<FlowOutOfFunds onBackToMarkets={backToMarkets} onClose={handleClose} />
	{:else if completed || activeDeckStranded}
		<FlowEnd
			{canExtend}
			comeback={isComeback}
			onClose={handleClose}
			onExtend={handleExtend}
			onInstallPrompt={() => (a2hsSheetOpen = true)}
			overtime={overtimeSession}
			pending={callsCount}
			{showInstallNudge}
			staked={sessionStaked}
			streak={dailyStreak}
		/>

		<A2hsSheet isOpen={a2hsSheetOpen} onClose={() => (a2hsSheetOpen = false)} source="flow_end" />
	{:else if entered}
		<!-- Persistent Flow header: VICI wordmark + deck-scope chip +
		     bolt streak chip on the left; bell on the right. Secondary
		     row carries the daily-goal count (`done / total`) and `+xp VXP
		     this session` over a thin progress bar. Tapping the wordmark
		     exits Flow. -->
		<FlowTopBar
			categoryLabel={topBarCategoryLabel}
			{dailyGoalDone}
			dailyGoalTarget={sittingGoal}
			{dailyStreak}
			{flameStage}
			onExit={backToMarkets}
			{xp}
		/>

		{#if lastStreakShown > 0}
			{#key lastStreakShown}
				<FlowComboBanner count={lastStreakShown} />
			{/key}
		{/if}

		{#if streakBreakBanner}
			<FlowStreakBreakBanner stage={streakBreakBanner.stage} />
		{/if}

		<main class="flow-stage">
			<div class="flow-card-wrap">
				<!-- Only the current card is rendered; it stands alone over an
				     empty stage, with no peeking cards behind it. Keyed on
				     `currentIndex` so each advance remounts it and replays the
				     rise-from-below (`flow-card-rise`). While a gating beat plays
				     (`flowPaused`) the card is removed so the character holds the
				     empty slot; that removal also triggers the `out:fly` throw of
				     the just-committed card. -->
				{#if currentCard}
					{@const flowCategory = resolveFlowArtCategory({
						tags: marketTagMap[currentCard.id] ?? [],
						seed: currentCard.id
					})}
					{@const metadata = marketMetadataMap.get(currentCard.id)}
					{@const priceSeries = priceHistoryById.get(currentCard.id)}
					{@const priorCall = userSignals.priorCalls[currentCard.id]}
					{@const followedLean = userSignals.followedLean[currentCard.id]}
					{@const categoryAcc = userSignals.categoryAcc[flowCategory]}
					{#key currentIndex}
						{#if !flowPaused}
							<!-- Outer slot owns the exit (`out:fly`); the inner riser
							     owns the rise-in (`flow-card-rise`). Keeping the two on
							     separate elements means the exit transform never fights
							     the rise animation if a card is committed mid-rise. -->
							<div
								class="flow-card-slot"
								out:fly={prefersReducedMotion()
									? { duration: 0 }
									: { x: exitX, y: exitY, duration: 450, opacity: 0, easing: cubicOut }}
							>
								<div class="flow-card-riser flow-card-rise">
									<FlowCard
										category={flowCategory}
										{categoryAcc}
										committedAction={currentCard.id === committedMarketId ? committedAction : null}
										{followedLean}
										gesturesArmed={deckGesturesArmed}
										interactive
										market={currentCard}
										{metadata}
										onAction={handleAction}
										onStakeChange={(next) => {
											tradeAmount = next;
										}}
										onToggleTranslation={onToggleFlowTranslation}
										pointXs={priceSeries?.xs}
										points={priceSeries?.yes}
										{priorCall}
										showOriginal={flowShowOriginal}
										signedIn={nonNullish($userStore.user)}
										{stakeWarning}
										{tradeAmount}
										translatedLanguageLabel={nonNullish(currentTranslation)
											? translatedLanguageLabel(currentTranslation.locale)
											: undefined}
										translation={currentTranslation}
									/>
								</div>
							</div>
						{/if}
					{/key}
				{/if}
			</div>

			<FlowXpPops pops={xpPops} />

			<!-- Gesture coach: first-run only. A non-blocking map of the
			     swipe gestures over the live card; it teaches by doing and
			     clears itself on the first committed YES / NO, signalled by
			     the `commitToastKeySeq` counter. Persists dismissal in
			     localStorage so it shows at most once. -->
			<FlowCoach commitSignal={commitToastKeySeq} />

			<!-- Per-swipe commit pop: "CALLED YES · {stake} IN PLAY". Rises
			     from the exit edge (is-yes → right, is-no → left) on every
			     committed YES / NO. Keyed so consecutive commits replay the
			     `xp-toast-pop` envelope. -->
			{#if commitToast}
				{#key commitToast.key}
					<XpToast
						bonus={commitToast.bonus}
						onDone={() => (commitToast = null)}
						side={commitToast.side}
						stake={commitToast.stake}
					/>
				{/key}
			{/if}

			<!-- Character beat, in the gap between cards. Plays centered &
			     large in the empty slot (soft 96 / hard 132) while the deck
			     holds; the next card rises over it once it finishes. -->
			{#if activeMotionBeat}
				<MotionBeat beat={activeMotionBeat} onDone={onMotionBeatDone} />
			{/if}
		</main>

		<!-- Bottom-of-deck affordance rail: chevrons drift outward on a
		     1.7 s ping cycle while the TAP / SKIP labels call out the
		     non-swipe gestures. Pure visual sugar; gestures are wired in
		     FlowCard. -->
		<SwipeHint />

		{#if playgroundOnly}
			<!-- Playground (USD / ICP) stake stepper. VXP uses the
			     back-face peg-rail and renders no bottom bar. -->
			<FlowBottomBar
				min={0.1}
				onAction={handleAction}
				onIncrement={incrementAmount}
				step={0.1}
				unitLabel={$playgroundFlowTradeUnitLabel}
				bind:tradeAmount
			/>
		{/if}
	{/if}

	<!-- Entry beat: the unified full-bleed frosted overlay (deck-shuffle
	     loading + "while you were away" digest) sits above the deck and the
	     pill-nav until the session begins. The deck-shuffle beat auto-enters
	     once the deck is ready (a brief branded moment, no required tap); a
	     real away digest waits for the user (tap-anywhere / CTA) with a safety
	     auto-enter. Shown over the in-flight fetch and once the deck is loaded;
	     hidden on the empty deck and at the summary. Entering settles the
	     matured calls and reveals the deck below. -->
	{#if !entered && !completed && (loading || markets.length > 0)}
		<div out:fade={{ duration: prefersReducedMotion() ? 0 : 220 }}>
			<FlowEntry digest={liveDigest} onEnter={enterFlow} ready={!loading} />
		</div>
	{/if}
</div>

<svelte:window
	onkeydown={(e) => {
		// Ignore deck shortcuts while the entry gate is up (the overlay owns
		// the surface until the user enters), during the cold-load, and at
		// the summary.
		if (loading || completed || !entered) {
			return;
		}

		if (e.key === 'ArrowRight') {
			void handleAction('YES');
		}

		if (e.key === 'ArrowLeft') {
			void handleAction('NO');
		}

		if (e.key === 'ArrowUp') {
			void handleAction('SKIP');
		}
	}}
/>

<style lang="postcss">
	.flow-shell {
		position: relative;
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		background:
			radial-gradient(circle at 50% -10%, var(--laurel-glow), transparent 34%), var(--bg-base);
		animation: flow-fade-in 220ms var(--ease-stage) both;
	}
	@media (prefers-reduced-motion: reduce) {
		.flow-shell {
			animation: none;
		}
	}

	.flow-shell.is-active {
		position: fixed;
		inset: 0;
		z-index: 50;
		overflow: hidden;
	}

	/* Card stack: relative flex:1 container with the card absolutely
	   positioned inside so it fills the stage flush against the topbar
	   (no vertical centering, no max-height cap). */
	.flow-stage {
		position: relative;
		flex: 1 1 auto;
		padding: 0.5rem 1rem 0.75rem;
		min-height: 0;
	}

	.flow-card-wrap {
		position: absolute;
		inset: 0.5rem 0.5rem var(--bn-clear) 0.5rem;
		max-width: min(25.5rem, calc(100vw - 2rem));
		margin-inline: auto;
	}

	/* Desktop drops the floating pill, so the card no longer needs to
	   reserve `--bn-clear` clearance. */
	@media (min-width: 56rem) {
		.flow-card-wrap {
			inset: 0.5rem 0.5rem 0.75rem 0.5rem;
		}
	}

	.flow-card-slot {
		position: absolute;
		inset: 0;
	}

	/* The riser fills the slot and carries the rise-in animation, kept
	   separate from the slot's `out:fly` so the two never animate the
	   same element's transform. */
	.flow-card-riser {
		position: absolute;
		inset: 0;
	}
</style>
