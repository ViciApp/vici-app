<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import LandingMarketsDetail from '#lib/components/landing/LandingMarketsDetail.svelte';
	import LandingMarketsLead from '#lib/components/landing/LandingMarketsLead.svelte';
	import LandingMarketsMovers from '#lib/components/landing/LandingMarketsMovers.svelte';
	import LandingMarketsRow from '#lib/components/landing/LandingMarketsRow.svelte';
	import type { LandingMarketsLayout } from '#lib/constants/landing-markets.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { LandingMarketsView } from '#lib/types/landing-markets.ts';
	import type { Market } from '#lib/types/market.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import type { SettleGroup } from '#lib/utils/landing-markets.utils.ts';

	/**
	 * The Markets board under the filters. Front page: the lead, "Moving now"
	 * and the list in sections by when markets settle, a row opening in place.
	 * Table: a compact lead and one list soonest first, a row opening the side
	 * panel. While filtering, one list of every match.
	 */
	interface Props {
		layout: LandingMarketsLayout;
		view: LandingMarketsView;
		/** `undefined` while the first read is in flight. */
		lead?: Market;
		movers: Market[];
		/** One section per settlement window; a single untitled one for a flat list. */
		sections: { group?: SettleGroup; markets: Market[] }[];
		filtering: boolean;
		loading: boolean;
		nowMs: number;
		size: number;
		selectedId?: string;
		/** Id of the table's side panel. */
		panelId: string;
		uid: string;
		onselect: (market: Market) => void;
		onpick: (market: Market) => void;
		onsizechange: (size: number) => void;
	}

	const {
		layout,
		view,
		lead,
		movers,
		sections,
		filtering,
		loading,
		nowMs,
		size,
		selectedId,
		panelId,
		uid,
		onselect,
		onpick,
		onsizechange
	}: Props = $props();

	const table = $derived(layout === 'table');
	const empty = $derived(sections.every(({ markets }) => markets.length === 0));

	const GROUP_KEYS = {
		this_year: 'landing.markets.group.this_year',
		early_next: 'landing.markets.group.early_next',
		later_next: 'landing.markets.group.later_next',
		beyond: 'landing.markets.group.beyond'
	} as const;

	const groupTitle = (group: SettleGroup): string =>
		t({
			locale: $localeStore,
			key: GROUP_KEYS[group.key],
			params: 'year' in group ? { year: group.year } : undefined
		});
</script>

{#if loading}
	<div class="lmb-skeleton is-lead" aria-busy="true"></div>
	{#each [0, 1, 2, 3, 4] as row (row)}
		<div class="lmb-skeleton" aria-hidden="true"></div>
	{/each}
{:else}
	{#if nonNullish(lead)}
		<section class="lmb-top" aria-labelledby="{uid}-trending">
			<h2 id="{uid}-trending" class="lmb-heading">
				{t({ locale: $localeStore, key: 'markets.section.trending' })}
			</h2>
			{#if table}
				<LandingMarketsLead
					compact
					detailId={panelId}
					market={lead}
					{nowMs}
					onselect={() => onselect(lead)}
					selected={selectedId === lead.id}
					{size}
					{view}
				/>
			{:else}
				<LandingMarketsLead market={lead} {nowMs} {size} {view} />
				{#if movers.length > 0}
					<LandingMarketsMovers headingId="{uid}-movers" {movers} {onpick} {view} />
				{/if}
			{/if}
		</section>
	{/if}

	{#if !empty}
		<div class="lmb-list" class:is-table={table}>
			{#each sections as section, sectionIndex (section.group?.key ?? 'all')}
				{@const offset = sections
					.slice(0, sectionIndex)
					.reduce((count, { markets }) => count + markets.length, 0)}
				{#if nonNullish(section.group)}
					<h2 class="lmb-heading is-section">{groupTitle(section.group)}</h2>
				{/if}
				<ul
					class="lmb-rows"
					aria-label={isNullish(section.group)
						? t({ locale: $localeStore, key: 'landing.markets.list' })
						: groupTitle(section.group)}
				>
					{#each section.markets as market, index (market.id)}
						<LandingMarketsRow
							controls={table ? panelId : `${uid}-x-${market.id}`}
							index={offset + index}
							{market}
							{nowMs}
							onselect={() => onselect(market)}
							selected={selectedId === market.id}
							{size}
							{table}
							{view}
						>
							{#snippet expansion()}
								{#if !table}
									<LandingMarketsDetail inRow {market} {nowMs} {onsizechange} {size} {view} />
								{/if}
							{/snippet}
						</LandingMarketsRow>
					{/each}
				</ul>
			{/each}
		</div>
	{:else if isNullish(lead)}
		<p class="lmb-none" role="status">
			{t({
				locale: $localeStore,
				key: filtering ? 'landing.markets.no_match' : 'landing.markets.none_open'
			})}
		</p>
	{/if}
{/if}

<style lang="postcss">
	.lmb-top {
		display: grid;
		gap: 20px;
	}

	.lmb-heading {
		margin: 0 0 -6px;
		font: 700 18px/1 var(--font-headline, var(--font-display));
		letter-spacing: -0.02em;
	}

	.lmb-heading.is-section {
		margin: 22px 12px 8px;
	}

	.lmb-list > .lmb-heading.is-section:first-child {
		margin-top: 4px;
	}

	.lmb-rows {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.lmb-none {
		margin: 0;
		padding: 28px 12px;
		font: 500 15px/1.4 var(--font-display);
		color: var(--lm-quiet);
	}

	.lmb-skeleton {
		height: 64px;
		border-radius: 18px;
		background: var(--lm-pane-a);
		opacity: 0.6;
	}

	.lmb-skeleton.is-lead {
		height: 220px;
		border-radius: 24px;
	}
</style>
