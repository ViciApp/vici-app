<script lang="ts">
	import AdminBulkMarketForm from '#lib/components/admin/AdminBulkMarketForm.svelte';
	import AdminMarketForm from '#lib/components/admin/AdminMarketForm.svelte';
	import AdminSubPageHeader from '#lib/components/admin/AdminSubPageHeader.svelte';
	import { normalizeStoredTags } from '#lib/constants/market-taxonomy.constants.ts';
	import { upsertMarketMetadata } from '#lib/services/market-metadata.services.ts';
	import { createMarket } from '#lib/services/market.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { notificationsStore } from '#lib/stores/notification.store.ts';
	import { toBalanceDomain } from '#lib/utils/balance-domain.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import type { RegistryDid } from '$declarations';

	let bulkInProgress = $state(false);
	let bulkProgress = $state(0);
	let bulkTotal = $state(0);
	let bulkSuccess = $state(0);
	let bulkFailed = $state(0);

	// Single-market creation success/failure notifications are owned by the form itself; the
	// market list is fed from a global store and refreshes independently, so there's nothing
	// extra to do on success here.
	const handleMarketCreated = (): Promise<void> => Promise.resolve();

	const handleBulkCreate = async (
		bulkMarkets: {
			title: string;
			resolution: string;
			description?: string;
			expiryDate: string;
			balanceDomain?: string;
			outcomes?: string[];
			tags?: string[];
		}[]
	) => {
		bulkInProgress = true;
		bulkProgress = 0;
		bulkTotal = bulkMarkets.length;
		bulkSuccess = 0;
		bulkFailed = 0;

		const defaultDomain: RegistryDid.BalanceDomain = { ViciXp: null };

		await Promise.allSettled(
			bulkMarkets.map(
				async ({ title, description, resolution, expiryDate, outcomes, balanceDomain, tags }) => {
					try {
						const result = await createMarket({
							title,
							description,
							resolution,
							expiryDate: BigInt(new Date(expiryDate).getTime()),
							outcomes,
							balanceDomain: balanceDomain ? toBalanceDomain(balanceDomain) : defaultDomain
						});

						const normalizedTags = normalizeStoredTags(
							(tags ?? []).map((value) => value.toLowerCase())
						);

						if (normalizedTags.length > 0) {
							await upsertMarketMetadata({
								seriesId: result,
								data: { events: [], tags: normalizedTags, suggested: false }
							}).catch((err) => {
								console.error(`Failed to set tags for bulk market: ${title}`, err);
							});
						}

						bulkSuccess++;

						return result;
					} catch (e: unknown) {
						console.error(`Failed to create bulk market: ${title}`, e);

						bulkFailed++;
						throw e;
					} finally {
						bulkProgress++;
					}
				}
			)
		);

		bulkInProgress = false;

		notificationsStore.add({
			title: t({ locale: $localeStore, key: 'admin.markets.bulk.complete_title' }),
			message: t({
				locale: $localeStore,
				key:
					bulkFailed > 0
						? 'admin.markets.bulk.complete_message_with_errors'
						: 'admin.markets.bulk.complete_message',
				params: { success: bulkSuccess, failed: bulkFailed }
			}),
			type: bulkFailed > 0 ? 'warning' : 'success'
		});
	};
</script>

<div class="space-y-12 px-4 py-6 sm:py-8 lg:py-10">
	<AdminSubPageHeader
		description={t({ locale: $localeStore, key: 'admin.hub.markets.description' })}
		title={t({ locale: $localeStore, key: 'admin.hub.markets.title' })}
	/>

	<div class="grid grid-cols-1 gap-12 lg:grid-cols-2">
		<section class="space-y-8">
			<AdminMarketForm onAddMarketSuccess={handleMarketCreated} />
		</section>

		<section class="space-y-8">
			<AdminBulkMarketForm onBulkCreate={handleBulkCreate} />
		</section>
	</div>
</div>

{#if bulkInProgress && bulkTotal > 0}
	<div
		class="bg-background/80 fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
	>
		<div class="scale-up border-border bg-card w-full max-w-md rounded-lg border p-8 shadow-2xl">
			<div class="mb-6 flex items-center justify-between">
				<h3 class="text-foreground text-xl font-bold">
					{t({ locale: $localeStore, key: 'admin.markets.bulk.creating' })}
				</h3>
				<span class="text-muted-foreground font-mono text-sm font-medium tabular-nums">
					{t({
						locale: $localeStore,
						key: 'admin.markets.bulk.progress',
						params: { progress: bulkProgress, total: bulkTotal }
					})}
				</span>
			</div>

			<div class="bg-card mb-4 h-3 w-full overflow-hidden rounded-full">
				<div
					style="width: {(bulkProgress / bulkTotal) * 100}%"
					class="bg-primary h-full transition-all duration-300 ease-out"
				></div>
			</div>

			<div class="mb-6 flex justify-between gap-4">
				<div
					class="bg-yes-wash flex grow flex-col items-center justify-center rounded-lg p-3 text-center"
				>
					<span class="text-yes text-xs font-bold uppercase">
						{t({ locale: $localeStore, key: 'admin.markets.bulk.success_label' })}
					</span>
					<span class="text-foreground font-mono text-xl font-bold">{bulkSuccess}</span>
				</div>
				<div
					class="bg-no-wash flex grow flex-col items-center justify-center rounded-lg p-3 text-center"
				>
					<span class="text-no text-xs font-bold uppercase">
						{t({ locale: $localeStore, key: 'admin.markets.bulk.failed_label' })}
					</span>
					<span class="text-foreground font-mono text-xl font-bold">{bulkFailed}</span>
				</div>
			</div>

			<p class="text-muted-foreground text-center text-sm italic">
				{t({ locale: $localeStore, key: 'admin.markets.bulk.busy' })}
			</p>
		</div>
	</div>
{/if}

<style lang="postcss">
	.scale-up {
		animation: scale-up 0.3s ease-out;
	}

	@keyframes scale-up {
		from {
			opacity: 0;
			transform: scale(0.95);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.scale-up {
			animation: none;
		}
	}
</style>
