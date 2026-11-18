<script lang="ts">
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import { ZERO } from '#lib/constants/app.constants.ts';
	import { settleMarket } from '#lib/services/resolution.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { notificationsStore } from '#lib/stores/notification.store.ts';
	import type { Market } from '#lib/types/market.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		market: Market;
		onSettled: () => void;
	}

	const { market, onSettled }: Props = $props();

	let settlementPrice = $state<'' | '1.0' | '0.0'>('');
	let selectedOutcomeId = $state('');
	let resolutionText = $state('');
	let officialSource = $state('');
	let loading = $state(false);
	let error = $state('');
	let showConfirm = $state(false);

	const isExpired = $derived(market.expiryDate < BigInt(Date.now()));
	const isUrgent = $derived(isExpired && market.status !== 'Resolved');
	const isCategorical = $derived(market.payoffType === 'Categorical');

	const hasOutcome = $derived(isCategorical ? selectedOutcomeId !== '' : settlementPrice !== '');
	const hasText = $derived(resolutionText.trim().length > 0);
	const hasSource = $derived(officialSource.trim().length > 0);
	const canResolve = $derived(hasOutcome && hasText && hasSource);

	const summaryOutcome = $derived.by(() => {
		if (isCategorical) {
			return market.outcomes?.find((o) => o.id === selectedOutcomeId)?.title ?? '';
		}

		if (settlementPrice === '1.0') {
			return t({ locale: $localeStore, key: 'market.resolution.settle_yes' });
		}

		if (settlementPrice === '0.0') {
			return t({ locale: $localeStore, key: 'market.resolution.settle_no' });
		}

		return '';
	});

	const openConfirm = () => {
		if (!canResolve) {
			return;
		}

		error = '';
		showConfirm = true;
	};

	const handleSettle = async () => {
		loading = true;
		error = '';

		try {
			if (isCategorical) {
				await settleMarket({ seriesId: market.id, outcomeId: selectedOutcomeId });
			} else {
				// Settlement price is a bigint already scaled to PRICE_DECIMALS.
				// Binary clearing treats any `price > 0` as YES, so 100n / 0n
				// is the canonical encoding here.
				const price = settlementPrice === '1.0' ? 100n : ZERO;
				await settleMarket({ seriesId: market.id, settlementPrice: price });
			}

			showConfirm = false;
			onSettled();
			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'wallet.send.success_title' }),
				message: t({
					locale: $localeStore,
					key: 'market.resolution.notify.success_with_source',
					params: {
						outcome: summaryOutcome,
						source: officialSource.trim()
					}
				}),
				type: 'success'
			});
		} catch (e: unknown) {
			error =
				(e as Error).message ?? t({ locale: $localeStore, key: 'market.resolution.error.failed' });
		} finally {
			loading = false;
		}
	};
</script>

