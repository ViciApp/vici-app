<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { Check, X } from '@lucide/svelte/icons';
	import { onDestroy, onMount } from 'svelte';
	import ScreenHeader from '#lib/components/layout/ScreenHeader.svelte';
	import LoadingSpinner from '#lib/components/ui/LoadingSpinner.svelte';
	import { ZERO } from '#lib/constants/app.constants.ts';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { VXP_TOKEN } from '#lib/constants/tokens/tokens.ic.constants.ts';
	import {
		CALIBRATION_DAILY_CAP,
		CALIBRATION_RECOVERY_FLOOR_BASE_UNITS,
		VXP_CALIBRATION_REWARD_BASE_UNITS
	} from '#lib/constants/vxp-economy.constants.ts';
	import { getCalibrationDeck } from '#lib/services/calibration.services.ts';
	import {
		claimCalibrationReward,
		type VxpCalibrationClaim,
		type VxpCalibrationReason
	} from '#lib/services/vxp-awards.services.ts';
	import { balancesStore } from '#lib/stores/balances.store.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { hydrate, marketDisplay } from '#lib/stores/market-translations.store.ts';
	import type { CalibrationCard, CalibrationSide } from '#lib/types/calibration.ts';
	import { decimalFixedValueToNumber } from '#lib/utils/format.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { goBack, resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { prefersReducedMotion } from '#lib/utils/reduced-motion.utils.ts';

	/**
	 * Calibration practice: a recovery surface for a depleted user.
	 *
	 * The user reads a finalised Vici binary market with its outcome
	 * hidden and calls YES / NO. The call is sent to the satellite, which
	 * re-derives the winning side from the clearing settlement and is the
	 * sole authority on correctness: the client never decides whether the
	 * call was right. A correct call mints a fixed +20 VXP; a wrong call
	 * mints nothing and applies no penalty (losses are shielded), shown
	 * honestly. A short pacing countdown arms the next card so the session
	 * stays deliberate rather than a rapid-fire grind.
	 *
	 * While the free balance sits below the recovery floor the persistent
	 * "RECOVERY · LOSSES SHIELDED" banner stays up; once the balance climbs
	 * back to the floor the surface disarms into a "you're recovered" beat.
	 */

	// Seconds the pacing countdown runs between cards before the next one
	// arms. Reduced-motion collapses the visual ring to an instant, but the
	// timer still gates the next card so the deliberate cadence holds.
	const PACING_COUNTDOWN_SECONDS = 20;

	type Phase = 'loading' | 'active' | 'pacing' | 'complete' | 'recovered' | 'rate_limited';

	let phase = $state<Phase>('loading');
	let deck = $state<CalibrationCard[]>([]);
	let cardIndex = $state(0);
	let claiming = $state(false);
	// Last server result for the current card: drives the instant feedback
	// overlay (correct celebration / shielded miss / already-claimed note).
	let lastClaim = $state<VxpCalibrationClaim | null>(null);
	// Reason a rate-limit / ineligible state was entered, for the right copy.
	let blockedReason = $state<VxpCalibrationReason | null>(null);

	// Session tally, surfaced honestly: calls made, calls the server scored
	// correct, and the VXP minted (only correct calls move this).
	let sessionCalls = $state(0);
	let sessionCorrect = $state(0);
	let sessionVxp = $state(0);

	// Pacing countdown.
	let secondsLeft = $state(PACING_COUNTDOWN_SECONDS);
	let pacingTimer: ReturnType<typeof setInterval> | null = null;

	const reduceMotion = $derived(prefersReducedMotion());

	// Free VXP balance, in base units, read from the wallet store, the same
	// source the Wallet hero and Dash read. The recovery banner / disarm gate
	// keys off this against the recovery floor (also base units).
	const vxpBalanceBaseUnits = $derived.by((): bigint => $balancesStore?.[VXP_TOKEN.id] ?? ZERO);

	// Loss-shield is active while the user is genuinely recovering, i.e. the
	// free balance is below the recovery floor. Mirrors the server bound that
	// gates the reward (a wrong call always mints nothing regardless; the
	// shield framing is the UX honesty layer for the recovering user). The
	// comparison is base-unit vs base-unit.
	const shielded = $derived(vxpBalanceBaseUnits < CALIBRATION_RECOVERY_FLOOR_BASE_UNITS);

	// Whole-VXP display values for copy: derived from the base-unit constants
	// so the numbers shown to the user track the authoritative thresholds.
	const recoveryFloorVxp = $derived(
		decimalFixedValueToNumber({
			value: CALIBRATION_RECOVERY_FLOOR_BASE_UNITS,
			decimals: VXP_TOKEN.decimals
		})
	);
	const calibrationRewardVxp = $derived(
		decimalFixedValueToNumber({
			value: VXP_CALIBRATION_REWARD_BASE_UNITS,
			decimals: VXP_TOKEN.decimals
		})
	);

	const currentCard = $derived<CalibrationCard | undefined>(deck[cardIndex]);

	// Hydrate translations for the calibration deck so each card's question reads
	// in the reader's language.
	$effect(() => {
		const ids = deck.map((card) => card.market.id);

		if (ids.length > 0) {
			void hydrate([...new Set(ids)]);
		}
	});

	onMount(async () => {
		try {
			deck = await getCalibrationDeck();
			phase = deck.length === 0 ? 'complete' : 'active';
		} catch (e: unknown) {
			console.error('Failed to load Calibration deck', e);
			phase = 'complete';
		}
	});

	onDestroy(() => {
		clearPacing();
	});

	const clearPacing = () => {
		if (nonNullish(pacingTimer)) {
			clearInterval(pacingTimer);
			pacingTimer = null;
		}
	};

	// Map a non-paying server reason to a terminal screen state. Returns
	// `true` when the reason ends the session (rate-limit / recovered),
	// `false` when the session should simply advance to the next card.
	const applyBlockingReason = (reason: VxpCalibrationReason | undefined): boolean => {
		if (reason === 'rate_limited_hourly' || reason === 'rate_limited_daily') {
			blockedReason = reason;
			phase = 'rate_limited';
			clearPacing();

			return true;
		}

		if (reason === 'balance_above_floor') {
			// The user climbed back to the recovery floor mid-session: disarm
			// into the "you're recovered" beat rather than keep practising.
			blockedReason = reason;
			phase = 'recovered';
			clearPacing();

			return true;
		}

		return false;
	};

	const handleCall = async (side: CalibrationSide) => {
		const card = currentCard;

		if (isNullish(card) || claiming || phase !== 'active') {
			return;
		}

		claiming = true;

		try {
			const claim = await claimCalibrationReward({
				seriesId: card.market.id,
				chosenSide: side
			});

			lastClaim = claim;
			sessionCalls += 1;

			if (claim.correct && claim.paidNow) {
				sessionCorrect += 1;
				// Add the reward the server actually paid (base units, decimal
				// string) converted to whole-VXP for display, never the local
				// constant, so the tally stays correct if the server reward
				// ever differs from our compile-time guess.
				sessionVxp += nonNullish(claim.rewardBaseUnits)
					? decimalFixedValueToNumber({
							value: BigInt(claim.rewardBaseUnits),
							decimals: VXP_TOKEN.decimals
						})
					: calibrationRewardVxp;
			} else if (claim.correct && claim.alreadyClaimed) {
				// Counts as a correct read for the session tally, but the reward
				// was already earned on this market so nothing mints again.
				sessionCorrect += 1;
			}

			// A terminal reason ends the session immediately; otherwise pace to
			// the next card after the feedback has had a beat to read.
			if (applyBlockingReason(claim.reason)) {
				return;
			}

			startPacing();
		} catch (e: unknown) {
			console.error('Calibration claim failed', e);
			// Transport-level failure: let the user retry the same card.
			lastClaim = null;
		} finally {
			claiming = false;
		}
	};

	// Enter the pacing beat: hold the feedback, run the countdown, then arm
	// the next card (or finish the deck). Reduced-motion still waits out the
	// timer so the cadence is identical; only the ring animation collapses.
	const startPacing = () => {
		phase = 'pacing';
		secondsLeft = PACING_COUNTDOWN_SECONDS;
		clearPacing();

		pacingTimer = setInterval(() => {
			secondsLeft -= 1;

			if (secondsLeft <= 0) {
				armNextCard();
			}
		}, 1000);
	};

	const armNextCard = () => {
		clearPacing();
		lastClaim = null;

		if (cardIndex >= deck.length - 1) {
			phase = 'complete';

			return;
		}

		cardIndex += 1;
		phase = 'active';
	};

	// Skip the remaining countdown: the user taps "Next" to arm immediately.
	const skipPacing = () => {
		armNextCard();
	};

	const back = () => {
		goBack(resolveAppPath(AppPath.Flow));
	};

	// Countdown ring geometry. The dash offset shrinks as `secondsLeft`
	// falls, sweeping the ring; reduced-motion shows a static full ring.
	const RING_CIRCUMFERENCE = 2 * Math.PI * 28;
	const ringOffset = $derived(
		reduceMotion ? 0 : RING_CIRCUMFERENCE * (1 - secondsLeft / PACING_COUNTDOWN_SECONDS)
	);
