<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import FlowCallSizeSlider from '#lib/components/market/FlowCallSizeSlider.svelte';
	import {
		VXP_DEFAULT_CALL_SIZE,
		VXP_MAX_CALL_SIZE,
		type VxpCallSize
	} from '#lib/constants/vxp-economy.constants.ts';
	import { balanceDomain } from '#lib/derived/balance-domain.derived.ts';
	import type { Market } from '#lib/types/market.ts';
	import { isViciXp } from '#lib/utils/balance-domain.utils.ts';
	import { resolveOutcomeExecutionPrice } from '#lib/utils/market.utils.ts';
	import { clampVxpCallSize, vxpNetWin } from '#lib/utils/vxp-economy.utils.ts';

	interface Props {
		market: Market;
		yesPct: number;
		noPct: number;
		// Current call size (string for input-binding parity with
		// FlowMode). Drives the call-size slider and payout preview.
		tradeAmount?: string;
		// Call-size change callback, fired as the slider moves.
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

	// The call-size slider is shown whenever the call-size controls are wired
	// and the user is on the ViciXP domain (the playground domain uses the
	// FlowMode stepper with fractional ICP / ckUSDC amounts, not the slider).
	const showCallSizeSlider = $derived(
		nonNullish(tradeAmount) && nonNullish(onCallSizeChange) && isViciXp($balanceDomain)
	);
	const currentCallSize: VxpCallSize = $derived(
		showCallSizeSlider ? clampVxpCallSize({ value: Number(tradeAmount) }) : VXP_DEFAULT_CALL_SIZE
	);
	const atCap = $derived(currentCallSize >= VXP_MAX_CALL_SIZE);
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

	const selectCallSize = (size: VxpCallSize) => {
		if (isNullish(onCallSizeChange)) {
			return;
		}

		onCallSizeChange(String(size));
	};
</script>

{#if showCallSizeSlider}
	<FlowCallSizeSlider
		{atCap}
		{callSizeWarning}
		{currentCallSize}
		{noNetWin}
		{noPct}
		onSelectCallSize={selectCallSize}
		{yesNetWin}
		{yesPct}
	/>
{/if}
