<script lang="ts">
	/**
	 * Transaction history: every event that changed what the user owns,
	 * newest first: bonuses (labelled from the ledger award memo),
	 * prediction stakes, settlements, and external transfers. The last
	 * column carries the running total balance after each event, anchored on
	 * the live total-holdings figure so the top row always matches the Dash
	 * hero and old rows never drift negative. The headline triple reconciles
	 * by construction: total = available + in play. Spec: docs/ai/
	 * spec-driven-development/specs/2026-06-12-feat-transaction-history.md.
	 */
	import { isNullish, nonNullish } from '@dfinity/utils';
	import {
		ArrowLeftRight,
		Flag,
		Flame,
		Gift,
		Sparkles,
		Target,
		Trophy,
		X,
		Zap
	} from '@lucide/svelte/icons';
	import { onMount } from 'svelte';
	import DashHoldingsBreakdown from '#lib/components/dash/DashHoldingsBreakdown.svelte';
	import ScreenHeader from '#lib/components/layout/ScreenHeader.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Pagination from '#lib/components/ui/Pagination.svelte';
	import {
		MILLISECOND_IN_NANOSECONDS,
		TRANSACTION_HISTORY_PAGE_SIZE,
		USD_DECIMALS,
		ZERO
	} from '#lib/constants/app.constants.ts';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { openCallCount } from '#lib/derived/open-call-count.derived.ts';
	import { tradeHistory, tradeHistoryNotInitialized } from '#lib/derived/trade-history.derived.ts';
	import {
		vxpBacked,
		vxpHoldingsNotInitialized,
		vxpHoldingsTotal,
		vxpSpendable
	} from '#lib/derived/vxp-holdings.derived.ts';
	import { track } from '#lib/services/analytics.services.ts';
	import {
		loadVxpLedgerHistory,
		type VxpLedgerHistory
	} from '#lib/services/transaction-history.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { displayMarkets } from '#lib/stores/market-translations.store.ts';
	import type {
		TransactionHistoryBonusTag,
		TransactionHistoryFilter,
		TransactionHistoryRow
	} from '#lib/types/transaction-history.ts';
	import {
		decimalFixedValueToNumber,
		formatLongDate,
		formatNanosecondsToDate
	} from '#lib/utils/format.utils.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';
	import { goBack, resolveAppPath } from '#lib/utils/nav.utils.ts';
	import {
		formatVxpBalance,
		formatWholeVxpMagnitude
	} from '#lib/utils/playground-display.utils.ts';
	import { assembleTransactionHistory } from '#lib/utils/transaction-history.utils.ts';
	import { page } from '$app/state';

	const FILTERS: TransactionHistoryFilter[] = ['all', 'predictions', 'results', 'bonuses'];

	let ledger = $state<VxpLedgerHistory | undefined>();
	let ledgerFailed = $state(false);

	onMount(async () => {
		const history = await loadVxpLedgerHistory();

		if (isNullish(history)) {
			ledgerFailed = true;

			return;
		}

		ledger = history;
	});

	const loading = $derived(
		(isNullish(ledger) && !ledgerFailed) ||
			$tradeHistoryNotInitialized ||
			$vxpHoldingsNotInitialized
	);

	const rows = $derived.by((): TransactionHistoryRow[] | undefined => {
		if (loading) {
			return;
		}

		return assembleTransactionHistory({
			events: $tradeHistory,
			ledgerEntries: ledger?.entries ?? [],
			totalAnchor: $vxpHoldingsTotal,
			includeGenesis: nonNullish(ledger) && !ledger.truncated
		});
	});

	let filter = $state<TransactionHistoryFilter>('all');
	let pageIndex = $state(1);

	const filteredRows = $derived.by((): TransactionHistoryRow[] => {
		if (isNullish(rows)) {
			return [];
		}

		switch (filter) {
			case 'predictions':
				return rows.filter(({ kind }) => kind === 'prediction');
			case 'results':
				return rows.filter(({ kind }) => ['won', 'lost', 'neutral', 'liquidation'].includes(kind));
			case 'bonuses':
				return rows.filter(({ kind }) => kind === 'bonus');
			default:
				return rows;
		}
	});

	const pageRows = $derived(
		filteredRows.slice(
			(pageIndex - 1) * TRANSACTION_HISTORY_PAGE_SIZE,
			pageIndex * TRANSACTION_HISTORY_PAGE_SIZE
		)
	);

	const applyFilter = (next: TransactionHistoryFilter) => {
		if (next === filter) {
			return;
		}

		filter = next;
		pageIndex = 1;
		track({ name: 'transactions_filtered', label: next });
	};

	let viewTracked = false;
	$effect(() => {
		if (nonNullish(rows) && !viewTracked) {
			viewTracked = true;
			track({
				name: 'transactions_viewed',
				source: page.url.searchParams.get('source') === 'sheet' ? 'dash_sheet' : 'direct',
				count: rows.length
			});
		}
	});

	const totalDisplay = $derived(
		formatVxpBalance({ value: $vxpHoldingsTotal, decimals: USD_DECIMALS })
	);
	const availableDisplay = $derived(
		formatVxpBalance({ value: $vxpSpendable, decimals: USD_DECIMALS })
	);
	const inPlayDisplay = $derived(formatVxpBalance({ value: $vxpBacked, decimals: USD_DECIMALS }));

	const BONUS_LABEL_KEYS: Record<TransactionHistoryBonusTag, MessageKey> = {
		achievement: 'transactions.bonus.achievement',
		calibration: 'transactions.bonus.calibration',
		comeback: 'transactions.bonus.comeback',
		league_founder: 'transactions.bonus.league_founder',
		'new-user': 'transactions.bonus.new_user',
		referral: 'transactions.bonus.referral',
		streak: 'transactions.bonus.streak',
		tournament_prize: 'transactions.bonus.tournament_prize',
		worlds_podium: 'transactions.bonus.worlds_podium',
		unknown: 'transactions.bonus.unknown'
	};

	const rowTitle = (row: TransactionHistoryRow): string => {
		const locale = $localeStore;

		if (row.kind === 'joined') {
			return t({
				locale,
				key: 'settings.identity.joined',
				params: {
					date: formatLongDate({ date: row.timestampNs / MILLISECOND_IN_NANOSECONDS, locale })
				}
			});
		}

		if (row.kind === 'bonus') {
			const bonusLabel = t({ locale, key: BONUS_LABEL_KEYS[row.bonusTag ?? 'unknown'] });

			return `${t({ locale, key: 'transactions.kind.bonus' })} · ${bonusLabel}`;
		}

		const kindLabel = t({ locale, key: `transactions.kind.${row.kind}` as const });
		const market = nonNullish(row.marketId) ? $displayMarkets.get(row.marketId) : undefined;

		return nonNullish(market) ? `${kindLabel} · ${market.title}` : kindLabel;
	};

	const rowMeta = (row: TransactionHistoryRow): string => {
		// The genesis row already carries its date in the title.
		if (row.kind === 'joined') {
			return '';
		}

		const when = formatNanosecondsToDate({ nanoseconds: row.timestampNs });

		// A fill moves the stake into play without changing total; surface the
		// committed margin here so the muted "—" amount reads as "still yours".
		if (row.kind === 'prediction' && nonNullish(row.stake) && row.stake > ZERO) {
			return `${when} · ${t({
				locale: $localeStore,
				key: 'transactions.in_play',
				params: { amount: formatVxpBalance({ value: row.stake, decimals: USD_DECIMALS }) }
			})}`;
		}

		return when;
	};

	const deltaDisplay = (row: TransactionHistoryRow): string => {
		// Placing a prediction is wealth-neutral (VXP moves into play, total is
		// unchanged), so it carries no signed amount; the meta shows the stake.
		if (row.kind === 'prediction') {
			return '—';
		}

		const value = decimalFixedValueToNumber({ value: row.delta, decimals: USD_DECIMALS });

		if (value === 0) {
			return '0';
		}

		return `${value > 0 ? '+' : '−'}${formatWholeVxpMagnitude(value)}`;
	};

	const deltaTone = (row: TransactionHistoryRow): 'up' | 'down' | 'zero' =>
		row.delta > ZERO ? 'up' : row.delta < ZERO ? 'down' : 'zero';
