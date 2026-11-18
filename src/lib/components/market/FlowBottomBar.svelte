<script lang="ts">
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { FlowAction } from '#lib/types/market.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		tradeAmount: string;
		step: number;
		min: number;
		unitLabel: string;
		onIncrement: (direction: 1 | -1) => void;
		onAction: (action: FlowAction) => void;
	}

	let { tradeAmount = $bindable(), step, min, unitLabel, onIncrement, onAction }: Props = $props();
</script>

<footer class="flow-bottombar">
	<div class="flow-amount">
		<button
			class="flow-amount-btn"
			aria-label={t({ locale: $localeStore, key: 'flow.amount.decrease_aria' })}
			onclick={() => onIncrement(-1)}
		>
			−
		</button>
		<div class="flow-amount-field">
			<input
				class="flow-amount-input"
				inputmode="decimal"
				{min}
				{step}
				type="number"
				bind:value={tradeAmount}
			/>
			<span class="flow-amount-unit">{unitLabel}</span>
		</div>
		<button
			class="flow-amount-btn"
			aria-label={t({ locale: $localeStore, key: 'flow.amount.increase_aria' })}
			onclick={() => onIncrement(1)}
		>
			+
		</button>
	</div>

	<div class="flow-actions">
		<button
			class="flow-action flow-action-no"
			aria-label={t({ locale: $localeStore, key: 'market.forecast.predict_no' })}
			onclick={() => onAction('NO')}
		>
			<svg class="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					d="M6 18L18 6M6 6l12 12"
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="3"
				/>
			</svg>
			<span class="flow-action-label">
				{t({ locale: $localeStore, key: 'flow.action.no' })}
			</span>
		</button>

		<button
			class="flow-action flow-action-skip"
			aria-label={t({ locale: $localeStore, key: 'flow.skip_aria' })}
			onclick={() => onAction('SKIP')}
		>
			<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					d="M5 12l7-7 7 7M5 19l7-7 7 7"
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="3"
				/>
			</svg>
			<span class="flow-action-label">
				{t({ locale: $localeStore, key: 'flow.action.skip' })}
			</span>
		</button>

		<button
			class="flow-action flow-action-yes"
			aria-label={t({ locale: $localeStore, key: 'market.forecast.predict_yes' })}
			onclick={() => onAction('YES')}
		>
			<svg class="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					d="M5 13l4 4L19 7"
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="3.5"
				/>
			</svg>
			<span class="flow-action-label">
				{t({ locale: $localeStore, key: 'flow.action.yes' })}
			</span>
		</button>
	</div>

	<div class="flow-kbd">
		<kbd>←</kbd>
		<span>·</span>
		<kbd>↑</kbd>
		<span>·</span>
		<kbd>→</kbd>
	</div>
</footer>

<style lang="postcss">
	.flow-bottombar {
		position: sticky;
		bottom: 0;
		z-index: 60;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
		/* Reserve clearance for the floating pillnav. `--bn-clear`
		 * resolves to `96px + safe-area-inset-bottom`. */
		padding: 0.55rem 1rem var(--bn-clear);
		background: linear-gradient(
			to top,
			color-mix(in srgb, var(--bg-base) 98%, transparent) 56%,
			transparent
		);
	}

	.flow-amount {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 3px;
		border-radius: var(--r-pill);
		background: var(--bg-surface);
		box-shadow: inset 0 0 0 1px var(--border-base);
	}
	.flow-amount-btn {
		width: 2rem;
		height: 2rem;
		border-radius: var(--r-pill);
		background: var(--bg-popover);
		color: var(--text-base);
		font-size: 18px;
		font-weight: 900;
		line-height: 1;
		transition: transform 0.12s ease;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
	}
	.flow-amount-btn:active {
		transform: scale(0.985);
	}
	.flow-amount-field {
		display: inline-flex;
		align-items: baseline;
		gap: 4px;
		padding: 0 10px;
		min-width: 5.5rem;
		justify-content: center;
	}
	.flow-amount-input {
		width: 3.5rem;
		background: transparent;
		text-align: right;
		font-family: var(--font-mono);
		font-size: 15px;
		font-weight: 900;
		color: var(--text-base);
		outline: none;
		font-variant-numeric: tabular-nums;
		-moz-appearance: textfield;
	}
	.flow-amount-input::-webkit-outer-spin-button,
	.flow-amount-input::-webkit-inner-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}
	.flow-amount-unit {
		font-size: var(--t-10);
		font-weight: 900;
		letter-spacing: 0.08em;
		color: var(--text-muted);
	}

	.flow-actions {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 1rem;
	}
	.flow-action {
		display: inline-flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0;
		border-radius: var(--r-pill);
		background: var(--bg-surface);
		transition:
			transform 0.12s ease,
			box-shadow 0.2s ease;
		position: relative;
	}
	.flow-action:active {
		transform: scale(0.985);
	}
	.flow-action-label {
		position: absolute;
		bottom: -1.25rem;
		font-size: 9px;
		font-weight: 900;
		letter-spacing: 0.18em;
		color: var(--text-muted);
	}

	.flow-action-no {
		width: 3.35rem;
		height: 3.35rem;
		border: 3px solid color-mix(in srgb, var(--no) 25%, transparent);
		color: var(--no);
		box-shadow: 0 10px 24px var(--no-wash);
	}
	.flow-action-skip {
		width: 2.75rem;
		height: 2.75rem;
		border: 3px solid var(--border-strong);
		color: var(--text-muted);
		box-shadow: 0 6px 14px rgba(0, 0, 0, 0.15);
	}
	.flow-action-yes {
		width: 3.35rem;
		height: 3.35rem;
		border: 3px solid color-mix(in srgb, var(--yes) 25%, transparent);
		color: var(--yes);
		box-shadow: 0 10px 24px rgba(79, 211, 161, 0.15);
	}

	/* Desktop only keyboard hints */
	.flow-kbd {
		display: none;
		align-items: center;
		gap: 8px;
		font-size: var(--t-10);
		font-weight: 700;
		letter-spacing: 0.14em;
		color: var(--text-muted);
		text-transform: uppercase;
		margin-top: 0.25rem;
	}
	.flow-kbd kbd {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.25rem;
		height: 1.25rem;
		padding: 0 4px;
		border: 1.5px solid var(--border-strong);
		border-radius: 6px;
		background: var(--bg-surface);
		color: var(--text-base);
		font-family: inherit;
		font-size: var(--t-11);
		line-height: 1;
	}

	@media (hover: hover) and (pointer: fine) {
		.flow-kbd {
			display: flex;
		}
	}
</style>
