<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	/**
	 * Interactive swipe hero — the centerpiece of the landing.
	 *
	 * A stranger can MAKE A REAL CALL before signup: drag the demo
	 * market card left (NO) or right (YES). Committing a side plays a
	 * payoff celebration (confetti + spark burst, the Oracle/Trickster
	 * character beat, an XP count-up) and then a brief "leaderboard
	 * climb" moment — the competitive hook — before the sign-up ask.
	 *
	 * The card reuses the real Flow-front markup (`.flow-card` /
	 * `.flow-face`, styled in `src/landing.css`) so the demo matches the
	 * actual product card. Every animation is reduced-motion gated.
	 */
	import { ChevronRight, RotateCcw } from '@lucide/svelte/icons';
	import { onMount } from 'svelte';
	import OracleChar from '$lib/components/characters/OracleChar.svelte';
	import TricksterChar from '$lib/components/characters/TricksterChar.svelte';
	import ViciChar from '$lib/components/characters/ViciChar.svelte';
	import LandingConsensusCompass from '$lib/components/landing/LandingConsensusCompass.svelte';
	import MarketArtwork from '$lib/components/market/MarketArtwork.svelte';
	import {
		LANDING_CAT_COLORS,
		LANDING_CAT_LABELS,
		LANDING_HERO_CARD,
		LANDING_HERO_CLIMB,
		LANDING_HERO_STAKE
	} from '$lib/constants/landing-data.constants';
	import { PublicPath } from '$lib/constants/routes.constants';
	import { daysToKickoff } from '$lib/derived/featured-event.derived';
	import { localeStore } from '$lib/stores/locale.store';
	import { t } from '$lib/utils/i18n.utils';
	import { splitHeadline } from '$lib/utils/landing-headline.utils';
	import { prefersReducedMotion } from '$lib/utils/reduced-motion.utils';

	const XP = LANDING_HERO_STAKE;
	const YES = LANDING_HERO_CARD.yes;
	const NO = 100 - YES;
	const accent = LANDING_CAT_COLORS.crypto;
	const catLabel = LANDING_CAT_LABELS.crypto;
	const artMarket = { cat: 'crypto', id: LANDING_HERO_CARD.artSeed } as const;

	// Payout-from-stake for each side (long-shot pays more).
	const winYes = Math.round(XP / (YES / 100)) - XP;
	const winNo = Math.round(XP / (NO / 100)) - XP;

	type Phase = 'rest' | 'gone' | 'payoff';
	type Side = 'YES' | 'NO';

	let phase = $state<Phase>('rest');
	let side = $state<Side | null>(null);
	let dx = $state(0);
	let dragging = $state(false);
	let xpShown = $state(0);
	let climb = $state(false);
	let startX = 0;

	// Tracks the pending rest→payoff advance scheduled by `commit` so a
	// re-commit or unmount can't fire a stale phase change.
	let commitTimer: ReturnType<typeof setTimeout> | null = null;

	const clearCommitTimer = (): void => {
		if (nonNullish(commitTimer)) {
			clearTimeout(commitTimer);
			commitTimer = null;
		}
	};

	// A minority call (under 50% consensus on the chosen side) is the
	// contrarian "Trickster" beat; otherwise the Oracle delivers the verdict.
	const contrarian = $derived(side === 'YES' ? YES < 50 : NO < 50);
	const reduce = $derived(prefersReducedMotion());

	// Stable confetti + spark geometry (seeded, not random per frame).
	const confettiCols = [
		'var(--accent)',
		'var(--yes)',
		'#FFD9A0',
		'#F2ECDC',
		'var(--brand, #B49CFF)'
	];
	const confetti = Array.from({ length: 46 }).map((_, i) => {
		const drift = (((i * 53) % 100) / 100) * 2 - 1;

		return {
			left: `${4 + ((i * 71) % 92)}%`,
			width: `${5 + (i % 4) * 1.5}px`,
			height: `${8 + (i % 5) * 2}px`,
			background: confettiCols[i % confettiCols.length],
			borderRadius: i % 3 === 0 ? '50%' : '2px',
			'--cx': `${(drift * 150).toFixed(0)}px`,
			'--cr': `${((i * 97) % 720) - 360}deg`,
			'--cd': `${(0.95 + ((i * 13) % 70) / 100).toFixed(2)}s`,
			delay: `${(((i * 29) % 30) / 100).toFixed(2)}s`
		};
	});
	const sparks = Array.from({ length: 26 }).map((_, i) => {
		const a = Math.PI * 2 * (i / 26) + (i % 3);
		const r = 64 + ((i * 37) % 96);

		return {
			'--dx': `${Math.cos(a) * r}px`,
			'--dy': `${Math.sin(a) * r - 20}px`,
			'--rot': `${((i * 47) % 360) - 180}deg`,
			delay: `${(i % 6) * 0.035}s`
		};
	});

	const confettiStyle = (c: (typeof confetti)[number]): string =>
		`left:${c.left};width:${c.width};height:${c.height};background:${c.background};border-radius:${c.borderRadius};--cx:${c['--cx']};--cr:${c['--cr']};--cd:${c['--cd']};animation-delay:${c.delay};`;
	const sparkStyle = (s: (typeof sparks)[number]): string =>
		`--dx:${s['--dx']};--dy:${s['--dy']};--rot:${s['--rot']};animation-delay:${s.delay};`;

	// XP count-up on payoff, then auto-advance to the leaderboard-climb beat.
	$effect(() => {
		if (phase !== 'payoff') {
			xpShown = 0;
			climb = false;

			return;
		}

		const reduceMotion = reduce;
		const toClimb = setTimeout(() => (climb = true), reduceMotion ? 200 : 1350);

		if (reduceMotion) {
			xpShown = XP;

			return () => clearTimeout(toClimb);
		}

		let raf = 0;
		const t0 = performance.now();

		const tick = (now: number) => {
			const p = Math.min(1, (now - t0) / 700);
			xpShown = Math.round(XP * (1 - Math.pow(1 - p, 3)));

			if (p < 1) {
				raf = requestAnimationFrame(tick);
			}
		};

		raf = requestAnimationFrame(tick);
		const safety = setTimeout(() => (xpShown = XP), 1200);

		return () => {
			cancelAnimationFrame(raf);
			clearTimeout(safety);
			clearTimeout(toClimb);
		};
	});

	const commit = (s: Side): void => {
		side = s;
		dragging = false;
		dx = s === 'YES' ? 520 : -520;
		phase = 'gone';
		clearCommitTimer();
		commitTimer = setTimeout(() => {
			commitTimer = null;
			phase = 'payoff';
		}, 360);
	};

	const reset = (): void => {
		clearCommitTimer();
		phase = 'rest';
		side = null;
		dx = 0;
		climb = false;
	};

	// Clear any pending rest→payoff advance on teardown.
	$effect(() => clearCommitTimer);

	const pointerX = (e: MouseEvent | TouchEvent): number =>
		'touches' in e ? e.touches[0].clientX : e.clientX;

	const onDown = (e: MouseEvent | TouchEvent): void => {
		if (phase !== 'rest') {
			return;
		}

		dragging = true;
		startX = pointerX(e);
	};

	// Window-level move/up listeners while dragging so a fast drag that
	// leaves the card still tracks and commits.
	$effect(() => {
		if (!dragging) {
			return;
		}

		const move = (e: MouseEvent | TouchEvent): void => {
			if (phase !== 'rest') {
				return;
			}

			dx = pointerX(e) - startX;
		};

		const up = (): void => {
			if (phase !== 'rest') {
				return;
			}

			if (dx > 95) {
				commit('YES');
			} else if (dx < -95) {
				commit('NO');
			} else {
				dragging = false;
				dx = 0;
			}
		};

		window.addEventListener('mousemove', move);
		window.addEventListener('mouseup', up);
		window.addEventListener('touchmove', move, { passive: true });
		window.addEventListener('touchend', up);

		return () => {
			window.removeEventListener('mousemove', move);
			window.removeEventListener('mouseup', up);
			window.removeEventListener('touchmove', move);
			window.removeEventListener('touchend', up);
		};
	});

	const rot = $derived(Math.max(-16, Math.min(16, dx / 14)));
	const yesOv = $derived(Math.max(0, Math.min(1, dx / 110)));
	const noOv = $derived(Math.max(0, Math.min(1, -dx / 110)));
	const cardStyle = $derived(
		phase === 'rest'
			? `transform:translateX(${dx}px) rotate(${rot}deg); transition:${dragging ? 'none' : 'transform .3s var(--ease)'};`
			: `transform:translateX(${dx}px) rotate(${side === 'YES' ? 22 : -22}deg); opacity:0; transition:transform .42s var(--ease), opacity .42s var(--ease);`
	);

	const climbAcc = Math.round(XP / (NO / 100));

	const tt = (key: Parameters<typeof t>[0]['key']) => t({ locale: $localeStore, key });

	const headline = $derived(splitHeadline(tt('welcome.hero.headline')));
	const cardMeta = $derived(
		t({ locale: $localeStore, key: 'welcome.hero.card_meta', params: { pct: YES } })
	);

	onMount(() => {
		if (typeof document !== 'undefined') {
			document.documentElement.setAttribute('data-accent', 'laurel');
		}
	});
