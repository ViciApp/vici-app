<script lang="ts">
	import AdminResolutionHistory from '#lib/components/admin/AdminResolutionHistory.svelte';
	import AdminResolutionList from '#lib/components/admin/AdminResolutionList.svelte';
	import AdminSubPageHeader from '#lib/components/admin/AdminSubPageHeader.svelte';
	import { markets, marketsNotInitialized } from '#lib/derived/markets.derived.ts';
	import { resolveMarket } from '#lib/services/authn.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { notificationsStore } from '#lib/stores/notification.store.ts';
	import type { MarketId, Outcome } from '#lib/types/market.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	const unresolvedMarkets = $derived($markets.filter((m) => m.status !== 'Resolved'));
	const resolvedMarkets = $derived($markets.filter((m) => m.status === 'Resolved'));

	const handleResolve = async ({ marketId, outcome }: { marketId: MarketId; outcome: Outcome }) => {
		try {
			await resolveMarket({ marketId, outcome });
			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'admin.markets.resolved.title' }),
				message: t({
					locale: $localeStore,
					key: 'admin.markets.resolved.message',
					params: { marketId, outcome }
				}),
				type: 'success'
			});
		} catch (e: unknown) {
			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'admin.markets.resolution_failed' }),
				message: (e as Error).message,
				type: 'error'
			});
		}
	};
</script>

<div class="space-y-12 px-4 py-6 sm:py-8 lg:py-10">
	<AdminSubPageHeader
		description={t({ locale: $localeStore, key: 'admin.hub.resolutions.description' })}
		title={t({ locale: $localeStore, key: 'admin.hub.resolutions.title' })}
	/>

	<div class="space-y-8">
		<AdminResolutionList
			loading={$marketsNotInitialized}
			markets={unresolvedMarkets}
			onResolve={handleResolve}
		/>

		<AdminResolutionHistory markets={resolvedMarkets} />
	</div>
</div>
