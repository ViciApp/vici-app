<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { onMount } from 'svelte';
	import AdminSubPageHeader from '$lib/components/admin/AdminSubPageHeader.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import InfiniteScroll from '$lib/components/ui/InfiniteScroll.svelte';
	import Tabs from '$lib/components/ui/Tabs.svelte';
	import WalletHistory from '$lib/components/wallet/WalletHistory.svelte';
	import WalletReceive from '$lib/components/wallet/WalletReceive.svelte';
	import WalletSend from '$lib/components/wallet/WalletSend.svelte';
	import { VXP_TOKEN } from '$lib/constants/tokens/tokens.ic.constants';
	import { walletUiTokens } from '$lib/derived/tokens.derived';
	import { safeGetIdentityOnce } from '$lib/services/identity.services';
	import { sendIc } from '$lib/services/send.services';
	import {
		getTransactionsPage,
		type WalletTransactionsCursors,
		type WalletTransactionsDone
	} from '$lib/services/wallet.service';
	import { localeStore } from '$lib/stores/locale.store';
	import { notificationsStore } from '$lib/stores/notification.store';
	import type { Token } from '$lib/types/token';
	import type { Transaction } from '$lib/types/wallet';
	import { emit } from '$lib/utils/events.utils';
	import { t } from '$lib/utils/i18n.utils';
	import { parseToken } from '$lib/utils/parse.utils';

	/**
	 * Admin-only VXP treasury console: the send / receive / history
	 * surfaces over the VXP ledger, reachable from the admin hub.
	 *
	 * History pages the VXP index canister only — the ICP / ckUSDC legs
	 * start as `done` so `getTransactionsPage` never queries them.
	 */

	const vxpOnlyDone = (): WalletTransactionsDone => ({ icp: true, ckUsdc: true, vxp: false });

	let transactions = $state<Transaction[]>([]);
	let batchSize = $state<bigint>(20n);
	const batchSizeOptions: bigint[] = [10n, 20n, 50n];
	let loadingHistory = $state(false);
	let hasMoreHistory = $state(true);

	let cursors = $state<WalletTransactionsCursors>({});
	let done = $state<WalletTransactionsDone>(vxpOnlyDone());

	let activeTab = $state('send');

	const tabs = $derived([
		{ value: 'history', label: t({ locale: $localeStore, key: 'wallet.tab.history' }) },
		{ value: 'send', label: t({ locale: $localeStore, key: 'wallet.tab.send' }) },
		{ value: 'receive', label: t({ locale: $localeStore, key: 'wallet.tab.receive' }) }
	]);

	const sortNewestFirst = (arr: Transaction[]) =>
		arr.sort((a, b) => (a.timestamp === b.timestamp ? 0 : a.timestamp > b.timestamp ? -1 : 1));

	const resetHistory = () => {
		transactions = [];
		cursors = {};
		done = vxpOnlyDone();
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

	onMount(() => {
		void reloadHistory();
	});

	let recipient = $state('');
	let amount = $state('');
	let selectedToken = $state<Token | undefined>();
	let sending = $state(false);

	// Send defaults to the VXP ledger; the clearing-driven wallet token
	// list still backs the selector, the constant only covers a cold load.
	const vxpUiToken = $derived(
		$walletUiTokens.find((token) => token.symbol === VXP_TOKEN.symbol) ?? VXP_TOKEN
	);
	const selectedTokenForSend = $derived(selectedToken ?? vxpUiToken);

	const handleSend = async () => {
		if (sending) {
			return;
		}

		if (isNullish(recipient) || isNullish(amount) || isNullish(selectedTokenForSend)) {
			return;
		}

		sending = true;

		try {
			const identity = await safeGetIdentityOnce();

			await sendIc({
				identity,
				to: recipient,
				amount: parseToken({
					value: `${amount}`,
					unitName: selectedTokenForSend.decimals
				}),
				ledgerCanisterId: selectedTokenForSend.ledgerCanisterId
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
				message: (e as Error).message,
				type: 'error'
			});
		} finally {
			sending = false;
		}
	};
</script>

<div class="space-y-12 px-4 py-6 sm:py-8 lg:py-10">
	<AdminSubPageHeader
		description={t({ locale: $localeStore, key: 'admin.hub.vxp.description' })}
		title={t({ locale: $localeStore, key: 'admin.hub.vxp.title' })}
	/>

	<Card class="bg-card/85 overflow-hidden" padding="none">
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
						tokens={$walletUiTokens}
					/>
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

					<WalletHistory {transactions} />

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
