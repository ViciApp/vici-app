<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import type { Doc } from '@junobuild/core';
	import { UserMinus, UserPlus } from '@lucide/svelte/icons';
	import { onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import ScreenHeader from '#lib/components/layout/ScreenHeader.svelte';
	import Avatar from '#lib/components/profile/Avatar.svelte';
	import BaseButton from '#lib/components/ui/BaseButton.svelte';
	import BottomSheet from '#lib/components/ui/BottomSheet.svelte';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { globalStandingsRows, type StandingsRow } from '#lib/derived/standings.derived.ts';
	import { authPrincipal } from '#lib/derived/user.derived.ts';
	import { track } from '#lib/services/analytics.services.ts';
	import { loadProfilesByPrincipals } from '#lib/services/profile.services.ts';
	import {
		cancelFriendRequest,
		sendFriendRequest,
		unfriendUser
	} from '#lib/services/relation.services.ts';
	import { loadGlobalStandings } from '#lib/services/standings.services.ts';
	import {
		friendsListStore,
		refreshFriendRelations,
		sentFriendRequestsStore
	} from '#lib/stores/friends.store.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { notificationsStore } from '#lib/stores/notification.store.ts';
	import { globalStandingsStore } from '#lib/stores/standings.store.ts';
	import { leaderboardQualifyMin } from '#lib/stores/tweaks.store.ts';
	import type { Relation } from '#lib/types/relation.ts';
	import type { StandingsWindow } from '#lib/types/standings.ts';
	import { shortenPrincipal } from '#lib/utils/format.utils.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';
	import { goBack, resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { prefersReducedMotion } from '#lib/utils/reduced-motion.utils.ts';
	import { friendRequestOutcomeNotice } from '#lib/utils/relation.utils.ts';

	/**
	 * Global standings.
	 *
	 * Three windows (`This week` / `This month` / `All time`) each read their
	 * own slice of the clearing canister's `list_leaderboard` aggregate (over a
	 * fixed calendar window). Switching a window lazily loads + caches that
	 * slice, so a revisit renders instantly while a refresh runs in the
	 * background.
	 *
	 * The board ranks by **confidence-adjusted accuracy**. The canister returns
	 * the slice ordered by net P&L; `globalStandingsRows` re-ranks it and splits
	 * it into two partitions (see `standings.constants`):
	 *  - **ranked** — predictors who cleared the qualify gate (settled calls ≥
	 *    the effective threshold), ordered by a Bayesian-shrinkage score so a
	 *    thin record can't top a proven one. Each carries a 1-based `displayRank`
	 *    (we render this, never `entry.rank`, the canister's P&L rank).
	 *  - **provisional** — predictors below the gate: unranked, shown in a
	 *    separate section with `{done}/{min} to qualify` progress.
	 *
	 * Layout is a single column:
	 *  - chip-style window tabs at the top
	 *  - 3-tile podium row (top-3, #1 gets the gold halo + tinted bg)
	 *  - flat list of remaining ranked rows (rank, avatar, handle + calls ·
	 *    streak, accuracy on the right — coloured `--yes` once accuracy ≥ 78%)
	 *  - the Provisional section (only when non-empty)
	 *
	 * Every row and podium tile shows its **call count** — the trust signal that
	 * makes the shrinkage legible. Accuracy and settled count are authoritative
	 * from the clearing canister; handle / avatar / streak are overlaid from the
	 * shared profile cache (the viewer's own row from their live profile). The
	 * viewer's own row carries an accent border + tinted bg and is never
	 * tappable; every other row / podium tile opens a mini-profile bottom sheet
	 * with an add- or remove-friend action that routes through the same
	 * `relation.services` the Friends tab uses.
	 */

	const windows: { id: StandingsWindow; labelKey: MessageKey }[] = [
		{ id: 'week', labelKey: 'leaderboard.scope.week' },
		{ id: 'month', labelKey: 'leaderboard.scope.month' },
		{ id: 'all', labelKey: 'leaderboard.scope.all' }
	];

	let activeWindow = $state<StandingsWindow>('week');
	const currentUser = $derived($authPrincipal);

	// Only the active window's joined rows are computed. `globalStandingsRows`
	// re-maps its whole window on every `profilesStore` trickle, so instantiating
	// all three at once would keep re-mapping two windows that aren't on screen.
	// The standings store caches per-window, so switching tabs re-subscribes to
	// the cached slice. `undefined` until the active window's slice has loaded,
	// distinct from a loaded-but-empty window (both partitions `[]`).
	const partitionStore = $derived(globalStandingsRows(activeWindow));
	const partition = $derived($partitionStore);

	const loading = $derived(isNullish(partition));
	const rankedRows = $derived(partition?.ranked ?? []);
	const provisionalRows = $derived(partition?.provisional ?? []);

	const podium = $derived(rankedRows.slice(0, 3));
	const rest = $derived(rankedRows.slice(3));

	// The viewer's own row, wherever it landed (ranked or provisional), for the
	// `leaderboard_viewed` qualification signal.
	const selfRow = $derived([...rankedRows, ...provisionalRows].find((row) => row.isSelf));

	// Hydrate each window on first view. The store caches per-window, so a
	// repeat visit short-circuits the fetch and re-renders the cached slice.
	$effect(() => {
		const window = activeWindow;

		if (isNullish(partition)) {
			void loadGlobalStandings({ window }).catch((err: unknown) => {
				console.error(err);
			});
		}
	});

	// Fire `leaderboard_viewed` once per window load / tab switch (not on every
	// profile trickle that re-derives the partition). `ok` = the viewer cleared
	// the qualify gate (ranked vs provisional/absent); `value` = their settled
	// count, so the gate's effect on real viewers is measurable.
	let trackedWindow = $state<StandingsWindow | undefined>(undefined);

	$effect(() => {
		if (isNullish(partition) || activeWindow === trackedWindow) {
			return;
		}

		trackedWindow = activeWindow;
		track({
			name: 'leaderboard_viewed',
			label: activeWindow,
			count: rankedRows.length,
			ok: nonNullish(selfRow?.displayRank),
			value: selfRow?.entry.settledCount
		});
	});

	// Hydrate the shared profile cache for the rows this surface paints —
	// handle / avatar / streak overlay onto the standing reactively as profiles
	// land. `loadGlobalStandings` no longer hydrates (the dash shares its cached
	// slice but only needs the viewer's own rank), so the Leaderboard owns this.
	// `loadProfilesByPrincipals` dedupes against the cache, so the re-run this
	// triggers once profiles arrive is a no-op.
	//
	// Driven off the RAW slice (`globalStandingsStore`), not the filtered
	// `rankedRows` / `provisionalRows`: the leaderboard opt-out fails closed, so
	// a not-yet-hydrated (or opted-out) row is absent from the partition.
	// Hydrating only the visible rows would never fetch the missing profiles, so
	// an opted-in row could never resolve into view. The viewer's own row is
	// excluded — `globalStandingsRows` overlays it from the live
	// `userStore.profile`, so hydrating it would only add a redundant
	// `getProfile` on every visit / window switch.
	$effect(() => {
		const slice = $globalStandingsStore.get(activeWindow);

		if (isNullish(slice)) {
			return;
		}

		const owners = slice.entries
			.filter((entry) => entry.owner !== currentUser)
			.map((entry) => entry.owner);

		if (owners.length > 0) {
			void loadProfilesByPrincipals({ principals: owners });
		}
	});

	const handleOf = (row: StandingsRow): string =>
		row.nickname && row.nickname.length > 0 ? row.nickname : shortenPrincipal(row.owner);

	// ── Friend state ────────────────────────────────────────────────
	const friendOwners = $derived(
		new Set(
			$friendsListStore.flatMap((relation) =>
				relation.participants.filter((p) => p !== currentUser)
			)
		)
	);

	const isFriend = (owner: string): boolean => friendOwners.has(owner);

	const pendingSentDoc = (owner: string): Doc<Relation> | undefined =>
		$sentFriendRequestsStore.find((doc) => doc.data.participants.includes(owner));

	onMount(() => {
		// Hydrate the shared social graph so `isFriend` is accurate on first
		// paint. The store is stale-while-revalidate.
		void refreshFriendRelations();
	});

	// ── Mini-profile bottom sheet ───────────────────────────────────
	let openRow = $state<StandingsRow | undefined>(undefined);
	let mutatingOwner = $state<string | undefined>(undefined);

	const openSheet = (row: StandingsRow) => {
		// The viewer's own row is informational — there's nothing to add.
		if (row.isSelf) {
			return;
		}

		openRow = row;
	};

	const closeSheet = () => {
		openRow = undefined;
	};

	const handleToggleFriend = async () => {
		if (!openRow || !currentUser) {
			return;
		}

		const target = openRow.owner;
		mutatingOwner = target;

		// Determine which of the three states we are in at call time.
		const friendDoc = pendingSentDoc(target);
		const accepted = isFriend(target);
		const isPending = !accepted && nonNullish(friendDoc);

		let errorKey: MessageKey = 'arena.friends.error.send_failed_detail';

		try {
			if (accepted) {
				errorKey = 'arena.friends.error.unfriend_failed';
				await unfriendUser({ target, sender: currentUser });
			} else if (isPending) {
				errorKey = 'arena.friends.error.cancel_failed';
				await cancelFriendRequest({ currentRelation: friendDoc });
			} else {
				const outcome = await sendFriendRequest({ target, sender: currentUser });

				track({ name: 'friend_request_sent', source: 'leaderboard', label: outcome.status });

				const notice = friendRequestOutcomeNotice({ outcome, locale: $localeStore });

				if (nonNullish(notice)) {
					notificationsStore.add({
						title: t({ locale: $localeStore, key: 'leaderboard.title' }),
						...notice
					});
				}
			}

			await refreshFriendRelations();
			openRow = undefined;
		} catch (err: unknown) {
			console.error(err);

			// `{detail}` only exists in the send key — unfriend/cancel copies
			// ignore the param. It keeps an unexpected failure screenshotable.
			const detail = err instanceof Error ? err.message.trim().slice(0, 140) : '';

			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'leaderboard.title' }),
				message: t({
					locale: $localeStore,
					key: errorKey,
					params: { detail: detail || 'unknown' }
				}),
				type: 'error'
			});
		} finally {
			mutatingOwner = undefined;
		}
	};
