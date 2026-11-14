<script lang="ts" module>
	export interface ZeroMarketRow {
		marketId: string;
		question: string;
		side?: 'YES' | 'NO';
		context: string;
		timer: string;
	}
</script>

<script lang="ts">
	/**
	 * Day-0 / Day-1 Dashboard: the same three-zone framework as the standard
	 * build, with every zero-data block swapped for calibrating / orientation
	 * content:
	 *
	 * - **Day 0** (`day1 === false`): no calls placed. A calibrating accuracy
	 *   hero (muted dash + dotted baseline), the starter balance card, and a
	 *   "start with one of these" list of real open markets.
	 * - **Day 1+** (`day1 === true`): calls placed, none settled. The hero
	 *   still calibrates but names when the first call settles; the stack shows
	 *   holdings + in-play; the call list shows every in-flight call and a couple
	 *   of accessible markets to add while waiting.
	 *
	 * The markets and the calls are real (shaped by the host from the markets /
	 * positions / orders stores); only the trend line is intentionally absent
	 * until a call resolves. Tapping the balance card opens the same holdings
	 * breakdown sheet as the standard build.
	 */
	import { ChevronRight } from '@lucide/svelte/icons';
	import DashCallRow from '#lib/components/dash/DashCallRow.svelte';
	import type { OpenCallRow } from '#lib/components/dash/DashCallsZone.svelte';
	import DashGettingStarted from '#lib/components/dash/DashGettingStarted.svelte';
	import { EMPTY_VALUE } from '#lib/constants/app.constants.ts';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { goto } from '$app/navigation';

	interface Props {
		/** `false` → Day 0; `true` → Day 1+ (call placed, unresolved). */
		day1: boolean;
		/** Spendable/starter balance, formatted whole-VXP. */
		holdingsDisplay: string;
		/** In-play (backed) VXP, formatted: Day 1 only. */
		inPlayDisplay: string;
		/** Figures not loaded yet: render pulsing placeholders instead of 0. */
		loading: boolean;
		/** Number of live (unresolved) calls: Day 1 stack sub-stat. */
		pendingCount: number;
		/** When the first call settles (year-stripped), for the calibrating copy. */
		firstCallTimer: string;
		/** Starter markets (Day 0): real open markets to make a first call on. */
		starterRows: ZeroMarketRow[];
		/** Every open call (positions + resting orders), soonest-first (Day 1+). */
		openCalls: OpenCallRow[];
		/** Markets to add while waiting (Day 1). */
		moreRows: ZeroMarketRow[];
		/** Opens the holdings breakdown sheet. */
		onOpen: () => void;
	}

	let {
		day1,
		holdingsDisplay,
		inPlayDisplay,
		loading,
		pendingCount,
		firstCallTimer,
		starterRows,
		openCalls,
		moreRows,
		onOpen
	}: Props = $props();

	const PREVIEW = 3;

	// The in-flight list previews the soonest-expiring calls and reveals the rest
	// inline, mirroring the standard build's Open tab (see `DashCallsZone`).
	let expanded = $state(false);
	const openVisible = $derived(expanded ? openCalls : openCalls.slice(0, PREVIEW));

	const openMarket = (marketId: string): void => {
		void goto(resolveAppPath(`${AppPath.Markets}/${marketId}`));
	};

	const openFlow = (): void => {
		void goto(resolveAppPath(AppPath.Flow));
	};

	const calibratingCaption = $derived(
		day1
			? t({
					locale: $localeStore,
					key: 'dash.build.zero_cal_day1',
					params: { when: firstCallTimer }
				})
			: t({ locale: $localeStore, key: 'dash.build.zero_cal_day0' })
	);
</script>