<Card padding="lg" variant={isUrgent ? 'default' : 'outline'}>
	<div class="space-y-6">
		{#if isUrgent}
			<div class="flex items-center gap-2">
				<Badge variant="danger"
					>{t({ locale: $localeStore, key: 'market.resolution.urgent_badge' })}</Badge
				>
			</div>
		{/if}

		<div>
			<h3 class="text-foreground text-lg font-black uppercase">
				{t({ locale: $localeStore, key: 'market.resolution.title' })}
			</h3>
			<p class="text-muted-foreground mt-2 text-xs">
				{isCategorical
					? t({ locale: $localeStore, key: 'market.resolution.categorical_sub' })
					: t({ locale: $localeStore, key: 'market.resolution.binary_sub' })}
			</p>
		</div>

		<div class="space-y-4">
			{#if isCategorical}
				<div class="grid grid-cols-1 gap-2">
					{#each market.outcomes ?? [] as outcome (outcome.id)}
						<button
							class="flex w-full items-center justify-between rounded-xl border-2 px-4 py-3 transition-all {selectedOutcomeId ===
							outcome.id
								? 'border-primary bg-primary/10 text-primary'
								: 'border-border bg-card text-foreground hover:border-foreground/10'}"
							onclick={() => (selectedOutcomeId = outcome.id)}
							type="button"
						>
							<span class="font-bold">{outcome.title}</span>
							{#if selectedOutcomeId === outcome.id}
								<div class="bg-primary h-2 w-2 rounded-full"></div>
							{/if}
						</button>
					{/each}
				</div>
			{:else}
				<div class="flex gap-2">
					<Button
						class="flex-1"
						onclick={() => (settlementPrice = '1.0')}
						size="sm"
						variant={settlementPrice === '1.0' ? 'primary' : 'outline'}
					>
						{t({ locale: $localeStore, key: 'market.resolution.settle_yes' })}
					</Button>
					<Button
						class="flex-1"
						onclick={() => (settlementPrice = '0.0')}
						size="sm"
						variant={settlementPrice === '0.0' ? 'primary' : 'outline'}
					>
						{t({ locale: $localeStore, key: 'market.resolution.settle_no' })}
					</Button>
				</div>
			{/if}

			<div class="space-y-2">
				<label class="text-muted-foreground eyebrow-xs" for="resolution-text">
					{t({ locale: $localeStore, key: 'market.resolution.resolution_text' })}
				</label>
				<textarea
					id="resolution-text"
					class="focus:ring-primary bg-foreground/5 text-foreground ring-border min-h-24 w-full rounded-2xl border-none px-4 py-3 text-sm ring-1 ring-inset focus:ring-2"
					placeholder={t({
						locale: $localeStore,
						key: 'market.resolution.placeholder.text'
					})}
					bind:value={resolutionText}></textarea>
			</div>

			<div class="space-y-2">
				<label class="text-muted-foreground eyebrow-xs" for="resolution-source">
					{t({ locale: $localeStore, key: 'market.resolution.source' })}
				</label>
				<input
					id="resolution-source"
					class="focus:ring-primary bg-foreground/5 text-foreground ring-border w-full rounded-2xl border-none px-4 py-3 text-sm ring-1 ring-inset focus:ring-2"
					placeholder={t({
						locale: $localeStore,
						key: 'market.resolution.placeholder.source'
					})}
					type="text"
					bind:value={officialSource}
				/>
			</div>

			{#if error}
				<div class="text-destructive text-xs font-medium">
					{error}
				</div>
			{/if}

			<Button
				onclick={openConfirm}
				size="lg"
				status={loading ? 'pending' : canResolve ? 'enabled' : 'disabled'}
				variant={isUrgent ? 'danger' : 'primary'}
			>
				{t({ locale: $localeStore, key: 'market.resolution.resolve_settle' })}
			</Button>
		</div>
	</div>
</Card>

<Dialog
	title={t({ locale: $localeStore, key: 'market.resolution.confirm.title' })}
	bind:show={showConfirm}
>
	<div class="space-y-4">
		<div class="space-y-1">
			<p class="text-muted-foreground eyebrow-xs">
				{t({ locale: $localeStore, key: 'market.resolution.confirm.summary_outcome' })}
			</p>
			<p class="text-foreground text-base font-bold">{summaryOutcome}</p>
		</div>

		<div class="space-y-1">
			<p class="text-muted-foreground eyebrow-xs">
				{t({ locale: $localeStore, key: 'market.resolution.resolution_text' })}
			</p>
			<p class="text-foreground text-sm whitespace-pre-wrap">{resolutionText.trim()}</p>
		</div>

		<div class="space-y-1">
			<p class="text-muted-foreground eyebrow-xs">
				{t({ locale: $localeStore, key: 'market.resolution.source' })}
			</p>
			<p class="text-foreground text-sm break-words">{officialSource.trim()}</p>
		</div>

		<p class="text-muted-foreground text-xs">
			{t({ locale: $localeStore, key: 'admin.resolution.confirm.warning' })}
		</p>

		{#if error}
			<div class="text-destructive text-xs font-medium">
				{error}
			</div>
		{/if}

		<div class="flex gap-2 pt-2">
			<Button
				class="flex-1"
				onclick={() => (showConfirm = false)}
				size="md"
				status={loading ? 'disabled' : 'enabled'}
				variant="outline"
			>
				{t({ locale: $localeStore, key: 'market.resolution.confirm.cancel' })}
			</Button>
			<Button
				class="flex-1"
				onclick={handleSettle}
				size="md"
				status={loading ? 'pending' : 'enabled'}
				variant={isUrgent ? 'danger' : 'primary'}
			>
				{t({ locale: $localeStore, key: 'market.resolution.confirm.cta' })}
			</Button>
		</div>
	</div>
</Dialog>
