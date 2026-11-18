<script lang="ts">
	import { X } from '@lucide/svelte/icons';
	import { tradeErrorMessage } from '#lib/canisters/clearing.errors.ts';
	import SignInActions from '#lib/components/authn/SignInActions.svelte';
	import BottomSheet from '#lib/components/ui/BottomSheet.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { VXP_CALL_SIZE_LADDER } from '#lib/constants/vxp-economy.constants.ts';
	import { playgroundVxpUnitMode } from '#lib/derived/playground.derived.ts';
	import { userSignedIn } from '#lib/derived/user.derived.ts';
	import { vxpSpendable } from '#lib/derived/vxp-holdings.derived.ts';
	import { getBalances } from '#lib/services/wallet.services.ts';
	import { collateralsStore } from '#lib/stores/collaterals.store.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { notificationsStore } from '#lib/stores/notification.store.ts';
	import type { CallSide, Market } from '#lib/types/market.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';
	import { resolveOutcomeExecutionPrice } from '#lib/utils/market.utils.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { formatAvailableMarginForUi } from '#lib/utils/playground-display.utils.ts';
	import { executeOutcomeTrade } from '#lib/utils/trade.utils.ts';
	import { browser } from '$app/env';

	/**
	 * Prediction-confirmation surface for a binary market. A user has
	 * already chosen a side (YES / NO) on the market detail CTA; this
	 * panel commits a single market-order call at the current price.
	 *
	 * Chrome (scrim, grip, safe-area inset, Escape, focus trap, viewport
	 * pinning, pill-nav hide) comes from the shared {@link BottomSheet}
	 * primitive in its `desktopCentered` variant: a bottom-docked sheet on
	 * phone widths and a centred modal on wider viewports; one set of
	 * content, switched purely in CSS so there is no forked markup.
	 *
	 * Sizing is a slider that steps through the fixed call-size ladder
	 * (`VXP_CALL_SIZE_LADDER`) rather than a free continuous range, because
	 * `executeOutcomeTrade` rejects any premium that isn't a ladder rung
	 * on ViciXp markets, so every selectable value must be a valid rung.
	 * No limit-order / target-price path lives here; the only submission
	 * is a market order; the clearing layer still picks `MARKET` vs
	 * `LIMIT` execution from live depth under the hood.
	 */
	interface Props {
		market: Market;
		selectedOutcome: CallSide;
		onClose: () => void;
		onPredictionPlaced: () => void;
		/**
		 * Translated market title for the active locale; defaults to the
		 * on-chain original so callers without a translation render unchanged.
		 */
		displayTitle?: string;
	}

	const { market, selectedOutcome, onClose, onPredictionPlaced, displayTitle }: Props = $props();

	const questionTitle = $derived(displayTitle ?? market.title);

	const tr = ({ key, params }: { key: MessageKey; params?: Record<string, string | number> }) =>
		t({ locale: $localeStore, key, params });

	// Call-size slider: an index-based control over the fixed call-size
	// ladder, so every stop is a valid rung the backend will accept (a
	// free continuous range would let the user pick amounts ViciXp markets
	// reject). Defaults to the smallest rung; `size` is the selected rung
	// amount, derived from the slider index.
	let sizeIndex = $state(0);
	const size = $derived(VXP_CALL_SIZE_LADDER[sizeIndex]);

	let loading = $state(false);
	let error = $state('');

	const sideLabel = $derived(
		selectedOutcome === 'YES' ? tr({ key: 'outcome.yes' }) : tr({ key: 'outcome.no' })
	);

	// Execution price of the chosen side, shared with `executeOutcomeTrade` so
	// the previewed "+X VXP" matches the order placed.
	const sideExecutionPrice = $derived(
		resolveOutcomeExecutionPrice({ market, action: selectedOutcome })
	);

	const payout = $derived.by(() => {
		if (!Number.isFinite(sideExecutionPrice) || sideExecutionPrice <= 0) {
			return size;
		}

		return Math.round(size / sideExecutionPrice);
	});

	// Available collateral for this market's balance domain; the shared
	// "spendable margin" derivation, so the figure matches the wallet, the
	// Dashboard, and every other prediction surface.
	const availableMargin = $derived($vxpSpendable);

	const balanceLabel = $derived(
		formatAvailableMarginForUi({ value: availableMargin, playground: $playgroundVxpUnitMode })
	);

	const fetchBalance = async () => {
		if (!$userSignedIn) {
			return;
		}

		try {
			const { collateral, accountState } = await getBalances(market.balanceDomain);

			collateralsStore.update((state) => ({
				balances: collateral,
				accountState,
				assetsConfig: state?.assetsConfig ?? {}
			}));
		} catch (err: unknown) {
			console.error('Failed to fetch balance', err);
		}
	};

	const handleLockIn = async () => {
		if (loading) {
			return;
		}

		loading = true;
		error = '';

		try {
			await executeOutcomeTrade({
				market,
				action: selectedOutcome,
				amount: String(size),
				orderType: 'MARKET'
			});

			notificationsStore.add({
				title: tr({ key: 'prediction.notification.title' }),
				message: tr({ key: 'prediction.notification.message', params: { side: sideLabel } }),
				type: 'success'
			});

			void fetchBalance();
			onPredictionPlaced();
		} catch (err: unknown) {
			error = tr(tradeErrorMessage(err));
		} finally {
			loading = false;
		}
	};

	$effect(() => {
		if (!browser) {
			return;
		}

		if ($userSignedIn) {
			void fetchBalance();
		}
	});
