<script lang="ts">
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	/**
	 * Deployed-vs-depleted recovery beat — shown when the user's free VXP
	 * balance has fallen to the recovery floor. It reads net worth still
	 * locked in open calls to tell two very different states apart:
	 *
	 * - **Fully deployed** (locked VXP at or above the deploy floor): the stack is
	 *   in play, not lost — a positive beat. The VXP is parked in calls that
	 *   haven't settled and pays out on their own dates. CTAs point at the
	 *   open calls, with Calibration offered as a "practice while you wait".
	 * - **Genuine depletion** (below the floor): realised losses have eroded
	 *   the stack. The way back is the risk-free Calibration practice path —
	 *   losses are shielded while the balance recovers — so the primary CTA
	 *   opens Calibration.
	 *
	 * Both `_vxp` numbers are whole VXP. The component is presentational; the
	 * branch and the CTAs are passed in by the host surface.
	 */
	interface Props {
		/** `true` when net worth in open calls is at or above the deploy floor. */
		deployed: boolean;
		/** Whole VXP still riding on unsettled open calls. */
		lockedInOpenVxp: number;
		/** Number of open calls the locked VXP is riding on. */
		openCallCount: number;
		/** Fixed reward, in VXP, a correct Calibration call mints. */
		rewardVxp: number;
		/** Opens the Calibration practice surface. */
		onCalibrate: () => void;
		/** Opens the user's open calls (portfolio). Only used when deployed. */
		onReviewOpenCalls?: () => void;
	}

	const {
		deployed,
		lockedInOpenVxp,
		openCallCount,
		rewardVxp,
		onCalibrate,
		onReviewOpenCalls
	}: Props = $props();

	const lockedDisplay = $derived(lockedInOpenVxp.toLocaleString());

	const openCallsLabel = $derived(
		t({
			locale: $localeStore,
			key: openCallCount === 1 ? 'calibration.beat.open_call' : 'calibration.beat.open_calls',
			params: { count: openCallCount }
		})
	);
</script>

<section class="recovery-beat" class:is-deployed={deployed} role="status">
	{#if deployed}
		<div class="recovery-crest" aria-hidden="true">◆</div>
		<p class="eyebrow recovery-eyebrow">
			{t({ locale: $localeStore, key: 'calibration.beat.deployed.eyebrow' })}
		</p>
		<p class="recovery-title serif-italic">
			{t({ locale: $localeStore, key: 'calibration.beat.deployed.title' })}
		</p>
		<p class="num recovery-grant">{lockedDisplay}</p>
		<p class="eyebrow recovery-grant-sub">
			{t({
				locale: $localeStore,
				key: 'calibration.beat.deployed.riding_on',
				params: { calls: openCallsLabel }
			})}
		</p>
		<p class="recovery-quote">
			{t({ locale: $localeStore, key: 'calibration.beat.deployed.body' })}
		</p>
		<button class="recovery-cta is-primary" onclick={() => onReviewOpenCalls?.()} type="button">
			{t({ locale: $localeStore, key: 'calibration.beat.deployed.see_open_calls' })}
		</button>
		<button class="recovery-cta is-ghost" onclick={onCalibrate} type="button">
			{t({ locale: $localeStore, key: 'calibration.beat.deployed.practice' })}
		</button>
	{:else}
		<p class="eyebrow recovery-eyebrow">
			{t({ locale: $localeStore, key: 'calibration.beat.depleted.eyebrow' })}
		</p>
		<p class="recovery-quote">
			{t({ locale: $localeStore, key: 'calibration.beat.depleted.body' })}
		</p>
		<button class="recovery-cta is-primary" onclick={onCalibrate} type="button">
			{t({ locale: $localeStore, key: 'calibration.beat.depleted.open_calibration' })}
		</button>
		<p class="eyebrow recovery-foot">
			{t({
				locale: $localeStore,
				key: 'calibration.beat.depleted.foot',
				params: { reward: rewardVxp }
			})}
		</p>
	{/if}
</section>

<style lang="postcss">
	.recovery-beat {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 24px;
		text-align: center;
		background: var(--bg-popover);
		border: 1px solid var(--border-base);
		border-radius: 16px;
	}

	.recovery-beat.is-deployed {
		border-color: color-mix(in srgb, var(--yes) 36%, var(--border-base));
	}

	.recovery-crest {
		font-size: 24px;
		color: var(--yes);
		line-height: 1;
	}

	.recovery-eyebrow {
		margin: 0;
		color: var(--text-muted);
	}

	.recovery-beat.is-deployed .recovery-eyebrow {
		color: var(--yes);
	}

	.recovery-title {
		margin: 0.25rem 0 0;
		font-size: 18px;
		font-weight: 600;
		color: var(--text-base);
		line-height: 1.3;
	}

	.recovery-grant {
		margin: 0.5rem 0 0;
		font-size: 40px;
		font-weight: 600;
		letter-spacing: -0.04em;
		color: var(--yes);
		line-height: 1;
	}

	.recovery-grant-sub {
		margin: 0;
		color: var(--text-muted);
	}

	.recovery-quote {
		margin: 0.5rem 0 0;
		font-size: var(--t-14, 14px);
		color: var(--text-muted);
		max-width: 24rem;
	}

	.recovery-cta {
		width: 100%;
		appearance: none;
		margin-top: 0.5rem;
		padding: 0.75rem 1rem;
		font: inherit;
		font-size: var(--t-14, 14px);
		font-weight: 600;
		border-radius: var(--r-12, 12px);
		cursor: pointer;
		transition:
			opacity var(--d-hover, 140ms) var(--ease-vici, ease),
			border-color var(--d-hover, 140ms) var(--ease-vici, ease);
	}

	.recovery-cta.is-primary {
		color: var(--bg-base);
		background: var(--text-base);
		border: 1px solid var(--text-base);
	}

	.recovery-cta.is-primary:hover {
		opacity: 0.9;
	}

	.recovery-cta.is-ghost {
		color: var(--text-base);
		background: var(--bg-popover);
		border: 1px solid var(--border-base);
	}

	.recovery-cta.is-ghost:hover {
		border-color: var(--border-strong);
	}

	.recovery-foot {
		margin: 0.5rem 0 0;
		color: var(--text-muted);
	}

	@media (prefers-reduced-motion: reduce) {
		.recovery-cta {
			transition: none;
		}
	}
</style>
