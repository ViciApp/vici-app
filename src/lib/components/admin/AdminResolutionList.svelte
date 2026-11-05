<script lang="ts">
	import { isNullish, nonNullish, notEmptyString } from '@dfinity/utils';
	import Button from '#lib/components/ui/Button.svelte';
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import LoadingSpinner from '#lib/components/ui/LoadingSpinner.svelte';
	import { TestId } from '#lib/constants/test-ids.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { Market, MarketId, Outcome } from '#lib/types/market.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		markets: Market[];
		loading: boolean;
		onResolve: (params: { marketId: MarketId; outcome: Outcome }) => Promise<void>;
	}

	const { markets, loading, onResolve }: Props = $props();

	let resolvingMarketId = $state<MarketId | null>(null);

	let confirmTarget = $state<{ marketId: MarketId; title: string; outcome: Outcome } | null>(null);
	let showConfirm = $state(false);

	const openConfirm = (params: { marketId: MarketId; title: string; outcome: Outcome }) => {
		if (nonNullish(resolvingMarketId)) {
			return;
		}

		confirmTarget = params;
		showConfirm = true;
	};

	const confirmBusy = $derived(
		nonNullish(confirmTarget) && resolvingMarketId === confirmTarget.marketId
	);

	const handleResolve = async () => {
		if (isNullish(confirmTarget)) {
			return;
		}

		const { marketId, outcome } = confirmTarget;
		resolvingMarketId = marketId;

		try {
			await onResolve({ marketId, outcome });
		} finally {
			resolvingMarketId = null;
			showConfirm = false;
		}
	};

	let searchQuery = $state('');

	const sortedMarkets = $derived([...markets].sort((a, b) => Number(a.expiryDate - b.expiryDate)));

	const filteredMarkets = $derived.by(() => {
		const query = searchQuery.trim().toLowerCase();

		if (query === '') {
			return sortedMarkets;
		}

		return sortedMarkets.filter(({ id, title, resolution }) =>
			[id, title, resolution].some((field) => field.toLowerCase().includes(query))
		);
	});

	const getExpirationStatus = (expiryDate: bigint) => {
		const now = BigInt(Date.now());

		const diff = Number(expiryDate - now);

		if (diff <= 0) {
			return {
				label: t({ locale: $localeStore, key: 'admin.resolution.status.expired' }),
				color: 'red'
			};
		}

		if (diff < 1000 * 60 * 60) {
			return {
				label: t({ locale: $localeStore, key: 'admin.resolution.status.urgent' }),
				color: 'orange'
			};
		}

		if (diff < 1000 * 60 * 60 * 24) {
			return {
				label: t({ locale: $localeStore, key: 'admin.resolution.status.today' }),
				color: 'orange-light'
			};
		}

		if (diff < 1000 * 60 * 60 * 24 * 7) {
			return {
				label: t({ locale: $localeStore, key: 'admin.resolution.status.this_week' }),
				color: 'amber'
			};
		}

		return {
			label: t({ locale: $localeStore, key: 'admin.resolution.status.pending' }),
			color: 'muted'
		};
	};

	const getStatusStyles = (color: string) => {
		switch (color) {
			case 'red':
				return 'bg-destructive/10 border-destructive/20 text-destructive';
			case 'orange':
				return 'bg-primary/10 border-primary/30 text-primary';
			case 'orange-light':
				return 'bg-primary/10 border-primary/25 text-primary';
			case 'amber':
				return 'bg-amber-50 border-amber-100 text-amber-700';
			default:
				return 'bg-foreground/5 border-border text-muted-foreground';
		}
	};

	const getBadgeStyles = (color: string) => {
		switch (color) {
			case 'red':
				return 'bg-destructive/20 text-destructive';
			case 'orange':
				return 'bg-primary/20 text-primary';
			case 'orange-light':
				return 'bg-primary/10 text-primary';
			case 'amber':
				return 'bg-amber-100 text-amber-800';
			default:
				return 'bg-foreground/8 text-foreground';
		}
	};
</script>

<div
	class="border-border bg-card rounded-3xl border p-4 sm:p-8"
	data-tid={TestId.AdminResolutionList}
