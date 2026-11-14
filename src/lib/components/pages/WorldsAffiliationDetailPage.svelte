<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import { ChevronRight } from '@lucide/svelte/icons';
	import { onMount } from 'svelte';
	import ScreenHeader from '#lib/components/layout/ScreenHeader.svelte';
	import CountryFlag from '#lib/components/ui/CountryFlag.svelte';
	import { hasCountryFlag } from '#lib/constants/country-flags.constants.ts';
	import {
		lookupWorldsAffiliation,
		WORLDS_COUNTRIES,
		WORLDS_UNIVERSITIES
	} from '#lib/constants/worlds-affiliations.constants.ts';
	import {
		getAffiliationStats,
		listAffiliationChampionships,
		listAffiliationStats,
		listWorldsMemberCounts
	} from '#lib/services/worlds.services.ts';
	import { myAffiliationsStore, refreshMyAffiliations } from '#lib/stores/affiliations.store.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import {
		MIN_CALLS_FOR_RANK,
		type AffiliationChampionship,
		type AffiliationStatsDoc
	} from '#lib/types/affiliation-stats.ts';
	import type { AffiliationKind } from '#lib/types/affiliation.ts';
	import { affiliationChipStyle } from '#lib/utils/affiliation-chip.utils.ts';
	import { affiliationDisplayName } from '#lib/utils/affiliation-name.utils.ts';
	import {
		affiliationLifetimeAccuracy,
		affiliationMonthlyAccuracy,
		affiliationRankComparator,
		formatAccuracyPercent
	} from '#lib/utils/affiliation-stats.utils.ts';
	import { formatMonthAnchorLabel } from '#lib/utils/format.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { goBack } from '#lib/utils/nav.utils.ts';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	/**
	 * Worlds affiliation detail: drill-down from `WorldsPage` and the
	 * battle standings. The same component serves both the university
	 * ("school") and country ("nation") variant; the two mirror each
	 * other in layout and differ only in the kind label, the identity
	 * glyph (letter badge vs flag), and the affiliation marker (Alma
	 * Mater vs Citizen).
	 *
	 * Layout, top to bottom:
	 *
	 *  1. Compact bar (`ScreenHeader`) with an inline back control and
	 *     the affiliation name, followed by a scrollable context-chip
	 *     row (kind · members · champion count · your-marker).
	 *  2. Identity card: a brand-coloured letter badge (or flag) beside
	 *     a season-rank line.
	 *  3. Three-stat grid: May rank, WC-Battle rank (accented), and
	 *     all-time accuracy.
	 *  4. Activity block: an under-threshold empty state encouraging
	 *     calls, or the live accuracy split for active affiliations.
	 *  5. A standings CTA back to the full battle list.
	 *
	 * Stats are populated by the satellite hook on `profiles` updates,
	 * so the user's own resolved calls are already folded into the
	 * affiliation totals server-side; no client-side session delta is
	 * applied here (that would double-count).
	 */
	interface Props {
		kind: AffiliationKind;
		affiliationIdentifier: string;
	}

	const { kind, affiliationIdentifier }: Props = $props();

	const option = $derived(lookupWorldsAffiliation({ kind, id: affiliationIdentifier }));
	const rosterSize = $derived(
		kind === 'university' ? WORLDS_UNIVERSITIES.length : WORLDS_COUNTRIES.length
	);
	const isCountry = $derived(kind === 'country');

	let memberCount = $state<number | undefined>();
	let stats = $state<AffiliationStatsDoc | undefined>();
	let allStats = $state<AffiliationStatsDoc[]>([]);
	let championships = $state<AffiliationChampionship[]>([]);
	let loadState: 'loading' | 'ready' | 'error' = $state('loading');
	let errorMessage: string | null = $state(null);

	// Whether this affiliation is the caller's own: read from the shared
	// cache so the "your marker" chip survives re-entry without a refetch.
	const isMine = $derived(
		(kind === 'university' ? $myAffiliationsStore.university : $myAffiliationsStore.country)
			?.affiliationIdentifier === affiliationIdentifier
	);

	onMount(async () => {
		void refreshMyAffiliations();

		try {
			const [counts, statsResp, allResp, cups] = await Promise.all([
				listWorldsMemberCounts({ kind }),
				getAffiliationStats({ kind, affiliationIdentifier }),
				listAffiliationStats({ kind }),
				listAffiliationChampionships({ kind, affiliationIdentifier })
			]);
			memberCount = counts[affiliationIdentifier] ?? 0;
			stats = statsResp;
			allStats = allResp;
			championships = cups;
			loadState = 'ready';
		} catch (err) {
			console.error('WorldsAffiliationDetailPage: load failed', err);
			errorMessage = t({ locale: $localeStore, key: 'common.error.generic' });
			loadState = 'error';
		}
	});

	const accuracyPctLifetime = $derived(
		stats && stats.totalCalls > 0 ? formatAccuracyPercent(affiliationLifetimeAccuracy(stats)) : '–'
	);

	const accuracyPctMonth = $derived(
		stats && stats.monthTotalCalls > 0
			? formatAccuracyPercent(affiliationMonthlyAccuracy(stats))
			: '–'
	);

	const hasActivity = $derived(nonNullish(stats) && stats.totalCalls > 0);
	const isLowActivity = $derived(!stats || stats.totalCalls < MIN_CALLS_FOR_RANK);
	const callsToQualify = $derived(
		stats ? Math.max(0, MIN_CALLS_FOR_RANK - stats.totalCalls) : MIN_CALLS_FOR_RANK
	);

	/**
	 * Position of this affiliation in the lifetime-accuracy (WC) and
	 * month-accuracy rankings. Returns `0` when this affiliation has no
	 * stats doc (unranked / first-call pending).
	 */
	const rankBy = ({ key }: { key: 'lifetime' | 'month' }): number => {
		if (allStats.length === 0) {
			return 0;
		}

		const score = (s: AffiliationStatsDoc): number =>
			key === 'lifetime' ? affiliationLifetimeAccuracy(s) : affiliationMonthlyAccuracy(s);

		const sorted = [...allStats].sort(
			affiliationRankComparator({ accuracyOf: score, callsOf: (s) => s.totalCalls })
		);

		const idx = sorted.findIndex((s) => s.affiliationIdentifier === affiliationIdentifier);

		return idx === -1 ? 0 : idx + 1;
	};

	const wcRank = $derived(rankBy({ key: 'lifetime' }));
	const monthRank = $derived(rankBy({ key: 'month' }));

	const monthRankLabel = $derived(monthRank > 0 ? `#${monthRank}` : '–');
	const wcRankLabel = $derived(wcRank > 0 ? `#${wcRank}` : '–');

	const headerName = $derived(
		nonNullish(option)
			? affiliationDisplayName({ option, kind, locale: $localeStore })
			: affiliationIdentifier
	);

	// Compact-header title. Countries lead with their flag glyph so the
	// bar still carries the nation marker the identity card repeats below.
	const headerTitle = $derived(
		isCountry && option?.glyph ? `${option.glyph} ${headerName}` : headerName
	);

	const championCount = $derived(championships.length);

	/**
	 * Context chips below the bar: the kind label, member count, the
	 * champion-cup count (only once the affiliation has at least one
	 * recorded cup), and (when this is the caller's own affiliation) the
	 * Alma Mater / Citizen marker.
	 */
	const chips = $derived.by(() => {
		const out: { label: string; acc: boolean }[] = [
			{
				label: t({
					locale: $localeStore,
					key: isCountry ? 'worlds.detail.kind_country' : 'worlds.detail.kind_university'
				}),
				acc: false
			}
		];

		if (nonNullish(memberCount)) {
			out.push({
				label: t({
					locale: $localeStore,
					key: 'worlds.detail.members_count',
					params: { count: memberCount }
				}),
				acc: false
			});
		}

		if (championCount > 0) {
			out.push({
				label: t({
					locale: $localeStore,
					key: 'worlds.detail.champion_chip',
					params: { count: championCount }
				}),
				acc: true
			});
		}

		if (isMine) {
			out.push({
				label: t({
					locale: $localeStore,
					key: isCountry ? 'worlds.detail.marker_citizen' : 'worlds.detail.marker_alma_mater'
				}),
				acc: true
			});
		}

		return out;
	});

	const badgeStyle = $derived(affiliationChipStyle({ color: option?.color, text: option?.text }));

	const identityWashStyle = $derived(
		option?.color
			? `background: linear-gradient(180deg, ${option.color}1a, transparent 70%), var(--bg-surface);`
			: ''
	);

	const backToWorlds = () => {
		goBack(`${resolve('arena')}/worlds`);
	};

	const openStandings = () => {
		void goto(`${resolve('arena')}/worlds/${isCountry ? 'countries' : 'schools'}`);
	};

	const openFlow = () => {
		void goto(resolve('flow'));
	};
