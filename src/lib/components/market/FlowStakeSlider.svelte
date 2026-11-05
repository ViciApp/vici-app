<script lang="ts">
	import { VXP_STAKE_LADDER, type VxpStake } from '#lib/constants/vxp-economy.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { formatWholeVxpMagnitude } from '#lib/utils/playground-display.utils.ts';

	interface Props {
		currentStake: VxpStake;
		atCap: boolean;
		stakePct: number;
		stakeIdx: number;
		yesPct: number;
		noPct: number;
		stakeYesWin: number;
		stakeNoWin: number;
		onStakeRangeChange: (e: Event) => void;
		onSelectStake: (rung: VxpStake) => void;
		// Proactive stake warning resolved by FlowMode. `'unaffordable'` = the
		// size exceeds spendable VXP; `'wont-finish'` = it would leave too
		// little to finish the sitting. `'none'` renders no row.
		stakeWarning?: 'none' | 'unaffordable' | 'wont-finish';
	}

	let {
		currentStake,
		atCap,
		stakePct,
		stakeIdx,
		yesPct,
		noPct,
		stakeYesWin,
		stakeNoWin,
		onStakeRangeChange,
		onSelectStake,
		stakeWarning = 'none'
	}: Props = $props();

	// Each peg label is centred on the slider stop it selects, so the
	// number sits directly under the handle position it maps to — the
	// first peg at 0 %, the last at 100 %, and the middle rungs at their
	// exact fraction of the ladder.
	const pegPct = (index: number): number =>
		VXP_STAKE_LADDER.length > 1 ? (index / (VXP_STAKE_LADDER.length - 1)) * 100 : 0;
</script>