</script>

<!-- The ↑/↓ rank-delta pill was dropped here: it was derived from the canister's
     prior *P&L* rank, which is meaningless now that the board is ordered by
     accuracy — it would point the wrong way and mislead. The `rankDelta` field
     stays on the model for other (P&L-ranked) surfaces. -->

<div class="leaderboard-page">
	<ScreenHeader
		back={{
			label: t({ locale: $localeStore, key: 'leaderboard.back' }),
			onBack: () => goBack(resolveAppPath(AppPath.Arena))
		}}
		title={t({ locale: $localeStore, key: 'leaderboard.title' })}
	/>

	<!-- Window chips — `This week / This month / All time`. -->
	<div class="leaderboard-scopes" role="tablist">
		{#each windows as window (window.id)}
			<button
				class="leaderboard-scope"
				class:is-active={activeWindow === window.id}
				aria-selected={activeWindow === window.id}
				onclick={() => (activeWindow = window.id)}
				role="tab"
				type="button"
			>
				{t({ locale: $localeStore, key: window.labelKey })}
			</button>
		{/each}
	</div>

	{#if loading}
		<div class="leaderboard-loading">
			<div class="leaderboard-spinner"></div>
			<p class="allcaps">{t({ locale: $localeStore, key: 'leaderboard.loading' })}</p>
		</div>
	{:else if rankedRows.length === 0 && provisionalRows.length === 0}
		<div class="leaderboard-empty">
			<p class="allcaps">{t({ locale: $localeStore, key: 'leaderboard.empty' })}</p>
			<p class="leaderboard-empty-sub">
				{t({ locale: $localeStore, key: 'leaderboard.empty_sub' })}
			</p>
		</div>
	{:else}
		<!-- The ranked podium + list render only when at least one predictor has
		     qualified. With everyone still below the gate (e.g. a high Tweak
		     threshold) the board is all-Provisional — skip straight to that
		     section rather than painting an empty podium. -->
		{#if rankedRows.length > 0}
			<!-- 3-tile podium row. #1 gets the gold halo + tinted bg; #2 / #3 stay
			     on the neutral surface. Every tile but the viewer's own is a real
			     button that opens the mini-profile sheet. -->
			<div class="leaderboard-podium">
				{#each podium as row, i (row.owner)}
					<button
						class="leaderboard-podium-tile"
						class:is-first={i === 0}
						class:is-you={row.isSelf}
						aria-label={row.isSelf
							? undefined
							: t({
									locale: $localeStore,
									key: 'leaderboard.open_profile_aria',
									params: { name: handleOf(row) }
								})}
						disabled={row.isSelf}
						onclick={() => openSheet(row)}
						type="button"
						in:fly={prefersReducedMotion() ? { duration: 0 } : { y: 24, delay: i * 100 }}
					>
						<div class="leaderboard-podium-rank num allcaps">#{row.displayRank}</div>
						<div class="leaderboard-podium-avatar-wrap">
							<Avatar
								class={i === 0 ? 'leaderboard-podium-avatar-lg' : 'leaderboard-podium-avatar-md'}
								avatar={row.avatar ?? null}
								avatarParts={row.avatarParts ?? null}
								nickname={row.nickname ?? null}
								owner={row.owner}
								self={row.isSelf}
							/>
						</div>
						<div class="leaderboard-podium-name">
							{row.isSelf ? t({ locale: $localeStore, key: 'leaderboard.you' }) : handleOf(row)}
						</div>
						<div class="leaderboard-podium-acc num">{row.entry.accuracy}%</div>
						<div class="leaderboard-podium-calls num">
							{t({
								locale: $localeStore,
								key: 'leaderboard.row.calls',
								params: { count: row.entry.settledCount }
							})}
						</div>
					</button>
				{/each}
			</div>

			<!-- Flat list of remaining ranked rows. -->
			<ul class="leaderboard-rows">
				{#each rest as row, i (row.owner)}
					<li in:fade={{ delay: i * 20 }}>
						<button
							class="leaderboard-row"
							class:is-you={row.isSelf}
							aria-label={row.isSelf
								? undefined
								: t({
										locale: $localeStore,
										key: 'leaderboard.open_profile_aria',
										params: { name: handleOf(row) }
									})}
							disabled={row.isSelf}
							onclick={() => openSheet(row)}
							type="button"
						>
							<span class="leaderboard-row-left">
								<span class="leaderboard-row-rank-wrap">
									<span class="leaderboard-row-rank num">#{row.displayRank}</span>
								</span>
								<Avatar
									class="leaderboard-row-avatar"
									avatar={row.avatar ?? null}
									avatarParts={row.avatarParts ?? null}
									nickname={row.nickname ?? null}
									owner={row.owner}
									self={row.isSelf}
								/>
								<span class="leaderboard-row-text">
									<span class="leaderboard-row-handle">
										{row.isSelf
											? t({ locale: $localeStore, key: 'leaderboard.you' })
											: handleOf(row)}
									</span>
									<span class="leaderboard-row-meta num">
										{t({
											locale: $localeStore,
											key: 'leaderboard.row.calls',
											params: { count: row.entry.settledCount }
										})} · {t({
											locale: $localeStore,
											key: 'leaderboard.row.streak',
											params: { count: row.dailyStreak }
										})}
									</span>
								</span>
							</span>
							<span class="leaderboard-row-acc num" class:is-strong={row.entry.accuracy >= 78}>
								{row.entry.accuracy}%
							</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		<!-- Provisional — predictors who've predicted but are below the qualify
		     gate. Unranked, shown with progress so newcomers see a path, not a
		     phantom #1. Only rendered when at least one predictor is provisional. -->
		{#if provisionalRows.length > 0}
			<div class="leaderboard-provisional">
				<div class="leaderboard-provisional-head">
					<span class="allcaps"
						>{t({ locale: $localeStore, key: 'leaderboard.provisional.title' })}</span
					>
					<span class="num allcaps leaderboard-provisional-min">
						{t({
							locale: $localeStore,
							key: 'leaderboard.provisional.min_calls',
							params: { count: $leaderboardQualifyMin }
						})}
					</span>
				</div>
				<ul class="leaderboard-rows">
					{#each provisionalRows as row, i (row.owner)}
						<li in:fade={{ delay: i * 20 }}>
							<button
								class="leaderboard-row leaderboard-row-provisional"
								class:is-you={row.isSelf}
								aria-label={row.isSelf
									? undefined
									: t({
											locale: $localeStore,
											key: 'leaderboard.open_profile_aria',
											params: { name: handleOf(row) }
										})}
								disabled={row.isSelf}
								onclick={() => openSheet(row)}
								type="button"
							>
								<span class="leaderboard-row-left">
									<span class="leaderboard-prov-badge allcaps">
										{t({ locale: $localeStore, key: 'leaderboard.provisional.badge' })}
									</span>
									<Avatar
										class="leaderboard-row-avatar"
										avatar={row.avatar ?? null}
										avatarParts={row.avatarParts ?? null}
										nickname={row.nickname ?? null}
										owner={row.owner}
										self={row.isSelf}
									/>
									<span class="leaderboard-row-text">
										<span class="leaderboard-row-handle">
											{row.isSelf
												? t({ locale: $localeStore, key: 'leaderboard.you' })
												: handleOf(row)}
										</span>
										<span class="leaderboard-row-meta num">
											{t({
												locale: $localeStore,
												key: 'leaderboard.provisional.to_qualify',
												params: { done: row.entry.settledCount, min: $leaderboardQualifyMin }
											})}
										</span>
									</span>
								</span>
								<span class="leaderboard-row-acc num leaderboard-prov-acc">
									{row.entry.accuracy}%
								</span>
							</button>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	{/if}
</div>

<!-- Mini-profile bottom sheet — opens on row / podium tap. Shows the tapped
     predictor's window accuracy, settled count and streak with an add- or
     remove-friend action that routes through the shared relation services. -->
<BottomSheet isOpen={nonNullish(openRow)} onClose={closeSheet}>
	{#if openRow}
		{@const row = openRow}
		{@const friend = isFriend(row.owner)}
		{@const sentDoc = pendingSentDoc(row.owner)}
		{@const pending = !friend && nonNullish(sentDoc)}
		<div class="lb-sheet-head">
			<span class="lb-sheet-avatar">
				<Avatar
					class="h-full w-full"
					avatar={row.avatar ?? null}
					avatarParts={row.avatarParts ?? null}
					nickname={row.nickname ?? null}
					owner={row.owner}
				/>
			</span>
			<div class="lb-sheet-head-copy">
				<span class="lb-sheet-name">@{handleOf(row)}</span>
				<span class="num lb-sheet-sub">
					{#if nonNullish(row.displayRank)}
						{t({
							locale: $localeStore,
							key: 'leaderboard.sheet.rank_streak',
							params: { rank: row.displayRank, count: row.dailyStreak }
						})}
					{:else}
						{t({
							locale: $localeStore,
							key: 'leaderboard.sheet.provisional_streak',
							params: { count: row.dailyStreak }
						})}
					{/if}
				</span>
			</div>
		</div>

		<div class="lb-sheet-stats">
			<div class="lb-sheet-stat">
				<span class="lb-sheet-lbl">
					{t({ locale: $localeStore, key: 'arena.friends.sheet.accuracy' })}
				</span>
				<span class="lb-sheet-val num">{row.entry.accuracy}%</span>
			</div>
			<div class="lb-sheet-stat">
				<span class="lb-sheet-lbl">
					{t({ locale: $localeStore, key: 'leaderboard.sheet.settled' })}
				</span>
				<span class="lb-sheet-val num">{row.entry.settledCount}</span>
			</div>
			<div class="lb-sheet-stat">
				<span class="lb-sheet-lbl">
					{t({ locale: $localeStore, key: 'arena.friends.sheet.streak' })}
				</span>
				<span class="lb-sheet-val num">{row.dailyStreak}d</span>
			</div>
		</div>

		<BaseButton
			class={friend
				? 'lb-sheet-action lb-sheet-remove'
				: pending
					? 'lb-sheet-action lb-sheet-pending'
					: 'lb-sheet-action lb-sheet-add'}
			onclick={handleToggleFriend}
			status={mutatingOwner === row.owner ? 'pending' : 'enabled'}
		>
			{#if friend}
				<UserMinus aria-hidden="true" size={15} strokeWidth={1.8} />
				{t({ locale: $localeStore, key: 'arena.friends.sheet.remove' })}
			{:else if pending}
				{t({ locale: $localeStore, key: 'leaderboard.sheet.requested' })}
				<span class="lb-sheet-pending-cancel">
					{t({ locale: $localeStore, key: 'leaderboard.sheet.cancel_request' })}
				</span>
			{:else}
				<UserPlus aria-hidden="true" size={15} strokeWidth={1.8} />
				{t({ locale: $localeStore, key: 'leaderboard.sheet.add_friend' })}
			{/if}
		</BaseButton>
		<BaseButton class="lb-sheet-close" onclick={closeSheet}>
			{t({ locale: $localeStore, key: 'arena.friends.sheet.close' })}
		</BaseButton>
	{/if}
</BottomSheet>

<style lang="postcss">
	.leaderboard-page {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0 1.25rem 6rem;
	}

	/* Window chip strip — `This week / This month / All time`. */
	.leaderboard-scopes {
		display: flex;
		gap: 0.375rem;
		padding: 0.25rem 0 0.875rem;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.leaderboard-scopes::-webkit-scrollbar {
		display: none;
	}

	.leaderboard-scope {
		appearance: none;
		display: inline-flex;
		align-items: center;
		/* ≥44px tap target on the window tab control while the chip keeps its
		   compact visual height. */
		min-height: 44px;
		padding: 0.4rem 0.875rem;
		font: inherit;
		font-size: var(--t-13);
		font-weight: 600;
		color: var(--text-muted);
		background: var(--bg-surface);
		border: 1px solid var(--border-base);
		border-radius: var(--r-pill);
		cursor: pointer;
		white-space: nowrap;
		transition:
			color var(--d-hover) var(--ease-vici),
			border-color var(--d-hover) var(--ease-vici);
	}

	.leaderboard-scope:hover {
		color: var(--text-base);
		border-color: var(--border-strong);
	}

	.leaderboard-scope.is-active {
		color: var(--text-base);
		border-color: color-mix(in srgb, var(--color-primary) 50%, var(--border-base));
		background: color-mix(in srgb, var(--color-primary) 12%, var(--bg-surface));
	}

	/* Podium — three tiles in a row. Tile 0 is #1 (the gold one). */
	.leaderboard-podium {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.leaderboard-podium-tile {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.35rem;
		padding: 0.75rem 0.5rem;
		appearance: none;
		font: inherit;
		color: inherit;
		background: var(--bg-surface);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		text-align: center;
		cursor: pointer;
		transition: border-color var(--d-hover) var(--ease-vici);
	}

	.leaderboard-podium-tile:disabled {
		cursor: default;
	}

	.leaderboard-podium-tile:not(:disabled):hover {
		border-color: var(--border-strong);
	}

	.leaderboard-podium-tile.is-first {
		border-color: color-mix(in srgb, #f4c544 45%, var(--border-base));
		background: color-mix(in srgb, #f4c544 6%, var(--bg-surface));
	}

	.leaderboard-podium-tile.is-first:not(:disabled):hover {
		border-color: color-mix(in srgb, #f4c544 60%, var(--border-base));
	}

	.leaderboard-podium-tile.is-you {
		border-color: color-mix(in srgb, var(--color-primary) 45%, var(--border-base));
		background: color-mix(in srgb, var(--color-primary) 8%, var(--bg-surface));
	}

	.leaderboard-podium-rank {
		font-size: var(--t-11);
		font-weight: 700;
		letter-spacing: 0.08em;
		color: var(--text-muted);
	}

	.leaderboard-podium-tile.is-first .leaderboard-podium-rank {
		color: #f4c544;
	}

	.leaderboard-podium-avatar-wrap {
		display: flex;
		justify-content: center;
		margin-top: 0.15rem;
	}

	:global(.leaderboard-podium-avatar-lg) {
		width: 3rem;
		height: 3rem;
	}

	:global(.leaderboard-podium-avatar-md) {
		width: 2.25rem;
		height: 2.25rem;
	}

	.leaderboard-podium-name {
		max-width: 100%;
		margin-top: 0.25rem;
		font-size: var(--t-12);
		font-weight: 600;
		color: var(--text-base);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.leaderboard-podium-acc {
		margin-top: 0.1rem;
		font-size: var(--t-13);
		font-weight: 600;
		color: var(--color-primary);
	}

	/* Call count — the trust signal under each podium tile's accuracy. */
	.leaderboard-podium-calls {
		margin-top: 0.1rem;
		font-size: var(--t-10);
		font-weight: 600;
		letter-spacing: 0.04em;
		color: var(--text-muted);
	}

	/* Rest rows — simple flat row card. */
	.leaderboard-rows {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.leaderboard-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 0.75rem 0.875rem;
		appearance: none;
		font: inherit;
		color: inherit;
		text-align: left;
		background: var(--bg-surface);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		cursor: pointer;
		transition: border-color var(--d-hover) var(--ease-vici);
	}

	.leaderboard-row:disabled {
		cursor: default;
	}

	.leaderboard-row:not(:disabled):hover {
		border-color: var(--border-strong);
	}

	/* Your own row reads as a personal highlight: an accent gradient that
	   fades to the surface, plus an accent-tinted border. The rank and handle
	   pick up the accent colour + extra weight below. */
	.leaderboard-row.is-you {
		border-color: color-mix(in srgb, var(--color-primary) 45%, var(--border-base));
		background: linear-gradient(
			90deg,
			var(--accent-glow, color-mix(in srgb, var(--color-primary) 16%, transparent)),
			transparent
		);
	}

	.leaderboard-row.is-you .leaderboard-row-handle {
		color: var(--color-primary);
		font-weight: 700;
	}

	.leaderboard-row-left {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-width: 0;
	}

	.leaderboard-row-rank-wrap {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.1rem;
		width: 2rem;
	}

	.leaderboard-row-rank {
		font-size: var(--t-13);
		font-weight: 600;
		color: var(--text-muted);
	}

	.leaderboard-row.is-you .leaderboard-row-rank {
		color: var(--color-primary);
		font-weight: 700;
	}

	:global(.leaderboard-row-avatar) {
		width: 1.75rem;
		height: 1.75rem;
		flex-shrink: 0;
	}

	.leaderboard-row-text {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}

	.leaderboard-row-handle {
		font-size: var(--t-13);
		font-weight: 600;
		color: var(--text-base);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.leaderboard-row-meta {
		font-size: 0.65rem;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}

	.leaderboard-row-acc {
		font-size: var(--t-14);
		font-weight: 600;
		color: var(--text-base);
	}

	.leaderboard-row-acc.is-strong {
		color: var(--yes);
	}

	/* ── Provisional section ─────────────────────────────────────── */
	.leaderboard-provisional {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		margin-top: 0.75rem;
	}

	.leaderboard-provisional-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.25rem 0.125rem;
		font-size: var(--t-10);
		font-weight: 700;
		letter-spacing: var(--tracking-allcaps);
		color: var(--text-muted);
	}

	.leaderboard-provisional-min {
		font-weight: 600;
	}

	/* Provisional rows read a touch quieter than ranked ones — they're a path,
	   not a standing. */
	.leaderboard-row-provisional:not(.is-you) {
		opacity: 0.86;
	}

	.leaderboard-prov-badge {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		padding: 0.15rem 0.4rem;
		font-size: var(--t-10);
		font-weight: 700;
		letter-spacing: var(--tracking-allcaps);
		color: var(--text-muted);
		background: var(--bg-elevated);
		border: 1px solid var(--border-base);
		border-radius: var(--r-pill);
	}

	.leaderboard-prov-acc {
		font-size: var(--t-13);
		color: var(--text-muted);
	}

	.leaderboard-loading,
	.leaderboard-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.875rem;
		padding: 3rem 1rem;
		color: var(--text-muted);
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: var(--tracking-allcaps);
	}

	.leaderboard-empty-sub {
		max-width: 18rem;
		font-size: var(--t-12);
		font-weight: 500;
		letter-spacing: normal;
		text-align: center;
		text-transform: none;
		color: var(--text-muted);
	}

	.leaderboard-spinner {
		width: 2.5rem;
		height: 2.5rem;
		border: 3px solid color-mix(in srgb, var(--color-primary) 25%, transparent);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: leaderboard-spin 720ms linear infinite;
	}

	@keyframes leaderboard-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.leaderboard-spinner {
			animation-duration: 1.6s;
		}
	}

	/* ── Mini-profile sheet body ─────────────────────────────────── */
	.lb-sheet-head {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.25rem 0 0.85rem;
	}

	.lb-sheet-avatar {
		display: inline-flex;
		overflow: hidden;
		width: 3rem;
		height: 3rem;
		flex-shrink: 0;
		border-radius: var(--r-pill);
		background: var(--bg-surface);
	}

	.lb-sheet-head-copy {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.15rem;
	}

	.lb-sheet-name {
		color: var(--text-base);
		font-size: var(--t-16);
		font-weight: 700;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lb-sheet-sub {
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: var(--t-10);
		font-weight: 800;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
	}

	.lb-sheet-stats {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.5rem;
		margin-bottom: 0.85rem;
		padding: 0.75rem 0;
		border-top: 1px solid var(--border-base);
		border-bottom: 1px solid var(--border-base);
	}

	.lb-sheet-stat {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		text-align: center;
	}

	.lb-sheet-lbl {
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: 0.6rem;
		font-weight: 800;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
	}

	.lb-sheet-val {
		color: var(--text-base);
		font-size: var(--t-16);
		font-weight: 700;
	}

	:global(.lb-sheet-action) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		width: 100%;
		padding: 0.75rem;
		border-radius: var(--r-pill);
		font-size: var(--t-13);
		font-weight: 700;
	}

	:global(.lb-sheet-add) {
		border: 1px solid color-mix(in srgb, var(--color-primary) 45%, var(--border-base));
		background: var(--color-primary);
		color: var(--color-primary-foreground, white);
	}

	:global(.lb-sheet-remove) {
		border: 1px solid var(--border-base);
		background: var(--bg-surface);
		color: var(--no);
	}

	:global(.lb-sheet-pending) {
		flex-direction: column;
		gap: 0.15rem;
		border: 1px solid var(--border-base);
		background: var(--bg-surface);
		color: var(--text-muted);
	}

	.lb-sheet-pending-cancel {
		font-size: var(--t-11);
		color: var(--no);
		font-weight: 600;
	}

	:global(.lb-sheet-close) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		padding: 0.65rem;
		margin-top: 0.4rem;
		border: 0;
		border-radius: var(--r-pill);
		background: transparent;
		color: var(--text-muted);
		font-size: var(--t-13);
		font-weight: 700;
	}
</style>
