<script lang="ts">
	import CallSizeSlider from '#lib/components/market/CallSizeSlider.svelte';
	import type { VxpCallSize } from '#lib/constants/vxp-economy.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { formatWholeVxpMagnitude } from '#lib/utils/playground-display.utils.ts';

	interface Props {
		currentCallSize: VxpCallSize;
		atCap: boolean;
		yesPct: number;
		noPct: number;
		yesNetWin: number;
		noNetWin: number;
		onSelectCallSize: (size: VxpCallSize) => void;
		// Proactive call-size warning resolved by FlowMode. `'unaffordable'` = the
		// size exceeds spendable VXP; `'wont-finish'` = it would leave too
		// little to finish the sitting. `'none'` renders no row.
		callSizeWarning?: 'none' | 'unaffordable' | 'wont-finish';
	}

	let {
		currentCallSize,
		atCap,
		yesPct,
		noPct,
		yesNetWin,
		noNetWin,
		onSelectCallSize,
		callSizeWarning = 'none'
	}: Props = $props();
</script>

<section
	class={`flow-back-block flow-call-size${atCap ? ' is-cap' : ''}`}
	data-no-card-gesture="true"
>
	<CallSizeSlider onValueChange={onSelectCallSize} source="flow" value={currentCallSize} />
	<div class="flow-call-size-payout">
		<div class="flow-call-size-payout-row">
			<span class="flow-call-size-payout-lbl allcaps">
				{t({ locale: $localeStore, key: 'card.if_yes_at', params: { pct: yesPct } })}
			</span>
			<span class="num text-yes">+{formatWholeVxpMagnitude(yesNetWin)} VXP</span>
		</div>
		<div class="flow-call-size-payout-row">
			<span class="flow-call-size-payout-lbl allcaps">
				{t({ locale: $localeStore, key: 'card.if_no_at', params: { pct: noPct } })}
			</span>
			<span class="num text-yes">+{formatWholeVxpMagnitude(noNetWin)} VXP</span>
		</div>
		<div class="flow-call-size-payout-row">
			<span class="flow-call-size-payout-lbl allcaps">
				{t({ locale: $localeStore, key: 'card.if_wrong' })}
			</span>
			<span class="num text-no">−{currentCallSize} VXP</span>
		</div>
	</div>
	{#if callSizeWarning !== 'none'}
		<p class="flow-call-size-warning" aria-live="polite" role="status">
			{callSizeWarning === 'unaffordable'
				? t({ locale: $localeStore, key: 'flow.call_size.warning.unaffordable' })
				: t({ locale: $localeStore, key: 'flow.call_size.warning.wont_finish' })}
		</p>
	{/if}
</section>

<style lang="postcss">
	/* Shared block wrapper (from the FlowCardBack `.flow-back-block` rule)
	   and the section surface (from the grouped `.flow-resolution,
	   .flow-community, .flow-call-size, .flow-split` rule): duplicated here so
	   the extracted section keeps its spacing + surface under Svelte's
	   per-component style scoping. */
	.flow-back-block {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.flow-call-size {
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

	/* Cap state: at the maximum call size every accent surface flips
	   from laurel to `--no` red (this section's wash, border and payout
	   rule here; label, value, fill and handle inside the shared slider)
	   so the user feels the upper bound visually instead of having to
	   read it. */
	.flow-call-size.is-cap {
		background: linear-gradient(
			180deg,
			rgba(255, 107, 107, 0.06),
			rgba(226, 184, 66, 0.02) 70%,
			transparent
		);
		border-color: rgba(255, 107, 107, 0.3);
	}
	.flow-call-size-payout {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding-top: 0.5rem;
		border-top: 1px dashed color-mix(in srgb, var(--laurel) 20%, transparent);
		margin-top: 0.4rem;
	}
	.flow-call-size.is-cap .flow-call-size-payout {
		border-top-color: color-mix(in srgb, var(--no) 20%, transparent);
	}
	.flow-call-size-payout-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: var(--t-12);
	}
	.flow-call-size-payout-lbl {
		color: var(--text-muted);
		font-family: var(--font-data);
		font-size: var(--t-10);
		letter-spacing: 0.1em;
	}

	/* Proactive size warning: reuses the cap's red tint so a problematic
	   size reads as a soft warning, not an error banner. One dense line. */
	.flow-call-size-warning {
		margin: 0.5rem 0 0;
		padding: 0.4rem 0.5rem;
		border-radius: var(--r-8);
		border: 1px solid rgba(255, 107, 107, 0.3);
		background: rgba(255, 107, 107, 0.08);
		color: var(--no);
		font-size: var(--t-12);
		line-height: 1.3;
	}
</style>
