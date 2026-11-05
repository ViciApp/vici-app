<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import CountryFlag from '#lib/components/ui/CountryFlag.svelte';
	import {
		lookupWorldsAffiliation,
		type WorldsAffiliationOption
	} from '#lib/constants/worlds-affiliations.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { AffiliationStatsDoc } from '#lib/types/affiliation-stats.ts';
	import { affiliationChipStyle } from '#lib/utils/affiliation-chip.utils.ts';
	import { affiliationDisplayName } from '#lib/utils/affiliation-name.utils.ts';
	import {
		affiliationLifetimeAccuracy,
		affiliationMonthlyAccuracy,
		affiliationRankComparator,
		formatAccuracyPercent
	} from '#lib/utils/affiliation-stats.utils.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';

	/**
	 * Worlds battle card — one card per roster (school / country) that
	 * folds the World Cup event and the monthly Season into a single
	 * surface behind a `World Cup ⇄ Season` scope toggle. Replaces the
	 * earlier twin-card shape (a featured WC card stacked over a compact
	 * monthly card) so each roster reads as one always-live battle the
	 * viewer pivots in place.
	 *
	 * The card owns its own scope ranking: it receives the full roster
	 * `stats` and re-sorts by the active scope's accuracy (lifetime for
	 * `wc`, monthly for `month`) with the shared rank comparator, then
	 * presents the top-3 podium, the viewer's own row when affiliated,
	 * and a `{days}d left` countdown. Tapping the card routes to the
	 * roster's detail surface with the chosen scope so the deep link
	 * lands on the same ranking the viewer was looking at.
	 *
	 * Accuracy basis note: the satellite does not yet write a WC-tagged
	 * sub-bucket, so the `wc` scope ranks by lifetime accuracy and the
	 * `month` scope by monthly accuracy — the same basis the Worlds
	 * detail surface uses.
	 */
	interface Props {
		kind: 'university' | 'country';
		// Full roster stats; the card sorts these per the active scope.
		stats: AffiliationStatsDoc[];
		// Viewer's affiliation identifier, or undefined when unaffiliated.
		myAffiliationIdentifier: string | undefined;
		// Total roster size for the "{rank} of {total}" line and meta.
		total: number;
		// Days left in the WC event, or null when unavailable.
		wcDaysLeft: number | null;
		// Days left in the current month's season.
		monthDaysLeft: number | null;
		// Apply the top separator that divides stacked roster sections.
		divided?: boolean;
		// Open the roster detail surface for the chosen scope.
		onOpen: (scope: 'wc' | 'month') => void;
	}

	const {
		kind,
		stats,
		myAffiliationIdentifier,
		total,
		wcDaysLeft,
		monthDaysLeft,
		divided = false,
		onOpen
	}: Props = $props();

	type Scope = 'wc' | 'month';

	let scope = $state<Scope>('wc');

	const isCountry = $derived(kind === 'country');

	const option = (id: string) => lookupWorldsAffiliation({ kind, id });

	// Locale-aware roster label off an already-resolved option — country
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

	const accForScope = ({ row, scope: sc }: { row: AffiliationStatsDoc; scope: Scope }): number =>
		sc === 'wc' ? affiliationLifetimeAccuracy(row) : affiliationMonthlyAccuracy(row);

	// Ranking follows the active scope's accuracy; the tie-break always
	// uses lifetime `totalCalls`, matching the Worlds detail surface.
	const sortedForScope = $derived.by(() => {
		const activeScope = scope;

		return [...stats].sort(
			affiliationRankComparator({
				accuracyOf: (row) => accForScope({ row, scope: activeScope }),
				callsOf: (row) => row.totalCalls
			})
		);
	});

	const top3 = $derived(sortedForScope.slice(0, 3));

	const myRank = $derived(
		nonNullish(myAffiliationIdentifier)
			? sortedForScope.findIndex((s) => s.affiliationIdentifier === myAffiliationIdentifier) + 1
			: 0
	);

	const myStats = $derived(
		nonNullish(myAffiliationIdentifier)
			? sortedForScope.find((s) => s.affiliationIdentifier === myAffiliationIdentifier)
			: undefined
	);

	const myOption = $derived(
		nonNullish(myAffiliationIdentifier) ? option(myAffiliationIdentifier) : undefined
	);
	const myName = $derived(
		nonNullish(myAffiliationIdentifier)
			? displayName({ option: myOption, id: myAffiliationIdentifier })
			: ''
	);

	const daysLeft = $derived(scope === 'wc' ? wcDaysLeft : monthDaysLeft);

	const eyebrowKey = $derived<MessageKey>(
		isCountry ? 'battles.section.worlds_countries' : 'battles.section.worlds_universities'
	);

	const open = () => onOpen(scope);

	const onCardKeydown = (event: KeyboardEvent) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			open();
		}
	};

	// Podium tile background — a top-down wash of the roster entry's brand
	// colour fading into the surface. Gold (rank 1) layers a faint accent
	// tint underneath; silver/bronze fade straight to transparent. Falls
	// back to the medal-tinted CSS default when the entry has no colour.
	const podiumStyle = ({ color, gold = false }: { color?: string; gold?: boolean }): string => {
		if (!color) {
			return '';
		}

		return gold
			? `background: linear-gradient(180deg, ${color}33, color-mix(in srgb, var(--laurel) 6%, transparent) 70%), var(--bg-surface);`
			: `background: linear-gradient(180deg, ${color}1a, transparent 70%), var(--bg-surface);`;
	};
