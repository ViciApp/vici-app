<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import type { ClearingDid } from '$declarations';
	import { orderRejectionMessage } from '$lib/canisters/clearing.errors';
	import MarketTitleSkeleton from '$lib/components/market/MarketTitleSkeleton.svelte';
	import BaseButton from '$lib/components/ui/BaseButton.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Pagination from '$lib/components/ui/Pagination.svelte';
	import { primaryMicro } from '$lib/constants/market-taxonomy.constants';
	import {
		PORTFOLIO_DEFAULT_DECIMALS,
		PORTFOLIO_PAGE_SIZE
	} from '$lib/constants/portfolio.constants';
	import { AppPath } from '$lib/constants/routes.constants';
	import { marketTags } from '$lib/derived/market-tags.derived';
	import { marketsNotInitialized } from '$lib/derived/markets.derived';
	import { cancelLimitOrder } from '$lib/services/order.services';
	import { localeStore } from '$lib/stores/locale.store';
	import { notificationsStore } from '$lib/stores/notification.store';
	import type { Market, MarketId } from '$lib/types/market';
	import { formatPrice, formatQuantity } from '$lib/utils/format.utils';
	import { t } from '$lib/utils/i18n.utils';
	import { tagColor } from '$lib/utils/tag-color.utils';

	interface Props {
		orders: ClearingDid.LimitOrder[];
		markets: Market[];
		onRefresh: () => void;
	}

	const { orders, markets, onRefresh }: Props = $props();

	const getMarketById = (id: string) => markets.find((m) => m.id === id);

	const isBuyOrder = (order: ClearingDid.LimitOrder) => 'Buy' in order.side;

	let cancellingId = $state<string | null>(null);

	let page = $state(1);

	$effect(() => {
		const totalPages = Math.max(1, Math.ceil(orders.length / PORTFOLIO_PAGE_SIZE));

		if (page > totalPages) {
			page = totalPages;
		}
	});

	const pagedOrders = $derived(
		orders.slice((page - 1) * PORTFOLIO_PAGE_SIZE, page * PORTFOLIO_PAGE_SIZE)
	);

	/** Category accent color for the row tag chip; mirrors PortfolioPage. */
	const categoryAccent = (marketId: MarketId): string => {
		const micro = primaryMicro($marketTags[marketId] ?? []);

		return tagColor(micro ?? '');
	};

	const categoryLabel = (marketId: MarketId): string | null => {
		const micro = primaryMicro($marketTags[marketId] ?? []);

		return nonNullish(micro) ? micro.toUpperCase() : null;
	};

	const handleCancel = async ({
		event,
		orderId
	}: {
		event: MouseEvent;
		orderId: string;
	}): Promise<void> => {
		// Cancel button lives inside the card-link, so block the click
		// from bubbling up to the market-detail navigation.
		event.preventDefault();
		event.stopPropagation();

		cancellingId = orderId;

		try {
			await cancelLimitOrder(orderId);
			onRefresh();
		} catch (err: unknown) {
			const rejection = orderRejectionMessage(err);

			if (isNullish(rejection)) {
				throw err;
			}

			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'portfolio.orders.cancel_failed' }),
				message: t({ locale: $localeStore, ...rejection }),
				type: 'error'
			});

			// The usual refusal is an order that already left the book, so the row is stale.
			onRefresh();
		} finally {
			cancellingId = null;
		}
	};
</script>

