<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import LoadingSpinner from '#lib/components/ui/LoadingSpinner.svelte';
	import { ZERO } from '#lib/constants/app.constants.ts';
	import { orders } from '#lib/derived/orders.derived.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { orderBookStore } from '#lib/stores/order-book.store.ts';
	import { selectPrice } from '#lib/stores/trade.store.ts';
	import type { Market, Outcome } from '#lib/types/market.ts';
	import type { OrderBookLevel } from '#lib/types/order.ts';
	import {
		decimalFixedValueToNumber,
		formatProbability,
		formatQuantity
	} from '#lib/utils/format.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		market: Market;
		outcome?: Outcome;
	}

	const { market, outcome = 'YES' }: Props = $props();
	const {
		id: marketId,
		token: { decimals: tokenDecimals }
	} = $derived(market);

	let outcomeChanging = $state(false);

	$effect(() => {
		if (outcome) {
			outcomeChanging = true;
			const timer = setTimeout(() => (outcomeChanging = false), 300);

			return () => clearTimeout(timer);
		}
	});

	const rawOrders = $derived($orderBookStore?.[marketId]);
	const loading = $derived(isNullish(rawOrders) || outcomeChanging);

	const processedBook = $derived(() => {
		if (!rawOrders) {
			return { bids: [], asks: [] };
		}

		const bids: OrderBookLevel[] = [];
		const asks: OrderBookLevel[] = [];

		rawOrders.forEach((o) => {
			const side = 'Buy' in o.side ? 'BUY' : 'SELL';
			const oOutcomeId = o.outcome_id[0] ?? 'YES';

			const isBinarySide = outcome === 'YES' || outcome === 'NO';
			const isOrderBinarySide = oOutcomeId === 'YES' || oOutcomeId === 'NO';

			let displaySide = side;
			let displayPrice = decimalFixedValueToNumber({
				value: o.price.decimal.value,
				decimals: o.price.decimal.decimals
			});

			if (oOutcomeId !== outcome) {
				if (isBinarySide && isOrderBinarySide) {
					displaySide = side === 'BUY' ? 'SELL' : 'BUY';
					displayPrice = 1 - displayPrice;
				} else {
					return;
				}
			}

			const target = displaySide === 'BUY' ? bids : asks;
			const existing = target.find((l) => Math.abs(l.price - displayPrice) < 0.000001);

			if (nonNullish(existing)) {
				existing.totalQty += o.qty;
				existing.orderCount += 1;
			} else {
				target.push({
					price: displayPrice,
					totalQty: o.qty,
					orderCount: 1
				});
			}
		});

		return {
			bids: bids.sort((a, b) => b.price - a.price),
			asks: asks.sort((a, b) => a.price - b.price)
		};
	});

	const displayBids = $derived(processedBook().bids);
	const displayAsks = $derived(processedBook().asks);

	const calculateDepthPercentage = ({ qty, maxQty }: { qty: bigint; maxQty: bigint }) => {
		if (maxQty === ZERO) {
			return 0;
		}

		return (Number(qty) / Number(maxQty)) * 100;
	};

	const maxQty = $derived(() => {
		const allLevels = [...displayBids, ...displayAsks];

		return allLevels.reduce((max, level) => (level.totalQty > max ? level.totalQty : max), ZERO);
	});

	const handlePriceSelect = (price: number) => {
		selectPrice(price);
	};

	const isUserLevel = $derived((price: number) =>
		$orders.some((o) => {
			if (o.series_id !== marketId) {
				return false;
			}

			const oOutcomeId = o.outcome_id[0] ?? 'YES';
			const oPrice = decimalFixedValueToNumber({
				value: o.price.decimal.value,
				decimals: o.price.decimal.decimals
			});

			if (oOutcomeId === outcome) {
				return Math.abs(oPrice - price) < 0.000001;
			}

			if (
				(outcome === 'YES' || outcome === 'NO') &&
				(oOutcomeId === 'YES' || oOutcomeId === 'NO')
			) {
				return Math.abs(1 - oPrice - price) < 0.000001;
			}

			return false;
		})
	);
</script>