<section class={`flow-back-block flow-stake${atCap ? ' is-cap' : ''}`} data-no-card-gesture="true">
	<div class="flow-stake-head">
		<span class="eyebrow flow-stake-label">
			{atCap
				? t({ locale: $localeStore, key: 'card.call_size_cap' })
				: t({ locale: $localeStore, key: 'card.call_size' })}
		</span>
		<span class="flow-stake-value num">
			{currentStake}
			<span class="flow-stake-unit">VXP</span>
		</span>
	</div>
	<div class="flow-stake-slider-wrap">
		<div class="flow-stake-track" aria-hidden="true">
			<div style:width="{stakePct}%" class="flow-stake-fill"></div>
		</div>
		<div style:left="{stakePct}%" class="flow-stake-handle" aria-hidden="true"></div>
		<input
			class="flow-stake-range"
			aria-label={t({ locale: $localeStore, key: 'card.call_size' })}
			max={VXP_STAKE_LADDER.length - 1}
			min={0}
			onchange={onStakeRangeChange}
			oninput={onStakeRangeChange}
			step={1}
			type="range"
			value={Math.max(0, stakeIdx)}
		/>
	</div>
	<div class="flow-stake-pegs" role="radiogroup">
		{#each VXP_STAKE_LADDER as rung, i (rung)}
			<button
				style:left="{pegPct(i)}%"
				class="flow-stake-peg num"
				class:is-active={rung === currentStake}
				aria-checked={rung === currentStake}
				onclick={(e) => {
					e.stopPropagation();
					onSelectStake(rung);
				}}
				role="radio"
				type="button"
			>
				{rung}
			</button>
		{/each}
	</div>
	<div class="flow-stake-payout">
		<div class="flow-stake-payout-row">
			<span class="flow-stake-payout-lbl allcaps">
				{t({ locale: $localeStore, key: 'card.if_yes_at', params: { pct: yesPct } })}
			</span>
			<span class="num text-yes">+{formatWholeVxpMagnitude(stakeYesWin)} VXP</span>
		</div>
		<div class="flow-stake-payout-row">
			<span class="flow-stake-payout-lbl allcaps">
				{t({ locale: $localeStore, key: 'card.if_no_at', params: { pct: noPct } })}
			</span>
			<span class="num text-yes">+{formatWholeVxpMagnitude(stakeNoWin)} VXP</span>
		</div>
		<div class="flow-stake-payout-row">
			<span class="flow-stake-payout-lbl allcaps">
				{t({ locale: $localeStore, key: 'card.if_wrong' })}
			</span>
			<span class="num text-no">−{currentStake} VXP</span>
		</div>
	</div>
	{#if stakeWarning !== 'none'}
		<p class="flow-stake-warning" aria-live="polite" role="status">
			{stakeWarning === 'unaffordable'
				? t({ locale: $localeStore, key: 'flow.stake.warning.unaffordable' })
				: t({ locale: $localeStore, key: 'flow.stake.warning.wont_finish' })}
		</p>
	{/if}
</section>

<style lang="postcss">
	/* Shared block wrapper (from the FlowCardBack `.flow-back-block` rule)
	   and the section surface (from the grouped `.flow-resolution,
	   .flow-community, .flow-stake, .flow-split` rule) — duplicated here so
	   the extracted section keeps its spacing + surface under Svelte's
	   per-component style scoping. */
	.flow-back-block {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.flow-stake {
		padding: 0.75rem 0.85rem;
		border-radius: var(--r-12);
		border: 1px solid color-mix(in srgb, var(--laurel) 22%, var(--border-base));
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--laurel) 6%, transparent),
			color-mix(in srgb, var(--laurel) 2%, transparent) 70%,
			transparent
		);
		box-shadow: var(--inset-hi);
	}

	/* Cap state: when the user hits the top rung of the stake ladder
	   we flip every accent surface — wash, border, label, value,
	   slider fill, handle, active peg — from laurel to `--no` red so
	   the user feels the upper bound visually instead of having to
	   read it. */
	.flow-stake.is-cap {
		background: linear-gradient(
			180deg,
			rgba(255, 107, 107, 0.06),
			rgba(226, 184, 66, 0.02) 70%,
			transparent
		);
		border-color: rgba(255, 107, 107, 0.3);
	}
	.flow-stake-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
	}
	.flow-stake-label {
		color: var(--text-muted);
		font-family: var(--font-mono);
	}
	.flow-stake.is-cap .flow-stake-label {
		color: var(--no);
	}
	.flow-stake-value {
		font-family: var(--font-mono);
		font-size: 1.375rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		color: var(--laurel);
	}
	.flow-stake.is-cap .flow-stake-value {
		color: var(--no);
	}
	.flow-stake-unit {
		font-size: var(--t-12);
		opacity: 0.7;
		margin-left: 2px;
	}

	.flow-stake-slider-wrap {
		position: relative;
		height: 28px;
		margin: 0.4rem 0 0.3rem;
	}
	.flow-stake-track {
		position: absolute;
		top: 50%;
		left: 0;
		right: 0;
		transform: translateY(-50%);
		height: 6px;
		border-radius: var(--r-pill);
		background: var(--border-strong);
		overflow: hidden;
	}
	.flow-stake-fill {
		height: 100%;
		background: linear-gradient(90deg, var(--laurel), #ffd27a);
		border-radius: inherit;
		transition: width 220ms var(--ease-vici);
	}
	.flow-stake.is-cap .flow-stake-fill {
		background: linear-gradient(90deg, var(--laurel), var(--no));
	}
	.flow-stake-handle {
		position: absolute;
		top: 50%;
		width: 22px;
		height: 22px;
		border-radius: var(--r-pill);
		background: var(--laurel);
		border: 3px solid var(--bg-surface);
		transform: translate(-50%, -50%);
		box-shadow:
			0 0 0 1px var(--laurel),
			0 3px 10px color-mix(in srgb, var(--laurel) 40%, transparent);
		pointer-events: none;
		transition:
			left 220ms var(--ease-vici),
			background 220ms var(--ease-vici),
			border-color 220ms var(--ease-vici),
			box-shadow 220ms var(--ease-vici);
	}
	.flow-stake.is-cap .flow-stake-handle {
		background: var(--no);
		box-shadow:
			0 0 0 1px var(--no),
			0 3px 8px color-mix(in srgb, var(--no) 40%, transparent);
	}
	.flow-stake-range {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
		margin: 0;
	}

	/* Pegs are absolutely positioned so each label centres on the slider
	   stop it selects (see `pegPct`), keeping the ladder readout in lock
	   step with the handle rather than evenly spaced. The container
	   reserves a fixed row height since its children are taken out of
	   flow. */
	.flow-stake-pegs {
		position: relative;
		height: 1.4rem;
	}
	.flow-stake-peg {
		position: absolute;
		top: 0;
		transform: translateX(-50%);
		appearance: none;
		padding: 0.25rem 0.25rem;
		font-family: var(--font-mono);
		font-size: var(--t-10);
		font-weight: 600;
		color: var(--fg-faint);
		background: transparent;
		border: 0;
		border-radius: var(--r-pill);
		cursor: pointer;
		transition:
			color var(--d-hover) ease,
			background var(--d-hover) ease;
	}
	.flow-stake-peg:hover {
		color: var(--text-base);
	}
	.flow-stake-peg:active {
		background: color-mix(in srgb, var(--text-base) 5%, transparent);
	}
	.flow-stake-peg.is-active {
		color: var(--accent);
		font-weight: 700;
	}
	.flow-stake.is-cap .flow-stake-peg.is-active {
		color: var(--no);
	}

	.flow-stake-payout {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding-top: 0.5rem;
		border-top: 1px dashed color-mix(in srgb, var(--laurel) 20%, transparent);
		margin-top: 0.4rem;
	}
	.flow-stake.is-cap .flow-stake-payout {
		border-top-color: color-mix(in srgb, var(--no) 20%, transparent);
	}
	.flow-stake-payout-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: var(--t-12);
	}
	.flow-stake-payout-lbl {
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: var(--t-10);
		letter-spacing: 0.1em;
	}

	/* Proactive size warning — reuses the cap's red tint so a problematic
	   size reads as a soft warning, not an error banner. One dense line. */
	.flow-stake-warning {
		margin: 0.5rem 0 0;
		padding: 0.4rem 0.5rem;
		border-radius: var(--r-8);
		border: 1px solid rgba(255, 107, 107, 0.3);
		background: rgba(255, 107, 107, 0.08);
		color: var(--no);
		font-size: var(--t-12);
		line-height: 1.3;
	}

	/* The handle glides and the fill grows toward a newly selected rung;
	   under reduced-motion they snap to the new position instead. */
	@media (prefers-reduced-motion: reduce) {
		.flow-stake-handle,
		.flow-stake-fill {
			transition: none;
		}
	}
</style>
