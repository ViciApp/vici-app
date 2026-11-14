<script lang="ts">
	/**
	 * FlowEntry: the unified full-bleed frosted entry that sits over the
	 * deck (above the pill-nav) until the session begins.
	 *
	 * One surface, two modes:
	 *  • DECK mode: when there is nothing settled to recap, the entry is a
	 *    brief branded beat, NOT a gate. The deck riffles (three cards fan +
	 *    snap) under the Oracle orb while the first-card fetch resolves, then
	 *    the surface auto-enters the moment the deck is ready and a short
	 *    dwell has elapsed (~800 ms, or 250 ms under reduced motion, just long
	 *    enough for the beat to register). No tap is required; the "Enter
	 *    Flow →" CTA is an optional tap-to-skip that the user can hit early.
	 *  • DIGEST mode: when calls settled since the user's last visit, the
	 *    "while you were away" recap takes over and the surface WAITS for the
	 *    user: outcome-aware framing (net gain → celebratory 56px green net +
	 *    confetti + "keep the run going"; net loss → measured neutral net, no
	 *    confetti, "shake it off"), the actual resolved calls (win/loss list,
	 *    capped at 5 + "+N more"). There is no short auto-enter here; the user
	 *    reads the digest and continues via tap-anywhere or the CTA. A ~30 s
	 *    safety net still prevents an indefinite linger. While the per-row
	 *    market titles are still resolving (catalog and/or translations:
	 *    `digest.titlesLoading`) the recap holds behind the deck beat instead
	 *    of flashing `Unknown Market` rows, and every enter path is blocked so
	 *    the recap can't be skipped unseen; a bounded cap guarantees it still
	 *    shows even if the titles never settle.
	 *
	 * `ready` carries the REAL first-card fetch state, so neither the dwell
	 * auto-enter, the safety auto-enter, nor a tap ever reveals a deck that has
	 * not arrived: while the fetch is in flight the Oracle copy keeps cycling
	 * and the CTA holds its arming state. Entering settles any matured calls
	 * (`onEnter`) and reveals the deck. Reduced-motion + theme safe.
	 */
	import OracleChar from '#lib/components/characters/OracleChar.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { FlowEntryMethod, ResolutionRevealData } from '#lib/types/flow.ts';
	import { flowBeat, flowSummary } from '#lib/utils/flow-sound.utils.ts';
	import { haptic } from '#lib/utils/haptics.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { formatWholeVxpMagnitude } from '#lib/utils/playground-display.utils.ts';
	import { prefersReducedMotion } from '#lib/utils/reduced-motion.utils.ts';

	// The deck-shuffle dwell: the entry beat holds this long before the deck
	// is allowed to auto-enter (paired with the real first-card readiness). A
	// short branded moment, not a gate; reduced motion trims it further.
	const DECK_DWELL_MS = 800;
	const DECK_DWELL_REDUCED_MS = 250;
	// Safety-net ceiling for the digest wait; if the user never acts, the
	// surface still enters once both this has elapsed and the deck is ready.
	const SAFETY_AUTO_ENTER_MS = 30_000;
	// Ceiling on how long the digest may hold for its per-row titles. Past it
	// the recap shows with whatever resolved (fallback titles included); a
	// failed catalog or translation fetch can delay the recap, never swallow
	// it. Must stay well under SAFETY_AUTO_ENTER_MS so the safety net can only
	// fire on a recap the user actually saw.
	const TITLES_WAIT_CAP_MS = 8_000;

	interface Props {
		/** The away-digest; `count === 0` falls back to deck-shuffle mode. */
		digest: ResolutionRevealData;
		/**
		 * Real first-card fetch readiness. Auto-enter (the short deck dwell and
		 * the digest safety net alike) and the optional tap-to-skip CTA all gate
		 * on this, so no path ever reveals a deck that has not yet arrived.
		 * Stays false while the deck is loading.
		 */
		ready: boolean;
		/**
		 * Settles the matured calls and reveals the deck. Called once: by the
		 * deck-mode dwell auto-enter, the digest safety-net auto-enter, a
		 * tap-anywhere, or a tap on the CTA. The `entry` arg carries how the
		 * session was opened (`'tap'` = deliberate, `'auto'` = timer-driven) so
		 * the caller can record it on the analytics `flow_session_started` event.
		 */
		onEnter: (entry: FlowEntryMethod) => void;
	}

	const { digest, ready, onEnter }: Props = $props();

	const hasDigest = $derived(digest.count > 0);
	const positive = $derived(digest.netVxp >= 0);

	// Set when the titles wait-cap fires: from then on the recap shows with
	// whatever titles resolved rather than holding any longer.
	let titlesWaitElapsed = $state(false);

	// The recap is pending while its row titles are still resolving (bounded
	// by the cap). While pending the surface renders the deck beat and every
	// enter path is blocked, so the unseen recap can neither flash `Unknown
	// Market` nor be skipped.
	const digestPending = $derived(hasDigest && digest.titlesLoading && !titlesWaitElapsed);
	const showDigest = $derived(hasDigest && !digestPending);

	// Rotating Oracle copy for the deck-shuffle mode. One line reads, fades,
	// and the next takes its place: continuously, with no empty frames. Each
	// line plays the 1.1s `flowFade` (in → hold → out) and the swap is driven
	// by that animation finishing (`advanceLine`), not by a free-running
	// timer: a `setInterval` drifts against the CSS clock, so a late tick
	// leaves the line parked at the fade-out's `opacity:0` for a visible beat
	// (longer if the tab was ever backgrounded and the interval throttled).
	// Mounting the next line the instant the previous one ends keeps the
	// cadence frame-tight.
	const loadLineKeys = [
		'flow.entry.line.crowd',
		'flow.entry.line.chances',
		'flow.entry.line.shuffle',
		'flow.entry.line.summon'
	] as const;
	let loadLine = $state(0);

	const advanceLine = () => {
		loadLine = (loadLine + 1) % loadLineKeys.length;
	};

	// The "Enter Flow →" CTA is an optional tap-to-skip; the entry beat
	// auto-enters on its own (see below), so the CTA arms as soon as the real
	// first-card fetch (`ready`) lands. It never reveals a deck that hasn't
	// arrived, and it holds its arming state while the recap is still pending
	// so a tap can't dismiss a digest the user never saw.
	const ctaReady = $derived(ready && !digestPending);

	// Whether `onEnter` already ran (any path), so the ready-gated auto-enter
	// timers never double-fire once the deck becomes ready.
	let entered = $state(false);

	// Set when the deck-mode dwell timer fires; the actual auto-enter is
	// ready-gated (see the effect below) so it enters at max(dwell, ready).
	// DECK mode only: a no-op away digest (`count === 0`) is the brief beat.
	let dwellElapsed = $state(false);

	// Set when the digest safety-net timer fires; likewise ready-gated, so a
	// long-untapped digest still enters at max(30s, ready) without ever
	// revealing an unready deck. DIGEST mode only.
	let safetyElapsed = $state(false);

	const previewItems = $derived(digest.items.slice(0, 5));

	// Decorative confetti burst seeds: net-positive batches only. Mirrors
	// the radial `fe-spark` layout: 24 sparks fanned around the net figure.
	const burstSeeds = Array.from({ length: 24 }).map((_, i) => {
		const a = Math.PI * 2 * (i / 24);
		const r = 90 + ((i * 37) % 80);

		return {
			fdx: `${Math.cos(a) * r}px`,
			fdy: `${Math.sin(a) * r - 20}px`,
			frot: `${((i * 53) % 360) - 180}deg`,
			delay: `${(i % 5) * 0.05}s`
		};
	});

	// Reactive reduced-motion driver. `prefersReducedMotion()` reads the live
	// MediaQuery so this $effect re-runs whenever the user toggles the OS
	// preference while the component is mounted: ensuring exactly ONE driver
	// is active at any time: the CSS `animationend` path (full motion) or the
	// plain interval (reduced motion). The interval is also created fresh if
	// the preference flips from full → reduced mid-session, and cancelled when
	// it flips back.
	$effect(() => {
		const reduce = prefersReducedMotion();

		// Under reduced motion the line is held static (no `flowFade`, so no
		// `animationend` to drive the swap): keep the same 1.1s reading beat
		// on a plain timer. The line never animates to `opacity:0`, so there
		// are still no empty frames here.
		const rot = reduce ? setInterval(advanceLine, 1100) : undefined;

		// Reveal cue: fired only in DIGEST mode, paired with the recap landing:
		// a celebratory chime + a celebration buzz for a net gain, a soft single
		// tone + low thud for a loss. Suppressed under reduced motion. Stored so
		// it can be cancelled on cleanup if the user navigates or the preference
		// flips before the 360 ms fires.
		let revealCue: ReturnType<typeof setTimeout> | undefined;

		if (showDigest && !reduce) {
			revealCue = setTimeout(() => {
				revealCue = undefined;

				if (positive) {
					flowSummary();
					haptic('celebration');
				} else {
					flowBeat(false);
					haptic('low-thud');
				}
			}, 360);
		}

		return () => {
			clearInterval(rot);
			clearTimeout(revealCue);
		};
	});

	// DECK-mode dwell: a brief branded beat, not a gate. After the dwell
	// (~800 ms, or 250 ms under reduced motion) the surface is free to
	// auto-enter: paired with `ready` in the effect below so it enters at
	// max(dwell, ready). Keyed on the reduced-motion preference so the correct
	// delay is applied from the current state. DECK mode only.
	$effect(() => {
		if (hasDigest) {
			return;
		}

		const reduce = prefersReducedMotion();
		const dwell = setTimeout(
			() => {
				dwellElapsed = true;
			},
			reduce ? DECK_DWELL_REDUCED_MS : DECK_DWELL_MS
		);

		return () => {
			clearTimeout(dwell);
		};
	});

	// DIGEST-mode titles wait-cap: while the recap is held for its row titles,
	// arm the ceiling after which it shows regardless. Restarted if the digest
	// flips back into loading; the flag is one-way, matching the "show it and
	// keep it shown" intent.
	$effect(() => {
		if (!hasDigest || !digest.titlesLoading) {
			return;
		}

		const cap = setTimeout(() => {
			titlesWaitElapsed = true;
		}, TITLES_WAIT_CAP_MS);

		return () => {
			clearTimeout(cap);
		};
	});

	// DIGEST-mode safety net: after ~30 s, flag that the wait has run long.
	// Kept in its OWN effect with NO dependency on `prefersReducedMotion()`, so
	// the timer starts once and isn't cleared/restarted when the OS
	// reduced-motion preference is toggled mid-session (which would postpone
	// the safety auto-enter). The actual enter is ready-gated below, so an
	// in-flight deck is never revealed early; it enters the moment the deck
	// becomes ready. DIGEST mode only; the deck mode auto-enters far sooner via
	// the dwell.
	$effect(() => {
		if (!hasDigest) {
			return;
		}

		const safety = setTimeout(() => {
			safetyElapsed = true;
		}, SAFETY_AUTO_ENTER_MS);

		return () => {
			clearTimeout(safety);
		};
	});

	// The fade-out lands on `opacity:0`; advancing on its end mounts the next
	// line right then, so the swap is seamless. Full-motion only: reduced
	// motion holds a static line and cycles on the interval above.
	const onLineEnd = () => {
		if (!prefersReducedMotion()) {
			advanceLine();
		}
	};

	// Reveal the deck. Idempotent (the `entered` latch) so the dwell / safety
	// auto-enter, a tap-anywhere, and the CTA can't double-fire. Gated on
	// `ready` so no path ever reveals a deck that hasn't arrived, and on the
	// pending recap so no path (tap, CTA, or timer) settles a digest the user
	// never saw: entering marks its calls seen. `entry` records whether this
	// was a deliberate tap or a timer-driven auto-enter.
	const enterFlow = (entry: FlowEntryMethod) => {
		if (!ready || entered || digestPending) {
			return;
		}

		entered = true;
		onEnter(entry);
	};

	// Auto-enter, ready-gated for both modes:
	//  • DECK mode: the brief dwell elapses and the deck is ready → enter, no
	//    tap required. The entry is a branded beat, not a gate.
	//  • DIGEST mode: only the 30 s safety net auto-enters (the user is meant
	//    to read the recap and continue by tap); it enters at max(30s, ready).
	$effect(() => {
		if (entered || !ready) {
			return;
		}

		if (hasDigest ? safetyElapsed : dwellElapsed) {
			enterFlow('auto');
		}
	});

	// Tap-anywhere to continue: the whole overlay is the affordance, not just
	// the CTA, so a pointer-down over it enters once the deck is ready (matching
	// the labelled CTA button, which is the same idempotent `enterFlow` path and
	// the accessible control). A window listener, rather than a clickable
	// wrapper, keeps the overlay free of a static interactive element, but it is
	// scoped so it only fires for a primary pointer landing inside `.flow-loading`
	// and NOT inside the scrollable digest `.reslist` (which needs pointer-down
	// for touch scrolling). This avoids entering on taps in the bottom-nav
	// clearance area and lets the digest list scroll. Re-armed reactively as
	// `ready` flips and torn down on unmount.
	$effect(() => {
		if (entered) {
			return;
		}

		const onPointerDown = (event: PointerEvent) => {
			if (event.button !== 0 || !event.isPrimary) {
				return;
			}

			const target = event.target instanceof Element ? event.target : null;

			if (!target?.closest('.flow-loading') || target.closest('.reslist')) {
				return;
			}

			enterFlow('tap');
		};

		window.addEventListener('pointerdown', onPointerDown);

		return () => {
			window.removeEventListener('pointerdown', onPointerDown);
		};
	});

	const ctaLabel = $derived(
		ctaReady
			? t({ locale: $localeStore, key: 'flow.entry.cta_ready' })
			: t({ locale: $localeStore, key: 'flow.entry.cta_arming' })
	);