<div class="db-body">
	<!-- Getting-started checklist: cross-surface direction for the first run -->
	<DashGettingStarted />

	<!-- ZONE 1 · PERFORMANCE: calibrating -->
	<div class="db-hero">
		<div class="db-hrow">
			<span class="db-lbl">{t({ locale: $localeStore, key: 'dash.accuracy.eyebrow' })}</span>
		</div>
		<div class="db-big num db-muted">{EMPTY_VALUE}<span class="db-u">%</span></div>
		<div class="db-cal">{calibratingCaption}</div>
		<div class="db-areachart db-empty">
			<svg preserveAspectRatio="none" viewBox="0 0 360 48">
				<line
					stroke="var(--fg-faint)"
					stroke-dasharray="3 6"
					stroke-width="1.5"
					x1="0"
					x2="360"
					y1="30"
					y2="30"
				/>
			</svg>
		</div>
	</div>

	<!-- ZONE 2 · STACK -->
	<button class="db-wallet" onclick={onOpen} type="button">
		<div class="db-left">
			<div class="db-k">
				{t({
					locale: $localeStore,
					key: day1 ? 'dash.holdings.eyebrow' : 'dash.build.zero_starter_balance'
				})}
			</div>
			<div class="db-v num" class:db-ph={loading}>
				{loading ? t({ locale: $localeStore, key: 'dash.rank.placeholder' }) : holdingsDisplay}<span
					class="db-vu">VXP</span
				>
			</div>
		</div>
		<div class="db-wright">
			{#if day1}
				<div class="db-stat">
					<div class="db-kk">{t({ locale: $localeStore, key: 'dash.build.in_play' })}</div>
					<div class="db-vv num" class:db-ph={loading}>
						{loading ? t({ locale: $localeStore, key: 'dash.rank.placeholder' }) : inPlayDisplay}
					</div>
				</div>
				<div class="db-stat">
					<div class="db-kk">{t({ locale: $localeStore, key: 'dash.build.zero_calls' })}</div>
					<div class="db-vv num">{pendingCount}</div>
				</div>
			{:else}
				<span class="db-gift-tag">
					{t({ locale: $localeStore, key: 'dash.build.zero_starter_gift' })}
				</span>
			{/if}
			<span class="db-wchev" aria-hidden="true">
				<ChevronRight size={15} strokeWidth={2} />
			</span>
		</div>
	</button>

	<!-- ZONE 3 · CALLS -->
	{#if day1}
		<div class="db-calls">
			<div class="db-calls-head">
				<span class="db-sec-label"
					>{t({ locale: $localeStore, key: 'dash.build.zero_in_flight' })}</span
				>
			</div>
			{#if openCalls.length === 0}
				<div class="db-empty">
					{t({ locale: $localeStore, key: 'dash.dz.active_day1_pending_body' })}
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
		</div>
		<div class="db-calls">
			<div class="db-calls-head">
				<span class="db-sec-label"
					>{t({ locale: $localeStore, key: 'dash.build.zero_add_another' })}</span
				>
			</div>
			{#each moreRows as row (row.marketId)}
				<DashCallRow
					context={row.context}
					dot="pending"
					end={row.timer}
					onClick={() => openMarket(row.marketId)}
					question={row.question}
				/>
			{/each}
			<button class="db-callmore" onclick={openFlow} type="button">
				{t({ locale: $localeStore, key: 'dash.build.zero_make_another' })}
			</button>
		</div>
	{:else}
		<div class="db-calls">
			<div class="db-calls-head">
				<span class="db-sec-label"
					>{t({ locale: $localeStore, key: 'dash.build.zero_start_with' })}</span
				>
			</div>
			{#each starterRows as row (row.marketId)}
				<DashCallRow
					context={row.context}
					dot="pending"
					end={row.timer}
					onClick={() => openMarket(row.marketId)}
					question={row.question}
				/>
			{/each}
			<button class="db-callmore" onclick={openFlow} type="button">
				{t({ locale: $localeStore, key: 'dash.build.zero_browse_all' })}
			</button>
		</div>
	{/if}
</div>
