<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { Plus } from '@lucide/svelte/icons';
	import { onMount } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import ScreenHeader from '#lib/components/layout/ScreenHeader.svelte';
	import CreateLeagueModal from '#lib/components/leagues/CreateLeagueModal.svelte';
	import JoinLeagueModal from '#lib/components/leagues/JoinLeagueModal.svelte';
	import LeagueCtaCard from '#lib/components/leagues/LeagueCtaCard.svelte';
	import LeagueListCard from '#lib/components/leagues/LeagueListCard.svelte';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { authPrincipal } from '#lib/derived/user.derived.ts';
	import { settleFounderAwards, type LeagueWithRole } from '#lib/services/leagues.services.ts';
	import { findOwnStanding, getLeagueStandings } from '#lib/services/standings.services.ts';
	import { friendsListStore, refreshFriendRelations } from '#lib/stores/friends.store.ts';
	import {
		friendRecommendedLeaguesStore,
		leagueBattlesStore,
		leagueMembersStore,
		leaguesErrorStore,
		leaguesLoadedStore,
		myLeaguesStore,
		refreshMyLeagues
	} from '#lib/stores/leagues.store.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { profilesStore } from '#lib/stores/profiles.store.ts';
	import type { LeagueMemberDoc } from '#lib/types/league-member.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { leagueRankOf, rankLeagueMembers } from '#lib/utils/league-rank.utils.ts';
	import { goBack, resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { refreshAllBalances } from '#lib/utils/refresh.utils.ts';
	import { goto } from '$app/navigation';

	/**
	 * Social cohorts list page.
	 *
	 * Mounted inside the Arena tab container. Lists every league
	 * the caller is a member of via `listMyLeagues`, split into
	 * "founded" (the caller is the owner) and "joined" (everyone
	 * else). Each row carries a gradient logo tile, the league name
	 * + role chip, a member-count meta line (with an optional weekly
	 * rank-trend), an optional friend-overlap row when any of the
	 * viewer's friends are in the league, a trailing "#rank of M"
	 * badge, and an inline copy-invite pill.
	 *
	 * The Create + Join entries live in a trailing "Start or join"
	 * CTA grid — never as a top-of-list pill row.
	 */

	interface Props {
		// When true, hide the page's own appbar — the container is
		// expected to render one (e.g. the tabbed Arena parent).
		embedded?: boolean;
	}

	const { embedded = false }: Props = $props();

	interface LeagueRow extends LeagueWithRole {
		memberCount: number;
		members: string[];
		// Full roster docs (with join timestamps) kept alongside the flat
		// `members` principal list so the card can rank by accuracy through
		// the shared helper, with join order as the stable tie-breaker.
		roster: LeagueMemberDoc[];
	}

	let createOpen = $state(false);
	let joinOpen = $state(false);

	const selfPrincipal = $derived($authPrincipal);

	// Stale-while-revalidate: render whatever the shared leagues cache
	// holds and kick a background refresh on every mount. The skeleton
	// only shows on the cold load (before the first refresh resolves);
	// re-entering Arena → Leagues paints the cached list instantly.
	onMount(() => {
		void refreshMyLeagues();
		void refreshFriendRelations();
	});

	const loadState = $derived.by<'loading' | 'ready' | 'error'>(() => {
		if ($leaguesLoadedStore) {
			return 'ready';
		}

		return $leaguesErrorStore ? 'error' : 'loading';
	});

	// Build the per-league rows from the shared cache. Each row pulls its
	// roster from the per-league map the store hydrated; a league still
	// missing from the map falls back to an empty roster.
	const rows = $derived.by<LeagueRow[]>(() =>
		$myLeaguesStore.map((m) => {
			const roster = $leagueMembersStore.get(m.league.id) ?? [];
			const members = roster.map((r) => r.member);

			return {
				...m,
				memberCount: members.length,
				members,
				roster
			} satisfies LeagueRow;
		})
	);

	const friendPrincipals = $derived.by(() => {
		const me = selfPrincipal;
		const set = new SvelteSet<string>();

		for (const relation of $friendsListStore) {
			const other = relation.participants.find((p) => p !== me);

			if (other) {
				set.add(other);
			}
		}

		return set;
	});

	const founded = $derived(rows.filter((r) => r.role === 'owner'));
	const joined = $derived(rows.filter((r) => r.role !== 'owner'));

	// Retroactively back-pay the "Founder +100 VXP" reward for any league
	// the caller founded before the founder-award hook shipped. Gated on the
	// loaded list actually containing an owned league — so a member who never
	// founded one makes no (state-changing) update call — and fired at most
	// once per mount. Idempotent server-side; refresh balances only when
	// something was newly settled so the credit shows without a reload.
	let founderSettleTried = false;

	$effect(() => {
		if (founderSettleTried || founded.length === 0) {
			return;
		}

		founderSettleTried = true;

		void settleFounderAwards().then((settled) => {
			if (settled > 0) {
				refreshAllBalances();
			}
		});
	});

	// "Friends are in" — public leagues the caller's confirmed friends are
	// in but the caller is not. Capped so the row stays a discovery nudge
	// at the foot of the list, not a directory.
	const FRIEND_RECS_LIMIT = 5;
	const recommendations = $derived($friendRecommendedLeaguesStore.slice(0, FRIEND_RECS_LIMIT));

	/**
	 * For each league, derive a friend-overlap summary using the
	 * `friendPrincipals` set + the prefetched profile cache. Falls
	 * back to a truncated principal text when no profile/nickname
	 * is cached yet.
	 */
	const friendOverlapFor = (
		row: LeagueRow
	): { handle: string; count: number; principals: string[] } | undefined =>
		friendOverlapFromPrincipals(row.members.filter((m) => friendPrincipals.has(m)));

	/**
	 * Build a friend-overlap summary from an already-resolved list of
	 * friend principals (the league members who are friends of the
	 * viewer). Shared by the membership cards (which derive the overlap
	 * from the full roster) and the recommendation cards (where the
	 * satellite already returns the overlap directly).
	 */
	const friendOverlapFromPrincipals = (
		overlap: string[]
	): { handle: string; count: number; principals: string[] } | undefined => {
		if (overlap.length === 0) {
			return;
		}

		const [first] = overlap;
		const profile = $profilesStore.get(first);
		const nickname = profile?.nickname?.trim();
		// Prefix the highlighted handle with `@` ("<b>@handle</b> +
		// N friends") for nicknamed members. Anonymous principals
		// stay un-prefixed.
		const handle = nickname && nickname.length > 0 ? `@${nickname}` : `${first.slice(0, 6)}…`;

		return { handle, count: overlap.length, principals: overlap };
	};

	// Per-member stats for the accuracy ranking, read from the shared profile
	// cache (`refreshMyLeagues` hydrates every roster member). Both default to
	// 0 until the profile lands, matching the league detail page.
	const memberAccuracy = (principal: string): number =>
		$profilesStore.get(principal)?.accuracy ?? 0;

	const memberStreak = (principal: string): number =>
		$profilesStore.get(principal)?.dailyStreak ?? 0;

	/**
	 * Caller's 1-indexed rank per league — the same accuracy-first ranking the
	 * detail page and its leaderboard use, so the card badge agrees with both.
	 * Computed once per (rows, viewer, profile-cache) change rather than per
	 * card render: the page re-renders for unrelated reactive churn (trend
	 * resolution, modal toggles), and re-sorting every roster each time is
	 * wasted O(n log n). Leagues where the caller isn't in the (still-
	 * hydrating) roster are absent, so the badge is hidden rather than wrong.
	 */
	const yourRankByLeague = $derived.by(() => {
		const ranks = new SvelteMap<string, number>();

		for (const row of rows) {
			const rank = leagueRankOf({
				sorted: rankLeagueMembers({
					members: row.roster,
					accuracyOf: memberAccuracy,
					streakOf: memberStreak
				}),
				principal: selfPrincipal
			});

			if (nonNullish(rank)) {
				ranks.set(row.league.id, rank);
			}
		}

		return ranks;
	});

	const yourRankFor = (row: LeagueRow): number | undefined => yourRankByLeague.get(row.league.id);

	/**
	 * Per-league rank-trend for the viewer, keyed by league id. Sourced from
	 * the clearing canister's weekly `list_leaderboard` ranking over each
	 * league's own roster: the sign of the viewer's own week-over-week rank
	 * movement (`rankDelta = priorRank - rank`). A league the viewer has no
	 * prior-week rank in (newcomer / no settled position) carries no entry, so
	 * the card shows no arrow rather than a fabricated one.
	 */
	const leagueTrends = new SvelteMap<string, number>();
	// The principal the `leagueTrends` cache was computed for. Trends are
	// viewer-specific, so on a viewer change (sign-out → sign-in, account
	// switch without a reload) the cache is dropped and recomputed.
	let trendsOwner: string | undefined;

	// Resolve each membership's weekly rank-trend in isolation, once a roster
	// is known. `getLeagueStandings` ranks the supplied member set against the
	// week window; we keep only the sign of the viewer's own `rankDelta` and
	// map it onto the card's convention (negative = climbed, shown as ↑).
	$effect(() => {
		const owner = selfPrincipal;

		if (isNullish(owner)) {
			return;
		}

		// New viewer → discard the previous viewer's cached trends so the
		// arrows are never computed for the wrong principal.
		if (owner !== trendsOwner) {
			trendsOwner = owner;
			leagueTrends.clear();
		}

		const pending = rows.filter(
			(row) => row.members.length > 0 && !leagueTrends.has(row.league.id)
		);

		for (const row of pending) {
			const { id } = row.league;
			const { members } = row;

			// Mark this league resolved the moment its query is scheduled
			// (default 0 = no arrow), so a reactive re-run before the request
			// settles never re-fires the same query. A real prior-week delta
			// overwrites the 0 below; leagues with no comparable prior week
			// simply keep it.
			leagueTrends.set(id, 0);

			void getLeagueStandings({ window: 'week', members })
				.then((result) => {
					const own = findOwnStanding({ result, owner });
					const delta = own?.rankDelta;

					// `rankDelta` is `priorRank - rank` (positive = climbed); the
					// card's `trend` inverts that (negative = climbed). Leave the
					// 0 (no arrow) when there is no comparable prior week.
					if (nonNullish(delta)) {
						leagueTrends.set(id, -delta);
					}
				})
				.catch((err: unknown) => {
					console.error(err);
				});
		}
	});

	// The card's `trend` value for a league — 0 (no arrow) until its weekly
	// standing has resolved a comparable prior-week rank for the viewer.
	const trendFor = (row: LeagueRow): number => leagueTrends.get(row.league.id) ?? 0;

	// Count of incoming, not-yet-accepted challenges where this league is the
	// challenged side (`sideB`). Surfaces a chip on owned cards so the challenge
	// is visible without opening the league. Read from the same per-league
	// battle list the detail page renders, so it stays in sync after a refresh.
	const incomingChallengesFor = (row: LeagueRow): number =>
		($leagueBattlesStore.get(row.league.id) ?? []).filter(
			(b) => b.state === 'proposed' && b.sideB === row.league.id
		).length;

	const openCreate = () => {
		createOpen = true;
	};

	const openJoin = () => {
		joinOpen = true;
	};

	const handleAfterAction = () => {
		createOpen = false;
		joinOpen = false;
		void refreshMyLeagues();
	};

	const handleCardClick = (leagueId: string) => {
		void goto(`${resolveAppPath(AppPath.Arena)}/leagues/${leagueId}`);
	};
</script>

{#snippet leaguesCreateAction()}
	<button
		class="appbar-icon-btn"
		aria-label={t({ locale: $localeStore, key: 'leagues.create.cta' })}
		onclick={openCreate}
		type="button"
	>
		<Plus aria-hidden="true" size={18} strokeWidth={1.8} />
	</button>
{/snippet}

<div class="leagues-page pb-24" class:embedded>
	{#if !embedded}
		<ScreenHeader
			back={{
				label: t({ locale: $localeStore, key: 'leagues.back' }),
				onBack: () => goBack(resolveAppPath(AppPath.Arena))
			}}
			right={leaguesCreateAction}
			title={t({ locale: $localeStore, key: 'leagues.title' })}
		/>
	{/if}

	{#if loadState === 'loading'}
		<ul class="leagues-list" aria-busy="true">
			{#each Array.from({ length: 3 }) as _, i (i)}
				<li class="league-card-skeleton" aria-hidden="true"></li>
			{/each}
		</ul>
	{:else if loadState === 'error'}
		<p class="leagues-error" role="alert">
			{t({ locale: $localeStore, key: 'leagues.error.generic' })}
		</p>
	{:else if rows.length === 0}
		<section class="leagues-empty">
			<p class="leagues-empty-quote">
				{t({ locale: $localeStore, key: 'leagues.empty.quote' })}
			</p>
			<p class="leagues-empty-body">
				{t({ locale: $localeStore, key: 'leagues.empty.body' })}
			</p>
			<div class="leagues-empty-ctas">
				<button class="leagues-empty-cta is-primary" onclick={openCreate} type="button">
					{t({ locale: $localeStore, key: 'leagues.empty.cta_create' })}
				</button>
				<button class="leagues-empty-cta" onclick={openJoin} type="button">
					{t({ locale: $localeStore, key: 'leagues.empty.cta_join' })}
				</button>
			</div>
		</section>
	{:else}
		{#if founded.length > 0}
			<section class="leagues-section">
				<h2 class="leagues-eyebrow allcaps">
					{t({ locale: $localeStore, key: 'leagues.eyebrow.founded' })}
				</h2>
				<ul class="leagues-list">
					{#each founded as row (row.league.id)}
						<li>
							<LeagueListCard
								friendOverlap={friendOverlapFor(row)}
								incomingChallengeCount={incomingChallengesFor(row)}
								league={row.league}
								memberCount={row.memberCount}
								onclick={() => handleCardClick(row.league.id)}
								role={row.role}
								trend={trendFor(row)}
								yourRank={yourRankFor(row)}
							/>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if joined.length > 0}
			<section class="leagues-section">
				<h2 class="leagues-eyebrow allcaps">
					{t({ locale: $localeStore, key: 'leagues.eyebrow.joined' })}
				</h2>
				<ul class="leagues-list">
					{#each joined as row (row.league.id)}
						<li>
							<LeagueListCard
								friendOverlap={friendOverlapFor(row)}
								league={row.league}
								memberCount={row.memberCount}
								onclick={() => handleCardClick(row.league.id)}
								role={row.role}
								trend={trendFor(row)}
								yourRank={yourRankFor(row)}
							/>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<!-- Start or join — secondary actions, deliberately lighter than the
		     league cards above so the leagues you're in stay the focus. -->
		<section class="leagues-section">
			<h2 class="leagues-eyebrow allcaps">
				{t({ locale: $localeStore, key: 'leagues.eyebrow.start_or_join' })}
			</h2>
			<div class="leagues-cta-grid">
				<LeagueCtaCard
					onclick={openCreate}
					sub={t({ locale: $localeStore, key: 'leagues.card.create_founder' })}
					title={t({ locale: $localeStore, key: 'leagues.card.create_title' })}
					variant="create"
				/>
				<LeagueCtaCard
					onclick={openJoin}
					sub={t({ locale: $localeStore, key: 'leagues.card.join_invite' })}
					title={t({ locale: $localeStore, key: 'leagues.card.join_title' })}
					variant="join"
				/>
			</div>
		</section>

		{#if recommendations.length > 0}
			<section class="leagues-section">
				<h2 class="leagues-eyebrow allcaps">
					{t({ locale: $localeStore, key: 'leagues.eyebrow.friends_in' })}
				</h2>
				<ul class="leagues-list">
					{#each recommendations as rec (rec.league.id)}
						<li>
							<LeagueListCard
								friendOverlap={friendOverlapFromPrincipals(rec.friendMembers)}
								isRecommendation
								league={rec.league}
								memberCount={rec.memberCount}
								onclick={() => handleCardClick(rec.league.id)}
							/>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/if}
</div>

<CreateLeagueModal
	isOpen={createOpen}
	onClose={() => (createOpen = false)}
	onCreated={handleAfterAction}
/>

<JoinLeagueModal
	isOpen={joinOpen}
	onClose={() => (joinOpen = false)}
	onJoined={handleAfterAction}
/>

<style lang="postcss">
	.leagues-page {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0.25rem 1.25rem 1.5rem;
	}

	/* Embedded in the Arena tab panel, the horizontal inset is already
	   supplied by the Arena page wrapper; drop ours so the content
	   aligns with the tab strip instead of sitting doubly indented. */
	.leagues-page.embedded {
		padding-left: 0;
		padding-right: 0;
	}

	.leagues-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.leagues-eyebrow {
		margin: 0;
		font-size: var(--t-10);
		font-weight: 600;
		letter-spacing: var(--tracking-allcaps);
		color: var(--text-muted);
	}

	.leagues-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		list-style: none;
		padding: 0;
		margin: 0;
	}

	/* Two-up grid for the Create / Join secondary actions. */
	.leagues-cta-grid {
		display: grid;
		/* `minmax(0, 1fr)` lets the columns shrink below their content's
		   intrinsic width, so wide button labels can't force horizontal
		   overflow (the default `1fr` floors at `minmax(auto, 1fr)`). */
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 10px;
	}

	.league-card-skeleton {
		min-height: 4.4rem;
		background: color-mix(in srgb, var(--bg-surface) 75%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		opacity: 0.55;
		animation: leagues-pulse 1.4s ease-in-out infinite;
	}

	@keyframes leagues-pulse {
		0%,
		100% {
			opacity: 0.5;
		}

		50% {
			opacity: 0.75;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.league-card-skeleton {
			animation: none;
		}
	}

	.leagues-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
		/* Gold-washed, dashed-laurel "invite-only" panel — distinct from
		   the neutral surface cards so the zero-state reads as an
		   editorial prompt, not a plain empty card. */
		padding: 1.5rem 1.375rem;
		text-align: center;
		background:
			linear-gradient(180deg, color-mix(in srgb, var(--laurel) 6%, transparent), transparent 70%),
			var(--bg-surface);
		border: 1px dashed color-mix(in srgb, var(--laurel) 25%, transparent);
		border-radius: var(--r-16, var(--r-12));
	}

	.leagues-empty-quote {
		margin: 0;
		font-family: var(--font-display);
		font-style: italic;
		font-size: var(--t-20, 1.25rem);
		color: var(--color-primary);
	}

	.leagues-empty-body {
		margin: 0;
		font-size: var(--t-13);
		color: var(--text-muted);
		line-height: 1.5;
		max-width: 34ch;
	}

	.leagues-empty-ctas {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.45rem;
	}

	.leagues-empty-cta {
		appearance: none;
		padding: 0.55rem 0.95rem;
		font: inherit;
		font-size: var(--t-13);
		font-weight: 700;
		color: var(--text-base);
		background: color-mix(in srgb, var(--bg-surface) 80%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-pill);
		cursor: pointer;
		transition:
			background-color var(--d-hover) var(--ease-vici),
			border-color var(--d-hover) var(--ease-vici);
	}

	.leagues-empty-cta:hover {
		background: color-mix(in srgb, var(--bg-surface) 50%, transparent);
		border-color: var(--border-strong);
	}

	.leagues-empty-cta.is-primary {
		color: var(--text-on-accent, #fff);
		background: var(--color-primary);
		border-color: var(--color-primary);
	}

	.leagues-empty-cta.is-primary:hover {
		background: color-mix(in srgb, var(--color-primary) 88%, var(--text-base));
	}

	.leagues-error {
		margin: 0;
		padding: 1rem;
		font-size: var(--t-13);
		color: var(--no);
		background: color-mix(in srgb, var(--no-wash, var(--no)) 14%, transparent);
		border: 1px solid color-mix(in srgb, var(--no) 35%, var(--border-base));
		border-radius: var(--r-12);
	}
</style>