</script>

<div class="calib-screen">
	<ScreenHeader
		back={{ label: t({ locale: $localeStore, key: 'calibration.back.label' }), onBack: back }}
		title={t({ locale: $localeStore, key: 'calibration.title' })}
	/>

	{#if shielded && (phase === 'active' || phase === 'pacing')}
		<!-- Persistent recovery banner: up while the user is below the
		     recovery floor, so the loss-shield promise stays visible. -->
		<div class="calib-banner" role="status">
			{t({
				locale: $localeStore,
				key: 'calibration.banner.recovery',
				params: { floor: recoveryFloorVxp }
			})}
		</div>
	{/if}

	{#if phase === 'loading'}
		<div
			class="calib-state"
			aria-label={t({ locale: $localeStore, key: 'calibration.loading' })}
			aria-live="polite"
			role="status"
		>
			<LoadingSpinner size="md" />
		</div>
	{:else if phase === 'recovered'}
		<div class="calib-state">
			<p class="eyebrow calib-state-eyebrow">
				{t({ locale: $localeStore, key: 'calibration.recovered.eyebrow' })}
			</p>
			<p class="calib-state-title serif-italic">
				{t({ locale: $localeStore, key: 'calibration.recovered.title' })}
			</p>
			<p class="calib-state-sub">
				{t({
					locale: $localeStore,
					key: 'calibration.recovered.sub',
					params: { floor: recoveryFloorVxp }
				})}
			</p>
			<button class="calib-cta" onclick={back} type="button">
				{t({ locale: $localeStore, key: 'calibration.cta.back_to_flow' })}
			</button>
		</div>
	{:else if phase === 'rate_limited'}
		<div class="calib-state">
			<p class="eyebrow calib-state-eyebrow">
				{t({ locale: $localeStore, key: 'calibration.rate_limited.eyebrow' })}
			</p>
			<p class="calib-state-title serif-italic">
				{t({ locale: $localeStore, key: 'calibration.rate_limited.title' })}
			</p>
			<p class="calib-state-sub">
				{#if blockedReason === 'rate_limited_hourly'}
					{t({ locale: $localeStore, key: 'calibration.rate_limited.hourly' })}
				{:else}
					{t({
						locale: $localeStore,
						key: 'calibration.rate_limited.daily',
						params: { cap: CALIBRATION_DAILY_CAP }
					})}
				{/if}
			</p>
			<button class="calib-cta" onclick={back} type="button">
				{t({ locale: $localeStore, key: 'calibration.cta.back_to_flow' })}
			</button>
		</div>
	{:else if phase === 'complete'}
		<div class="calib-state">
			<p class="eyebrow calib-state-eyebrow">
				{sessionCalls === 0
					? t({ locale: $localeStore, key: 'calibration.empty.eyebrow' })
					: t({ locale: $localeStore, key: 'calibration.complete.eyebrow' })}
			</p>
			{#if sessionCalls === 0}
				<p class="calib-state-title serif-italic">
					{t({ locale: $localeStore, key: 'calibration.empty.title' })}
				</p>
				<p class="calib-state-sub">
					{t({ locale: $localeStore, key: 'calibration.empty.sub' })}
				</p>
			{:else}
				<p class="calib-state-title serif-italic">
					{t({
						locale: $localeStore,
						key: 'calibration.complete.title',
						params: { right: sessionCorrect, total: sessionCalls }
					})}
				</p>
				<div class="calib-result">
					<div class="num calib-result-amount">+{sessionVxp}</div>
					<div class="eyebrow calib-result-sub">
						{t({ locale: $localeStore, key: 'calibration.complete.earned' })}
					</div>
				</div>
			{/if}
			<button class="calib-cta" onclick={back} type="button">
				{t({ locale: $localeStore, key: 'calibration.cta.back_to_flow' })}
			</button>
		</div>
	{:else if nonNullish(currentCard)}
		<!-- active | pacing -->
		<div class="calib-body">
			<p class="eyebrow calib-progress-label">
				{t({
					locale: $localeStore,
					key: 'calibration.progress',
					params: { n: cardIndex + 1, total: deck.length }
				})}
			</p>

			<div class="calib-card" class:is-paced={phase === 'pacing'}>
				<div class="eyebrow calib-card-tag">
					{t({ locale: $localeStore, key: 'calibration.card.tag' })}
				</div>
				<h2 class="calib-card-q">{$marketDisplay(currentCard.market).title}</h2>
				<div class="eyebrow calib-card-meta">
					{t({ locale: $localeStore, key: 'calibration.card.meta' })}
				</div>
				<div class="calib-card-stakes">
					<span>
						{t({ locale: $localeStore, key: 'calibration.card.if_right' })}
						<b class="is-yes"
							>+{calibrationRewardVxp} {t({ locale: $localeStore, key: 'calibration.vxp' })}</b
						>
					</span>
					<span>
						{t({ locale: $localeStore, key: 'calibration.card.if_wrong' })}
						{#if shielded}
							<b class="is-yes">
								{t({ locale: $localeStore, key: 'calibration.card.shielded_short' })}
							</b>
						{:else}
							<b class="calib-no-penalty">
								{t({ locale: $localeStore, key: 'calibration.card.no_penalty_short' })}
							</b>
						{/if}
					</span>
				</div>
			</div>

			<div class="calib-tally">
				<span class="eyebrow calib-tally-label">
					{t({ locale: $localeStore, key: 'calibration.tally.session' })}
				</span>
				<span class="num calib-tally-value is-yes">
					+{sessionVxp}
					{t({ locale: $localeStore, key: 'calibration.vxp' })}
				</span>
				<span class="calib-tally-dim">
					{t({
						locale: $localeStore,
						key: 'calibration.tally.right',
						params: { right: sessionCorrect, total: sessionCalls }
					})}
				</span>
			</div>

			{#if phase === 'active'}
				<div class="calib-actions">
					<button
						class="calib-action is-no"
						disabled={claiming}
						onclick={() => void handleCall('NO')}
						type="button"
					>
						{t({ locale: $localeStore, key: 'outcome.no' })}
					</button>
					<button
						class="calib-action is-yes"
						disabled={claiming}
						onclick={() => void handleCall('YES')}
						type="button"
					>
						{t({ locale: $localeStore, key: 'outcome.yes' })}
					</button>
				</div>
			{:else if nonNullish(lastClaim)}
				<!-- Pacing beat: honest feedback + the countdown ring that arms
				     the next card. -->
				<div
					class="calib-feedback"
					class:is-correct={lastClaim.correct}
					class:is-miss={!lastClaim.correct}
					class:no-animation={reduceMotion}
					role="status"
				>
					{#if lastClaim.correct}
						<Check aria-hidden="true" size={20} strokeWidth={2.6} />
						<span>
							{#if lastClaim.alreadyClaimed}
								{t({ locale: $localeStore, key: 'calibration.feedback.already_claimed' })}
							{:else}
								{t({
									locale: $localeStore,
									key: 'calibration.feedback.correct',
									params: { reward: calibrationRewardVxp }
								})}
							{/if}
						</span>
					{:else}
						<X aria-hidden="true" size={20} strokeWidth={2.6} />
						<span>
							{t({ locale: $localeStore, key: 'calibration.feedback.miss' })}
						</span>
					{/if}
				</div>

				<div class="calib-pacing">
					<div class="calib-ring" class:no-animation={reduceMotion}>
						<svg aria-hidden="true" height="64" viewBox="0 0 64 64" width="64">
							<circle class="calib-ring-track" cx="32" cy="32" r="28" />
							<circle
								style="stroke-dasharray: {RING_CIRCUMFERENCE}; stroke-dashoffset: {ringOffset};"
								class="calib-ring-progress"
								cx="32"
								cy="32"
								r="28"
							/>
						</svg>
						<span class="num calib-ring-count">{secondsLeft}</span>
					</div>
					<p class="calib-pacing-label">
						{t({ locale: $localeStore, key: 'calibration.pacing.label' })}
					</p>
					<button class="calib-next" onclick={skipPacing} type="button">
						{t({ locale: $localeStore, key: 'calibration.pacing.next' })}
					</button>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style lang="postcss">
	.calib-screen {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 0 1.25rem 6rem;
		min-height: 100dvh;
	}

	/* Persistent recovery banner. */
	.calib-banner {
		margin: 0;
		padding: 8px 12px;
		border-radius: var(--r-12, 10px);
		text-align: center;
		font-family: var(--font-mono, monospace);
		font-size: 11px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--yes);
		background: color-mix(in srgb, var(--yes) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--yes) 30%, transparent);
	}

	/* Terminal / loading states. */
	.calib-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 3rem 1rem;
		text-align: center;
	}

	.calib-state-eyebrow {
		color: var(--text-muted);
	}

	.calib-state-title {
		margin: 0.5rem 0 0;
		font-size: 22px;
		font-weight: 600;
		color: var(--text-base);
	}

	.calib-state-sub {
		margin: 0;
		font-size: var(--t-14, 14px);
		color: var(--text-muted);
		max-width: 22rem;
	}

	.calib-result {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		margin: 1rem 0;
	}

	.calib-result-amount {
		font-size: 40px;
		font-weight: 600;
		letter-spacing: -0.04em;
		color: var(--yes);
		line-height: 1;
	}

	.calib-result-sub {
		color: var(--text-muted);
	}

	/* Active body. */
	.calib-body {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.calib-progress-label {
		color: var(--text-muted);
	}

	.calib-card {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1.5rem 1.25rem;
		background: var(--bg-popover);
		border: 1px solid var(--border-base);
		border-radius: 16px;
	}

	.calib-card.is-paced {
		opacity: 0.6;
		transition: opacity var(--d-state, 220ms) var(--ease-vici, ease);
	}

	@media (prefers-reduced-motion: reduce) {
		.calib-card.is-paced {
			transition: none;
		}
	}

	.calib-card-tag {
		color: var(--text-muted);
	}

	.calib-card-q {
		margin: 0;
		font-size: 20px;
		font-weight: 600;
		line-height: 1.3;
		color: var(--text-base);
	}

	.calib-card-meta {
		color: var(--text-muted);
	}

	.calib-card-stakes {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: var(--t-13, 13px);
		color: var(--text-muted);
		border-top: 1px solid var(--border-base);
		padding-top: 0.75rem;
	}

	.calib-card-stakes b {
		font-weight: 600;
	}

	.is-yes {
		color: var(--yes);
	}

	.is-no {
		color: var(--no);
	}

	.calib-no-penalty {
		color: var(--text-base);
	}

	.calib-tally {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.calib-tally-label {
		color: var(--text-muted);
	}

	.calib-tally-value {
		font-weight: 600;
	}

	.calib-tally-dim {
		font-size: var(--t-13, 13px);
		color: var(--text-muted);
	}

	/* YES / NO actions. */
	.calib-actions {
		display: flex;
		gap: 0.75rem;
	}

	.calib-action {
		flex: 1;
		appearance: none;
		padding: 1rem;
		font: inherit;
		font-size: 16px;
		font-weight: 700;
		letter-spacing: 0.04em;
		border-radius: var(--r-12, 12px);
		cursor: pointer;
		border: 1px solid transparent;
		transition:
			opacity var(--d-hover, 140ms) var(--ease-vici, ease),
			transform var(--d-hover, 140ms) var(--ease-vici, ease);
	}

	.calib-action:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.calib-action.is-no {
		color: var(--no);
		background: color-mix(in srgb, var(--no) 12%, transparent);
		border-color: color-mix(in srgb, var(--no) 36%, transparent);
	}

	.calib-action.is-yes {
		color: var(--yes);
		background: color-mix(in srgb, var(--yes) 12%, transparent);
		border-color: color-mix(in srgb, var(--yes) 36%, transparent);
	}

	.calib-action:not(:disabled):active {
		transform: scale(0.98);
	}

	@media (prefers-reduced-motion: reduce) {
		.calib-action {
			transition: none;
		}

		.calib-action:not(:disabled):active {
			transform: none;
		}
	}

	/* Feedback + pacing. */
	.calib-feedback {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		border-radius: var(--r-12, 12px);
		font-size: var(--t-14, 14px);
		font-weight: 600;
		animation: calib-feedback-in var(--d-enter, 220ms) var(--ease-vici, ease) both;
	}

	.calib-feedback.is-correct {
		color: var(--yes);
		background: color-mix(in srgb, var(--yes) 12%, transparent);
	}

	.calib-feedback.is-miss {
		color: var(--text-muted);
		background: var(--bg-surface);
	}

	.calib-feedback.no-animation {
		animation: none;
	}

	@keyframes calib-feedback-in {
		from {
			opacity: 0;
			transform: translateY(6px);
		}

		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.calib-pacing {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
	}

	.calib-ring {
		position: relative;
		width: 64px;
		height: 64px;
	}

	.calib-ring svg {
		transform: rotate(-90deg);
	}

	.calib-ring-track {
		fill: none;
		stroke: var(--border-base);
		stroke-width: 4;
	}

	.calib-ring-progress {
		fill: none;
		stroke: var(--yes);
		stroke-width: 4;
		stroke-linecap: round;
		transition: stroke-dashoffset 1s linear;
	}

	.calib-ring.no-animation .calib-ring-progress {
		transition: none;
		stroke-dashoffset: 0;
	}

	.calib-ring-count {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 18px;
		font-weight: 600;
		color: var(--text-base);
	}

	.calib-pacing-label {
		margin: 0;
		font-size: var(--t-13, 13px);
		color: var(--text-muted);
	}

	.calib-next {
		appearance: none;
		padding: 0.5rem 1.25rem;
		font: inherit;
		font-size: var(--t-13, 13px);
		font-weight: 600;
		color: var(--text-base);
		background: var(--bg-popover);
		border: 1px solid var(--border-base);
		border-radius: var(--r-pill, 999px);
		cursor: pointer;
	}

	.calib-next:hover {
		border-color: var(--border-strong);
	}

	/* Shared CTA. */
	.calib-cta {
		margin-top: 0.75rem;
		appearance: none;
		padding: 0.75rem 1.5rem;
		font: inherit;
		font-size: var(--t-14, 14px);
		font-weight: 600;
		color: var(--bg-base);
		background: var(--text-base);
		border: 1px solid var(--text-base);
		border-radius: var(--r-12, 12px);
		cursor: pointer;
	}

	.calib-cta:hover {
		opacity: 0.9;
	}
</style>
