<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import FlowStakeSlider from '#lib/components/market/FlowStakeSlider.svelte';
	import {
		VXP_DEFAULT_STAKE,
		VXP_STAKE_LADDER,
		type VxpStake
	} from '#lib/constants/vxp-economy.constants.ts';
	import { balanceDomain } from '#lib/derived/balance-domain.derived.ts';
	import type { Market } from '#lib/types/market.ts';
	import { isViciXp } from '#lib/utils/balance-domain.utils.ts';
	import { resolveOutcomeExecutionPrice } from '#lib/utils/market.utils.ts';
	import { snapToStakeLadder, vxpNetWin } from '#lib/utils/vxp-economy.utils.ts';

	interface Props {
		market: Market;
		yesPct: number;
		noPct: number;
		// Current stake amount (string for input-binding parity with
		// FlowMode). Drives the stake slider and payout preview.
		tradeAmount?: string;
		// Stake-ladder change callback. Fires when a rung or the
		// native range input changes.
		onStakeChange?: (next: string) => void;
		// Proactive stake warning resolved by FlowMode, rendered on the slider.
		// Defaults to `'none'` so static / preview usages stay quiet.
		stakeWarning?: 'none' | 'unaffordable' | 'wont-finish';
	}

	const {
		market,
		yesPct,
		noPct,
		tradeAmount,
		onStakeChange,
		stakeWarning = 'none'
	}: Props = $props();

	// The stake ladder is shown whenever the stake controls are wired and
	// the user is on the ViciXP domain (the playground domain uses the
	// FlowMode stepper with fractional ICP / ckUSDC stakes, not the
	// ladder).
	const showStakeSlider = $derived(
		nonNullish(tradeAmount) && nonNullish(onStakeChange) && isViciXp($balanceDomain)
	);
	const currentStake: VxpStake = $derived(
		showStakeSlider
			? snapToStakeLadder({ value: Number(tradeAmount ?? '0') || 0 })
			: VXP_DEFAULT_STAKE
	);
	const stakeIdx = $derived(VXP_STAKE_LADDER.indexOf(currentStake));
	const stakePct = $derived(stakeIdx >= 0 ? (stakeIdx / (VXP_STAKE_LADDER.length - 1)) * 100 : 0);
	const atCap = $derived(currentStake === VXP_STAKE_LADDER[VXP_STAKE_LADDER.length - 1]);
	// Price off the execution price (the ask), like the order placed — not the
	// consensus mid, which over-promises on a thin book.
	const stakeYesWin = $derived(
		vxpNetWin({
			stake: currentStake,
			pWin: resolveOutcomeExecutionPrice({ market, action: 'YES' })
		})
	);
	const stakeNoWin = $derived(
		vxpNetWin({ stake: currentStake, pWin: resolveOutcomeExecutionPrice({ market, action: 'NO' }) })
	);

	const selectStake = (rung: VxpStake) => {
		if (isNullish(onStakeChange)) {
			return;
		}

		onStakeChange(String(rung));
	};

	const onStakeRangeChange = (e: Event) => {
		const target = e.target as HTMLInputElement;
		const idx = parseInt(target.value, 10);
		const rung = VXP_STAKE_LADDER[idx];

		if (nonNullish(rung)) {
			selectStake(rung);
		}
	};
</script>

{#if showStakeSlider}
	<FlowStakeSlider
		{atCap}
		{currentStake}
		{noPct}
		onSelectStake={selectStake}
		{onStakeRangeChange}
		{stakeIdx}
		{stakeNoWin}
		{stakePct}
		{stakeWarning}
		{stakeYesWin}
		{yesPct}
	/>
{/if}
