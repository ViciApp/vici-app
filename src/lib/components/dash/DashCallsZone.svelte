<script lang="ts" module>
	export interface OpenCallRow {
		key: string;
		question: string;
		side?: 'YES' | 'NO';
		context: string;
		timer: string;
		marketId: string;
	}

	export interface ResolvedCallRow {
		key: string;
		question: string;
		side?: 'YES' | 'NO';
		context: string;
		end: string;
		won: boolean;
		marketId?: string;
	}
</script>

<script lang="ts">
	/**
	 * Zone 3 · Calls — an Open / Resolved segmented toggle over compact call
	 * rows. Each tab previews the first three rows and reveals the rest inline
	 * via "see all". Open rows carry a pending dot + live timer; resolved rows
	 * carry a won/lost dot + signed VXP. The empty Open state nudges into Flow.
	 *
	 * Rows arrive fully shaped from the host (`DashPage`) so the data-derivation
	 * stays in one place and this component owns only the tab + expansion state.
	 */
	import DashCallRow from '#lib/components/dash/DashCallRow.svelte';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { goto } from '$app/navigation';

	interface Props {
		openCalls: OpenCallRow[];
		resolvedCalls: ResolvedCallRow[];
		/** Total resolved count, for the resolved "see all" label. */
		resolvedTotal: number;
	}

	let { openCalls, resolvedCalls, resolvedTotal }: Props = $props();

	const PREVIEW = 3;

	let tab = $state<'open' | 'resolved'>('open');
	let expanded = $state(false);

	// Each tab starts collapsed to its preview length — reset on tab flip.
	$effect(() => {
		// Touch `tab` so the reset runs whenever it changes.
		void tab;
		expanded = false;
	});

	const openVisible = $derived(expanded ? openCalls : openCalls.slice(0, PREVIEW));
	const resolvedVisible = $derived(expanded ? resolvedCalls : resolvedCalls.slice(0, PREVIEW));

	const openMarket = (marketId: string): void => {
		void goto(resolveAppPath(`${AppPath.Markets}/${marketId}`));
	};

	const openFlow = (): void => {
		void goto(resolveAppPath(AppPath.Flow));
	};
</script>

<div class="db-calls">
	<div class="db-calls-head">
		<span class="db-sec-label">{t({ locale: $localeStore, key: 'dash.build.calls_label' })}</span>
		<div class="db-seg" role="tablist">
			<button
				class:on={tab === 'open'}
				aria-selected={tab === 'open'}
				onclick={() => (tab = 'open')}
				role="tab"
				type="button"
			>
				{t({ locale: $localeStore, key: 'dash.build.tab_open' })}
			</button>
			<button
				class:on={tab === 'resolved'}
				aria-selected={tab === 'resolved'}
				onclick={() => (tab = 'resolved')}
				role="tab"
				type="button"
			>
				{t({ locale: $localeStore, key: 'dash.build.tab_resolved' })}
			</button>
		</div>
	</div>

	{#if tab === 'open'}
		{#if openCalls.length === 0}
			<div class="db-callempty">
				<div class="db-ce-dot"></div>
				<div class="db-ce-title">
					{t({ locale: $localeStore, key: 'dash.build.open_empty_title' })}
				</div>
				<div class="db-ce-sub">{t({ locale: $localeStore, key: 'dash.build.open_empty_sub' })}</div>
				<button class="db-ce-cta" onclick={openFlow} type="button">
					{t({ locale: $localeStore, key: 'dash.build.open_empty_cta' })}
				</button>
			</div>
		{:else}
			{#each openVisible as row (row.key)}
				<DashCallRow
					context={row.context}
					dot="pending"
					end={row.timer}
					onClick={() => openMarket(row.marketId)}
					question={row.question}
					side={row.side}
				/>
			{/each}
			{#if openCalls.length > PREVIEW}
				<button class="db-callmore" onclick={() => (expanded = !expanded)} type="button">
					{expanded
						? t({ locale: $localeStore, key: 'dash.build.show_less' })
						: t({
								locale: $localeStore,
								key: 'dash.build.see_all_open',
								params: { count: openCalls.length }
							})}
				</button>
			{/if}
		{/if}
	{:else if resolvedCalls.length === 0}
		<div class="db-empty">{t({ locale: $localeStore, key: 'dash.past.empty' })}</div>
	{:else}
		{#each resolvedVisible as row (row.key)}
			<DashCallRow
				context={row.context}
				dot={row.won ? 'won' : 'lost'}
				end={row.end}
				endTone={row.won ? 'win' : 'loss'}
				onClick={row.marketId ? () => openMarket(row.marketId as string) : undefined}
				question={row.question}
				side={row.side}
			/>
		{/each}
		{#if resolvedCalls.length > PREVIEW}
			<button class="db-callmore" onclick={() => (expanded = !expanded)} type="button">
				{expanded
					? t({ locale: $localeStore, key: 'dash.build.show_less' })
					: t({
							locale: $localeStore,
							key: 'dash.build.see_all_resolved',
							params: { count: resolvedTotal }
						})}
			</button>
		{/if}
	{/if}
</div>
