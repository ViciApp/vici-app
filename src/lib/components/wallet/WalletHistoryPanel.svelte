<script lang="ts">
	import InfiniteScroll from '#lib/components/ui/InfiniteScroll.svelte';
	import WalletHistory from '#lib/components/wallet/WalletHistory.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import {
		WALLET_HISTORY_BATCH_SIZES,
		type WalletHistoryPager
	} from '#lib/stores/wallet-history-pager.svelte.ts';
	import type { Transaction } from '#lib/types/wallet.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		pager: WalletHistoryPager;
		/** Rows to render: the pager's own, or a feed built on top of them. */
		transactions: Transaction[];
	}

	const { pager, transactions }: Props = $props();
</script>

<div class="space-y-4">
	<div class="flex items-center justify-between gap-4">
		<div class="eyebrow">
			{t({ locale: $localeStore, key: 'wallet.history.batch_size' })}
		</div>
		<div class="flex items-center gap-2">
			<select
				class="border-border bg-foreground/5 text-foreground focus:border-primary rounded-full border px-3 py-1.5 text-sm"
				aria-label={t({ locale: $localeStore, key: 'wallet.history.batch_size_label' })}
				disabled={pager.loading}
				onchange={(e) => {
					void pager.setBatchSize(BigInt((e.target as HTMLSelectElement).value));
				}}
			>
				{#each WALLET_HISTORY_BATCH_SIZES as option (option.toString())}
					<option selected={option === pager.batchSize} value={option.toString()}>
						{option.toString()}
					</option>
				{/each}
			</select>
		</div>
	</div>

	<WalletHistory {transactions} />

	<div class="flex flex-col items-center gap-3 pt-6 pb-2">
		{#if !pager.loading && !pager.hasMore && pager.transactions.length > 0}
			<div class="text-muted-foreground text-xs">
				{t({ locale: $localeStore, key: 'wallet.history.all_caught_up' })}
			</div>
		{/if}

		<InfiniteScroll
			hasMore={pager.hasMore}
			loading={pager.loading}
			onLoadMore={() => {
				void pager.loadNext();
			}}
		/>
	</div>
</div>
