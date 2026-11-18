<script lang="ts" module>
	/**
	 * Percentile bracket for a 1-based `rank` within a ranked set of
	 * `total`. Absolute rank loses meaning at scale (`#247 of 2,480`
	 * reads as arithmetic; `Top 10%` reads instantly), and a percentile
	 * stays legible as the pool grows.
	 *
	 * Rounds UP to the next worse bracket so the better tiers feel
	 * earned, and returns `undefined` below the Top 50% tier; a
	 * demoralizing band gets no badge and the caller falls back to the
	 * absolute `#rank of total`.
	 */
	const BRACKET_LADDER = [0.1, 1, 5, 10, 25, 50] as const;

	export const pctBracket = ({
		rank,
		total
	}: {
		rank: number;
		total: number;
	}): number | undefined => {
		if (rank < 1 || total < 1) {
			return;
		}

		const pct = (rank / total) * 100;

		for (const tier of BRACKET_LADDER) {
			if (pct <= tier) {
				return tier;
			}
		}
	};
</script>

<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import type { PrincipalText } from '@junobuild/schema';
	import { untrack } from 'svelte';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { lookupWorldsAffiliation } from '#lib/constants/worlds-affiliations.constants.ts';
	import { authPrincipal } from '#lib/derived/user.derived.ts';
	import { listLeagueMembers, listMyLeagues } from '#lib/services/leagues.services.ts';
	import {
		findOwnStanding,
		getLeagueStandings,
		getStandings
	} from '#lib/services/standings.services.ts';
	import { listAffiliationStats } from '#lib/services/worlds.services.ts';
	import { myAffiliationsStore, refreshMyAffiliations } from '#lib/stores/affiliations.store.ts';
	import { friendsListStore, refreshFriendRelations } from '#lib/stores/friends.store.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import {
		affiliationMonthlyAccuracy,
		affiliationRankComparator
	} from '#lib/utils/affiliation-stats.utils.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { prefersReducedMotion } from '#lib/utils/reduced-motion.utils.ts';
	import { get as getStorage, set as setStorage } from '#lib/utils/storage.utils.ts';
	import { goto } from '$app/navigation';

	/**
	 * Arena standing hero: one swipe-only standing that pages across the
	 * viewer's competitive scopes (Global → Friends → each League →
	 * Battle). A single ~76px rank figure reads at one consistent scale
	 * across every scope; tappable dots let the viewer jump between
	 * scopes and there is NO auto-advance; nothing rotates a stat out
	 * from under them.
	 *
	 * The Global scope leads with a percentile bracket (`Top 0.1%` /
	 * `Top 1%` / `Top 5%` / …) when the viewer is in the top half; below
	 * that it falls back to the absolute `#rank of total`. Movement reads as
	 * `▲ {n}`: a percentile-point delta (with a `%` suffix) for the
	 * Global scope, an absolute rank climb for the others.
	 *
	 * Every scope is sourced from real, already-cached data: the global
	 * + per-league + friends standings come from the clearing canister's
	 * ranked windows (the same source the Leaderboard surface uses), and
	 * the Battle scope ranks the viewer's university among the monthly
	 * roster. A scope is only added once its rank is known, so the hero
	 * never fabricates a position.
	 *
	 * Re-entry is instant: the computed scopes are persisted to
	 * localStorage (keyed per-principal) and seeded synchronously on
	 * mount, so a returning viewer sees their last standings immediately
	 * while a fresh hydrate runs in the background and overwrites them
	 * (stale-while-revalidate). On the very first cold load, no cache,
	 * a pulsing skeleton stands in for the hero until the hydrate lands.
	 */

	interface Props {
		// Switch the embedding Arena hub to a named tab (used by the
		// Friends scope tap so it lands inside the hub).
		onSelectTab?: (tab: 'friends' | 'leagues' | 'battles') => void;
	}

	const { onSelectTab }: Props = $props();

	// Where a scope's tap lands. Kept as a serializable descriptor (not a
	// closure) so the whole `Scope` round-trips through localStorage; the
	// live handler is rebuilt from it at tap time by `openScope`.
	type ScopeNav =
		| { kind: 'leaderboard' }
		| { kind: 'tab'; tab: 'friends' | 'leagues' | 'battles' }
		| { kind: 'league'; id: string }
		| { kind: 'school'; id: string };

	interface Scope {
		key: string;
		// Resolved scope label (already localized).
		label: string;
		// 1-based rank within the scope's ranked set.
		rank: number;
		// Total ranked set size.
		total: number;
		// Percentile bracket tier (e.g. 1 → "Top 1%"); undefined when the
		// scope shows an absolute rank.
		bracket: number | undefined;
		// Movement vs the prior window: positive climbs render "▲ {up}".
		up: number;
		// Append "%" to the movement figure (Global percentile scope).
		upSuffix: '%' | '';
		// Meta suffix line context (already localized).
		unit: string;
		// Serializable navigation target (resolved to a handler on tap).
		nav: ScopeNav;
	}

	// Versioned, per-principal localStorage key for the cached scopes.
	// Bump the version suffix if the persisted `Scope` shape changes so a
	// stale entry can't be mis-read.
	const cacheKey = (owner: PrincipalText): string => `vici.arena-standings.v1:${owner}`;

	const NAV_KINDS: ReadonlySet<string> = new Set(['leaderboard', 'tab', 'league', 'school']);

	// localStorage is untrusted input (parsed JSON, manually editable):
	// keep only entries whose render- and tap-critical fields are shaped
	// right so a malformed row can't throw mid-render or in `openScope`.
	const isScope = (value: unknown): value is Scope => {
		if (typeof value !== 'object' || isNullish(value)) {
			return false;
		}

		const scope = value as Partial<Scope>;

		return (
			typeof scope.key === 'string' &&
			typeof scope.label === 'string' &&
			typeof scope.rank === 'number' &&
			typeof scope.total === 'number' &&
			typeof scope.up === 'number' &&
			typeof scope.unit === 'string' &&
			nonNullish(scope.nav) &&
			typeof scope.nav === 'object' &&
			NAV_KINDS.has((scope.nav as { kind?: string }).kind ?? '')
		);
	};

	const readCache = (owner: PrincipalText): Scope[] | undefined => {
		const cached = getStorage<unknown>({ key: cacheKey(owner) });

		return Array.isArray(cached) ? cached.filter(isScope) : undefined;
	};

	const writeCache = ({ owner, value }: { owner: PrincipalText; value: Scope[] }): void => {
		setStorage({ key: cacheKey(owner), value });
	};

	let scopes = $state<Scope[]>([]);
	let idx = $state(0);
	let pointerDownX: number | null = null;
	// Live finger offset (px) while a horizontal drag is in flight; the
	// track follows it 1:1 so the hero pages like a real carousel instead
	// of flipping content on release.
	let dragX = $state(0);
	let dragging = $state(false);
	// Stays false until the first hydrate settles for the active principal.
	// Drives the cold-load skeleton: shown only while we have nothing cached
	// to render AND no hydrate has landed yet.
	let settled = $state(false);

	const principal = $derived($authPrincipal);

	const showSkeleton = $derived(scopes.length === 0 && !settled);

	const goLeaderboard = () => {
		void goto(resolveAppPath(`${AppPath.Arena}/leaderboard`));
	};

	const goSchool = (id: string) => {
		void goto(`${resolveAppPath(AppPath.Arena)}/worlds/school/${id}`);
	};

	const goLeague = (id: string) => {
		void goto(`${resolveAppPath(AppPath.Arena)}/leagues/${id}`);
	};

	const unitThisWeek = $derived(t({ locale: $localeStore, key: 'arena.hero.unit_this_week' }));

	// Seed from cache, then hydrate. Re-runs whenever the signed-in
	// `principal` changes so the cache key, seeded scopes, and fresh fetch
	// all track the active viewer (no cross-account bleed).
	//
	// The seed is synchronous so a returning viewer sees their last
	// standings on the same frame the page mounts. The fresh hydrate waits
	// for the friend relations / affiliations refreshes first because
	// `hydrate()` reads `$friendsListStore` / `$myAffiliationsStore`
	// synchronously: kicking it off before those resolve can permanently
	// omit the Friends and Battle scopes. The `cancelled` flag drops a late
	// resolution after teardown so we never write `scopes` on an unmounted
	// instance (or for a stale principal).
	$effect(() => {
		const owner = principal;
		let cancelled = false;

		// Stale-while-revalidate seed. A present cache entry (even an empty
		// array: "loaded, no standings") suppresses the skeleton; a missing
		// one leaves us in the cold-load state until the hydrate settles.
		const cached = nonNullish(owner) ? readCache(owner) : undefined;

		if (nonNullish(cached)) {
			scopes = cached;
			settled = true;
		} else {
			scopes = [];
			// No principal means no hydrate can run: settle the signed-out /
			// pre-auth state immediately so the skeleton only pulses while a
			// load is actually possible. When auth resolves, the effect
			// re-runs with the principal and the cold-load state kicks in.
			settled = isNullish(owner);
		}

		// Clamp the scope cursor WITHOUT registering `idx` / `scopes` as
		// dependencies. This effect assigns `scopes` a fresh array identity
		// on every run, so a tracked read of it here makes the effect its
		// own trigger: each run marks itself dirty again and Svelte aborts
		// the flush with `effect_update_depth_exceeded`, freezing the page.
		// Only `principal` may re-run this effect.
		untrack(() => {
			if (idx >= scopes.length) {
				idx = 0;
			}
		});

		void (async () => {
			await Promise.allSettled([refreshFriendRelations(), refreshMyAffiliations()]);

			if (cancelled) {
				return;
			}

			await hydrate({ owner, isCancelled: () => cancelled });
		})();

		return () => {
			cancelled = true;
		};
	});

	const hydrate = async ({
		owner,
		isCancelled
	}: {
		owner: PrincipalText | undefined;
		isCancelled: () => boolean;
	}): Promise<void> => {
		if (isNullish(owner)) {
			return;
		}

		const next: Scope[] = [];

		// ── Global ──────────────────────────────────────────────────
		try {
			const global = await getStandings({ window: 'week' });
			const mine = findOwnStanding({ result: global, owner });

			if (nonNullish(mine) && global.total > 0) {
				const bracket = pctBracket({ rank: mine.rank, total: global.total });
				// Movement on the Global scope reads as a percentile-point
				// climb so it stays meaningful at any pool size: the prior
				// rank's percentile minus the current one (positive climbs).
				const priorPct = nonNullish(mine.priorRank)
					? (mine.priorRank / global.total) * 100
					: undefined;
				const nowPct = (mine.rank / global.total) * 100;
				const up = nonNullish(priorPct) ? Math.max(0, Math.round(priorPct - nowPct)) : 0;

				next.push({
					key: 'global',
					label: t({ locale: $localeStore, key: 'arena.hero.global' }),
					rank: mine.rank,
					total: global.total,
					bracket,
					up,
					upSuffix: '%',
					unit: unitThisWeek,
					nav: { kind: 'leaderboard' }
				});
			}
		} catch {
			// Skip the Global scope if the standings window fails to load.
		}

		// ── Friends ─────────────────────────────────────────────────
		try {
			const friendOwners = $friendsListStore
				.map((relation) => relation.participants.find((p) => p !== owner))
				.filter((p): p is PrincipalText => nonNullish(p));

			if (friendOwners.length > 0) {
				const members = [...new Set([owner, ...friendOwners])];
				const friends = await getLeagueStandings({ window: 'week', members });
				const mine = findOwnStanding({ result: friends, owner });

				if (nonNullish(mine) && friends.total > 0) {
					next.push({
						key: 'friends',
						label: t({ locale: $localeStore, key: 'arena.hero.friends' }),
						rank: mine.rank,
						total: friends.total,
						bracket: undefined,
						up: nonNullish(mine.rankDelta) ? Math.max(0, mine.rankDelta) : 0,
						upSuffix: '',
						unit: unitThisWeek,
						nav: { kind: 'tab', tab: 'friends' }
					});
				}
			}
		} catch {
			// Skip the Friends scope on failure.
		}

		// ── Each League (best-ranked first) ─────────────────────────
		try {
			const myLeagues = await listMyLeagues();
			const leagueScopes: Scope[] = [];

			for (const { league } of myLeagues) {
				try {
					const roster = await listLeagueMembers({ leagueId: league.id });
					const members = roster.map((m) => m.member);
					const standings = await getLeagueStandings({ window: 'week', members });
					const mine = findOwnStanding({ result: standings, owner });

					if (nonNullish(mine) && standings.total > 0) {
						leagueScopes.push({
							key: `league-${league.id}`,
							label: league.name,
							rank: mine.rank,
							total: standings.total,
							bracket: undefined,
							up: nonNullish(mine.rankDelta) ? Math.max(0, mine.rankDelta) : 0,
							upSuffix: '',
							unit: unitThisWeek,
							nav: { kind: 'league', id: league.id }
						});
					}
				} catch {
					// Skip a league whose standings can't be computed.
				}
			}

			leagueScopes.sort((a, b) => a.rank - b.rank);
			next.push(...leagueScopes);
		} catch {
			// Skip all league scopes on failure.
		}

		// ── Battle (university) ─────────────────────────────────────
		try {
			const uni = $myAffiliationsStore.university;

			if (nonNullish(uni)) {
				const stats = await listAffiliationStats({ kind: 'university' });
				const ranked = [...stats].sort(
					affiliationRankComparator({
						accuracyOf: affiliationMonthlyAccuracy,
						callsOf: (row) => row.totalCalls
					})
				);
				const rank = ranked.findIndex(
					(row) => row.affiliationIdentifier === uni.affiliationIdentifier
				);

				if (rank !== -1) {
					const option = lookupWorldsAffiliation({
						kind: 'university',
						id: uni.affiliationIdentifier
					});

					next.push({
						key: 'battle',
						label: t({
							locale: $localeStore,
							key: 'arena.hero.battle',
							params: { name: option?.name ?? uni.affiliationIdentifier }
						}),
						rank: rank + 1,
						total: ranked.length,
						bracket: undefined,
						up: 0,
						upSuffix: '',
						unit: t({ locale: $localeStore, key: 'arena.hero.unit_in_wc' }),
						nav: { kind: 'school', id: uni.affiliationIdentifier }
					});
				}
			}
		} catch {
			// Skip the Battle scope on failure.
		}

		if (isCancelled()) {
			return;
		}

		scopes = next;
		settled = true;
		writeCache({ owner, value: next });

		if (idx >= scopes.length) {
			idx = 0;
		}
	};

	// Resolve a scope's serializable nav target to its live handler.
	const openScope = (scope: Scope): void => {
		switch (scope.nav.kind) {
			case 'leaderboard':
				goLeaderboard();

				return;
			case 'tab':
				onSelectTab?.(scope.nav.tab);

				return;
			case 'league':
				goLeague(scope.nav.id);

				return;
			case 'school':
				goSchool(scope.nav.id);
		}
	};

	const current = $derived(scopes[idx]);

	// Bracket value rendered as the hero number (e.g. "1%"); "Top" rides
	// as a small prefix so a percentile reads at the same scale as an
	// absolute "#9" and the card height stays fixed across scopes.
	const bracketPrefix = $derived(t({ locale: $localeStore, key: 'arena.hero.top_prefix' }));

	const select = (n: number) => {
		if (scopes.length === 0) {
			return;
		}

		idx = (n + scopes.length) % scopes.length;
	};

	const onPointerDown = (event: PointerEvent) => {
		pointerDownX = event.clientX;
		dragging = true;
		// Capture so move/up are still delivered if the pointer leaves the
		// hero mid-swipe; without this a release outside the element strands
		// the drag offset. The dots opt out via their own pointerdown.
		(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
	};

	const onPointerMove = (event: PointerEvent) => {
		if (isNullish(pointerDownX)) {
			return;
		}

		let dx = event.clientX - pointerDownX;

		// Rubber-band past the first/last scope: the track still follows
		// the finger (damped) so the edge reads as an edge, not a freeze.
		if ((idx === 0 && dx > 0) || (idx === scopes.length - 1 && dx < 0)) {
			dx *= 0.35;
		}

		dragX = dx;
	};

	// Snap the track back onto the active scope. With the drag offset
	// cleared the CSS transition re-engages and animates the remainder of
	// the travel (or the rubber-band return).
	const endDrag = () => {
		pointerDownX = null;
		dragging = false;
		dragX = 0;
	};

	const onPointerUp = (event: PointerEvent) => {
		(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);

		if (isNullish(pointerDownX)) {
			return;
		}

		const dx = event.clientX - pointerDownX;
		endDrag();

		// Treat a horizontal drag past the threshold as a scope page; a
		// small drag is a tap and opens the active scope's surface.
		if (Math.abs(dx) > 28) {
			select(idx + (dx < 0 ? 1 : -1));

			return;
		}

		if (nonNullish(current)) {
			openScope(current);
		}
	};

	const onKeydown = (event: KeyboardEvent) => {
		if (event.key === 'ArrowRight') {
			event.preventDefault();
			select(idx + 1);
		} else if (event.key === 'ArrowLeft') {
			event.preventDefault();
			select(idx - 1);
		} else if (event.key === 'Enter' || event.key === ' ') {
			// Only the hero itself opens the active scope; a focused dot
			// button has its own activation, so don't hijack its Enter/Space
			// when the keydown bubbles up from a nested control.
			if (event.target !== event.currentTarget) {
				return;
			}

			event.preventDefault();

			if (nonNullish(current)) {
				openScope(current);
			}
		}
	};

	const dotLabel = (scope: Scope): string =>
		t({ locale: $localeStore, key: 'arena.hero.dot_aria', params: { scope: scope.label } });

	const heroAriaKey: MessageKey = 'arena.hero.aria';
</script>

{#if showSkeleton}
	<!-- Cold-load placeholder: mirrors the hero rhythm (eyebrow → big rank
	     figure → meta line) so the layout doesn't reflow when the real
	     standing lands. Decorative pulse only; no copy. -->
	<div class="ar-standing" aria-hidden="true">
		<div class="ar-skel">
			<span class="ar-skel-block ar-skel-ctx"></span>
			<div class="ar-skel-body">
				<span class="ar-skel-block ar-skel-rank"></span>
			</div>
			<span class="ar-skel-block ar-skel-meta"></span>
		</div>
	</div>
{:else if nonNullish(current)}
	<div class="ar-standing">
		<div
			class="ar-live"
			class:reduced-motion={prefersReducedMotion()}
			aria-label={t({
				locale: $localeStore,
				key: heroAriaKey,
				params: { scope: current.label }
			})}
			onkeydown={onKeydown}
			onpointercancel={endDrag}
			onpointerdown={onPointerDown}
			onpointermove={onPointerMove}
			onpointerup={onPointerUp}
			role="button"
			tabindex="0"
		>
			{#if scopes.length > 1}
				<span class="ar-live-dots" role="tablist">
					{#each scopes as scope, i (scope.key)}
						<button
							class="ar-live-dot"
							class:is-on={i === idx}
							aria-label={dotLabel(scope)}
							aria-selected={i === idx}
							onclick={(event) => {
								event.stopPropagation();
								select(i);
							}}
							onpointerdown={(event) => event.stopPropagation()}
							role="tab"
							type="button"
						></button>
					{/each}
				</span>
			{/if}

			<div class="ar-live-viewport">
				<div
					style:transform={`translateX(calc(${idx * -100}% + ${dragX}px))`}
					class="ar-live-track"
					class:is-dragging={dragging}
				>
					{#each scopes as scope, i (scope.key)}
						<div class="ar-live-slide" aria-hidden={i !== idx}>
							<span class="ar-live-ctx" class:has-dots={scopes.length > 1}>{scope.label}</span>

							<div class="ar-live-body">
								{#if nonNullish(scope.bracket)}
									<span class="num ar-live-rank is-bracket">
										<span class="ar-live-rank-pre">{bracketPrefix}</span>{scope.bracket}%
									</span>
								{:else}
									<span class="num ar-live-rank">#{scope.rank}</span>
								{/if}

								{#if scope.up > 0}
									<span class="num ar-live-mv">▲ {scope.up}{scope.upSuffix}</span>
								{/if}

								<span class="ar-live-go" aria-hidden="true">→</span>
							</div>

							<div class="num ar-live-meta">
								{#if nonNullish(scope.bracket)}
									{t({
										locale: $localeStore,
										key: 'arena.hero.meta_ranked',
										params: { rank: scope.rank, total: scope.total }
									})}
								{:else}
									{t({
										locale: $localeStore,
										key: 'arena.hero.meta_of',
										params: { total: scope.total }
									})}
								{/if}
								· {scope.unit}
							</div>
						</div>
					{/each}
				</div>
			</div>
		</div>
	</div>
{/if}

<style lang="postcss">
	.ar-standing {
		padding: 1rem 0 0.85rem;
	}

	/* Cold-load skeleton: same vertical rhythm as `.ar-live` so the hero
	   doesn't jump when the real standing replaces it. */
	.ar-skel {
		display: block;
	}

	.ar-skel-block {
		display: block;
		border-radius: var(--r-8, 0.5rem);
		background: color-mix(in srgb, var(--text-muted) 16%, transparent);
		animation: ar-skel-pulse 1.4s ease-in-out infinite;
	}

	@keyframes ar-skel-pulse {
		0%,
		100% {
			opacity: 0.55;
		}
		50% {
			opacity: 0.9;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.ar-skel-block {
			animation: none;
		}
	}

	.ar-skel-ctx {
		width: 6.5rem;
		height: var(--t-10, 0.65rem);
		border-radius: var(--r-pill);
	}

	.ar-skel-body {
		display: flex;
		align-items: flex-end;
		margin-top: 8px;
		min-height: 64px;
	}

	.ar-skel-rank {
		width: 8.5rem;
		height: 58px;
	}

	.ar-skel-meta {
		width: 11rem;
		height: 11.5px;
		margin-top: 9px;
		border-radius: var(--r-pill);
	}

	.ar-live {
		position: relative;
		display: block;
		width: 100%;
		text-align: left;
		color: inherit;
		cursor: pointer;
		touch-action: pan-y;
		user-select: none;
		-webkit-user-select: none;
	}

	/* Paging carousel: every scope is laid out side by side on a flex
	   track that translates by whole slides. While a finger is down the
	   transition is suspended so the track follows the drag 1:1; on
	   release it eases onto the snapped scope. */
	.ar-live-viewport {
		overflow: hidden;
	}

	.ar-live-track {
		display: flex;
		transition: transform 320ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	.ar-live-track.is-dragging {
		transition: none;
	}

	.ar-live-slide {
		flex: 0 0 100%;
		min-width: 0;
	}

	.ar-live:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--color-primary) 55%, transparent);
		outline-offset: 4px;
		border-radius: var(--r-8, 0.5rem);
	}

	.ar-live-ctx {
		display: block;
		font-family: var(--font-mono);
		font-size: var(--t-10);
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* The dots overlay the track (they don't ride along with a slide), so
	   the label reserves their corner to keep its ellipsis clear of them. */
	.ar-live-ctx.has-dots {
		padding-right: 4.5rem;
	}

	.ar-live-dots {
		position: absolute;
		top: 3px;
		right: 0;
		z-index: 1;
		display: inline-flex;
		gap: 5px;
		align-items: center;
	}

	.ar-live-dot {
		appearance: none;
		width: 5px;
		height: 5px;
		padding: 0;
		border: 0;
		border-radius: var(--r-pill);
		background: color-mix(in srgb, var(--text-muted) 50%, transparent);
		cursor: pointer;
		transition:
			width 220ms cubic-bezier(0.22, 1, 0.36, 1),
			background 220ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	.ar-live-dot.is-on {
		width: 15px;
		background: var(--laurel);
	}

	.ar-live-dot:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--color-primary) 55%, transparent);
		outline-offset: 2px;
	}

	.reduced-motion .ar-live-dot,
	.reduced-motion .ar-live-track {
		transition: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.ar-live-dot,
		.ar-live-track {
			transition: none;
		}
	}

	.ar-live-body {
		display: flex;
		align-items: flex-end;
		gap: 12px;
		margin-top: 8px;
		min-height: 64px;
	}

	.ar-live-rank {
		font-family: var(--font-mono);
		font-weight: 700;
		font-size: 76px;
		line-height: 0.84;
		letter-spacing: -0.05em;
		color: var(--text-base);
	}

	/* Bracket modifier: same hero size as an absolute rank; the "Top"
	   word is a small prefix so the percentage figure matches "#9" in
	   scale and the card height stays fixed across scopes. */
	.ar-live-rank.is-bracket {
		white-space: nowrap;
	}

	.ar-live-rank-pre {
		font-size: 22px;
		font-weight: 700;
		letter-spacing: 0.01em;
		text-transform: uppercase;
		color: var(--text-muted);
		margin-right: 9px;
	}

	.ar-live-mv {
		font-family: var(--font-mono);
		font-size: 14px;
		font-weight: 600;
		color: var(--yes);
		white-space: nowrap;
	}

	.ar-live-meta {
		margin-top: 9px;
		font-family: var(--font-mono);
		font-size: 11.5px;
		color: var(--text-muted);
		white-space: nowrap;
	}

	.ar-live-go {
		margin-left: auto;
		align-self: center;
		font-family: var(--font-mono);
		font-size: 16px;
		color: color-mix(in srgb, var(--text-muted) 60%, transparent);
	}
</style>
