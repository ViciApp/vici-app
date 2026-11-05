<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { onMount } from 'svelte';
	import MetadataEventsTab from '#lib/components/market/metadata/MetadataEventsTab.svelte';
	import MetadataShowcaseTab from '#lib/components/market/metadata/MetadataShowcaseTab.svelte';
	import MetadataTranslationsTab from '#lib/components/market/metadata/MetadataTranslationsTab.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import Tabs from '#lib/components/ui/Tabs.svelte';
	import { normalizeStoredTags } from '#lib/constants/market-taxonomy.constants.ts';
	import { userIsAdmin } from '#lib/derived/user.derived.ts';
	import { MarketEventDirection, MarketWhyNowKind } from '#lib/enums/market-metadata.ts';
	import {
		getMarketMetadata,
		upsertMarketMetadata
	} from '#lib/services/market-metadata.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { ButtonStatus } from '#lib/types/components.ts';
	import type { MarketEvent, MarketMetadataInput } from '#lib/types/market-metadata.ts';
	import type { Market } from '#lib/types/market.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { refreshMarketMetadata, refreshMarketTags } from '#lib/utils/refresh.utils.ts';

	interface Props {
		market: Market;
		canEdit: boolean;
	}

	const { market, canEdit }: Props = $props();

	type TabId = 'showcase' | 'events' | 'translations';

	let activeTab = $state<TabId>('showcase');

	interface EventRow {
		day: string;
		dir: MarketEventDirection;
		label: string;
	}

	let whyKind = $state<MarketWhyNowKind>(MarketWhyNowKind.CLOSING);
	let whyText = $state('');
	let tags = $state<string[]>([]);
	let suggested = $state(false);
	let subtitle = $state('');
	let eventOne = $state<EventRow>({ day: '', dir: MarketEventDirection.UP, label: '' });
	let eventTwo = $state<EventRow>({ day: '', dir: MarketEventDirection.UP, label: '' });
	let status = $state<ButtonStatus>('enabled');
	let loaded = $state(false);
	let savedAt = $state<number | undefined>(undefined);
	let error = $state<string | undefined>(undefined);

	const tabs = $derived([
		{
			value: 'showcase' as const,
			label: t({ locale: $localeStore, key: 'market.metadata.tab.showcase' })
		},
		{
			value: 'events' as const,
			label: t({ locale: $localeStore, key: 'market.metadata.tab.events' })
		},
		...($userIsAdmin
			? [
					{
						value: 'translations' as const,
						label: t({ locale: $localeStore, key: 'market.metadata.tab.translations' })
					}
				]
			: [])
	]);

	const parseDay = (value: string): number | undefined => {
		const trimmed = value.trim();

		if (trimmed.length === 0) {
			return;
		}

		const parsed = Number(trimmed);

		return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
	};

	const eventFromFields = (row: EventRow): MarketEvent | undefined => {
		const trimmed = row.label.trim();
		const parsedDay = parseDay(row.day);

		if (trimmed.length === 0 || isNullish(parsedDay)) {
			return;
		}

		return {
			label: trimmed,
			day: parsedDay,
			dir: row.dir
		};
	};

	const buildInput = (): MarketMetadataInput => {
		const why = whyText.trim();
		const trimmedSubtitle = subtitle.trim();
		const events = [eventFromFields(eventOne), eventFromFields(eventTwo)].filter(
			(event): event is MarketEvent => nonNullish(event)
		);

		return {
			...(why.length > 0 && { whyNow: { kind: whyKind, text: why } }),
			...(trimmedSubtitle.length > 0 && { subtitle: trimmedSubtitle }),
			events,
			tags,
			suggested
		};
	};

	const save = async () => {
		status = 'pending';
		error = undefined;

		try {
			const metadata = await upsertMarketMetadata({
				seriesId: market.id,
				data: buildInput()
			});
			({ updatedAt: savedAt, suggested } = metadata);
			tags = normalizeStoredTags(metadata.tags ?? []);
			refreshMarketTags();
			refreshMarketMetadata();
		} catch (err: unknown) {
			console.warn('Market metadata save failed:', err);
			error = t({ locale: $localeStore, key: 'market.metadata.error.save' });
		} finally {
			status = 'enabled';
		}
	};

	onMount(async () => {
		try {
			const metadata = await getMarketMetadata(market.id);

			if (metadata?.whyNow) {
				whyKind = metadata.whyNow.kind;
				whyText = metadata.whyNow.text;
			}

			suggested = metadata?.suggested ?? false;
			subtitle = metadata?.subtitle ?? '';
			tags = normalizeStoredTags(metadata?.tags ?? []);

			const [first, second] = metadata?.events ?? [];

			if (first) {
				eventOne = { day: String(first.day), dir: first.dir, label: first.label };
			}

			if (second) {
				eventTwo = { day: String(second.day), dir: second.dir, label: second.label };
			}
		} catch (err: unknown) {
			console.warn('Market metadata load failed:', err);
			error = t({ locale: $localeStore, key: 'market.metadata.error.load' });
		} finally {
			loaded = true;
		}
	});