</script>

<BottomSheet desktopCentered isOpen={true} labelledBy="confirm-title" {onClose}>
	<div class="confirm-head">
		<h3 id="confirm-title" class="confirm-title">
			{tr({ key: 'prediction.back_side', params: { side: sideLabel } })}
		</h3>
		<button
			class="confirm-close"
			aria-label={tr({ key: 'a11y.close' })}
			onclick={onClose}
			type="button"
		>
			<X aria-hidden="true" size={16} strokeWidth={1.8} />
		</button>
	</div>

	<p class="confirm-question">{questionTitle}</p>

	{#if $userSignedIn}
		<div class="confirm-card">
			<div class="confirm-card-head">
				<span class="confirm-eyebrow">{tr({ key: 'prediction.how_much' })}</span>
				<span class="confirm-balance num">
					{tr({ key: 'prediction.balance', params: { amount: balanceLabel } })}
				</span>
			</div>

			<div class="confirm-amount">
				<span class="confirm-amount-value num">{size}</span>
				<span class="confirm-eyebrow">{market.token.symbol}</span>
			</div>

			<input
				class="confirm-range"
				aria-label={tr({ key: 'prediction.how_much' })}
				max={VXP_CALL_SIZE_LADDER.length - 1}
				min={0}
				step={1}
				type="range"
				bind:value={sizeIndex}
			/>

			<div class="confirm-payout">
				<span class="confirm-payout-label">{tr({ key: 'prediction.if_right' })}</span>
				<span class="confirm-payout-value num">
					{tr({
						key: 'prediction.payout',
						params: { amount: payout, symbol: market.token.symbol }
					})}
				</span>
			</div>
		</div>

		{#if error}
			<div class="confirm-error">{error}</div>
		{/if}

		<Button
			class="confirm-submit"
			onclick={handleLockIn}
			size="lg"
			status={loading ? 'pending' : 'enabled'}
		>
			{#snippet busyLabel()}
				{tr({ key: 'prediction.confirming' })}
			{/snippet}
			{tr({ key: 'prediction.lock_in', params: { side: sideLabel } })}
		</Button>
	{:else}
		<div class="confirm-signin">
			<p class="confirm-signin-copy">{tr({ key: 'prediction.sign_in' })}</p>
			<SignInActions />
			<a class="confirm-deposit" href={resolveAppPath(AppPath.Wallet)}>
				{tr({ key: 'prediction.deposit_wallet' })}
			</a>
		</div>
	{/if}
</BottomSheet>

<style lang="postcss">
	.confirm-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	.confirm-title {
		margin: 0;
		font-size: var(--t-20);
		font-weight: 700;
		letter-spacing: var(--tracking-snug);
		color: var(--text-base);
	}

	.confirm-close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.375rem 0.5rem;
		border: none;
		border-radius: var(--r-8);
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition: color var(--d-hover) var(--ease-vici);
	}

	.confirm-close:hover {
		color: var(--text-base);
	}

	.confirm-question {
		margin: 0 0 1rem;
		font-size: var(--t-14);
		color: var(--text-muted);
	}

	.confirm-card {
		padding: 1rem;
		border: 1px solid var(--border-base);
		border-radius: 12px;
		background: var(--bg-surface);
	}

	.confirm-card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.confirm-eyebrow {
		font-family: var(--font-mono);
		font-size: var(--t-10);
		font-weight: 600;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.confirm-balance {
		font-family: var(--font-mono);
		font-size: var(--t-10);
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.confirm-amount {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	.confirm-amount-value {
		font-family: var(--font-mono);
		font-size: 2.25rem;
		font-weight: 600;
		letter-spacing: -0.02em;
		color: var(--text-base);
	}

	.confirm-range {
		width: 100%;
		margin-top: 0.75rem;
		accent-color: var(--accent);
		cursor: pointer;
	}

	.confirm-payout {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 0.625rem;
		font-size: var(--t-13);
	}

	.confirm-payout-label {
		color: var(--text-muted);
	}

	.confirm-payout-value {
		font-family: var(--font-mono);
		font-weight: 600;
		color: var(--accent);
	}

	.confirm-error {
		margin-top: 0.75rem;
		padding: 0.75rem;
		border: 1px solid color-mix(in srgb, var(--no) 22%, transparent);
		border-radius: var(--r-8);
		background: color-mix(in srgb, var(--no) 8%, transparent);
		font-size: var(--t-12);
		font-weight: 500;
		color: var(--no);
	}

	:global(.confirm-submit) {
		width: 100%;
		margin-top: 0.875rem;
	}

	.confirm-signin {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		padding: 1.5rem;
		border-radius: 12px;
		background: color-mix(in srgb, var(--color-primary) 10%, transparent);
		text-align: center;
	}

	.confirm-signin-copy {
		margin: 0;
		font-size: var(--t-14);
		font-weight: 500;
		color: var(--color-primary);
	}

	.confirm-deposit {
		font-size: var(--t-12);
		font-weight: 700;
		color: var(--color-primary);
		text-decoration: underline;
	}

	.confirm-deposit:hover {
		text-decoration: none;
	}
</style>
