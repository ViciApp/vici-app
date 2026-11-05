<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import Avatar from '#lib/components/profile/Avatar.svelte';
	import { leaderboard } from '#lib/derived/leaderboard.derived.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { FollowedLeanSignal, TopPredictorSignal } from '#lib/types/market-signals.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		/**
		 * Leaderboard-ranked predictors who hold a position on this market,
		 * each with the side they actually took. `undefined` while the page
		 * is still resolving them — the list area stays blank rather than
		 * flashing the empty state at people who are about to appear.
		 */
		topPredictors?: TopPredictorSignal[];
		/**
		 * Lean of the people the viewer follows, if any have called this
		 * market. Sparse: when absent the followed-lean row is hidden
		 * rather than showing invented friends.
		 */
		followedLean?: FollowedLeanSignal;
	}

	const { topPredictors, followedLean }: Props = $props();

	const followedNo = $derived(nonNullish(followedLean) ? followedLean.total - followedLean.yes : 0);

	// Join each signal back onto its cached leaderboard row for the display
	// fields (nickname / avatar / accuracy / streak). The signals were
	// resolved from this same store's principal order, so a miss only
	// happens if the board refreshed mid-flight — drop that row rather
	// than render a half-empty identity.
	const rows = $derived(
		(topPredictors ?? [])
			.map((signal) => {
				const user = $leaderboard.find(({ owner }) => owner === signal.owner);

				return nonNullish(user) ? { user, side: signal.side } : undefined;
			})
			.filter(nonNullish)
	);
</script>

<!-- "Top predictors here" mini-leaderboard: the highest-ranked
     predictors on the global board who hold a live position on THIS
     market, tagged with the side they committed (resolved via
     per-candidate `aggregate_lean` probes — see
     `top-predictors.services.ts`). -->
