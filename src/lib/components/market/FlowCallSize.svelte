<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import FlowCallSizeSlider from '#lib/components/market/FlowCallSizeSlider.svelte';
	import {
		VXP_DEFAULT_CALL_SIZE,
		VXP_CALL_SIZE_LADDER,
		type VxpCallSize
	} from '#lib/constants/vxp-economy.constants.ts';
	import { balanceDomain } from '#lib/derived/balance-domain.derived.ts';
	import type { Market } from '#lib/types/market.ts';
	import { isViciXp } from '#lib/utils/balance-domain.utils.ts';
	import { resolveOutcomeExecutionPrice } from '#lib/utils/market.utils.ts';
	import { snapToCallSizeLadder, vxpNetWin } from '#lib/utils/vxp-economy.utils.ts';

	interface Props {
		market: Market;
		yesPct: number;
		noPct: number;
		// Current call size (string for input-binding parity with
		// FlowMode). Drives the call-size slider and payout preview.
		tradeAmount?: string;
		// Call-size ladder change callback. Fires when a rung or the
		// native range input changes.
		onCallSizeChange?: (next: string) => void;
		// Proactive call-size warning resolved by FlowMode, rendered on the slider.
		// Defaults to `'none'` so static / preview usages stay quiet.
		callSizeWarning?: 'none' | 'unaffordable' | 'wont-finish';
	}

	const {
		market,
		yesPct,
		noPct,
		tradeAmount,
		onCallSizeChange,
		callSizeWarning = 'none'
	}: Props = $props();

	// The call-size ladder is shown whenever the call-size controls are wired and
	// the user is on the ViciXP domain (the playground domain uses the
	// FlowMode stepper with fractional ICP / ckUSDC amounts, not the
	// ladder).
	const showCallSizeSlider = $derived(
		nonNullish(tradeAmount) && nonNullish(onCallSizeChange) && isViciXp($balanceDomain)
	);
	const currentCallSize: VxpCallSize = $derived(
		showCallSizeSlider
			? snapToCallSizeLadder({ value: Number(tradeAmount ?? '0') || 0 })
			: VXP_DEFAULT_CALL_SIZE
	);
	const callSizeIdx = $derived(VXP_CALL_SIZE_LADDER.indexOf(currentCallSize));
	const callSizePct = $derived(
		callSizeIdx >= 0 ? (callSizeIdx / (VXP_CALL_SIZE_LADDER.length - 1)) * 100 : 0
	);
	const atCap = $derived(currentCallSize === VXP_CALL_SIZE_LADDER[VXP_CALL_SIZE_LADDER.length - 1]);
	// Price off the execution price (the ask), like the order placed, not the
	// consensus mid, which over-promises on a thin book.
	const yesNetWin = $derived(
		vxpNetWin({
			amount: currentCallSize,
			pWin: resolveOutcomeExecutionPrice({ market, action: 'YES' })
		})
	);
	const noNetWin = $derived(
		vxpNetWin({
			amount: currentCallSize,
			pWin: resolveOutcomeExecutionPrice({ market, action: 'NO' })
		})
	);

	const selectCallSize = (rung: VxpCallSize) => {
		if (isNullish(onCallSizeChange)) {
			return;
		}

		onCallSizeChange(String(rung));
	};

	const onCallSizeRangeChange = (e: Event) => {
		const target = e.target as HTMLInputElement;
		const idx = parseInt(target.value, 10);
		const rung = VXP_CALL_SIZE_LADDER[idx];

		if (nonNullish(rung)) {
			selectCallSize(rung);
		}
	};
</script>

{#if showCallSizeSlider}
	<FlowCallSizeSlider
		{atCap}
		{callSizeIdx}
		{callSizePct}
		{callSizeWarning}
		{currentCallSize}
		{noNetWin}
		{noPct}
		{onCallSizeRangeChange}
		onSelectCallSize={selectCallSize}
		{yesNetWin}
		{yesPct}
	/>
{/if}