</script>

<header class="lpc-hero">
	<div class="lpc-wrap lpc-hero-grid">
		<!-- Copy column — kicker + headline -->
		<div class="lpc-hero-copy">
			<span class="lpc-kicker lpc-rise" data-i="0">
				<span class="pulse" aria-hidden="true"></span>
				{tt('welcome.hero.kicker')}
			</span>
			<div class="lpc-rise" data-i="1">
				<h1 class="lpc-display">
					{headline.before}{#if headline.accent}<span class="acc">{headline.accent}</span
						>{/if}{headline.after}
				</h1>
			</div>
		</div>

		<!-- Interactive card column -->
		<div class="lpc-hero-stage lpc-rise" data-i="2">
			<div class="lpc-char-zone">
				{#if phase === 'rest'}
					<div class="lpc-char lpc-char-in">
						<ViciChar mood="encouraging" size={56} />
						<div class="lpc-pill">{tt('welcome.hero.hint')}</div>
					</div>
				{/if}
			</div>

			<div class="lpc-deck">
				<div class="lpc-deck-stack" aria-hidden="true"></div>
				{#if phase !== 'payoff'}
					<div
						style={cardStyle}
						class="flow-card"
						aria-hidden="true"
						onmousedown={onDown}
						ontouchstart={onDown}
						role="button"
						tabindex="-1"
					>
						<div class="flow-face">
							<div
								style="background:linear-gradient(160deg, {accent}26 0%, {accent}10 60%, transparent 100%); border-bottom:1px solid {accent}1F;"
								class="flow-head"
							>
								<div class="row between">
									<div style="gap:8px;" class="row">
										<span style="color:{accent}; background:rgba(242,236,220,0.06);" class="tag">
											{catLabel}
										</span>
										{#if nonNullish($daysToKickoff) && $daysToKickoff > 0}
											<span class="flow-days num soon">{$daysToKickoff}d</span>
										{/if}
									</div>
									<LandingConsensusCompass yes={YES} />
								</div>
								<h2 class="flow-q">{tt('welcome.hero.card_q')}</h2>
							</div>
							<div class="flow-body">
								<div class="flow-art-bleed">
									<MarketArtwork
										bleed
										category="crypto"
										seed={artMarket.id}
										size={420}
										state="neutral"
									/>
								</div>
								<div class="flow-probs">
									<div class="flow-probs-row">
										<div class="flow-probs-side no" data-side="no">
											<span class="flow-probs-pct">{NO}%</span>
											<span class="flow-probs-label no">{tt('welcome.hero.no')}</span>
										</div>
										<div class="flow-probs-track" aria-hidden="true">
											<div style="width:{NO}%;" class="flow-probs-fill-no"></div>
											<div style="width:{YES}%;" class="flow-probs-fill-yes"></div>
										</div>
										<div class="flow-probs-side yes" data-side="yes">
											<span class="flow-probs-label yes">{tt('welcome.hero.yes')}</span>
											<span class="flow-probs-pct">{YES}%</span>
										</div>
									</div>
									<div class="flow-probs-action-row">
										<div class="flow-probs-action no">
											<span class="flow-probs-arrow">←</span>
											<span class="flow-probs-payout"
												>+{winNo}<span class="flow-probs-payout-unit">VXP</span></span
											>
											<span class="flow-probs-role">{tt('welcome.hero.favorite')}</span>
										</div>
										<div class="flow-probs-action yes">
											<span class="flow-probs-role">{tt('welcome.hero.long_shot')}</span>
											<span class="flow-probs-payout"
												>+{winYes}<span class="flow-probs-payout-unit">VXP</span></span
											>
											<span class="flow-probs-arrow">→</span>
										</div>
									</div>
								</div>
								<div class="row between flow-foot">
									<span class="num mute t-eyebrow">
										{cardMeta}
									</span>
									<span style="letter-spacing:0.14em;" class="num mute t-eyebrow">
										{tt('welcome.hero.swipe_to_call')}
									</span>
								</div>
							</div>
							<div style="opacity:{yesOv};" class="overlay yes">{tt('welcome.hero.yes')}</div>
							<div style="opacity:{noOv};" class="overlay no">{tt('welcome.hero.no')}</div>
						</div>
					</div>
				{:else}
					<div
						class="lpc-payoff"
						class:bold={contrarian}
						class:climbed={climb}
						aria-live="polite"
						role="status"
					>
						{#if !reduce}
							<div class="lpc-flash" aria-hidden="true"></div>
							<div class="lpc-rays" aria-hidden="true"></div>
							<div class="lpc-confetti" aria-hidden="true">
								{#each confetti as c, i (i)}
									<i style={confettiStyle(c)}></i>
								{/each}
							</div>
							<div class="lpc-burst" aria-hidden="true">
								{#each sparks as s, i (i)}
									<i style={sparkStyle(s)}></i>
								{/each}
							</div>
						{/if}
						<div class="lpc-celebrate-char" class:bold={contrarian}>
							{#if contrarian}
								<TricksterChar animate lightning size={132} />
							{:else}
								<OracleChar animate size={132} />
							{/if}
						</div>
						<div class="lpc-payoff-name">{contrarian ? 'TRICKSTER' : 'ORACLE'}</div>
						<div class="lpc-payoff-xp">+{xpShown}<small>VXP</small></div>
						{#if !climb}
							<div class="lpc-payoff-tally">{tt('welcome.hero.tally')}</div>
						{:else}
							<div class="lpc-climb">
								<div class="lpc-climb-head">
									{tt('welcome.hero.climb_to')}
									<b>#{LANDING_HERO_CLIMB.rank}</b>
								</div>
								<div class="lpc-climb-board" aria-hidden="true">
									<div class="lpc-climb-row you">
										<span class="r">{LANDING_HERO_CLIMB.rank}</span>
										<span class="h"
											>@you<span class="climb-badge">▲ {LANDING_HERO_CLIMB.delta}</span></span
										>
										<span class="a">{climbAcc + 4}%</span>
									</div>
									<div class="lpc-climb-row">
										<span class="r">3</span>
										<span class="h">@{LANDING_HERO_CLIMB.rival}</span>
										<span class="a">{climbAcc}%</span>
									</div>
									<div class="lpc-climb-row">
										<span class="r">4</span>
										<span class="h">@{LANDING_HERO_CLIMB.below}</span>
										<span class="a">{climbAcc - 3}%</span>
									</div>
								</div>
								<div class="lpc-payoff-line">{tt('welcome.hero.payoff')}</div>
							</div>
						{/if}
						<div class="lpc-payoff-actions">
							<a class="btn btn-primary lpc-payoff-cta" href={PublicPath.SignUp}>
								{tt('welcome.hero.payoff_cta')}
							</a>
							<button
								class="lpc-reset"
								aria-label={tt('welcome.hero.try_another')}
								onclick={reset}
								type="button"
							>
								<RotateCcw size={16} />
							</button>
						</div>
					</div>
				{/if}
			</div>
		</div>

		<div class="lpc-hero-tail">
			<p class="lpc-lede lpc-rise" data-i="3">{tt('welcome.hero.sub')}</p>
			<div class="lpc-hero-cta-row lpc-rise" data-i="4">
				<a class="btn btn-primary btn-lg" href={PublicPath.SignUp}>
					{tt('welcome.hero.cta')}
					<ChevronRight size={16} strokeWidth={2.4} />
				</a>
				<span class="lpc-cta-note">{tt('welcome.hero.cta_note')}</span>
			</div>
		</div>
	</div>
</header>
