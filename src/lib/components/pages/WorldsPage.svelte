<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import { onMount } from 'svelte';
	import ScreenHeader from '#lib/components/layout/ScreenHeader.svelte';
	import AffiliationPickerModal from '#lib/components/leagues/AffiliationPickerModal.svelte';
	import WorldsAffiliationPrompt from '#lib/components/worlds/WorldsAffiliationPrompt.svelte';
	import WorldsPodiumClaim from '#lib/components/worlds/WorldsPodiumClaim.svelte';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import {
		lookupWorldsAffiliation,
		WORLDS_UNIVERSITIES,
		type WorldsAffiliationOption
	} from '#lib/constants/worlds-affiliations.constants.ts';
	import { daysToFinal } from '#lib/derived/featured-event.derived.ts';
	import {
		claimWorldsPodiumPrize,
		listAffiliationStats,
		listWorldsMemberCounts
	} from '#lib/services/worlds.services.ts';
	import { myAffiliationsStore, refreshMyAffiliations } from '#lib/stores/affiliations.store.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { AffiliationStatsDoc } from '#lib/types/affiliation-stats.ts';
	import { affiliationChipStyle } from '#lib/utils/affiliation-chip.utils.ts';
	import {
		affiliationLifetimeAccuracy,
		affiliationMonthlyAccuracy,
		affiliationRankComparator,
		compareAffiliationByLifetime,
		compareAffiliationByMonth,
		formatAccuracyPercent
	} from '#lib/utils/affiliation-stats.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { previousMonthAnchor } from '#lib/utils/month-anchor.utils.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { goto } from '$app/navigation';

	/**
	 * Worlds: institutional battle surface.
	 *
	 * Layout:
	 *
	 *  1. Optional podium-claim banner: surfaces VXP credits when the
	 *     previous month's snapshot awarded the user.
	 *  2. Affiliation prompt: "Where did you study?" card, shown only
	 *     when the user has no school affiliation. Opens
	 *     `AffiliationPickerModal` on tap.
	 *  3. Hero event card: `FIFA WORLD CUP · Live` tags + WC Battle
	 *     title + top-3 podium tiles (driven by lifetime accuracy on
	 *     `listAffiliationStats({ kind: 'university' })`).
	 *  4. Scope toggle: current month season vs WC Battle (`{N}d left`).
	 *  5. Top-6 leaderboard with school glyph + calls eyebrow. When the
	 *     user is affiliated and outside the visible window, a sticky
	 *     `is-you` row pins to the bottom.
	 *
	 * Note: the per-affiliation `wins/totalCalls` accuracy we project here is
	 * the all-time bucket: the satellite sums the current roster's real
	 * lifetime record, so the "WC" scope ranks by the members' actual history.
	 * The "month" scope ranks by the current-month window the rolling stats
	 * doc accrues.
	 */

	const PODIUM_SIZE = 3;
	const TOP_N = 6;

	type Scope = 'month' | 'wc';

	let stats = $state<AffiliationStatsDoc[]>([]);
	let memberCounts = $state<Record<string, number>>({});
	let loadState = $state<'loading' | 'ready' | 'error'>('loading');
	let errorMessage = $state<string | null>(null);

	let scope = $state<Scope>('wc');
	let expanded = $state(false);
	let pickerKind = $state<'university' | 'country' | null>(null);

	let podiumClaim = $state<{ monthAnchor: string; awardsCreated: number } | null>(null);

	// Caller's affiliations come from the shared cache so re-entering
	// Worlds doesn't blank the "your school" row while a fetch runs. The
	// public school stats stay a per-mount fetch (gated by `loadState`).
	const myUni = $derived($myAffiliationsStore.university);
	const myCountry = $derived($myAffiliationsStore.country);

	const refresh = async () => {
		try {
			const [uniStats, counts] = await Promise.all([
				listAffiliationStats({ kind: 'university' }),
				listWorldsMemberCounts({ kind: 'university' })
			]);
			stats = uniStats;
			memberCounts = counts;
			loadState = 'ready';
		} catch (err) {
			console.error('WorldsPage: refresh failed', err);
			errorMessage = t({ locale: $localeStore, key: 'common.error.generic' });
			loadState = 'error';
		}
	};

	/**
	 * On every Worlds mount, fire a claim for the previous calendar
	 * month's podium. Idempotent: if the user already claimed it (or
	 * wasn't eligible), the server-side fast-path returns cleanly. If
	 * new awards landed, we surface a one-shot toast.
	 *
	 * This is the "scheduled task without a scheduler" pattern: user
	 * visits act as the trigger. Kept across the parity rewrite as
	 * tier C-29: production claim flow has no alternative trigger.
	 */
	const tryClaimPodium = async () => {
		try {
			const monthAnchor = previousMonthAnchor();
			const result = await claimWorldsPodiumPrize({ monthAnchor });

			if (result.awardsCreated > 0) {
				podiumClaim = {
					monthAnchor: result.monthAnchor,
					awardsCreated: result.awardsCreated
				};
			}
		} catch {
			// First visit before any closed month exists, or other
			// transient failure. Silent: claim retries on next mount.
		}
	};

	onMount(async () => {
		void refreshMyAffiliations();
		await refresh();
		void tryClaimPodium();
	});

	const accForScope = ({ row, scope }: { row: AffiliationStatsDoc; scope: Scope }): number =>
		scope === 'wc' ? affiliationLifetimeAccuracy(row) : affiliationMonthlyAccuracy(row);

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

	/**
	 * Top three by WC (lifetime) accuracy, driven by the same data
	 * regardless of the visible scope toggle, because the hero card
	 * always frames the World Cup battle.
	 */
	const wcTop3 = $derived.by(() => {
		const list = [...stats];

		list.sort(compareAffiliationByLifetime);

		return list.slice(0, PODIUM_SIZE);
	});

	const visibleRows = $derived(expanded ? sortedForScope : sortedForScope.slice(0, TOP_N));

	const myAffiliationId = $derived(myUni?.affiliationIdentifier);

	const myRankInScope = $derived(
		myAffiliationId
			? sortedForScope.findIndex((s) => s.affiliationIdentifier === myAffiliationId) + 1
			: 0
	);

	const myStatsRow = $derived(
		myAffiliationId
			? sortedForScope.find((s) => s.affiliationIdentifier === myAffiliationId)
			: undefined
	);

	const isMyRowInVisible = $derived(
		myAffiliationId ? visibleRows.some((s) => s.affiliationIdentifier === myAffiliationId) : false
	);

	const myUniOption = $derived<WorldsAffiliationOption | undefined>(
		myUni
			? lookupWorldsAffiliation({ kind: 'university', id: myUni.affiliationIdentifier })
			: undefined
	);

	const optionFor = (id: string): WorldsAffiliationOption | undefined =>
		lookupWorldsAffiliation({ kind: 'university', id });

	/**
	 * Podium tile background: a top-down wash of the school's own brand
	 * colour fading into the surface, so each tile reads as that school.
	 * Gold (rank 1) layers a faint accent tint underneath; silver/bronze
	 * fade straight to transparent. Falls back to the medal-tinted CSS
	 * default when a school carries no colour.
	 */
	const podiumStyle = ({ color, gold = false }: { color?: string; gold?: boolean }): string => {
		if (!color) {
			return '';
		}

		return gold
			? `background: linear-gradient(180deg, ${color}33, color-mix(in srgb, var(--laurel) 6%, transparent) 70%), var(--bg-surface);`
			: `background: linear-gradient(180deg, ${color}1a, transparent 70%), var(--bg-surface);`;
	};

	/**
	 * Letter-badge styling for a leaderboard row: the school's brand
	 * colour as the fill with its readable foreground. Empty string when
	 * the school has no colour so the CSS laurel default applies.
	 */
	const badgeStyle = (opt: WorldsAffiliationOption | undefined): string =>
		affiliationChipStyle({ color: opt?.color, text: opt?.text });

	/**
	 * Per-school signal for the affiliation picker: real member count
	 * (from `listWorldsMemberCounts`) plus the monthly-accuracy rank when
	 * the school is ranked. Schools with members but no stats doc carry a
	 * count with `monthRank` unset so the picker shows "{N} members"
	 * without a rank.
	 */
	const schoolStats = $derived.by(() => {
		const monthRanked = [...stats].sort(compareAffiliationByMonth);

		const rankById = new Map<string, number>(
			monthRanked.map((row, i) => [row.affiliationIdentifier, i + 1])
		);

		const out: Record<string, { members: number; monthRank?: number }> = {};

		for (const [id, members] of Object.entries(memberCounts)) {
			out[id] = { members, monthRank: rankById.get(id) };
		}

		return out;
	});

	const rosterSize = WORLDS_UNIVERSITIES.length;

	const detailPath = (id: string): string => `${resolveAppPath(AppPath.Arena)}/worlds/school/${id}`;

	const handleRowNav = (id: string) => {
		void goto(detailPath(id));
	};

	const currentMonthName = $derived.by(() => {
		const fmt = new Intl.DateTimeFormat($localeStore, { month: 'long' });

		return fmt.format(new Date());
	});

	const eventDaysLeft = $derived($daysToFinal);
