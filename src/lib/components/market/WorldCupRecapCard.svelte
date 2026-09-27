<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { EM_DASH } from '$lib/constants/app.constants';
	import { balanceDomain } from '$lib/derived/balance-domain.derived';
	import { featuredEvent } from '$lib/derived/featured-event.derived';
	import { syncMyStats } from '$lib/services/profile.services';
	import { loadMyUserStats } from '$lib/services/user-stats.services';
	import { localeStore } from '$lib/stores/locale.store';
	import { userStore } from '$lib/stores/user.store';
	import type { UserStatsDoc } from '$lib/types/user-stats';
	import { t } from '$lib/utils/i18n.utils';

	/**
	 * Recap "trophy" card shown at the top of the Markets list in the
	 * `open` phase of the World-Cup arc (the Cup has resolved). It mirrors
	 * the user's World-Cup performance — accuracy + call count, read from
	 * the same `wc` category bucket the Dash rank tile uses — and converts
	 * the wound-down event into broader play via an "Explore all markets"
	 * CTA.
	 *
	 * Real data only: accuracy and call count come from the persisted
	 * `user_stats` snapshot. When there are no World-Cup calls (or the
	 * snapshot hasn't loaded) the figures render as `EM_DASH` — we never
	 * fabricate a number.
	 */
	interface Props {
		/**
		 * Drop the WC focus and land the list on the all-categories view.
		 * Wired by `MarketsPage`.
		 */
		onExplore: () => void;
	}

	const { onExplore }: Props = $props();

	let userStats = $state<UserStatsDoc | undefined>(undefined);

	// Recompute then load the caller's stats. Mirrors `DashPage`: a user who
	// stayed signed in through World-Cup settlements would otherwise see the
	// last persisted snapshot, so we recompute from clearing history first,
	// then read the refreshed `user_stats` doc. `userStats` is cleared on
	// every owner change (including sign-out) so a shared device / account
	// switch can never flash the previous user's WC figures.
	$effect(() => {
		const owner = $userStore.profile?.owner;
		// Capture the domain synchronously so it's both a tracked dependency
		// and a stable value for the async recompute below.
		const domain = $balanceDomain;

		userStats = undefined;

		if (isNullish(owner)) {
			return;
		}

		let cancelled = false;

		void (async () => {
			try {
				await syncMyStats({ domain });
			} catch (err) {
				console.error('WorldCupRecapCard: failed to recompute stats', err);
			}

			try {
				const doc = await loadMyUserStats(owner);

				if (!cancelled) {
					userStats = doc;
				}
			} catch (err) {
				console.error('WorldCupRecapCard: failed to load user_stats', err);
			}
		})();

		return () => {
			cancelled = true;
		};
	});

	// The `wc` bucket is the event's own accuracy slice — the same source
	// the Dash rank tile reads. `undefined` until there's at least one call.
	const wcBucket = $derived(userStats?.categoryStats?.wc);
	const calls = $derived(wcBucket?.calls ?? 0);
	const accuracyPct = $derived(
		wcBucket && wcBucket.calls > 0 ? Math.round((wcBucket.wins / wcBucket.calls) * 100) : undefined
	);
</script>

<div style="margin: 4px 20px 16px;" class="recap card">
	<div class="recap-eyebrow eyebrow-xs acc" aria-hidden="true">⊹</div>
	<div class="recap-eyebrow eyebrow-xs">
		{t({
			locale: $localeStore,
			key: 'markets.wc_recap.eyebrow',
			params: { event: $featuredEvent.title }
		})}
	</div>

	<div class="recap-stats">
		<div class="recap-stat">
			<span class="recap-stat-v num acc t-h4">
				{#if nonNullish(accuracyPct)}{accuracyPct}%{:else}{EM_DASH}{/if}
			</span>
			<span class="recap-stat-l mute eyebrow-xs">
				{t({ locale: $localeStore, key: 'markets.wc_recap.accuracy' })}
			</span>
		</div>
		<div class="recap-stat">
			<span class="recap-stat-v num t-h4">
				{#if calls > 0}{calls.toLocaleString()}{:else}{EM_DASH}{/if}
			</span>
			<span class="recap-stat-l mute eyebrow-xs">
				{t({ locale: $localeStore, key: 'markets.wc_recap.calls' })}
			</span>
		</div>
	</div>

	<p class="recap-line dim t-body-sm">
		{t({ locale: $localeStore, key: 'markets.wc_recap.line' })}
	</p>

	<button class="recap-cta" onclick={onExplore} type="button">
		{t({ locale: $localeStore, key: 'markets.wc_recap.cta' })} →
	</button>
</div>

<style lang="postcss">
	.recap {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		background: linear-gradient(180deg, var(--laurel-glow), var(--bg-surface));
		border-color: color-mix(in srgb, var(--laurel) 28%, var(--border-base));
	}

	.recap-eyebrow {
		color: var(--text-muted);
	}

	.recap-eyebrow.acc {
		color: var(--laurel);
		font-size: 18px;
		line-height: 1;
	}

	.recap-stats {
		display: flex;
		gap: 2rem;
	}

	.recap-stat {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.recap-stat-v {
		font-weight: 600;
		line-height: 1;
	}

	.recap-line {
		margin: 0;
		max-width: 36ch;
	}

	.recap-cta {
		align-self: flex-start;
		appearance: none;
		background: transparent;
		border: 0;
		padding: 0;
		font: inherit;
		font-size: var(--t-12);
		letter-spacing: 0.02em;
		color: var(--laurel);
		cursor: pointer;
	}
</style>