{#if orders.length === 0}
	<EmptyState message={t({ locale: $localeStore, key: 'portfolio.orders.empty' })} />
{:else}
	<ul class="portfolio-list">
		{#each pagedOrders as order (order.order_id)}
			{@const market = getMarketById(order.series_id)}
			{@const marketId = order.series_id as MarketId}
			{@const isBuy = isBuyOrder(order)}
			{@const sideKey = isBuy ? 'yes' : 'no'}
			{@const catLabel = categoryLabel(marketId)}
			{@const catAccent = categoryAccent(marketId)}

			<li>
				<a
					class="portfolio-row portfolio-row-card"
					aria-label={$marketsNotInitialized && isNullish(market)
						? t({ locale: $localeStore, key: 'ui.loading' })
						: (market?.title ?? t({ locale: $localeStore, key: 'portfolio.unknown_market' }))}
					href="{AppPath.Markets}/{marketId}"
				>
					<div class="portfolio-row-tags">
						{#if catLabel}
							<span style:color={catAccent} class="portfolio-row-cat">{catLabel}</span>
						{:else}
							<span class="portfolio-row-cat is-dim">—</span>
						{/if}
						<span class="portfolio-row-side portfolio-row-side-{sideKey}">
							{isBuy
								? t({ locale: $localeStore, key: 'portfolio.orders.side.buy' })
								: t({ locale: $localeStore, key: 'portfolio.orders.side.sell' })}
						</span>
					</div>
					<div class="portfolio-row-title">
						{#if $marketsNotInitialized && isNullish(market)}
							<MarketTitleSkeleton />
						{:else}
							{market?.title ?? t({ locale: $localeStore, key: 'portfolio.unknown_market' })}
						{/if}
					</div>
					<div class="portfolio-row-meta">
						<span class="num portfolio-row-prob">
							{t({
								locale: $localeStore,
								key: 'portfolio.orders.row.price_qty',
								params: {
									price: formatPrice(order.price),
									qty: formatQuantity({
										value: order.qty,
										decimals: market?.token.decimals ?? PORTFOLIO_DEFAULT_DECIMALS
									})
								}
							})}
						</span>
						<BaseButton
							class="portfolio-row-cancel"
							onclick={(event) => handleCancel({ event, orderId: order.order_id })}
							status={cancellingId === order.order_id ? 'pending' : 'enabled'}
						>
							{t({ locale: $localeStore, key: 'profile.dashboard.cancel' })}
						</BaseButton>
					</div>
				</a>
			</li>
		{/each}
	</ul>

	{#if orders.length > PORTFOLIO_PAGE_SIZE}
		<Pagination
			onPageChange={(p) => (page = p)}
			{page}
			pageSize={PORTFOLIO_PAGE_SIZE}
			totalItems={orders.length}
		/>
	{/if}
{/if}

<style lang="postcss">
	/* List + row chrome mirrors `.portfolio-list` / `.portfolio-row-card`
	   in `PortfolioPage.svelte` (active calls). Keeping the rules local
	   here too so the component stays usable in isolation; they're
	   intentionally identical to the page-scoped versions. */
	.portfolio-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.portfolio-row {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.875rem;
		text-decoration: none;
		color: inherit;
		background: var(--bg-popover);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		transition: border-color var(--d-hover) var(--ease-vici);
	}

	.portfolio-row:hover {
		border-color: var(--border-strong);
	}

	.portfolio-row-tags {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.portfolio-row-cat {
		display: inline-flex;
		align-items: center;
		padding: 3px 7px;
		font-family: var(--font-mono);
		font-size: 9.5px;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-muted);
		background: color-mix(in srgb, var(--text-base) 6%, transparent);
		border-radius: var(--r-4);
	}

	.portfolio-row-cat.is-dim {
		opacity: 0.5;
	}

	.portfolio-row-title {
		font-size: var(--t-13);
		font-weight: 600;
		line-height: 1.4;
		color: var(--text-base);
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		overflow: hidden;
	}

	.portfolio-row-side {
		display: inline-flex;
		flex: 0 0 auto;
		align-items: center;
		padding: 3px 7px;
		font-family: var(--font-mono);
		font-size: 9.5px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		border-radius: var(--r-4);
		background: color-mix(in srgb, var(--text-base) 6%, transparent);
		color: var(--text-muted);
	}

	.portfolio-row-side-yes {
		color: var(--yes);
		background: var(--yes-wash);
	}

	.portfolio-row-side-no {
		color: var(--no);
		background: var(--no-wash);
	}

	.portfolio-row-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.portfolio-row-prob {
		font-size: var(--text-eyebrow, 11px);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	:global(.portfolio-row-cancel) {
		flex: 0 0 auto;
		padding: 0.25rem 0.625rem;
		font-size: var(--t-10);
		font-weight: 700;
		letter-spacing: var(--tracking-wide);
		text-transform: uppercase;
		color: var(--no);
		background: var(--no-wash);
		border-radius: 0.5rem;
	}

	:global(.portfolio-row-cancel:hover:not(:disabled)) {
		background: color-mix(in srgb, var(--no) 18%, transparent);
	}
</style>
