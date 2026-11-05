<script lang="ts">
	import PrincipalText from '#lib/components/ui/PrincipalText.svelte';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { displayMarkets } from '#lib/stores/market-translations.store.ts';
	import type { Transaction, TransactionType } from '#lib/types/wallet.ts';
	import { formatNanosecondsToDate, formatToken } from '#lib/utils/format.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		transactions: Transaction[];
	}

	const { transactions }: Props = $props();

	/**
	 * Direction of the row from the user's perspective. `out` debits, `in`
	 * credits, `neutral` is informational (orders/approvals) and stays
	 * uncoloured so it doesn't visually compete with realized moves.
	 */
	const directionFor = (type: TransactionType): 'in' | 'out' | 'neutral' => {
		switch (type) {
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
			case 'Approve':
			case 'OrderPlaced':
			case 'OrderCancelled':
			default:
				return 'neutral';
		}
	};

	// Title in the reader's language (see `displayMarkets`); `undefined` when the
	// market list hasn't caught up, so the row falls back to the prediction id.
	const marketTitle = (marketId: string): string | undefined =>
		$displayMarkets.get(marketId)?.title;
</script>

<div class="border-border bg-foreground/3 overflow-x-auto rounded-2xl border">
	{#if transactions.length === 0}
		<div class="text-muted-foreground py-12 text-center text-sm">
			{t({ locale: $localeStore, key: 'wallet.history.empty' })}
		</div>
	{:else}
		<table class="w-full text-left text-sm">
			<thead>
				<tr
					class="border-border text-muted-foreground bg-foreground/5 border-b text-[10px] tracking-widest uppercase"
				>
					<th class="px-4 py-3 font-bold">
						{t({ locale: $localeStore, key: 'wallet.history.col.date' })}
					</th>
					<th class="px-4 py-3 font-bold">
						{t({ locale: $localeStore, key: 'wallet.history.col.type' })}
					</th>
					<th class="px-4 py-3 font-bold">
						{t({ locale: $localeStore, key: 'wallet.history.col.token' })}
					</th>
					<th class="px-4 py-3 font-bold">
						{t({ locale: $localeStore, key: 'wallet.history.col.amount' })}
					</th>
					<th class="px-4 py-3 font-bold">
						{t({ locale: $localeStore, key: 'wallet.history.col.details' })}
					</th>
				</tr>
			</thead>
			<tbody class="divide-border/50 divide-y">
				{#each transactions as { id, timestamp, type, token, amount, marketId, counterparty, source } (`${id}-${token.symbol}`)}
					{@const direction = directionFor(type)}

					<tr class="hover:bg-foreground/5 transition-colors">
						<td class="text-muted-foreground px-4 py-3">
							{formatNanosecondsToDate({ nanoseconds: timestamp })}
						</td>
						<td
							class="px-4 py-3 font-bold"
							class:text-destructive={direction === 'out'}
							class:text-muted-foreground={direction === 'neutral'}
							class:text-yes={direction === 'in'}
						>
							<span class="inline-flex items-center gap-2">
								{type}
								{#if source === 'clearing'}
									<span
										class="border-border bg-foreground/5 text-muted-foreground rounded-md border px-1.5 py-0.5 text-[9px] font-black tracking-widest uppercase"
									>
										{t({ locale: $localeStore, key: 'wallet.history.source.clearing' })}
									</span>
								{/if}
							</span>
						</td>
						<td class="text-foreground px-4 py-3 uppercase">{token.symbol}</td>
						<td class="text-foreground num px-4 py-3 font-bold">
							{formatToken({ value: amount, unitName: token.decimals })}
						</td>
						<td class="text-muted-foreground px-4 py-3">
							{#if marketId}
								<a
									class="text-foreground hover:text-primary truncate underline-offset-2 hover:underline"
									href="{AppPath.Markets}/{marketId}"
								>
									{marketTitle(marketId) ??
										`${t({ locale: $localeStore, key: 'wallet.history.market_prediction_id' })} ${marketId}`}
								</a>
							{:else if counterparty}
								{t({ locale: $localeStore, key: 'wallet.history.to_from' })}
								<PrincipalText principal={counterparty} />
							{:else}
								-
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>
