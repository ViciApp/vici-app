<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { History } from '@lucide/svelte/icons';
	import { onMount, type Snippet } from 'svelte';
	import ScreenHeader from '#lib/components/layout/ScreenHeader.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import InfiniteScroll from '#lib/components/ui/InfiniteScroll.svelte';
	import Tabs from '#lib/components/ui/Tabs.svelte';
	import VxpRecoveryBeat from '#lib/components/wallet/VxpRecoveryBeat.svelte';
	import WalletHistory from '#lib/components/wallet/WalletHistory.svelte';
	import WalletReceive from '#lib/components/wallet/WalletReceive.svelte';
	import WalletSend from '#lib/components/wallet/WalletSend.svelte';
	import { USD_DECIMALS, ZERO } from '#lib/constants/app.constants.ts';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { VXP_TOKEN } from '#lib/constants/tokens/tokens.ic.constants.ts';
	import {
		CALIBRATION_DEPLOY_FLOOR_BASE_UNITS,
		CALIBRATION_RECOVERY_FLOOR_BASE_UNITS,
		VXP_CALIBRATION_REWARD_BASE_UNITS
	} from '#lib/constants/vxp-economy.constants.ts';
	import { markets } from '#lib/derived/markets.derived.ts';
	import { positions } from '#lib/derived/positions.derived.ts';
	import { walletUiTokens } from '#lib/derived/tokens.derived.ts';
	import { vxpBacked, vxpFree } from '#lib/derived/vxp-holdings.derived.ts';
	import { clearingTransactions } from '#lib/derived/wallet-feed.derived.ts';
	import {
		loadSendableWalletAssets,
		sendToken,
		SendTokenError
	} from '#lib/services/send.services.ts';
	import {
		getTransactionsPage,
		type WalletTransactionsCursors,
		type WalletTransactionsDone
	} from '#lib/services/wallet.service.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { displayMarkets } from '#lib/stores/market-translations.store.ts';
	import { notificationsStore } from '#lib/stores/notification.store.ts';
	import type { Token } from '#lib/types/token.ts';
	import type { Transaction } from '#lib/types/wallet.ts';
	import { emit } from '#lib/utils/events.utils.ts';
	import {
		decimalFixedValueToNumber,
		formatRelativeAgoFromNs,
		formatToken
	} from '#lib/utils/format.utils.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';
	import { goBack, resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { parseToken } from '#lib/utils/parse.utils.ts';
	import { formatVxpBalance } from '#lib/utils/playground-display.utils.ts';
	import { filterSendableTokens } from '#lib/utils/send.utils.ts';
	import { mergeWalletFeed, weeklyVxpDeltaBaseUnits } from '#lib/utils/transactions.utils.ts';
	import type { Web2WalletAsset } from '#lib/web2/client.ts';
	import { goto } from '$app/navigation';

	/**
	 * Wallet: centered VXP balance hero + recent activity over the
	 * real crypto send / receive / history surfaces.
	 *
	 * Layout
	 * - `ScreenHeader` with back → /profile, title "Wallet", and a
	 *   History icon on the right that focuses the activity list.
	 * - Hero card (centered): VXP eyebrow → 48px VXP balance → weekly
	 *   delta line in laurel / no-red → Open Flow + Back-a-call pill
	 *   row. Balance is read from `balancesStore` for the VXP ledger;
	 *   weekly delta sums signed deltas from clearing settlements in
	 *   the last 7 days.
	 * - Recent activity (6 rows): derived from the same merged
	 *   `filteredTransactions` source as the History tab, surfacing
	 *   real history.
	 * - Send / Receive / History tabs remain below for actual wallet
	 *   operations. Visually toned-down to read as a secondary
	 *   surface.
	 *
	 * The `CollateralStats` secondary card + its modal are intentionally
	 * gone; collateral lives inside the History "Clearing" tagged rows
	 * and the dedicated portfolio surface; it doesn't belong on the
	 * Wallet hero.
	 */

	let transactions = $state<Transaction[]>([]);
	let batchSize = $state<bigint>(20n);
	const batchSizeOptions: bigint[] = [10n, 20n, 50n];
	let loadingHistory = $state(false);
	let hasMoreHistory = $state(true);

	let cursors = $state<WalletTransactionsCursors>({});
	let done = $state<WalletTransactionsDone>({ icp: false, ckUsdc: false, vxp: false });

	let activeTab = $state('send');

	let activityListEl: HTMLElement | undefined = $state();

	const tabs = $derived([
		{ value: 'history', label: t({ locale: $localeStore, key: 'wallet.tab.history' }) },
		{ value: 'send', label: t({ locale: $localeStore, key: 'wallet.tab.send' }) },
		{ value: 'receive', label: t({ locale: $localeStore, key: 'wallet.tab.receive' }) }
	]);

	// Unified Wallet activity feed: the paged ICRC ledger rows held locally
	// merged with the clearing rows from `clearingTransactions` (derived),
	// filtered to the wallet's surfaced tokens and sorted newest-first.
	const filteredTransactions = $derived(
		mergeWalletFeed({
			ledgerTransactions: transactions,
			clearingTransactions: $clearingTransactions,
			allowedLedgerCanisterIds: $walletUiTokens.map((token) => token.ledgerCanisterId)
		})
	);

	// First 6 rows powering the "Recent activity" block.
	const recentActivity = $derived(filteredTransactions.slice(0, 6));

	const sortNewestFirst = (arr: Transaction[]) =>
		arr.sort((a, b) => (a.timestamp === b.timestamp ? 0 : a.timestamp > b.timestamp ? -1 : 1));

	// Live free VXP balance (`$vxpFree`) from the wallet store. Same source
	// `WalletStats` and `WalletDropdown` read: keyed by `TokenId`.
	const vxpBalanceDisplay = $derived(
		formatVxpBalance({ value: $vxpFree, decimals: VXP_TOKEN.decimals })
	);

	// ── Deployed-vs-depleted recovery split ───────────────────────────
	// When the free VXP balance falls to the recovery floor, the hero swaps
	// its dual-CTA row for a recovery beat. The branch reads net worth still
	// locked in open VXP calls: at/above the deploy floor the stack is "in
	// play, nothing lost" (deployed); below it the stack has eroded through
	// realised losses (genuine depletion). All gate comparisons run in VXP
	// *base units* (the same scale as the wallet balance and
	// `lockedCollateral`); the displayed numbers go through
	// `decimalFixedValueToNumber`, which yields a possibly-fractional VXP
	// value (the decimal scale applied, not an integer).
	const marketById = $derived(new Map($markets.map((m) => [m.id, m] as const)));

	// Open VXP positions: `lockedCollateral` is clearing-USD micro-units
	// (USD_DECIMALS = 4), the same scale as VXP base units, so the locked
	// total is compared against the deploy floor without any conversion.
	const openVxpPositions = $derived(
		$positions.filter((p) => marketById.get(p.marketId)?.token.symbol === VXP_TOKEN.symbol)
	);

	// Total VXP riding on open VXP-market positions, in base units: the
	// deploy-floor gate. `$vxpBacked` is the shared sum of `lockedCollateral`
	// across the user's VXP-market positions (see `vxp-holdings.derived`).

	// Whole-VXP rendering of the locked total, for the recovery beat display.
	const lockedInOpenVxp = $derived(
		Math.round(decimalFixedValueToNumber({ value: $vxpBacked, decimals: USD_DECIMALS }))
	);

	const recovering = $derived($vxpFree < CALIBRATION_RECOVERY_FLOOR_BASE_UNITS);
	const fullyDeployed = $derived($vxpBacked >= CALIBRATION_DEPLOY_FLOOR_BASE_UNITS);

	// Whole-VXP reward shown on the recovery beat, derived from the base-unit
	// constant so the display tracks the authoritative award amount.
	const calibrationRewardVxp = $derived(
		decimalFixedValueToNumber({
			value: VXP_CALIBRATION_REWARD_BASE_UNITS,
			decimals: VXP_TOKEN.decimals
		})
	);

	// Weekly VXP delta over the unified feed: signed settlement / trade flows
	// on VXP-denominated rows from the last 7 days (in base units).
	const weeklyVxpDelta = $derived(weeklyVxpDeltaBaseUnits(filteredTransactions));

	const weeklyDeltaDirection = $derived.by((): 'positive' | 'negative' | 'flat' => {
		if (weeklyVxpDelta > ZERO) {
			return 'positive';
		}

		if (weeklyVxpDelta < ZERO) {
			return 'negative';
		}

		return 'flat';
	});

	const weeklyDeltaDisplay = $derived.by((): string => {
		if (weeklyDeltaDirection === 'flat') {
			return '';
		}

		const positive = weeklyDeltaDirection === 'positive';
		const abs = positive ? weeklyVxpDelta : -weeklyVxpDelta;
		const sign = positive ? '+' : '−';

		return `${sign}${formatVxpBalance({ value: abs, decimals: VXP_TOKEN.decimals })}`;
	});

	const resetHistory = () => {
		transactions = [];
		cursors = {};
		done = { icp: false, ckUsdc: false, vxp: false };
		hasMoreHistory = true;
		loadingHistory = false;
	};

	const loadNextBatch = async () => {
		if (loadingHistory || !hasMoreHistory) {
			return;
		}

		loadingHistory = true;

		try {
			const result = await getTransactionsPage({ batchSize, cursors, done });

			const txKey = (tx: Transaction) => `${tx.id}-${tx.token.ledgerCanisterId}`;
			const merged: Record<string, Transaction> = {};

			for (const t of transactions) {
				merged[txKey(t)] = t;
			}

			for (const tx of result.transactions) {
				merged[txKey(tx)] = tx;
			}

			transactions = sortNewestFirst(Object.values(merged));

			const { cursors: nextCursors, done: nextDone, hasMore: nextHasMore } = result;
			cursors = nextCursors;
			done = nextDone;
			hasMoreHistory = nextHasMore;
		} finally {
			loadingHistory = false;
		}
	};

	const reloadHistory = async () => {
		resetHistory();
		await loadNextBatch();
	};

	// The loader answers `undefined` on the default backend (no custody gate),
	// so "still loading" needs its own flag.
	let sendAssets = $state<Web2WalletAsset[] | undefined>();
	let sendAssetsLoaded = $state(false);

	const loadSendAssets = async () => {
		try {
			sendAssets = await loadSendableWalletAssets();
		} catch (err: unknown) {
			// Without the catalog every web2 send is refused, so offer none.
			console.error('Failed to load the send asset catalog:', err);
			sendAssets = [];
		} finally {
			sendAssetsLoaded = true;
		}
	};

	onMount(() => {
		void reloadHistory();
		void loadSendAssets();
	});

	let recipient = $state('');
	let amount = $state('');
	let selectedToken = $state<Token | undefined>();
	let sending = $state(false);

	// Empty until the catalog resolves, so a token the API refuses to send is
	// never offered, not even while loading.
	const sendableTokens = $derived(
		sendAssetsLoaded ? filterSendableTokens({ tokens: $walletUiTokens, assets: sendAssets }) : []
	);

	const selectedTokenForSend = $derived(selectedToken ?? sendableTokens[0]);

	const handleSend = async () => {
		if (sending) {
			return;
		}

		if (isNullish(recipient) || isNullish(amount) || isNullish(selectedTokenForSend)) {
			return;
		}

		sending = true;

		try {
			// The service resolves the transport (user-signed ICRC transfer, or a
			// custodial withdrawal in web2 mode) and the auth that goes with it.
			await sendToken({
				token: selectedTokenForSend,
				to: recipient,
				amount: parseToken({
					value: `${amount}`,
					unitName: selectedTokenForSend.decimals
				})
			});

			emit({ message: 'viciRefreshBalances' });

			await reloadHistory();

			amount = '';

			recipient = '';

			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'wallet.send.success_title' }),
				message: t({ locale: $localeStore, key: 'wallet.send.success_message' }),
				type: 'success'
			});
		} catch (e: unknown) {
			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'wallet.send.error_title' }),
				message:
					e instanceof SendTokenError
						? `${t({ locale: $localeStore, key: e.messageKey, params: e.params })}${nonNullish(e.detail) ? ` (${e.detail})` : ''}`
						: (e as Error).message,
				type: 'error'
			});
		} finally {
			sending = false;
		}
	};

	const handleHistoryShortcut = () => {
		activeTab = 'history';
		// Defer to next tick so the History panel is mounted before scrolling.
		queueMicrotask(() => {
			activityListEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		});
	};

	// Row helpers: title / direction / amount label for the recent
	// activity list. Mirrors `WalletHistory`'s `directionFor` but renders
	// a single inline string (e.g. "Won · {market}", "Stake · {market}",
	// "Receive", "Send") so the row reads at a glance.
	const marketTitle = (marketId: string | undefined): string | undefined =>
		nonNullish(marketId) ? $displayMarkets.get(marketId)?.title : undefined;

	const recentRowTitleKey = (tx: Transaction): MessageKey => {
		switch (tx.type) {
			case 'Settlement':
				return 'wallet.row.settlement';
			case 'Trade':
				return 'wallet.row.trade';
			case 'CollateralDeposit':
				return 'wallet.row.collateral_deposit';
			case 'CollateralWithdraw':
				return 'wallet.row.collateral_withdraw';
			case 'OrderPlaced':
				return 'wallet.row.order_placed';
			case 'OrderCancelled':
				return 'wallet.row.order_cancelled';
			case 'Liquidation':
				return 'wallet.row.liquidation';
			case 'Reward':
				return 'wallet.row.reward';
			case 'Send':
				return 'wallet.row.send';
			case 'Receive':
				return 'wallet.row.receive';
			case 'Mint':
				return 'wallet.row.mint';
			case 'Burn':
				return 'wallet.row.burn';
			case 'Approve':
				return 'wallet.row.approve';
			default:
				return 'wallet.row.activity';
		}
	};

	const recentRowDirection = (tx: Transaction): 'in' | 'out' | 'neutral' => {
		switch (tx.type) {
			case 'Receive':
			case 'Mint':
			case 'CollateralWithdraw':
			case 'Settlement':
			case 'Reward':
				return 'in';
			case 'Send':
			case 'Burn':
			case 'CollateralDeposit':
			case 'Trade':
			case 'Liquidation':
				return 'out';
			default:
				return 'neutral';
		}
	};

	const recentRowAmount = (tx: Transaction): string => {
		const direction = recentRowDirection(tx);
		const formatted =
			tx.token.symbol === VXP_TOKEN.symbol
				? formatVxpBalance({ value: tx.amount, decimals: tx.token.decimals })
				: formatToken({ value: tx.amount, unitName: tx.token.decimals });

		if (direction === 'in') {
			return `+${formatted}`;
		}

		if (direction === 'out') {
			return `−${formatted}`;
		}

		return formatted;
	};