</script>

<div class="txh-page">
	<ScreenHeader
		back={{
			label: t({ locale: $localeStore, key: 'transactions.back' }),
			onBack: () => goBack(resolveAppPath(AppPath.Dash))
		}}
		title={t({ locale: $localeStore, key: 'transactions.title' })}
	/>

	<div class="txh-summary">
		<DashHoldingsBreakdown
			{availableDisplay}
			availableValue={$vxpSpendable}
			holdingsDisplay={totalDisplay}
			{inPlayDisplay}
			inPlayValue={$vxpBacked}
			openCallCount={$openCallCount}
		/>
	</div>

	<div
		class="txh-filters"
		aria-label={t({ locale: $localeStore, key: 'transactions.filters' })}
		role="group"
	>
		{#each FILTERS as filterOption (filterOption)}
			<button
				class="txh-chip"
				class:is-active={filter === filterOption}
				onclick={() => applyFilter(filterOption)}
				type="button"
			>
				{t({ locale: $localeStore, key: `transactions.filter.${filterOption}` as const })}
			</button>
		{/each}
	</div>

	{#if loading}
		<div class="txh-skeleton" aria-hidden="true">
			{#each Array.from({ length: 6 }) as _, i (i)}
				<div class="txh-skeleton-row animate-pulse"></div>
			{/each}
		</div>
	{:else if filteredRows.length === 0}
		<EmptyState message={t({ locale: $localeStore, key: 'transactions.empty' })} />
	{:else}
		<div class="txh-table">
			<div class="txh-head" aria-hidden="true">
				<span></span>
				<span>{t({ locale: $localeStore, key: 'transactions.col.activity' })}</span>
				<span class="txh-right">{t({ locale: $localeStore, key: 'transactions.col.amount' })}</span>
				<span class="txh-right">{t({ locale: $localeStore, key: 'transactions.col.balance' })}</span
				>
			</div>

			{#each pageRows as row (row.id)}
				<div class="txh-row">
					<span class="txh-ico is-{deltaTone(row)}" class:is-bonus={row.kind === 'bonus'}>
						{#if row.kind === 'won'}
							<Trophy aria-hidden="true" size={15} strokeWidth={1.8} />
						{:else if row.kind === 'lost'}
							<X aria-hidden="true" size={15} strokeWidth={1.8} />
						{:else if row.kind === 'prediction'}
							<Target aria-hidden="true" size={15} strokeWidth={1.8} />
						{:else if row.kind === 'bonus'}
							<Gift aria-hidden="true" size={15} strokeWidth={1.8} />
						{:else if row.kind === 'minted'}
							<Sparkles aria-hidden="true" size={15} strokeWidth={1.8} />
						{:else if row.kind === 'burned'}
							<Flame aria-hidden="true" size={15} strokeWidth={1.8} />
						{:else if row.kind === 'liquidation'}
							<Zap aria-hidden="true" size={15} strokeWidth={1.8} />
						{:else if row.kind === 'joined'}
							<Flag aria-hidden="true" size={15} strokeWidth={1.8} />
						{:else}
							<ArrowLeftRight aria-hidden="true" size={15} strokeWidth={1.8} />
						{/if}
					</span>
					<span class="txh-what">
						<span class="txh-title">{rowTitle(row)}</span>
						<span class="txh-meta">{rowMeta(row)}</span>
					</span>
					<span class="txh-amt num is-{deltaTone(row)}">
						{row.kind === 'joined' ? '—' : deltaDisplay(row)}
					</span>
					<span class="txh-bal num"
						>{formatVxpBalance({ value: row.balance, decimals: USD_DECIMALS })}</span
					>
				</div>
			{/each}
		</div>

		<Pagination
			onPageChange={(next) => (pageIndex = next)}
			page={pageIndex}
			pageSize={TRANSACTION_HISTORY_PAGE_SIZE}
			totalItems={filteredRows.length}
		/>

		{#if ledger?.truncated}
			<p class="txh-truncated">{t({ locale: $localeStore, key: 'transactions.truncated' })}</p>
		{/if}
	{/if}
</div>

<style lang="postcss">
	.txh-page {
		display: flex;
		flex-direction: column;
		padding-bottom: 24px;
	}

	.txh-summary {
		padding: 2px var(--spacing-edge) 12px;
	}

	.txh-filters {
		display: flex;
		gap: 6px;
		padding: 0 var(--spacing-edge) 12px;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.txh-filters::-webkit-scrollbar {
		display: none;
	}

	.txh-chip {
		flex: none;
		appearance: none;
		padding: 5px 12px;
		border: 1px solid var(--border-base);
		border-radius: var(--r-pill);
		background: transparent;
		color: var(--text-muted);
		font-size: var(--t-12);
		cursor: pointer;
	}

	.txh-chip.is-active {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--ink);
		font-weight: 600;
	}

	.txh-table {
		display: flex;
		flex-direction: column;
		padding: 0 var(--spacing-edge);
	}

	.txh-head,
	.txh-row {
		display: grid;
		grid-template-columns: 26px minmax(0, 1fr) 64px 72px;
		gap: 8px;
		align-items: center;
		padding: 9px 0;
	}

	.txh-head {
		padding-bottom: 5px;
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: var(--t-11);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.txh-row {
		border-top: 1px solid var(--border-base);
	}

	.txh-right {
		text-align: right;
	}

	.txh-ico {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		background: color-mix(in srgb, var(--text-base) 6%, transparent);
		color: var(--text-muted);
	}

	.txh-ico.is-up {
		color: var(--yes);
	}

	.txh-ico.is-down {
		color: var(--no);
	}

	.txh-ico.is-bonus {
		color: var(--color-accent);
	}

	.txh-what {
		display: flex;
		flex-direction: column;
		min-width: 0;
		gap: 1px;
	}

	.txh-title {
		overflow: hidden;
		color: var(--text-base);
		font-size: var(--t-13);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.txh-meta {
		overflow: hidden;
		color: var(--text-muted);
		font-size: var(--t-11);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.txh-amt {
		font-size: var(--t-13);
		font-weight: 600;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.txh-amt.is-up {
		color: var(--yes);
	}

	.txh-amt.is-down {
		color: var(--no);
	}

	.txh-amt.is-zero {
		color: var(--text-muted);
		font-weight: 400;
	}

	.txh-bal {
		color: var(--text-base);
		font-size: var(--t-13);
		text-align: right;
		font-variant-numeric: tabular-nums;
		opacity: 0.85;
	}

	.txh-skeleton {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 4px var(--spacing-edge);
	}

	.txh-skeleton-row {
		height: 40px;
		border-radius: 10px;
		background: color-mix(in srgb, var(--text-base) 6%, transparent);
	}

	.txh-truncated {
		margin: 0;
		padding: 12px var(--spacing-edge) 0;
		color: var(--text-muted);
		font-size: var(--t-11);
		text-align: center;
	}
</style>