>
	<h2 class="text-foreground mb-6 text-2xl font-bold">
		{t({ locale: $localeStore, key: 'admin.resolution.title' })}
	</h2>

	{#if loading}
		<div class="flex justify-center py-12">
			<LoadingSpinner size="sm" />
		</div>
	{:else if sortedMarkets.length === 0}
		<p class="text-muted-foreground py-12 text-center text-sm italic">
			{t({ locale: $localeStore, key: 'admin.resolution.empty' })}
		</p>
	{:else}
		<input
			class="bg-foreground/5 text-foreground ring-border focus:ring-primary placeholder:text-muted-foreground mb-6 w-full rounded-2xl border-none px-5 py-3 text-sm ring-1 ring-inset focus:ring-2"
			aria-label={t({ locale: $localeStore, key: 'admin.resolution.search.label' })}
			autocomplete="off"
			data-tid={TestId.AdminResolutionSearch}
			placeholder={t({ locale: $localeStore, key: 'admin.resolution.search.placeholder' })}
			type="search"
			bind:value={searchQuery}
		/>

		{#if filteredMarkets.length === 0}
			<p class="text-muted-foreground py-12 text-center text-sm italic">
				{t({
					locale: $localeStore,
					key: 'admin.resolution.search.no_results',
					params: { query: searchQuery.trim() }
				})}
			</p>
		{:else}
			<div class="space-y-6">
				{#each filteredMarkets as market (market.id)}
					{@const { id: marketId, title, resolution, expiryDate } = market}
					{@const status = getExpirationStatus(expiryDate)}
					{@const clause = resolution.trim()}

					<div
						class="space-y-4 rounded-2xl border p-6 {getStatusStyles(status.color)} transition-all"
						data-market-id={marketId}
						data-tid={TestId.AdminResolutionCard}
					>
						<div class="flex flex-col items-start justify-between gap-2 sm:flex-row">
							<div class="min-w-0 space-y-1">
								<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
									<h3 class="min-w-0 text-lg font-bold break-words">{title}</h3>
									<span
										class="shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-black tracking-wider whitespace-nowrap uppercase {getBadgeStyles(
											status.color
										)}"
									>
										{status.label}
									</span>
								</div>
								<p class="font-mono text-[10px] break-all opacity-60">
									{t({
										locale: $localeStore,
										key: 'admin.resolution.id_label',
										params: { marketId }
									})}
								</p>
							</div>

							<div class="shrink-0 text-[11px] font-semibold opacity-80">
								{t({
									locale: $localeStore,
									key: 'admin.resolution.expires',
									params: { date: new Date(Number(expiryDate)).toLocaleString() }
								})}
							</div>
						</div>

						{#if notEmptyString(clause)}
							<div class="space-y-1">
								<p class="text-[10px] font-black tracking-wider uppercase opacity-60">
									{t({ locale: $localeStore, key: 'admin.resolution.clause_label' })}
								</p>
								<p class="text-sm break-words opacity-80">{clause}</p>
							</div>
						{/if}

						<div class="flex gap-2">
							<Button
								class="border-success/20 bg-success/10 text-success hover:bg-success/15 flex-1 rounded-xl border py-2 text-xs font-bold"
								data-tid={TestId.AdminResolutionResolveYes}
								onclick={() => openConfirm({ marketId, title, outcome: 'YES' })}
								size="sm"
								status={resolvingMarketId === marketId ? 'pending' : 'enabled'}
								variant="ghost"
							>
								{t({ locale: $localeStore, key: 'admin.resolution.action.resolve_yes' })}
							</Button>
							<Button
								class="border-destructive/20 bg-destructive/10 text-destructive hover:bg-destructive/15 flex-1 rounded-xl border py-2 text-xs font-bold"
								data-tid={TestId.AdminResolutionResolveNo}
								onclick={() => openConfirm({ marketId, title, outcome: 'NO' })}
								size="sm"
								status={resolvingMarketId === marketId ? 'pending' : 'enabled'}
								variant="ghost"
							>
								{t({ locale: $localeStore, key: 'admin.resolution.action.resolve_no' })}
							</Button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<Dialog
	title={t({ locale: $localeStore, key: 'market.resolution.confirm.title' })}
	bind:show={showConfirm}
>
	{#if nonNullish(confirmTarget)}
		<div
			class="space-y-4"
			data-market-id={confirmTarget.marketId}
			data-tid={TestId.AdminResolutionConfirmDialog}
		>
			<div class="space-y-1">
				<p class="text-muted-foreground eyebrow-xs">
					{t({ locale: $localeStore, key: 'admin.resolution.confirm.market_label' })}
				</p>
				<p class="text-foreground text-base font-bold break-words">{confirmTarget.title}</p>
			</div>

			<div class="space-y-1">
				<p class="text-muted-foreground eyebrow-xs">
					{t({ locale: $localeStore, key: 'market.resolution.confirm.summary_outcome' })}
				</p>
				<p
					class="text-base font-black {confirmTarget.outcome === 'YES'
						? 'text-success'
						: 'text-destructive'}"
				>
					{t({
						locale: $localeStore,
						key:
							confirmTarget.outcome === 'YES'
								? 'market.resolution.settle_yes'
								: 'market.resolution.settle_no'
					})}
				</p>
			</div>

			<p class="text-muted-foreground text-xs">
				{t({ locale: $localeStore, key: 'admin.resolution.confirm.warning' })}
			</p>

			<div class="flex gap-2 pt-2">
				<Button
					class="flex-1"
					data-tid={TestId.AdminResolutionConfirmCancel}
					onclick={() => (showConfirm = false)}
					size="md"
					status={confirmBusy ? 'disabled' : 'enabled'}
					variant="outline"
				>
					{t({ locale: $localeStore, key: 'market.resolution.confirm.cancel' })}
				</Button>
				<Button
					class="flex-1"
					data-tid={TestId.AdminResolutionConfirmCta}
					onclick={handleResolve}
					size="md"
					status={confirmBusy ? 'pending' : 'enabled'}
					variant={confirmTarget.outcome === 'YES' ? 'primary' : 'danger'}
				>
					{t({ locale: $localeStore, key: 'market.resolution.confirm.cta' })}
				</Button>
			</div>
		</div>
	{/if}
</Dialog>