<div class="border-border bg-card overflow-hidden rounded-3xl border p-6">
	<div class="mb-6 flex items-center justify-between">
		<h3 class="text-foreground text-lg font-bold">
			{t({
				locale: $localeStore,
				key: 'market.order_book.title',
				params: { outcome }
			})}
		</h3>
		<div class="flex items-center gap-2">
			<span class="bg-yes flex h-2 w-2 animate-pulse rounded-full"></span>
			<span class="text-muted-foreground eyebrow-xs"
				>{t({ locale: $localeStore, key: 'market.order_book.live' })}</span
			>
		</div>
	</div>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-20">
			<LoadingSpinner size="md" />
			<span class="text-primary eyebrow-xs mt-4">
				{t({ locale: $localeStore, key: 'market.order_book.updating' })}
			</span>
		</div>
	{:else}
		<div class="space-y-1">
			<div class="flex flex-col-reverse">
				{#each displayAsks as ask (ask.price)}
					<button
						class="group hover:bg-foreground/5 relative flex items-center justify-between overflow-hidden rounded-lg px-2 py-2 transition-colors {isUserLevel(
							ask.price
						)
							? 'bg-foreground/5 ring-border ring-1 ring-inset'
							: ''}"
						onclick={() => handlePriceSelect(ask.price)}
					>
						<div
							style="width: {calculateDepthPercentage({ qty: ask.totalQty, maxQty: maxQty() })}%"
							class="absolute inset-y-0 right-0 bg-red-500/5 transition-all group-hover:bg-red-500/10"
						></div>

						<span class="text-destructive relative z-10 text-sm font-bold">
							{formatProbability(ask.price)}
							{#if isUserLevel(ask.price)}
								<span class="bg-destructive ml-1 inline-block h-1 w-1 rounded-full align-middle"
								></span>
							{/if}
						</span>
						<span class="text-muted-foreground relative z-10 text-xs font-medium">
							{formatQuantity({ value: ask.totalQty, decimals: tokenDecimals })}
						</span>
					</button>
				{/each}
			</div>

			<div class="border-border flex items-center justify-between border-y px-2 py-4">
				<span class="text-muted-foreground text-[10px] font-black tracking-widest uppercase"
					>{t({ locale: $localeStore, key: 'market.order_book.spread' })}</span
				>
				{#if displayAsks.length > 0 && displayBids.length > 0}
					<span class="text-foreground text-xs font-bold">
						{formatProbability(Math.abs(displayAsks[0].price - displayBids[0].price))}
					</span>
				{/if}
			</div>

			<div class="flex flex-col">
				{#each displayBids as bid (bid.price)}
					<button
						class="group hover:bg-foreground/5 relative flex items-center justify-between overflow-hidden rounded-lg px-2 py-2 transition-colors {isUserLevel(
							bid.price
						)
							? 'bg-foreground/5 ring-border ring-1 ring-inset'
							: ''}"
						onclick={() => handlePriceSelect(bid.price)}
					>
						<div
							style="width: {calculateDepthPercentage({ qty: bid.totalQty, maxQty: maxQty() })}%"
							class="absolute inset-y-0 right-0 bg-green-500/5 transition-all group-hover:bg-green-500/10"
						></div>

						<span class="text-yes relative z-10 text-sm font-bold">
							{formatProbability(bid.price)}
							{#if isUserLevel(bid.price)}
								<span class="bg-yes ml-1 inline-block h-1 w-1 rounded-full align-middle"> </span>
							{/if}
						</span>
						<span class="text-muted-foreground relative z-10 text-xs font-medium">
							{formatQuantity({ value: bid.totalQty, decimals: tokenDecimals })}
						</span>
					</button>
				{/each}
			</div>
		</div>

		<div
			class="border-border text-muted-foreground eyebrow-xs mt-6 grid grid-cols-2 gap-4 border-t pt-4"
		>
			<div>{t({ locale: $localeStore, key: 'market.order_book.price' })}</div>
			<div class="text-right">{t({ locale: $localeStore, key: 'market.order_book.qty' })}</div>
		</div>
	{/if}
</div>