</script>

<div class="worlds-page">
	<ScreenHeader title={t({ locale: $localeStore, key: 'worlds.title' })} />

	{#if podiumClaim}
		<WorldsPodiumClaim
			awardsCreated={podiumClaim.awardsCreated}
			monthAnchor={podiumClaim.monthAnchor}
			onDismiss={() => (podiumClaim = null)}
		/>
	{/if}

	{#if loadState === 'loading'}
		<p class="worlds-status" aria-busy="true">
			{t({ locale: $localeStore, key: 'worlds.loading' })}
		</p>
	{:else if loadState === 'error'}
		<p class="worlds-error" role="alert">
			{errorMessage ?? t({ locale: $localeStore, key: 'worlds.error.generic' })}
		</p>
	{:else}
		{#if !myUni}
			<WorldsAffiliationPrompt onPick={() => (pickerKind = 'university')} />
		{/if}

		<section class="worlds-event" aria-label="World Cup battle">
			<div class="worlds-event-tags">
				<span class="worlds-tag worlds-tag-wc">
					{t({ locale: $localeStore, key: 'worlds.event.tag_wc' })}
				</span>
				<span class="worlds-tag worlds-tag-live">
					{t({ locale: $localeStore, key: 'worlds.event.tag_live' })}
				</span>
			</div>
			<h3 class="worlds-event-title">
				{t({ locale: $localeStore, key: 'worlds.event.title_lede' })}
				<span class="serif-italic worlds-event-title-emph">
					{t({ locale: $localeStore, key: 'worlds.event.title_emph' })}
				</span>
				{t({ locale: $localeStore, key: 'worlds.event.title_tail' })}
			</h3>
			<div class="worlds-event-meta num">
				{#if nonNullish(eventDaysLeft)}
					{t({
						locale: $localeStore,
						key: 'worlds.event.meta',
						params: { days: eventDaysLeft, schools: rosterSize }
					})}
				{:else}
					{t({
						locale: $localeStore,
						key: 'worlds.event.meta_archived',
						params: { schools: rosterSize }
					})}
				{/if}
			</div>
			<div class="worlds-podium">
				{#if wcTop3[1]}
					{@const opt = optionFor(wcTop3[1].affiliationIdentifier)}
					<button
						style={podiumStyle({ color: opt?.color })}
						class="worlds-pod-tile is-silver"
						onclick={() => handleRowNav(wcTop3[1].affiliationIdentifier)}
						type="button"
					>
						<div class="num worlds-pod-place">02</div>
						<div class="worlds-pod-name">{opt?.name ?? wcTop3[1].affiliationIdentifier}</div>
						<div class="num worlds-pod-pct">
							{formatAccuracyPercent(affiliationLifetimeAccuracy(wcTop3[1]))}
						</div>
					</button>
				{/if}
				{#if wcTop3[0]}
					{@const opt = optionFor(wcTop3[0].affiliationIdentifier)}
					<button
						style={podiumStyle({ color: opt?.color, gold: true })}
						class="worlds-pod-tile is-gold"
						onclick={() => handleRowNav(wcTop3[0].affiliationIdentifier)}
						type="button"
					>
						<div class="num worlds-pod-place">01</div>
						<div class="worlds-pod-name">{opt?.name ?? wcTop3[0].affiliationIdentifier}</div>
						<div class="num worlds-pod-pct">
							{formatAccuracyPercent(affiliationLifetimeAccuracy(wcTop3[0]))}
						</div>
					</button>
				{/if}
				{#if wcTop3[2]}
					{@const opt = optionFor(wcTop3[2].affiliationIdentifier)}
					<button
						style={podiumStyle({ color: opt?.color })}
						class="worlds-pod-tile is-bronze"
						onclick={() => handleRowNav(wcTop3[2].affiliationIdentifier)}
						type="button"
					>
						<div class="num worlds-pod-place">03</div>
						<div class="worlds-pod-name">{opt?.name ?? wcTop3[2].affiliationIdentifier}</div>
						<div class="num worlds-pod-pct">
							{formatAccuracyPercent(affiliationLifetimeAccuracy(wcTop3[2]))}
						</div>
					</button>
				{/if}
			</div>
		</section>

		<div class="worlds-scope" aria-label="Leaderboard scope" role="tablist">
			<button
				class:is-active={scope === 'month'}
				aria-selected={scope === 'month'}
				onclick={() => (scope = 'month')}
				role="tab"
				type="button"
			>
				{t({
					locale: $localeStore,
					key: 'worlds.scope.month',
					params: { month: currentMonthName }
				})}
				<span class="worlds-scope-dim">
					· {t({ locale: $localeStore, key: 'worlds.scope.month_sub' })}
				</span>
			</button>
			<button
				class:is-active={scope === 'wc'}
				aria-selected={scope === 'wc'}
				onclick={() => (scope = 'wc')}
				role="tab"
				type="button"
			>
				{t({ locale: $localeStore, key: 'worlds.scope.wc' })}
				<span class="worlds-scope-dim">
					{#if nonNullish(eventDaysLeft)}
						· {t({
							locale: $localeStore,
							key: 'worlds.scope.wc_sub_days',
							params: { days: eventDaysLeft }
						})}
					{:else}
						· {t({ locale: $localeStore, key: 'worlds.scope.wc_sub_archived' })}
					{/if}
				</span>
			</button>
		</div>

		<div class="worlds-list">
			{#if visibleRows.length === 0}
				<p class="worlds-empty">
					{t({ locale: $localeStore, key: 'worlds.battle.empty_ranked' })}
				</p>
			{:else}
				{#each visibleRows as row, i (row.affiliationIdentifier)}
					{@const opt = optionFor(row.affiliationIdentifier)}
					{@const isYou = myUni?.affiliationIdentifier === row.affiliationIdentifier}
					<button
						class="worlds-row"
						class:is-you={isYou}
						class:rank-1={i === 0}
						class:rank-2={i === 1}
						class:rank-3={i === 2}
						onclick={() => handleRowNav(row.affiliationIdentifier)}
						type="button"
					>
						<span class="num worlds-row-rk">{(i + 1).toString().padStart(2, '0')}</span>
						<span style={badgeStyle(opt)} class="worlds-row-em" aria-hidden="true">
							{(opt?.name ?? row.affiliationIdentifier).charAt(0)}
						</span>
						<div class="worlds-row-meta">
							<div class="worlds-row-nm">
								{opt?.name ?? row.affiliationIdentifier}
								{#if isYou}
									· <span class="worlds-row-you">
										{t({ locale: $localeStore, key: 'worlds.you.suffix' })}
									</span>
								{/if}
							</div>
							<span class="num worlds-row-sub">
								{t({
									locale: $localeStore,
									key: 'worlds.row.calls',
									params: { calls: row.totalCalls }
								})}
							</span>
						</div>
						<span class="num worlds-row-pct"
							>{formatAccuracyPercent(accForScope({ row, scope }))}</span
						>
					</button>
				{/each}
			{/if}

			{#if sortedForScope.length > TOP_N}
				<button class="worlds-see-all" onclick={() => (expanded = !expanded)} type="button">
					{#if expanded}
						{t({ locale: $localeStore, key: 'worlds.show_top' })}
					{:else}
						{t({
							locale: $localeStore,
							key: 'worlds.see_all',
							params: { count: sortedForScope.length }
						})}
					{/if}
				</button>
			{/if}

			{#if myUni && myStatsRow && !isMyRowInVisible}
				<div class="worlds-you-sticky" role="status">
					<span class="num worlds-row-rk">
						{myRankInScope.toString().padStart(2, '0')}
					</span>
					<span style={badgeStyle(myUniOption)} class="worlds-row-em is-you" aria-hidden="true">
						{(myUniOption?.name ?? myUni.affiliationIdentifier).charAt(0)}
					</span>
					<div class="worlds-row-meta">
						<div class="worlds-row-nm worlds-row-nm-you">
							{myUniOption?.name ?? myUni.affiliationIdentifier}
							·
							<span class="worlds-row-you">
								{t({ locale: $localeStore, key: 'worlds.you.suffix' })}
							</span>
						</div>
						<span class="num worlds-row-sub">
							{t({
								locale: $localeStore,
								key: 'worlds.row.calls',
								params: { calls: myStatsRow.totalCalls }
							})}
						</span>
					</div>
					<span class="num worlds-row-pct worlds-row-pct-you">
						{formatAccuracyPercent(accForScope({ row: myStatsRow, scope }))}
					</span>
				</div>
			{/if}
		</div>
	{/if}
</div>

{#if nonNullish(pickerKind)}
	<AffiliationPickerModal
		current={{ university: myUni, country: myCountry }}
		isOpen={true}
		kind={pickerKind}
		onClose={() => (pickerKind = null)}
		onPicked={() => {
			pickerKind = null;
			void refreshMyAffiliations();
			void refresh();
		}}
		{schoolStats}
	/>
{/if}

<style lang="postcss">
	.worlds-page {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 0 1.25rem 6rem;
	}

	.worlds-status,
	.worlds-error {
		margin: 0 1rem;
		padding: 1rem;
		font-size: var(--t-13);
		border-radius: var(--r-12);
	}

	.worlds-status {
		color: var(--text-muted);
		background: color-mix(in srgb, var(--bg-surface) 86%, transparent);
		border: 1px solid var(--border-base);
	}

	.worlds-error {
		color: var(--no);
		background: color-mix(in srgb, var(--no-wash, var(--no)) 14%, transparent);
		border: 1px solid color-mix(in srgb, var(--no) 35%, var(--border-base));
	}

	/* ─────────────────────────── claim banner (C-29 keep) */
	/* ─────────────────────────── hero event card */
	.worlds-event {
		position: relative;
		overflow: hidden;
		margin: 0.25rem 1rem 0.25rem;
		padding: 0.9rem;
		background:
			linear-gradient(180deg, color-mix(in srgb, var(--laurel) 12%, transparent), transparent 70%),
			var(--bg-surface);
		border: 1px solid color-mix(in srgb, var(--laurel) 25%, var(--border-base));
		border-radius: var(--r-16, 1rem);
	}

	.worlds-event::after {
		content: '';
		position: absolute;
		inset: 0;
		background: radial-gradient(
			320px 200px at 100% 0%,
			color-mix(in srgb, #ff6b2a 18%, transparent),
			transparent 60%
		);
		pointer-events: none;
	}

	.worlds-event-tags {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin-bottom: 0.5rem;
		position: relative;
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

	.worlds-tag-wc {
		background: color-mix(in srgb, #ff6b2a 14%, transparent);
		color: #ff8a4c;
	}

	.worlds-tag-live {
		background: color-mix(in srgb, var(--no) 14%, transparent);
		color: var(--no);
	}

	.worlds-tag-live::before {
		content: '';
		width: 5px;
		height: 5px;
		border-radius: var(--r-pill);
		background: var(--no);
		animation: worlds-pulse 1.6s infinite;
	}

	@keyframes worlds-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.3;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.worlds-tag-live::before {
			animation: none;
		}
	}

	.worlds-event-title {
		position: relative;
		margin: 0 0 0.25rem;
		font-family: var(--font-sans);
		font-weight: 600;
		font-size: var(--t-17, 1.05rem);
		line-height: 1.2;
		letter-spacing: var(--tracking-snug);
		text-wrap: balance;
		color: var(--text-base);
	}

	.worlds-event-title-emph {
		color: var(--laurel);
		font-weight: 400;
	}

	.worlds-event-meta {
		position: relative;
		margin-bottom: 0.75rem;
		font-size: var(--t-10);
		color: var(--text-muted);
		letter-spacing: 0.06em;
		text-transform: none;
	}

	.worlds-podium {
		position: relative;
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: 0.45rem;
	}

	.worlds-pod-tile {
		appearance: none;
		padding: 0.6rem 0.3rem;
		font: inherit;
		text-align: center;
		color: var(--text-base);
		background: var(--bg-surface);
		border: 1px solid var(--border-base);
		border-radius: var(--r-10, 0.6rem);
		cursor: pointer;
		transition:
			transform 100ms ease,
			border-color 180ms ease;
	}

	.worlds-pod-tile:hover {
		transform: translateY(-1px);
		border-color: var(--text-muted);
	}

	.worlds-pod-tile.is-gold {
		border-color: color-mix(in srgb, #e2b842 40%, var(--border-base));
		background:
			linear-gradient(180deg, color-mix(in srgb, #e2b842 14%, transparent), transparent 70%),
			var(--bg-surface);
	}

	.worlds-pod-tile.is-silver {
		background:
			linear-gradient(180deg, color-mix(in srgb, #c0c5cb 14%, transparent), transparent 70%),
			var(--bg-surface);
	}

	.worlds-pod-tile.is-bronze {
		background:
			linear-gradient(180deg, color-mix(in srgb, #b57c52 14%, transparent), transparent 70%),
			var(--bg-surface);
	}

	.worlds-pod-place {
		font-size: var(--t-16, 1rem);
		font-weight: 700;
		letter-spacing: var(--tracking-tight);
		color: var(--text-muted);
	}

	.worlds-pod-tile.is-gold .worlds-pod-place {
		color: #e2b842;
	}

	.worlds-pod-tile.is-silver .worlds-pod-place {
		color: #c0c5cb;
	}

	.worlds-pod-tile.is-bronze .worlds-pod-place {
		color: #b57c52;
	}

	.worlds-pod-name {
		margin-top: 0.2rem;
		font-size: var(--t-11);
		font-weight: 600;
		line-height: 1.2;
		letter-spacing: -0.005em;
	}

	.worlds-pod-pct {
		margin-top: 0.1rem;
		font-size: var(--t-10);
		letter-spacing: var(--tracking-wide);
		color: var(--text-muted);
	}

	.worlds-pod-tile.is-gold .worlds-pod-pct {
		color: #e2b842;
		font-weight: 700;
	}

	/* ─────────────────────────── scope toggle */
	.worlds-scope {
		display: flex;
		gap: 0.1rem;
		margin: 0 1rem;
		padding: 0.2rem;
		background: color-mix(in srgb, var(--text-base) 4%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-10, 0.625rem);
	}

	.worlds-scope button {
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

	.worlds-scope button.is-active {
		color: var(--text-base);
		background: var(--bg-surface);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.16);
	}

	.worlds-scope-dim {
		color: var(--text-muted);
		font-weight: 500;
	}

	/* ─────────────────────────── leaderboard */
	.worlds-list {
		position: relative;
		padding-bottom: 0.5rem;
	}

	.worlds-empty {
		margin: 0 1rem;
		padding: 0.85rem 1rem;
		font-size: var(--t-12);
		color: var(--text-muted);
		background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
		border: 1px dashed var(--border-base);
		border-radius: var(--r-12);
	}

	.worlds-row {
		appearance: none;
		display: grid;
		grid-template-columns: 24px 28px 1fr auto;
		gap: 0.6rem;
		align-items: center;
		width: 100%;
		padding: 0.65rem 1rem;
		font: inherit;
		text-align: left;
		color: var(--text-base);
		background: transparent;
		border: 0;
		border-bottom: 1px solid var(--border-base);
		cursor: pointer;
	}

	.worlds-row:hover {
		background: color-mix(in srgb, var(--text-base) 3%, transparent);
	}

	.worlds-row-rk {
		font-size: var(--t-12);
		font-weight: 700;
		text-align: center;
		color: var(--text-muted);
	}

	.worlds-row.rank-1 .worlds-row-rk {
		color: #e2b842;
	}

	.worlds-row.rank-2 .worlds-row-rk {
		color: #c0c5cb;
	}

	.worlds-row.rank-3 .worlds-row-rk {
		color: #b57c52;
	}

	.worlds-row-em {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		font-family: var(--font-display);
		font-style: italic;
		font-weight: 400;
		font-size: var(--t-13);
		color: var(--text-base);
		background: color-mix(in srgb, var(--laurel) 14%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-pill);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
	}

	.worlds-row-meta {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.worlds-row-nm {
		font-size: var(--t-13);
		font-weight: 600;
		letter-spacing: -0.005em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.worlds-row-sub {
		margin-top: 0.05rem;
		font-size: var(--t-10);
		letter-spacing: var(--tracking-wide);
		color: var(--text-muted);
	}

	.worlds-row-pct {
		font-size: var(--t-13);
		font-weight: 700;
		text-align: right;
	}

	.worlds-row.rank-1 .worlds-row-pct {
		color: #e2b842;
	}

	.worlds-row.is-you {
		background: color-mix(in srgb, var(--laurel) 6%, transparent);
	}

	.worlds-row.is-you .worlds-row-nm,
	.worlds-row.is-you .worlds-row-pct {
		color: var(--laurel);
	}

	.worlds-row.is-you .worlds-row-em {
		box-shadow:
			0 0 0 1px color-mix(in srgb, var(--laurel) 40%, transparent),
			inset 0 1px 0 rgba(255, 255, 255, 0.14);
	}

	.worlds-row-you {
		color: var(--laurel);
		font-weight: 700;
	}

	.worlds-see-all {
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

	.worlds-see-all:hover {
		background: color-mix(in srgb, var(--laurel) 4%, transparent);
	}

	/* ─────────────────────────── sticky YOU */
	.worlds-you-sticky {
		position: sticky;
		bottom: calc(96px + env(safe-area-inset-bottom, 0px));
		display: grid;
		grid-template-columns: 24px 28px 1fr auto;
		gap: 0.6rem;
		align-items: center;
		padding: 0.65rem 1rem;
		background: var(--bg-surface);
		border-top: 1px solid color-mix(in srgb, var(--laurel) 35%, var(--border-base));
		border-bottom: 1px solid color-mix(in srgb, var(--laurel) 35%, var(--border-base));
		box-shadow: 0 -6px 16px -8px rgba(0, 0, 0, 0.4);
	}

	.worlds-you-sticky .worlds-row-rk {
		color: var(--laurel);
	}

	.worlds-row-em.is-you {
		background: color-mix(in srgb, var(--laurel) 18%, transparent);
		box-shadow: 0 0 0 1px var(--laurel);
	}

	.worlds-row-nm-you {
		color: var(--laurel);
	}

	.worlds-row-pct-you {
		color: var(--laurel);
	}
</style>