<section class="market-top-predictors" aria-labelledby="market-top-predictors-h">
	<header class="market-top-predictors-head">
		<h3 id="market-top-predictors-h" class="market-top-predictors-title">
			{t({ locale: $localeStore, key: 'market.detail.top_predictors.title' })}
		</h3>
	</header>

	{#if isNullish(topPredictors)}
		<!-- Still resolving — keep the area blank instead of flashing the
		     empty state under people who are about to appear. -->
	{:else if rows.length === 0}
		<p class="market-top-predictors-empty">
			{t({ locale: $localeStore, key: 'market.detail.top_predictors.empty' })}
		</p>
	{:else}
		<ul class="market-top-predictors-list">
			{#each rows as { user, side } (user.owner)}
				<li class="market-top-predictors-row">
					<div class="market-top-predictors-id">
						<Avatar
							class="market-top-predictors-avatar"
							avatar={user.avatar}
							avatarParts={user.avatarParts}
							nickname={user.nickname}
							owner={user.owner}
						/>
						<div class="market-top-predictors-meta">
							<span class="market-top-predictors-name">
								{user.nickname !== '' ? user.nickname : user.owner.slice(0, 8)}
							</span>
							<span class="num market-top-predictors-sub">
								{Math.round(user.accuracy)}%
								{t({ locale: $localeStore, key: 'market.detail.top_predictors.acc' })} ·
								{user.dailyStreak}{t({
									locale: $localeStore,
									key: 'market.detail.top_predictors.streak'
								})}
							</span>
						</div>
					</div>
					<span class="market-top-predictors-side" class:is-no={side === 'NO'}>
						{side === 'YES'
							? t({ locale: $localeStore, key: 'outcome.yes' })
							: t({ locale: $localeStore, key: 'outcome.no' })}
					</span>
				</li>
			{/each}
		</ul>
	{/if}

	{#if nonNullish(followedLean) && followedLean.total > 0}
		<div class="market-followed-lean">
			<div class="market-followed-lean-head">
				<span class="market-followed-lean-label">
					{t({ locale: $localeStore, key: 'market.detail.followed_lean.label' })}
				</span>
				<span class="num market-followed-lean-count">
					<span class="text-yes">{followedLean.yes}</span>
					{t({ locale: $localeStore, key: 'outcome.yes' })}
					<span class="market-followed-lean-sep" aria-hidden="true">·</span>
					<span class="text-no">{followedNo}</span>
					{t({ locale: $localeStore, key: 'outcome.no' })}
				</span>
			</div>
			<div
				class="market-followed-lean-dots"
				aria-label={t({
					locale: $localeStore,
					key: 'market.detail.followed_lean.aria',
					params: { yes: followedLean.yes, no: followedNo }
				})}
				role="img"
			>
				{#each Array.from({ length: followedLean.total }, (_, i) => i) as i (i)}
					<span class="market-followed-lean-dot" class:is-yes={i < followedLean.yes}></span>
				{/each}
			</div>
		</div>
	{/if}
</section>

<style lang="postcss">
	.market-top-predictors {
		padding: 0.5rem 1.25rem 1.25rem;
	}

	.market-top-predictors-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.5rem 0 0.75rem;
	}

	.market-top-predictors-title {
		margin: 0;
		color: var(--text-base);
		font-size: var(--t-16);
		font-weight: 600;
		letter-spacing: var(--tracking-snug);
	}

	.market-top-predictors-empty {
		margin: 0;
		padding: 0.75rem;
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		background: color-mix(in srgb, var(--bg-surface) 86%, transparent);
		color: var(--text-muted);
		font-size: var(--t-13);
	}

	.market-top-predictors-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.market-top-predictors-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.625rem 0.75rem;
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		background: color-mix(in srgb, var(--bg-surface) 86%, transparent);
	}

	.market-top-predictors-id {
		display: inline-flex;
		align-items: center;
		gap: 0.625rem;
		min-width: 0;
	}

	:global(.market-top-predictors-avatar) {
		width: 2rem;
		height: 2rem;
		flex-shrink: 0;
	}

	.market-top-predictors-meta {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}

	.market-top-predictors-name {
		overflow: hidden;
		color: var(--text-base);
		font-size: var(--t-13);
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.market-top-predictors-sub {
		color: var(--text-muted);
		font-size: var(--t-10);
		font-weight: 700;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
	}

	.market-top-predictors-side {
		flex-shrink: 0;
		padding: 0.2rem 0.5rem;
		border-radius: var(--r-pill);
		background: color-mix(in srgb, var(--yes) 12%, transparent);
		color: var(--yes);
		font-size: var(--t-10);
		font-weight: 700;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
	}

	.market-top-predictors-side.is-no {
		background: color-mix(in srgb, var(--no) 12%, transparent);
		color: var(--no);
	}

	/* Followed-lean row — how the people the viewer follows have called
	   this market. A label + `N YES · M NO` count over a dot grid, so
	   the social signal reads at a glance without a second list. */
	.market-followed-lean {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.5rem;
		padding: 0.75rem;
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		background: color-mix(in srgb, var(--bg-surface) 86%, transparent);
		box-shadow: var(--inset-hi);
	}

	.market-followed-lean-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.market-followed-lean-label {
		color: var(--text-base);
		font-size: var(--t-12);
		font-weight: 500;
	}

	.market-followed-lean-count {
		color: var(--text-muted);
		font-size: var(--t-12);
		font-weight: 700;
	}

	.market-followed-lean-count .text-yes,
	.market-followed-lean-count .text-no {
		font-weight: 700;
	}

	.market-followed-lean-sep {
		margin: 0 0.25rem;
		color: var(--fg-faint);
	}

	.market-followed-lean-dots {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.market-followed-lean-dot {
		width: 10px;
		height: 10px;
		border-radius: var(--r-pill);
		background: var(--no);
		opacity: 0.78;
		box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.18);
	}

	.market-followed-lean-dot.is-yes {
		background: var(--yes);
		opacity: 1;
	}
</style>