</script>

<section
	class="battles-section"
	class:is-divided={divided}
	aria-label={t({ locale: $localeStore, key: eyebrowKey })}
>
	<header class="battles-section-head">
		<span class="battles-eyebrow allcaps">
			{t({ locale: $localeStore, key: eyebrowKey })}
		</span>
		{#if nonNullish(myAffiliationIdentifier)}
			{#if isCountry}
				<span class="battles-section-head-meta num allcaps">
					{#if myOption}<CountryFlag class="battles-section-flag" countryCode={myOption.id} />{/if}
					{myName.toUpperCase()}
				</span>
			{:else}
				<span class="battles-section-head-meta num allcaps">
					{t({ locale: $localeStore, key: 'battles.your_school', params: { name: myName } })}
				</span>
			{/if}
		{/if}
	</header>

	<div
		class="battles-card"
		aria-label={t({ locale: $localeStore, key: 'battles.card.open_standings_aria' })}
		onclick={open}
		onkeydown={onCardKeydown}
		role="button"
		tabindex="0"
	>
		<div class="battles-card-head">
			<div class="battles-card-tags">
				<span class="battles-tag is-live">
					{t({ locale: $localeStore, key: 'worlds.event.tag_live' })}
				</span>
			</div>
			<!-- The scope toggle lives inside the tappable card, so each
			     toggle button stops propagation to avoid also opening the
			     detail surface. -->
			<div class="bout-scope-toggle" role="group">
				<button
					class:is-on={scope === 'wc'}
					aria-pressed={scope === 'wc'}
					onclick={(event) => {
						event.stopPropagation();
						scope = 'wc';
					}}
					type="button"
				>
					{t({ locale: $localeStore, key: 'battles.scope.world_cup' })}
				</button>
				<button
					class:is-on={scope === 'month'}
					aria-pressed={scope === 'month'}
					onclick={(event) => {
						event.stopPropagation();
						scope = 'month';
					}}
					type="button"
				>
					{t({ locale: $localeStore, key: 'battles.scope.season' })}
				</button>
			</div>
		</div>

		<p class="battles-card-meta">
			{scope === 'wc'
				? t({ locale: $localeStore, key: 'battles.card.scope_meta_wc' })
				: t({ locale: $localeStore, key: 'battles.card.scope_meta_month' })}
			·
			{isCountry
				? t({ locale: $localeStore, key: 'battles.card.count_nations', params: { count: total } })
				: t({
						locale: $localeStore,
						key: 'battles.card.count_schools',
						params: { count: total }
					})}
			{#if nonNullish(daysLeft)}
				· {t({ locale: $localeStore, key: 'battles.card.days_left', params: { days: daysLeft } })}
			{/if}
		</p>

		{#if top3.length > 0}
			<div class="battles-podium">
				{#if top3[1]}
					{@const opt = option(top3[1].affiliationIdentifier)}
					<div style={podiumStyle({ color: opt?.color })} class="battles-pod-tile is-silver">
						<div class="num battles-pod-place">02</div>
						<div class="battles-pod-name">
							{#if isCountry && opt}<CountryFlag
									class="battles-pod-flag"
									countryCode={opt.id}
								/>{/if}
							{displayName({ option: opt, id: top3[1].affiliationIdentifier })}
						</div>
						<div class="num battles-pod-pct">
							{formatAccuracyPercent(accForScope({ row: top3[1], scope }))}
						</div>
					</div>
				{/if}
				{#if top3[0]}
					{@const opt = option(top3[0].affiliationIdentifier)}
					<div
						style={podiumStyle({ color: opt?.color, gold: true })}
						class="battles-pod-tile is-gold"
					>
						<div class="num battles-pod-place">01</div>
						<div class="battles-pod-name">
							{#if isCountry && opt}<CountryFlag
									class="battles-pod-flag"
									countryCode={opt.id}
								/>{/if}
							{displayName({ option: opt, id: top3[0].affiliationIdentifier })}
						</div>
						<div class="num battles-pod-pct">
							{formatAccuracyPercent(accForScope({ row: top3[0], scope }))}
						</div>
					</div>
				{/if}
				{#if top3[2]}
					{@const opt = option(top3[2].affiliationIdentifier)}
					<div style={podiumStyle({ color: opt?.color })} class="battles-pod-tile is-bronze">
						<div class="num battles-pod-place">03</div>
						<div class="battles-pod-name">
							{#if isCountry && opt}<CountryFlag
									class="battles-pod-flag"
									countryCode={opt.id}
								/>{/if}
							{displayName({ option: opt, id: top3[2].affiliationIdentifier })}
						</div>
						<div class="num battles-pod-pct">
							{formatAccuracyPercent(accForScope({ row: top3[2], scope }))}
						</div>
					</div>
				{/if}
			</div>
		{/if}

		{#if nonNullish(myAffiliationIdentifier) && myStats}
			<div class="battles-your-row">
				<span
					style={isCountry
						? ''
						: affiliationChipStyle({ color: myOption?.color, text: myOption?.text })}
					class="battles-your-em"
					aria-hidden="true"
				>
					{#if isCountry}
						{#if myOption}<CountryFlag class="battles-your-flag" countryCode={myOption.id} />{/if}
					{:else}
						{myName.charAt(0)}
					{/if}
				</span>
				<span class="battles-your-text">
					<b>{myName}</b>
					·
					{t({ locale: $localeStore, key: 'battles.your_rank', params: { rank: myRank, total } })}
				</span>
				<span class="num battles-your-pct">
					{formatAccuracyPercent(accForScope({ row: myStats, scope }))}
				</span>
			</div>
		{:else}
			<p class="battles-card-meta is-pick">
				{isCountry
					? t({ locale: $localeStore, key: 'battles.country.month_pick', params: { count: total } })
					: t({ locale: $localeStore, key: 'battles.uni.month_pick', params: { count: total } })}
			</p>
		{/if}

		<span class="battles-see-all allcaps">
			{t({ locale: $localeStore, key: 'battles.see_full_standings' })}
		</span>
	</div>
</section>

<style lang="postcss">
	/* ─── section ────────────────────────────────────────────── */
	.battles-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	/* Separator between stacked roster sections — a hairline rule with a
	   short centered golden accent line riding the top edge. */
	.battles-section.is-divided {
		position: relative;
		margin-top: 28px;
		padding-top: 20px;
		border-top: 1px solid var(--border-base);
	}

	.battles-section.is-divided::before {
		content: '';
		position: absolute;
		top: -1px;
		left: 50%;
		transform: translateX(-50%);
		width: 48px;
		height: 1px;
		background: var(--laurel);
		opacity: 0.5;
	}

	.battles-section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		margin-bottom: 0.1rem;
	}

	.battles-eyebrow {
		font-family: var(--font-mono);
		font-size: var(--t-10);
		letter-spacing: 0.16em;
		color: var(--text-muted);
	}

	.battles-section-head-meta {
		font-size: var(--t-10);
		letter-spacing: 0.08em;
		color: var(--text-muted);
	}

	/* ─── grouped card ───────────────────────────────────────── */
	.battles-card {
		appearance: none;
		display: block;
		width: 100%;
		padding: 0.9rem;
		font: inherit;
		text-align: left;
		color: var(--text-base);
		background:
			linear-gradient(180deg, color-mix(in srgb, var(--laurel) 10%, transparent), transparent 70%),
			var(--bg-surface);
		border: 1px solid color-mix(in srgb, var(--laurel) 22%, var(--border-base));
		border-radius: var(--r-14, 0.85rem);
		cursor: pointer;
		transition: border-color 160ms ease;
	}

	.battles-card:hover {
		border-color: color-mix(in srgb, var(--laurel) 38%, var(--border-base));
	}

	.battles-card:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--color-primary) 55%, transparent);
		outline-offset: 2px;
	}

	.battles-card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.4rem;
	}

	.battles-card-tags {
		display: inline-flex;
		gap: 0.3rem;
	}

	.battles-tag {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.15rem 0.4rem;
		font-family: var(--font-mono, var(--font-sans));
		font-size: var(--t-10);
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		border-radius: var(--r-4, 0.25rem);
	}

	.battles-tag.is-live {
		background: color-mix(in srgb, var(--no) 14%, transparent);
		color: var(--no);
	}

	.battles-tag.is-live::before {
		content: '';
		width: 5px;
		height: 5px;
		border-radius: var(--r-pill);
		background: var(--no);
		animation: battles-live-pulse 1.6s infinite;
	}

	@keyframes battles-live-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.3;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.battles-tag.is-live::before {
			animation: none;
		}
	}

	/* ─── scope toggle ───────────────────────────────────────── */
	.bout-scope-toggle {
		display: inline-flex;
		gap: 2px;
		flex: none;
		padding: 2px;
		background: color-mix(in srgb, var(--text-base) 4%, transparent);
		border: 1px solid var(--border-base);
		border-radius: 7px;
	}

	.bout-scope-toggle button {
		appearance: none;
		padding: 0.3rem 0.55rem;
		font-family: var(--font-mono, var(--font-sans));
		font-size: var(--t-10);
		letter-spacing: 0.03em;
		white-space: nowrap;
		color: var(--text-muted);
		background: none;
		border: 0;
		border-radius: 5px;
		cursor: pointer;
		transition:
			background 160ms ease,
			color 160ms ease;
	}

	.bout-scope-toggle button.is-on {
		color: var(--text-base);
		background: var(--bg-surface);
	}

	.bout-scope-toggle button:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--color-primary) 55%, transparent);
		outline-offset: 1px;
	}

	.battles-card-meta {
		margin: 0 0 0.6rem;
		font-family: var(--font-mono);
		font-size: var(--t-10);
		color: var(--text-muted);
		letter-spacing: var(--tracking-wide);
	}

	.battles-card-meta.is-pick {
		margin-top: 0.3rem;
		margin-bottom: 0;
	}

	/* ─── podium ─────────────────────────────────────────────── */
	.battles-podium {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: 0.4rem;
		margin-bottom: 0.6rem;
	}

	.battles-pod-tile {
		padding: 0.55rem 0.3rem;
		text-align: center;
		background: var(--bg-surface);
		border: 1px solid var(--border-base);
		border-radius: var(--r-10, 0.6rem);
		transition:
			transform 100ms ease,
			border-color 180ms ease;
	}

	.battles-pod-tile:hover {
		border-color: var(--border-strong, var(--border-base));
		transform: translateY(-1px);
	}

	@media (prefers-reduced-motion: reduce) {
		.battles-pod-tile {
			transition: border-color 180ms ease;
		}

		.battles-pod-tile:hover {
			transform: none;
		}
	}

	.battles-pod-tile.is-gold {
		background:
			linear-gradient(
				180deg,
				color-mix(in srgb, #e2b842 20%, transparent),
				color-mix(in srgb, #e2b842 6%, transparent) 70%
			),
			var(--bg-surface);
		border-color: color-mix(in srgb, #e2b842 40%, var(--border-base));
	}

	.battles-pod-tile.is-silver {
		background:
			linear-gradient(180deg, color-mix(in srgb, #c0c5cb 14%, transparent), transparent 70%),
			var(--bg-surface);
	}

	.battles-pod-tile.is-bronze {
		background:
			linear-gradient(180deg, color-mix(in srgb, #b57c52 14%, transparent), transparent 70%),
			var(--bg-surface);
	}

	.battles-pod-place {
		font-size: var(--t-10);
		font-weight: 700;
		color: var(--text-muted);
	}

	.battles-pod-tile.is-gold .battles-pod-place {
		color: #e2b842;
	}

	.battles-pod-tile.is-silver .battles-pod-place {
		color: #c0c5cb;
	}

	.battles-pod-tile.is-bronze .battles-pod-place {
		color: #b57c52;
	}

	.battles-pod-name {
		margin-top: 0.18rem;
		font-size: var(--t-11);
		font-weight: 600;
		line-height: 1.2;
		overflow: hidden;
		text-overflow: ellipsis;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
	}

	.battles-pod-pct {
		margin-top: 0.1rem;
		font-size: var(--t-10);
		letter-spacing: var(--tracking-wide);
		color: var(--text-muted);
	}

	.battles-pod-tile.is-gold .battles-pod-pct {
		color: #e2b842;
		font-weight: 700;
	}

	/* ─── your-row inside grouped card ──────────────────────── */
	.battles-your-row {
		display: grid;
		grid-template-columns: 24px 1fr auto;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.6rem;
		background: color-mix(in srgb, var(--laurel) 6%, transparent);
		border: 1px solid color-mix(in srgb, var(--laurel) 18%, var(--border-base));
		border-radius: var(--r-10, 0.6rem);
	}

	.battles-your-em {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		font-family: var(--font-display);
		font-style: italic;
		font-size: var(--t-13);
		color: var(--text-base);
		background: color-mix(in srgb, var(--laurel) 14%, transparent);
		border-radius: var(--r-pill);
	}

	.battles-your-text {
		font-size: var(--t-12);
		color: var(--text-base);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.battles-your-pct {
		font-size: var(--t-13);
		font-weight: 700;
		color: var(--laurel);
	}

	/* ─── see-all ───────────────────────────────────────────── */
	.battles-see-all {
		display: block;
		margin-top: 0.55rem;
		font-family: var(--font-mono, var(--font-sans));
		font-size: var(--t-10);
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--laurel);
	}
</style>
