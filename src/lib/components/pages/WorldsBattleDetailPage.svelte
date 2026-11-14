<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import { onMount } from 'svelte';
	import ScreenHeader from '#lib/components/layout/ScreenHeader.svelte';
	import CountryFlag from '#lib/components/ui/CountryFlag.svelte';
	import { hasCountryFlag } from '#lib/constants/country-flags.constants.ts';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { VXP_WORLDS_PODIUM } from '#lib/constants/vxp-economy.constants.ts';
	import {
		lookupWorldsAffiliation,
		WORLDS_COUNTRIES,
		WORLDS_UNIVERSITIES,
		type WorldsAffiliationOption
	} from '#lib/constants/worlds-affiliations.constants.ts';
	import { daysToFinal } from '#lib/derived/featured-event.derived.ts';
	import { listAffiliationStats } from '#lib/services/worlds.services.ts';
	import { myAffiliationsStore, refreshMyAffiliations } from '#lib/stores/affiliations.store.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { AffiliationStatsDoc } from '#lib/types/affiliation-stats.ts';
	import type { AffiliationKind } from '#lib/types/affiliation.ts';
	import { affiliationDisplayName } from '#lib/utils/affiliation-name.utils.ts';
	import {
		affiliationLifetimeAccuracy,
		affiliationMonthlyAccuracy,
		affiliationRankComparator,
		formatAccuracyPercent
	} from '#lib/utils/affiliation-stats.utils.ts';
	import { formatMonthName } from '#lib/utils/format.utils.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';
	import { goBack, resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	/**
	 * Worlds battle: the full leaderboard surface across every
	 * affiliation of a given `kind` (`university` or `country`).
	 *
	 * Layers in order:
	 *
	 *  1. Hero card: `FIFA WORLD CUP · Live` tags, surface-aware title
	 *     (`Worlds Universities/Countries World Cup Battle` or the
	 *     current month's season battle), days-left + roster size meta.
	 *
	 *  2. Scope toggle: current-month season vs `WC Battle`. Lets users pivot
	 *     between the lifetime / monthly ranking on the same screen.
	 *     Initial scope reads from the `?scope=` query param so deep
	 *     links from `BattlesInboxPage` land on the correct view.
	 *
	 *  3. Full ranked leaderboard: top 10 collapsed, "See all" expands
	 *     to the full roster. When the caller is affiliated and outside
	 *     the visible window, a sticky `is-you` row pins to the bottom.
	 *
	 *  4. Podium prizes: the fixed VXP payouts from `VXP_WORLDS_PODIUM`
	 *     surface as an eyebrow card at the bottom so users learn what
	 *     they're playing for.
	 *
	 * Roster ordering is driven off `listAffiliationStats`. The all-time
	 * (`wc`) totals reflect the current roster's real lifetime: the satellite
	 * sums each member's lifetime record, so an affiliation appears (and ranks
	 * by its members' true history) as soon as that combined lifetime crosses
	 * the ranking floor, even before anyone has traded since joining. The
	 * `month` scope still ranks by the current-month window the rolling stats
	 * doc accrues.
	 */
	interface Props {
		kind: AffiliationKind;
	}

	const { kind }: Props = $props();

	type Scope = 'wc' | 'month';

	const VISIBLE_PREVIEW = 10;

	const roster = $derived(kind === 'university' ? WORLDS_UNIVERSITIES : WORLDS_COUNTRIES);

	const titleKey = $derived<MessageKey>(
		kind === 'university' ? 'worlds.battle.title_university' : 'worlds.battle.title_country'
	);

	const surfaceLabelLedeKey = $derived<MessageKey>(
		kind === 'university' ? 'battles.uni.wc_title_lede' : 'battles.country.wc_title_lede'
	);

	let stats = $state<AffiliationStatsDoc[]>([]);
	let loadState = $state<'loading' | 'ready' | 'error'>('loading');
	let expanded = $state(false);

	// Caller's affiliation for this kind: read from the shared cache so
	// the sticky "you" row survives re-entry without a refetch.
	const myAffil = $derived(
		kind === 'university' ? $myAffiliationsStore.university : $myAffiliationsStore.country
	);

	// Initial scope is sourced off `?scope=month` (the BattlesInbox monthly
	// card link), defaults to `wc` otherwise.
	let scope = $state<Scope>(page.url.searchParams.get('scope') === 'month' ? 'month' : 'wc');

	onMount(async () => {
		void refreshMyAffiliations();

		try {
			stats = await listAffiliationStats({ kind });
			loadState = 'ready';
		} catch {
			loadState = 'error';
		}
	});

	const accForScope = ({ row, scope: sc }: { row: AffiliationStatsDoc; scope: Scope }): number =>
		sc === 'wc' ? affiliationLifetimeAccuracy(row) : affiliationMonthlyAccuracy(row);

	const sortedForScope = $derived.by(() => {
		const list = [...stats];
		const activeScope = scope;

		// Accuracy basis follows the active scope; the tie-break always
		// uses lifetime `totalCalls`.
		list.sort(
			affiliationRankComparator({
				accuracyOf: (row) => accForScope({ row, scope: activeScope }),
				callsOf: (row) => row.totalCalls
			})
		);

		return list;
	});

	const visibleRows = $derived(
		expanded ? sortedForScope : sortedForScope.slice(0, VISIBLE_PREVIEW)
	);

	const myStatsRow = $derived.by(() => {
		const mine = myAffil;

		return mine
			? sortedForScope.find((s) => s.affiliationIdentifier === mine.affiliationIdentifier)
			: undefined;
	});

	const myRank = $derived.by(() => {
		const mine = myAffil;

		return mine
			? sortedForScope.findIndex((s) => s.affiliationIdentifier === mine.affiliationIdentifier) + 1
			: 0;
	});

	const isMyRowVisible = $derived.by(() => {
		const mine = myAffil;

		return mine
			? visibleRows.some((s) => s.affiliationIdentifier === mine.affiliationIdentifier)
			: false;
	});

	const optionFor = (id: string) => lookupWorldsAffiliation({ kind, id });

	// Locale-aware row label off an already-resolved option: country
	// names localize via `Intl.DisplayNames`; falls back to the raw id
	// when the option is off the roster.
	const displayName = ({
		option: opt,
		id
	}: {
		option: WorldsAffiliationOption | undefined;
		id: string;
	}): string =>
		nonNullish(opt) ? affiliationDisplayName({ option: opt, kind, locale: $localeStore }) : id;

	const detailPath = (id: string): string => {
		const segment = kind === 'university' ? 'school' : 'country';

		return `${resolveAppPath(AppPath.Arena)}/worlds/${segment}/${id}`;
	};

	const handleRowNav = (id: string) => {
		void goto(detailPath(id));
	};

	const eventDaysLeft = $derived($daysToFinal);

	// Month-anchored season label: the monthly scope always names the
	// current month rather than a hard-coded one.
	const currentMonthName = $derived(formatMonthName({ locale: $localeStore }));
</script>

<div class="worlds-battle">
	<ScreenHeader
		back={{
			label: t({ locale: $localeStore, key: 'worlds.battle.back' }),
			onBack: () => goBack(`${resolveAppPath(AppPath.Arena)}/worlds`)
		}}
		title={t({ locale: $localeStore, key: titleKey })}
	/>

	{#if loadState === 'loading'}
		<p class="worlds-battle-status" aria-busy="true">
			{t({ locale: $localeStore, key: 'worlds.loading' })}
		</p>
	{:else if loadState === 'error'}
		<p class="worlds-battle-error" role="alert">
			{t({ locale: $localeStore, key: 'worlds.error.generic' })}
		</p>
	{:else}
		<!-- Hero card: tags + surface-aware title + meta line -->
		<section class="worlds-battle-hero" data-scope={scope}>
			<div class="worlds-battle-hero-tags">
				{#if scope === 'wc'}
					<span class="worlds-tag is-wc">
						{t({ locale: $localeStore, key: 'worlds.event.tag_wc' })}
					</span>
					<span class="worlds-tag is-live">
						{t({ locale: $localeStore, key: 'worlds.event.tag_live' })}
					</span>
				{:else}
					<span class="worlds-tag is-monthly">
						{t({
							locale: $localeStore,
							key: 'worlds.battle.tag_monthly',
							params: { month: currentMonthName }
						})}
					</span>
				{/if}
			</div>
			<h3 class="worlds-battle-hero-title">
				{t({ locale: $localeStore, key: surfaceLabelLedeKey })}
				<span class="serif-italic worlds-battle-hero-emph">
					{scope === 'wc'
						? t({ locale: $localeStore, key: 'worlds.event.title_emph' })
						: t({
								locale: $localeStore,
								key: 'worlds.battle.month_emph',
								params: { month: currentMonthName }
							})}
				</span>
				{t({ locale: $localeStore, key: 'worlds.event.title_tail' })}
			</h3>
			<p class="worlds-battle-hero-meta num">
				{#if scope === 'wc' && nonNullish(eventDaysLeft)}
					{t({
						locale: $localeStore,
						key: 'worlds.event.meta',
						params: { days: eventDaysLeft, schools: roster.length }
					})}
				{:else if scope === 'wc'}
					{t({
						locale: $localeStore,
						key: 'worlds.event.meta_archived',
						params: { schools: roster.length }
					})}
				{:else}
					{t({
						locale: $localeStore,
						key: 'worlds.battle.meta_month',
						params: { count: roster.length }
					})}
				{/if}
			</p>
		</section>

		<!-- Scope toggle: WC vs Month -->
		<div class="worlds-battle-scope" aria-label="Battle scope" role="tablist">
			<button
				class:is-active={scope === 'month'}
				aria-selected={scope === 'month'}
				onclick={() => (scope = 'month')}
				role="tab"
				type="button"
			>
				{t({
					locale: $localeStore,
					key: 'worlds.battle.scope_month',
					params: { month: currentMonthName }
				})}
			</button>
			<button
				class:is-active={scope === 'wc'}
				aria-selected={scope === 'wc'}
				onclick={() => (scope = 'wc')}
				role="tab"
				type="button"
			>
				{t({ locale: $localeStore, key: 'worlds.scope.wc' })}
			</button>
		</div>

		<!-- Full leaderboard -->
		<div class="worlds-battle-list">
			{#if visibleRows.length === 0}
				<p class="worlds-battle-empty">
					{t({ locale: $localeStore, key: 'worlds.battle.empty_ranked' })}
				</p>
			{:else}
				{#each visibleRows as row, i (row.affiliationIdentifier)}
					{@const option = optionFor(row.affiliationIdentifier)}
					{@const isYou = myAffil?.affiliationIdentifier === row.affiliationIdentifier}
					<button
						class="worlds-battle-row"
						class:is-you={isYou}
						class:rank-1={i === 0}
						class:rank-2={i === 1}
						class:rank-3={i === 2}
						onclick={() => handleRowNav(row.affiliationIdentifier)}
						type="button"
					>
						<span class="num worlds-battle-rank">{(i + 1).toString().padStart(2, '0')}</span>
						<span class="worlds-battle-glyph" aria-hidden="true">
							{#if kind === 'country' && option && hasCountryFlag(option.id)}
								<CountryFlag class="worlds-battle-flag" countryCode={option.id} />
							{:else if kind === 'country'}
								{option?.glyph ?? '?'}
							{:else}
								{(option?.name ?? row.affiliationIdentifier).charAt(0)}
							{/if}
						</span>
						<div class="worlds-battle-meta">
							<div class="worlds-battle-name">
								{displayName({ option, id: row.affiliationIdentifier })}
								{#if isYou}
									·
									<span class="worlds-battle-you">
										{t({ locale: $localeStore, key: 'worlds.you.suffix' })}
									</span>
								{/if}
							</div>
							<span class="num worlds-battle-sub">
								{t({
									locale: $localeStore,
									key: 'worlds.row.calls',
									params: { calls: row.totalCalls }
								})}
							</span>
						</div>
						<span class="num worlds-battle-pct"
							>{formatAccuracyPercent(accForScope({ row, scope }))}</span
						>
					</button>
				{/each}
			{/if}

			{#if sortedForScope.length > VISIBLE_PREVIEW}
				<button class="worlds-battle-see-all" onclick={() => (expanded = !expanded)} type="button">
					{#if expanded}
						{t({ locale: $localeStore, key: 'worlds.battle.show_top' })}
					{:else}
						{t({
							locale: $localeStore,
							key:
								kind === 'university'
									? 'worlds.battle.see_all_schools'
									: 'worlds.battle.see_all_countries',
							params: { count: sortedForScope.length }
						})}
					{/if}
				</button>
			{/if}

			{#if myAffil && myStatsRow && !isMyRowVisible}
				{@const myOption = optionFor(myAffil.affiliationIdentifier)}
				<div class="worlds-battle-you-sticky" role="status">
					<span class="num worlds-battle-rank">
						{myRank.toString().padStart(2, '0')}
					</span>
					<span class="worlds-battle-glyph is-you" aria-hidden="true">
						{#if kind === 'country' && myOption && hasCountryFlag(myOption.id)}
							<CountryFlag class="worlds-battle-flag" countryCode={myOption.id} />
						{:else if kind === 'country'}
							{myOption?.glyph ?? '?'}
						{:else}
							{(myOption?.name ?? myAffil.affiliationIdentifier).charAt(0)}
						{/if}
					</span>
					<div class="worlds-battle-meta">
						<div class="worlds-battle-name worlds-battle-name-you">
							{displayName({ option: myOption, id: myAffil.affiliationIdentifier })}
							·
							<span class="worlds-battle-you">
								{t({ locale: $localeStore, key: 'worlds.you.suffix' })}
							</span>
						</div>
						<span class="num worlds-battle-sub">
							{t({
								locale: $localeStore,
								key: 'worlds.row.calls',
								params: { calls: myStatsRow.totalCalls }
							})}
						</span>
					</div>
					<span class="num worlds-battle-pct worlds-battle-pct-you">
						{formatAccuracyPercent(accForScope({ row: myStatsRow, scope }))}
					</span>
				</div>
			{/if}
		</div>

		<!-- Podium prizes: fixed VXP payouts for the battle -->
		<section class="worlds-battle-podium" aria-label="Worlds podium prizes">
			<h2 class="eyebrow worlds-battle-section-eyebrow">
				{t({ locale: $localeStore, key: 'worlds.podium.eyebrow' })}
			</h2>
			<div class="worlds-battle-podium-grid">
				<div class="worlds-battle-podium-rung is-gold">
					<span class="allcaps">{t({ locale: $localeStore, key: 'worlds.podium.gold' })}</span>
					<span class="num">+{VXP_WORLDS_PODIUM.gold}</span>
				</div>
				<div class="worlds-battle-podium-rung is-silver">
					<span class="allcaps">{t({ locale: $localeStore, key: 'worlds.podium.silver' })}</span>
					<span class="num">+{VXP_WORLDS_PODIUM.silver}</span>
				</div>
				<div class="worlds-battle-podium-rung is-bronze">
					<span class="allcaps">{t({ locale: $localeStore, key: 'worlds.podium.bronze' })}</span>
					<span class="num">+{VXP_WORLDS_PODIUM.bronze}</span>
				</div>
			</div>
		</section>
	{/if}
</div>

<style lang="postcss">
	.worlds-battle {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 0 1.25rem 6rem;
	}

	.worlds-battle-status,
	.worlds-battle-error {
		margin: 0;
		padding: 1rem;
		font-size: var(--t-13);
		border-radius: var(--r-12);
	}

	.worlds-battle-status {
		color: var(--text-muted);
		background: color-mix(in srgb, var(--bg-surface) 86%, transparent);
		border: 1px solid var(--border-base);
	}

	.worlds-battle-error {
		color: var(--no);
		background: color-mix(in srgb, var(--no-wash, var(--no)) 14%, transparent);
		border: 1px solid color-mix(in srgb, var(--no) 35%, var(--border-base));
	}

	/* Hero: surface-aware tint. WC scope uses the orange WC accent;
	   month scope uses the laurel tone. */
	.worlds-battle-hero {
		position: relative;
		overflow: hidden;
		padding: 0.9rem 1rem;
		background:
			linear-gradient(180deg, color-mix(in srgb, #ff6b2a 14%, transparent), transparent 70%),
			var(--bg-surface);
		border: 1px solid color-mix(in srgb, #ff6b2a 25%, var(--border-base));
		border-radius: var(--r-16, 1rem);
	}

	.worlds-battle-hero[data-scope='month'] {
		background:
			linear-gradient(180deg, color-mix(in srgb, var(--laurel) 14%, transparent), transparent 70%),
			var(--bg-surface);
		border-color: color-mix(in srgb, var(--laurel) 25%, var(--border-base));
	}

	.worlds-battle-hero-tags {
		display: flex;
		gap: 0.35rem;
		margin-bottom: 0.55rem;
	}

	.worlds-tag {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.18rem 0.45rem;
		font-family: var(--font-mono, var(--font-sans));
		font-size: var(--t-10);
		font-weight: 700;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
		border-radius: var(--r-4, 0.25rem);
	}

	.worlds-tag.is-wc {
		background: color-mix(in srgb, #ff6b2a 14%, transparent);
		color: #ff8a4c;
	}

	.worlds-tag.is-live {
		background: color-mix(in srgb, var(--no) 14%, transparent);
		color: var(--no);
	}

	.worlds-tag.is-live::before {
		content: '';
		width: 5px;
		height: 5px;
		border-radius: var(--r-pill);
		background: var(--no);
	}

	.worlds-tag.is-monthly {
		background: color-mix(in srgb, var(--laurel) 14%, transparent);
		color: var(--laurel);
	}

	.worlds-battle-hero-title {
		margin: 0 0 0.25rem;
		font-family: var(--font-sans);
		font-weight: 600;
		font-size: var(--t-17, 1.05rem);
		line-height: 1.2;
		letter-spacing: var(--tracking-snug);
		color: var(--text-base);
	}

	.worlds-battle-hero-emph {
		color: var(--laurel);
		font-weight: 400;
	}

	.worlds-battle-hero-meta {
		margin: 0;
		font-size: var(--t-10);
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}

	/* Scope toggle: mirrors WorldsPage's `worlds-scope`. */
	.worlds-battle-scope {
		display: flex;
		gap: 0.1rem;
		padding: 0.2rem;
		background: color-mix(in srgb, var(--text-base) 4%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-10, 0.625rem);
	}

	.worlds-battle-scope button {
		appearance: none;
		flex: 1;
		padding: 0.5rem 0.35rem;
		font: inherit;
		font-size: var(--t-12);
		font-weight: 500;
		color: var(--text-muted);
		background: transparent;
		border: 0;
		border-radius: var(--r-8, 0.45rem);
		cursor: pointer;
		transition:
			background 180ms ease,
			color 180ms ease;
	}

	.worlds-battle-scope button.is-active {
		color: var(--text-base);
		background: var(--bg-surface);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.16);
	}

	/* Leaderboard list */
	.worlds-battle-list {
		position: relative;
		display: flex;
		flex-direction: column;
	}

	.worlds-battle-empty {
		margin: 0 0 0.5rem;
		padding: 0.85rem 1rem;
		font-size: var(--t-12);
		color: var(--text-muted);
		background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
		border: 1px dashed var(--border-base);
		border-radius: var(--r-12);
	}

	.worlds-battle-row {
		appearance: none;
		display: grid;
		grid-template-columns: 24px 28px 1fr auto;
		gap: 0.6rem;
		align-items: center;
		width: 100%;
		padding: 0.65rem 0.5rem;
		font: inherit;
		text-align: left;
		color: var(--text-base);
		background: transparent;
		border: 0;
		border-bottom: 1px solid var(--border-base);
		cursor: pointer;
	}

	.worlds-battle-row:hover {
		background: color-mix(in srgb, var(--text-base) 3%, transparent);
	}

	.worlds-battle-rank {
		font-size: var(--t-12);
		font-weight: 700;
		text-align: center;
		color: var(--text-muted);
	}

	.worlds-battle-row.rank-1 .worlds-battle-rank {
		color: #e2b842;
	}

	.worlds-battle-row.rank-2 .worlds-battle-rank {
		color: #c0c5cb;
	}

	.worlds-battle-row.rank-3 .worlds-battle-rank {
		color: #b57c52;
	}

	.worlds-battle-glyph {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		font-family: var(--font-display);
		font-style: italic;
		font-size: var(--t-13);
		color: var(--text-base);
		background: color-mix(in srgb, var(--laurel) 14%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-pill);
		overflow: hidden;
	}

	.worlds-battle-glyph :global(.worlds-battle-flag) {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.worlds-battle-meta {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.worlds-battle-name {
		font-size: var(--t-13);
		font-weight: 600;
		letter-spacing: -0.005em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.worlds-battle-sub {
		margin-top: 0.05rem;
		font-size: var(--t-10);
		letter-spacing: var(--tracking-wide);
		color: var(--text-muted);
	}

	.worlds-battle-pct {
		font-size: var(--t-13);
		font-weight: 700;
		text-align: right;
	}

	.worlds-battle-row.rank-1 .worlds-battle-pct {
		color: #e2b842;
	}

	.worlds-battle-row.is-you {
		background: color-mix(in srgb, var(--laurel) 6%, transparent);
	}

	.worlds-battle-row.is-you .worlds-battle-name,
	.worlds-battle-row.is-you .worlds-battle-pct {
		color: var(--laurel);
	}

	.worlds-battle-you {
		color: var(--laurel);
		font-weight: 700;
	}

	.worlds-battle-see-all {
		appearance: none;
		display: block;
		width: 100%;
		padding: 0.85rem 1rem;
		font: inherit;
		font-family: var(--font-mono, var(--font-sans));
		font-size: var(--t-10);
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		text-align: center;
		color: var(--laurel);
		background: transparent;
		border: 0;
		cursor: pointer;
	}

	.worlds-battle-see-all:hover {
		background: color-mix(in srgb, var(--laurel) 4%, transparent);
	}

	/* Sticky YOU when affiliated user is outside the visible window. */
	.worlds-battle-you-sticky {
		position: sticky;
		bottom: calc(96px + env(safe-area-inset-bottom, 0px));
		display: grid;
		grid-template-columns: 24px 28px 1fr auto;
		gap: 0.6rem;
		align-items: center;
		padding: 0.65rem 0.5rem;
		background: var(--bg-surface);
		border-top: 1px solid color-mix(in srgb, var(--laurel) 35%, var(--border-base));
		border-bottom: 1px solid color-mix(in srgb, var(--laurel) 35%, var(--border-base));
		box-shadow: 0 -6px 16px -8px rgba(0, 0, 0, 0.4);
	}

	.worlds-battle-you-sticky .worlds-battle-rank {
		color: var(--laurel);
	}

	.worlds-battle-glyph.is-you {
		background: color-mix(in srgb, var(--laurel) 18%, transparent);
		box-shadow: 0 0 0 1px var(--laurel);
	}

	.worlds-battle-name-you {
		color: var(--laurel);
	}

	.worlds-battle-pct-you {
		color: var(--laurel);
	}

	/* Podium prizes: fixed VXP rungs. */
	.worlds-battle-podium {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.85rem 0.9rem;
		background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
	}

	.worlds-battle-section-eyebrow {
		margin: 0;
		color: var(--text-muted);
	}

	.worlds-battle-podium-grid {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: 0.5rem;
	}

	.worlds-battle-podium-rung {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.2rem;
		padding: 0.55rem 0.45rem;
		border-radius: var(--r-12);
		border: 1px solid var(--border-base);
		background: color-mix(in srgb, var(--bg-surface) 94%, transparent);
		font-size: var(--t-12);
		color: var(--text-muted);
	}

	.worlds-battle-podium-rung .num {
		font-size: var(--t-16, 1rem);
		font-weight: 700;
		color: var(--text-base);
	}

	.worlds-battle-podium-rung.is-gold {
		border-color: color-mix(in srgb, #f4c544 50%, var(--border-base));
		background: color-mix(in srgb, #f4c544 8%, var(--bg-surface));
	}

	.worlds-battle-podium-rung.is-silver {
		border-color: color-mix(in srgb, #c0c5cc 50%, var(--border-base));
		background: color-mix(in srgb, #c0c5cc 8%, var(--bg-surface));
	}

	.worlds-battle-podium-rung.is-bronze {
		border-color: color-mix(in srgb, #c97c4a 50%, var(--border-base));
		background: color-mix(in srgb, #c97c4a 8%, var(--bg-surface));
	}
</style>