</script>

{#snippet appbarRight()}
	<button
		class="appbar-icon-btn"
		aria-label={t({ locale: $localeStore, key: 'wallet.history.icon_label' })}
		onclick={handleHistoryShortcut}
		type="button"
	>
		<History aria-hidden="true" size={18} strokeWidth={1.8} />
	</button>
{/snippet}

<div class="wallet-page">
	<ScreenHeader
		back={{
			label: t({ locale: $localeStore, key: 'wallet.back.label' }),
			onBack: () => goBack(resolveAppPath(AppPath.Profile))
		}}
		right={appbarRight as Snippet}
		title={t({ locale: $localeStore, key: 'wallet.title' })}
	/>

	<!-- Centered hero: VXP eyebrow + 48px num + weekly delta + dual CTA. -->
	<section class="wallet-hero">
		<p class="eyebrow wallet-hero-eyebrow">
			{t({ locale: $localeStore, key: 'wallet.hero.eyebrow' })}
		</p>
		<p class="num wallet-hero-num">{vxpBalanceDisplay}</p>

		{#if weeklyDeltaDirection === 'flat'}
			<p class="num wallet-hero-delta is-flat">
				{t({ locale: $localeStore, key: 'wallet.hero.no_activity_week' })}
			</p>
		{:else}
			<p
				class="num wallet-hero-delta"
				class:is-negative={weeklyDeltaDirection === 'negative'}
				class:is-positive={weeklyDeltaDirection === 'positive'}
			>
				{t({
					locale: $localeStore,
					key: 'wallet.hero.delta_this_week',
					params: { amount: weeklyDeltaDisplay }
				})}
			</p>
		{/if}

		{#if recovering}
			<!-- Recovering: the hero swaps its dual-CTA row for the recovery
			     beat (the beat itself distinguishes deployed vs depleted). -->
			<VxpRecoveryBeat
				deployed={fullyDeployed}
				{lockedInOpenVxp}
				onCalibrate={() => void goto(resolveAppPath(AppPath.Calibration))}
				onReviewOpenCalls={() => void goto(resolveAppPath(AppPath.Portfolio))}
				openCallCount={openVxpPositions.length}
				rewardVxp={calibrationRewardVxp}
			/>
		{:else}
			<div class="wallet-hero-cta-row">
				<button
					class="wallet-hero-cta is-primary"
					onclick={() => void goto(resolveAppPath(AppPath.Flow))}
					type="button"
				>
					{t({ locale: $localeStore, key: 'wallet.cta.open_flow' })}
				</button>
				<button
					class="wallet-hero-cta is-ghost"
					onclick={() => void goto(resolveAppPath(AppPath.Home))}
					type="button"
				>
					{t({ locale: $localeStore, key: 'wallet.cta.back_a_call' })}
				</button>
			</div>
		{/if}
	</section>

	<!-- Recent activity: top 6 from the unified transactions feed. -->
	<section bind:this={activityListEl} class="wallet-activity">
		<h2 class="wallet-activity-title">
			{t({ locale: $localeStore, key: 'wallet.recent_activity' })}
		</h2>

		{#if recentActivity.length === 0}
			<p class="wallet-activity-empty serif-italic">
				{t({ locale: $localeStore, key: 'wallet.recent_activity.empty' })}
			</p>
		{:else}
			<ul class="wallet-activity-list">
				{#each recentActivity as tx (`${tx.id}-${tx.token.ledgerCanisterId}`)}
					{@const direction = recentRowDirection(tx)}
					{@const subtitle = marketTitle(tx.marketId)}

					<li class="wallet-activity-row">
						<div class="wallet-activity-row-body">
							<span class="wallet-activity-row-title">
								{t({ locale: $localeStore, key: recentRowTitleKey(tx) })}
								{#if subtitle}
									<span class="wallet-activity-row-sep">·</span>
									<span class="wallet-activity-row-sub">{subtitle}</span>
								{/if}
							</span>
							<span class="num wallet-activity-row-when">
								{formatRelativeAgoFromNs({ timestampNs: tx.timestamp, locale: $localeStore })}
							</span>
						</div>
						<span
							class="num wallet-activity-row-amount"
							class:is-negative={direction === 'out'}
							class:is-positive={direction === 'in'}
						>
							{recentRowAmount(tx)}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!--
		Send / Receive / History tabs. Visually toned-down: no big
		"TREASURY" eyebrow and no `CollateralStats` secondary card.
	-->
	<Card class="wallet-tabs-card bg-card/85 overflow-hidden" padding="none">
		<div class="border-border border-b p-2">
			<Tabs {tabs} bind:activeTab />
		</div>

		<div class="w-full p-4 sm:p-6">
			{#if activeTab === 'send'}
				{#if nonNullish(selectedTokenForSend)}
					<WalletSend
						{amount}
						onAmountChange={(v) => (amount = v)}
						onRecipientChange={(v) => (recipient = v)}
						onSend={handleSend}
						onTokenChange={(v) => (selectedToken = v)}
						{recipient}
						selectedToken={selectedTokenForSend}
						sendStatus={sending ? 'pending' : 'enabled'}
						tokens={sendableTokens}
					/>
				{:else if sendAssetsLoaded && $walletUiTokens.length > 0}
					<p class="text-muted-foreground text-sm">
						{t({ locale: $localeStore, key: 'wallet.send.not_available' })}
					</p>
				{:else}
					<p class="text-muted-foreground text-sm">
						{t({ locale: $localeStore, key: 'wallet.send.empty' })}
					</p>
				{/if}
			{:else if activeTab === 'receive'}
				<WalletReceive />
			{:else if activeTab === 'history'}
				<div class="space-y-4">
					<div class="flex items-center justify-between gap-4">
						<div class="eyebrow">
							{t({ locale: $localeStore, key: 'wallet.history.batch_size' })}
						</div>
						<div class="flex items-center gap-2">
							<select
								class="border-border bg-foreground/5 text-foreground focus:border-primary rounded-full border px-3 py-1.5 text-sm"
								aria-label={t({ locale: $localeStore, key: 'wallet.history.batch_size_label' })}
								disabled={loadingHistory}
								onchange={(e) => {
									batchSize = BigInt((e.target as HTMLSelectElement).value);
									void reloadHistory();
								}}
							>
								{#each batchSizeOptions as option (option.toString())}
									<option selected={option === batchSize} value={option.toString()}>
										{option.toString()}
									</option>
								{/each}
							</select>
						</div>
					</div>

					<WalletHistory transactions={filteredTransactions} />

					<div class="flex flex-col items-center gap-3 pt-6 pb-2">
						{#if !loadingHistory && !hasMoreHistory && transactions.length > 0}
							<div class="text-muted-foreground text-xs">
								{t({ locale: $localeStore, key: 'wallet.history.all_caught_up' })}
							</div>
						{/if}

						<InfiniteScroll
							hasMore={hasMoreHistory}
							loading={loadingHistory}
							onLoadMore={() => {
								void loadNextBatch();
							}}
						/>
					</div>
				</div>
			{/if}
		</div>
	</Card>
</div>

<style lang="postcss">
	.wallet-page {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		padding: 0 1.25rem 6rem;
	}

	/* ── Hero card ───────────────────────────────────────────── */
	.wallet-hero {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 24px;
		text-align: center;
		background: var(--bg-popover);
		border: 1px solid var(--border-base);
		border-radius: 16px;
		box-shadow:
			inset 0 1px 0 rgba(242, 236, 220, 0.06),
			0 8px 24px -10px rgba(0, 0, 0, 0.5);
	}

	.wallet-hero-eyebrow {
		margin: 0;
		color: var(--text-muted);
	}

	.wallet-hero-num {
		margin: 8px 0 0;
		font-size: 48px;
		font-weight: 600;
		letter-spacing: -0.04em;
		color: var(--text-base);
		line-height: 1;
	}

	.wallet-hero-delta {
		margin: 0.25rem 0 0;
		font-size: var(--t-13);
		font-weight: 600;
		color: var(--text-muted);
	}

	.wallet-hero-delta.is-positive {
		color: var(--yes);
	}

	.wallet-hero-delta.is-negative {
		color: var(--no);
	}

	.wallet-hero-delta.is-flat {
		color: var(--text-muted);
	}

	.wallet-hero-cta-row {
		display: flex;
		gap: 8px;
		width: 100%;
		margin-top: 18px;
	}

	.wallet-hero-cta {
		flex: 1;
		appearance: none;
		padding: 0.75rem 1rem;
		font: inherit;
		font-size: var(--t-13);
		font-weight: 600;
		border-radius: var(--r-12);
		cursor: pointer;
		transition:
			background-color var(--d-hover) var(--ease-vici),
			border-color var(--d-hover) var(--ease-vici),
			opacity var(--d-hover) var(--ease-vici);
	}

	.wallet-hero-cta.is-primary {
		color: var(--bg-base);
		background: var(--text-base);
		border: 1px solid var(--text-base);
	}

	.wallet-hero-cta.is-primary:hover {
		opacity: 0.9;
	}

	.wallet-hero-cta.is-ghost {
		color: var(--text-base);
		background: var(--bg-popover);
		border: 1px solid var(--border-base);
	}

	.wallet-hero-cta.is-ghost:hover {
		border-color: var(--border-strong);
	}

	/* ── Recent activity ─────────────────────────────────────── */
	.wallet-activity {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.wallet-activity-title {
		margin: 0 0 0.25rem;
		font-size: 15px;
		font-weight: 600;
		color: var(--text-base);
		letter-spacing: -0.01em;
	}

	.wallet-activity-empty {
		margin: 0;
		padding: 1.25rem 0.5rem;
		font-size: var(--t-14);
		color: var(--text-muted);
	}

	.wallet-activity-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.wallet-activity-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 12px 14px;
		background: var(--bg-surface);
		border: 1px solid var(--border-base);
		border-radius: 12px;
	}

	.wallet-activity-row-body {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}

	.wallet-activity-row-title {
		font-size: var(--t-13);
		font-weight: 500;
		color: var(--text-base);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.wallet-activity-row-sep {
		margin: 0 0.25rem;
		color: var(--text-muted);
	}

	.wallet-activity-row-sub {
		color: var(--text-muted);
	}

	.wallet-activity-row-when {
		font-size: var(--text-eyebrow, 11px);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.wallet-activity-row-amount {
		flex: 0 0 auto;
		font-size: var(--t-14);
		font-weight: 600;
		color: var(--text-muted);
	}

	.wallet-activity-row-amount.is-positive {
		color: var(--yes);
	}

	.wallet-activity-row-amount.is-negative {
		color: var(--no);
	}

	/* ── Tabs card ──────────────────────────────────────────── */
	:global(.wallet-tabs-card) {
		margin-top: 0.25rem;
	}
</style>