</script>

<div class="flow-loading" aria-live="polite" role="status">
	{#if showDigest}
		<!-- DIGEST MODE: focused on the resolved calls; no deck animation
		     competing for attention. -->
		<div class="away-view {positive ? 'win' : 'loss'}">
			{#if positive}
				<div class="away-burst" aria-hidden="true">
					{#each burstSeeds as seed, i (i)}
						<i
							style="--fdx: {seed.fdx}; --fdy: {seed.fdy}; --frot: {seed.frot}; animation-delay: {seed.delay}"
						></i>
					{/each}
				</div>
			{/if}
			<div class="orcfloat-sm"><OracleChar animate size={44} /></div>
			<div class="eyebrow-mute">{t({ locale: $localeStore, key: 'flow.entry.away_eyebrow' })}</div>
			<div class="away-net">
				{positive ? '+' : '−'}{formatWholeVxpMagnitude(digest.netVxp)}
				{t({ locale: $localeStore, key: 'flow.reso.vxp' })}
			</div>
			<div class="away-sub">
				{t({
					locale: $localeStore,
					key: 'flow.entry.away_sub',
					params: { count: digest.count, wins: digest.wins, losses: digest.losses }
				})}
			</div>
			<div class="away-copy">
				{positive
					? t({ locale: $localeStore, key: 'flow.entry.away_copy_win' })
					: t({ locale: $localeStore, key: 'flow.entry.away_copy_loss' })}
			</div>
			<div class="reslist">
				{#each previewItems as it (it.eventId)}
					<div class="resrow">
						<span class="resdot {it.result}" aria-hidden="true"></span>
						<span class="resq">{it.question}</span>
						<span class="resv {it.result}"
							>{it.net > 0 ? '+' : it.net < 0 ? '−' : ''}{formatWholeVxpMagnitude(it.net)}</span
						>
					</div>
				{/each}
			</div>
			{#if digest.count > 5}
				<div class="resmore">
					{t({
						locale: $localeStore,
						key: 'flow.entry.away_more',
						params: { count: digest.count - 5 }
					})}
				</div>
			{/if}
			<button
				class="enter-cta{ctaReady ? ' ready' : ''}"
				disabled={!ctaReady}
				onclick={() => enterFlow('tap')}
				type="button"
			>
				{#if !ctaReady}<span class="cta-fill" aria-hidden="true"></span>{/if}
				<span class="cta-label">{ctaLabel}</span>
			</button>
		</div>
	{:else}
		<!-- DECK MODE: the shuffle, when there's nothing to settle. Also the
		     holding beat while a pending digest waits for its titles. -->
		<div class="deckwrap" aria-hidden="true">
			<div class="pc a"><i class="t"></i><i class="m"></i><i class="s"></i></div>
			<div class="pc c"><i class="t"></i><i class="m"></i><i class="s"></i></div>
			<div class="pc b"><i class="t"></i><i class="m"></i><i class="s"></i></div>
			<div class="orcfloat"><span class="orb"><OracleChar animate size={58} /></span></div>
		</div>
		<div class="label">
			<div class="eyebrow-mute">{t({ locale: $localeStore, key: 'flow.entry.deck_eyebrow' })}</div>
			{#key loadLine}
				<!-- Ambient loading flavor: hidden from the polite live region so
				     the 1.1s swaps aren't announced on every cycle. -->
				<span class="line" aria-hidden="true" onanimationend={onLineEnd}
					>{t({ locale: $localeStore, key: loadLineKeys[loadLine] })}</span
				>
			{/key}
			<button
				class="enter-cta{ctaReady ? ' ready' : ''}"
				disabled={!ctaReady}
				onclick={() => enterFlow('tap')}
				type="button"
			>
				{#if !ctaReady}<span class="cta-fill" aria-hidden="true"></span>{/if}
				<span class="cta-label">{ctaLabel}</span>
			</button>
		</div>
	{/if}
</div>