</script>

{#if canEdit}
	<Card class="market-metadata-card" padding="lg">
		<div class="market-metadata-head">
			<div>
				<p class="eyebrow">{t({ locale: $localeStore, key: 'market.metadata.eyebrow' })}</p>
				<h3>{t({ locale: $localeStore, key: 'market.metadata.title' })}</h3>
			</div>
			{#if savedAt}
				<span class="num market-metadata-saved"
					>{t({ locale: $localeStore, key: 'market.metadata.saved' })}</span
				>
			{/if}
		</div>

		{#if !loaded}
			<p class="market-metadata-muted">
				{t({ locale: $localeStore, key: 'market.metadata.loading' })}
			</p>
		{:else}
			<div class="market-metadata-tabs">
				<Tabs
					activeTab={activeTab as string}
					onTabChange={(value) => (activeTab = value as TabId)}
					{tabs}
				/>
			</div>

			{#if error}
				<p class="market-metadata-error">{error}</p>
			{/if}

			{#if activeTab === 'showcase'}
				<MetadataShowcaseTab
					isAdmin={$userIsAdmin}
					onSubtitleChange={(value) => (subtitle = value)}
					onSuggestedChange={(value) => (suggested = value)}
					onTagsChange={(value) => (tags = value)}
					onWhyKindChange={(value) => (whyKind = value)}
					onWhyTextChange={(value) => (whyText = value)}
					{subtitle}
					{suggested}
					{tags}
					{whyKind}
					{whyText}
				/>

				<Button onclick={save} {status}>
					{t({ locale: $localeStore, key: 'market.metadata.save' })}
				</Button>
			{:else if activeTab === 'events'}
				<MetadataEventsTab
					{eventOne}
					{eventTwo}
					onEventOneChange={(next) => (eventOne = next)}
					onEventTwoChange={(next) => (eventTwo = next)}
				/>

				<Button onclick={save} {status}>
					{t({ locale: $localeStore, key: 'market.metadata.save' })}
				</Button>
			{:else if activeTab === 'translations' && $userIsAdmin}
				<MetadataTranslationsTab {market} />
			{/if}
		{/if}
	</Card>
{/if}

<style lang="postcss">
	.market-metadata-head {
		display: flex;
		align-items: start;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.market-metadata-head h3 {
		margin: 0.25rem 0 0;
		font-size: var(--t-20);
		font-weight: 600;
	}

	.market-metadata-saved,
	.market-metadata-muted {
		color: var(--text-muted);
		font-size: var(--t-12);
	}

	.market-metadata-error {
		margin: 0 0 1rem;
		color: var(--no);
		font-size: var(--t-13);
	}

	.market-metadata-tabs {
		margin-bottom: 1rem;
	}
</style>