</script>

<div class="worlds-detail">
	<ScreenHeader
		back={{
			label: t({ locale: $localeStore, key: 'worlds.detail.back' }),
			onBack: backToWorlds
		}}
		title={headerTitle}
	/>

	<div class="worlds-detail-chips">
		{#each chips as chip (chip.label)}
			<span class="num worlds-detail-chip" class:is-acc={chip.acc}>{chip.label}</span>
		{/each}
	</div>

	<section style={identityWashStyle} class="worlds-detail-identity">
		{#if isCountry}
			<span class="worlds-detail-flag" aria-hidden="true">
				{#if option && hasCountryFlag(option.id)}
					<CountryFlag class="worlds-detail-flag-svg" countryCode={option.id} />
				{:else}
					{option?.glyph ?? '🏳️'}
				{/if}
			</span>
		{:else}
			<span style={badgeStyle} class="worlds-detail-glyph" aria-hidden="true">
				{headerName.charAt(0)}
			</span>
		{/if}
		<div class="worlds-detail-identity-text">
			<span class="num allcaps worlds-detail-identity-eyebrow">
				{t({
					locale: $localeStore,
					key: isCountry ? 'worlds.detail.season_nation' : 'worlds.detail.season_founded'
				})}
			</span>
			<span class="num worlds-detail-identity-rank">
				{#if loadState === 'loading'}
					{t({ locale: $localeStore, key: 'worlds.detail.loading_members' })}
				{:else}
					{t({
						locale: $localeStore,
						key: 'worlds.detail.season_rank',
						params: { rank: monthRankLabel }
					})}
					{#if isMine}
						· <span class="worlds-detail-acc">
							{t({ locale: $localeStore, key: 'worlds.detail.season_youre_in' })}
						</span>
					{/if}
				{/if}
			</span>
		</div>
	</section>

	<div class="worlds-detail-rank-row">
		<div class="worlds-detail-rank-cell">
			<span class="num allcaps worlds-detail-rank-label">
				{t({ locale: $localeStore, key: 'worlds.detail.rank_month' })}
			</span>
			<span class="num worlds-detail-rank-value">{monthRankLabel}</span>
		</div>
		<div class="worlds-detail-rank-cell is-wc">
			<span class="num allcaps worlds-detail-rank-label">
				{t({ locale: $localeStore, key: 'worlds.detail.rank_wc' })}
			</span>
			<span class="num worlds-detail-rank-value">{wcRankLabel}</span>
		</div>
		<div class="worlds-detail-rank-cell">
			<span class="num allcaps worlds-detail-rank-label">
				{t({ locale: $localeStore, key: 'worlds.detail.rank_acc' })}
			</span>
			<span class="num worlds-detail-rank-value">{accuracyPctLifetime}</span>
		</div>
	</div>

	{#if isLowActivity}
		<div class="worlds-detail-empty">
			<span class="worlds-detail-empty-title">
				{t({
					locale: $localeStore,
					key: isCountry ? 'worlds.detail.empty_title_country' : 'worlds.detail.empty_title_school'
				})}
			</span>
			<p class="worlds-detail-empty-body">
				{t({
					locale: $localeStore,
					key: 'worlds.detail.empty_body',
					params: { name: headerName, calls: callsToQualify }
				})}
			</p>
			{#if isMine || !isCountry}
				<button class="worlds-detail-empty-cta" onclick={openFlow} type="button">
					{t({ locale: $localeStore, key: 'worlds.detail.empty_cta' })}
				</button>
			{/if}
		</div>
	{:else}
		<section class="worlds-detail-split">
			<div class="row-between">
				<span class="eyebrow worlds-detail-split-eyebrow">
					{t({ locale: $localeStore, key: 'worlds.detail.activity_eyebrow' })}
				</span>
				<span class="num allcaps worlds-detail-split-count">
					{t({
						locale: $localeStore,
						key: 'worlds.detail.activity_calls',
						params: { count: stats?.totalCalls ?? 0 }
					})}
				</span>
			</div>
			<div class="row-between worlds-detail-split-line">
				<span class="num allcaps worlds-detail-split-label">
					{t({ locale: $localeStore, key: 'worlds.detail.split_wc' })}
				</span>
				<span class="num worlds-detail-split-value worlds-detail-acc">{accuracyPctLifetime}</span>
			</div>
			<div class="row-between worlds-detail-split-line">
				<span class="num allcaps worlds-detail-split-label">
					{t({ locale: $localeStore, key: 'worlds.detail.split_month' })}
				</span>
				<span class="num worlds-detail-split-value">{accuracyPctMonth}</span>
			</div>
		</section>
	{/if}

	<section class="worlds-detail-champions">
		<div class="row-between">
			<span class="eyebrow worlds-detail-split-eyebrow">
				{t({ locale: $localeStore, key: 'worlds.detail.champions_eyebrow' })}
			</span>
			{#if championCount > 0}
				<span class="num allcaps worlds-detail-split-count">
					{t({
						locale: $localeStore,
						key: 'worlds.detail.champions_cups',
						params: { count: championCount }
					})}
				</span>
			{/if}
		</div>
		{#if loadState === 'loading'}
			<p class="worlds-detail-champions-empty">
				{t({ locale: $localeStore, key: 'worlds.detail.loading_champions' })}
			</p>
		{:else if championCount === 0}
			<p class="worlds-detail-champions-empty">
				{t({ locale: $localeStore, key: 'worlds.detail.champions_empty' })}
			</p>
		{:else}
			<ul class="worlds-detail-champions-list">
				{#each championships as cup (cup.monthAnchor)}
					<li class="row-between worlds-detail-champions-row">
						<span class="worlds-detail-champions-month"
							>{formatMonthAnchorLabel({ anchor: cup.monthAnchor, locale: $localeStore })}</span
						>
						<span class="num worlds-detail-champions-acc worlds-detail-acc">
							{formatAccuracyPercent(cup.accuracy)}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<button class="worlds-detail-cta" onclick={openStandings} type="button">
		<div class="worlds-detail-cta-text">
			<span class="eyebrow worlds-detail-cta-eyebrow">
				{t({ locale: $localeStore, key: 'worlds.detail.standings_eyebrow' })}
			</span>
			<span class="worlds-detail-cta-label">
				{t({
					locale: $localeStore,
					key: isCountry ? 'worlds.detail.standings_country' : 'worlds.detail.standings_school',
					params: { total: rosterSize }
				})}
			</span>
		</div>
		<ChevronRight aria-hidden="true" size={16} strokeWidth={1.6} />
	</button>

	{#if loadState === 'error'}
		<p class="worlds-detail-error" role="alert">
			{errorMessage ?? t({ locale: $localeStore, key: 'worlds.error.generic' })}
		</p>
	{/if}

	{#if hasActivity}
		<button class="worlds-detail-flow-link" onclick={openFlow} type="button">
			{t({ locale: $localeStore, key: 'worlds.detail.cta_label' })} →
		</button>
	{/if}
</div>

<style lang="postcss">
	.worlds-detail {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		padding: 0 1.25rem 6rem;
	}

	/* ─────────────────────────── context chips */
	.worlds-detail-chips {
		display: flex;
		gap: 0.375rem;
		margin: -0.25rem 0 0;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.worlds-detail-chips::-webkit-scrollbar {
		display: none;
	}

	.worlds-detail-chip {
		flex: 0 0 auto;
		padding: 0.25rem 0.625rem;
		font-size: var(--t-11);
		letter-spacing: 0.02em;
		color: var(--text-muted);
		border: 1px solid var(--border-base);
		border-radius: var(--r-pill);
		white-space: nowrap;
	}

	.worlds-detail-chip.is-acc {
		color: var(--laurel);
		border-color: color-mix(in srgb, var(--laurel) 30%, var(--border-base));
	}

	/* ─────────────────────────── identity card */
	.worlds-detail-identity {
		display: grid;
		grid-template-columns: 64px 1fr;
		gap: 0.95rem;
		align-items: center;
		padding: 1rem;
		background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
	}

	.worlds-detail-glyph {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 64px;
		height: 64px;
		font-family: var(--font-display);
		font-style: italic;
		font-weight: 400;
		font-size: var(--t-22, 1.5rem);
		color: var(--text-base);
		background: color-mix(in srgb, var(--laurel) 14%, var(--bg-surface));
		border: 1px solid rgba(0, 0, 0, 0.3);
		border-radius: var(--r-12);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14);
	}

	.worlds-detail-flag {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 64px;
		height: 64px;
		font-size: 2.875rem;
		line-height: 1;
	}

	.worlds-detail-flag :global(.worlds-detail-flag-svg) {
		width: 52px;
		height: 39px;
		border-radius: var(--r-6, 0.375rem);
		object-fit: cover;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
	}

	.worlds-detail-identity-text {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}

	.worlds-detail-identity-eyebrow {
		font-size: var(--t-10);
		letter-spacing: 0.18em;
		color: var(--text-muted);
	}

	.worlds-detail-identity-rank {
		font-size: var(--t-13);
		color: var(--text-muted);
	}

	.worlds-detail-acc {
		color: var(--laurel);
	}

	/* ─────────────────────────── 3-stat grid */
	.worlds-detail-rank-row {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.5rem;
	}

	.worlds-detail-rank-cell {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		padding: 0.6rem 0.4rem;
		background: color-mix(in srgb, var(--bg-surface) 96%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		text-align: center;
	}

	.worlds-detail-rank-cell.is-wc {
		background: color-mix(in srgb, var(--laurel) 6%, var(--bg-surface));
		border-color: color-mix(in srgb, var(--laurel) 30%, var(--border-base));
	}

	.worlds-detail-rank-label {
		max-width: 100%;
		overflow: hidden;
		font-size: var(--t-10);
		letter-spacing: var(--tracking-allcaps);
		color: var(--text-muted);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.worlds-detail-rank-cell.is-wc .worlds-detail-rank-label {
		color: var(--laurel);
	}

	.worlds-detail-rank-value {
		font-size: var(--t-16, 1.05rem);
		font-weight: 700;
		color: var(--text-base);
	}

	.worlds-detail-rank-cell.is-wc .worlds-detail-rank-value {
		color: var(--laurel);
	}

	/* ─────────────────────────── accuracy split */
	.worlds-detail-split {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.85rem 1rem;
		background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
	}

	.row-between {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.worlds-detail-split-eyebrow {
		margin: 0;
		color: var(--text-muted);
	}

	.worlds-detail-split-count {
		font-size: var(--t-10);
		letter-spacing: var(--tracking-allcaps);
		color: var(--laurel);
	}

	.worlds-detail-split-line {
		padding-top: 0.1rem;
	}

	.worlds-detail-split-label {
		font-size: var(--t-11);
		letter-spacing: var(--tracking-allcaps);
		color: var(--text-muted);
	}

	.worlds-detail-split-value {
		font-size: var(--t-13);
		font-weight: 700;
		color: var(--text-base);
	}

	/* ─────────────────────────── champion history */
	.worlds-detail-champions {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.85rem 1rem;
		background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
	}

	.worlds-detail-champions-empty {
		margin: 0;
		font-size: var(--t-12);
		line-height: 1.5;
		color: var(--text-muted);
	}

	.worlds-detail-champions-list {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.worlds-detail-champions-row {
		padding-top: 0.1rem;
	}

	.worlds-detail-champions-month {
		font-size: var(--t-13);
		color: var(--text-base);
	}

	.worlds-detail-champions-acc {
		font-size: var(--t-13);
		font-weight: 700;
	}

	/* ─────────────────────────── empty state (under threshold) */
	.worlds-detail-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 1.5rem;
		text-align: center;
		background: transparent;
		border: 1px dashed color-mix(in srgb, var(--laurel) 22%, var(--border-base));
		border-radius: var(--r-12);
	}

	.worlds-detail-empty-title {
		font-family: var(--font-display);
		font-style: italic;
		font-weight: 400;
		font-size: var(--t-20, 1.25rem);
		color: var(--text-muted);
	}

	.worlds-detail-empty-body {
		margin: 0;
		font-size: var(--t-13);
		line-height: 1.5;
		color: var(--text-muted);
	}

	.worlds-detail-empty-body :global(b) {
		color: var(--text-base);
	}

	.worlds-detail-empty-cta {
		appearance: none;
		margin-top: 0.5rem;
		padding: 0.5rem 1rem;
		font: inherit;
		font-size: var(--t-12);
		font-weight: 700;
		color: var(--laurel);
		background: transparent;
		border: 1px solid color-mix(in srgb, var(--laurel) 35%, var(--border-base));
		border-radius: var(--r-pill);
		cursor: pointer;
	}

	.worlds-detail-empty-cta:hover {
		background: color-mix(in srgb, var(--laurel) 6%, transparent);
	}

	/* ─────────────────────────── standings CTA */
	.worlds-detail-cta {
		appearance: none;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.85rem;
		padding: 0.95rem 1rem;
		font: inherit;
		color: var(--text-base);
		background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		cursor: pointer;
		transition:
			background 140ms ease,
			border-color 140ms ease;
	}

	.worlds-detail-cta:hover {
		background: color-mix(in srgb, var(--bg-surface) 60%, transparent);
		border-color: color-mix(in srgb, var(--laurel) 30%, var(--border-base));
	}

	.worlds-detail-cta-text {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		text-align: left;
	}

	.worlds-detail-cta-eyebrow {
		color: var(--laurel);
	}

	.worlds-detail-cta-label {
		font-size: var(--t-14);
		font-weight: 600;
	}

	.worlds-detail-error {
		margin: 0;
		padding: 0.85rem 1rem;
		font-size: var(--t-13);
		color: var(--no);
		background: color-mix(in srgb, var(--no-wash, var(--no)) 14%, transparent);
		border: 1px solid color-mix(in srgb, var(--no) 35%, var(--border-base));
		border-radius: var(--r-12);
	}

	.worlds-detail-flow-link {
		appearance: none;
		align-self: center;
		padding: 0.5rem 1rem;
		font: inherit;
		font-family: var(--font-mono, var(--font-sans));
		font-size: var(--t-10);
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--text-muted);
		background: none;
		border: 0;
		cursor: pointer;
	}

	.worlds-detail-flow-link:hover {
		color: var(--laurel);
	}
</style>
