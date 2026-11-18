<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	/**
	 * Zone 1 · Performance: the Dashboard masthead. A large mono accuracy
	 * number anchors the screen; beneath it sit the session delta + streak
	 * flame, a tappable benchmark toggle (global average ⇄ friends), and the
	 * swipeable accuracy-trend chart.
	 *
	 * All inputs are real: `accuracyValue` is the persisted lifetime accuracy,
	 * `sessionDelta` is reconstructed from recent settlements, `streak` is the
	 * daily-streak counter, and `friendsAhead` / `friendsTotal` come from the
	 * social graph joined with cached profiles. The trend line itself is
	 * synthesised deterministically (see `DashTrendChart`).
	 */
	import { Flame, Globe } from '@lucide/svelte/icons';
	import DashTrendChart from '#lib/components/dash/DashTrendChart.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		/** Accuracy as a 0..100 percentage. */
		accuracyValue: number;
		/** Accuracy formatted to one decimal for the big number. */
		accuracyPct: string;
		/** Session delta in points, or `null` for a first session. */
		sessionDelta: number | null;
		/** Current daily streak. */
		streak: number;
		/** Number of friends the user is ahead of (accuracy ≥). */
		friendsAhead: number;
		/** Total friends with a comparable record. */
		friendsTotal: number;
	}

	let { accuracyValue, accuracyPct, sessionDelta, streak, friendsAhead, friendsTotal }: Props =
		$props();

	// The global benchmark the anchor line compares against, the same 30-day
	// network average surfaced elsewhere on the dashboard copy.
	const GLOBAL_AVERAGE = 62.1;

	// 0 = global average, 1 = friends.
	let benchmark = $state(0);

	const aboveGlobal = $derived(accuracyValue >= GLOBAL_AVERAGE);

	const benchmarkText = $derived.by(() => {
		if (benchmark === 0) {
			return t({
				locale: $localeStore,
				key: aboveGlobal ? 'dash.build.bench_global_above' : 'dash.build.bench_global_below',
				params: { avg: GLOBAL_AVERAGE }
			});
		}

		if (friendsTotal === 0) {
			return t({ locale: $localeStore, key: 'dash.build.bench_friends_none' });
		}

		return t({
			locale: $localeStore,
			key: 'dash.build.bench_friends',
			params: { ahead: friendsAhead, total: friendsTotal }
		});
	});

	const toggleBenchmark = (): void => {
		benchmark = (benchmark + 1) % 2;
	};
</script>

<div class="db-hero">
	<div class="db-hrow">
		<span class="db-lbl">{t({ locale: $localeStore, key: 'dash.accuracy.eyebrow' })}</span>
	</div>
	<div class="db-big num">
		{accuracyPct}<span class="db-u">%</span>
	</div>
	<div class="db-anchorline num">
		{#if nonNullish(sessionDelta)}
			{@const positive = sessionDelta >= 0}
			<span class="db-delta" class:db-delta-neg={!positive} class:db-delta-pos={positive}>
				{t({
					locale: $localeStore,
					key: positive ? 'dash.build.session_delta_pos' : 'dash.build.session_delta_neg',
					params: { value: positive ? sessionDelta : Math.abs(sessionDelta) }
				})}
			</span>
		{:else}
			<span class="db-delta db-delta-mute">
				{t({ locale: $localeStore, key: 'dash.accuracy.first_session' })}
			</span>
		{/if}
		<span class="db-flame">
			<Flame aria-hidden="true" size={11} strokeWidth={2} />
			{t({ locale: $localeStore, key: 'dash.build.streak', params: { count: streak } })}
		</span>
	</div>
	<button class="db-subanchor num" onclick={toggleBenchmark} type="button">
		<span class="db-bench-ico">
			<Globe aria-hidden="true" size={13} strokeWidth={1.8} />
		</span>
		<span class="db-bench-text">{benchmarkText}</span>
		<span class="db-bench-dots" aria-hidden="true">
			<i class:on={benchmark === 0}></i>
			<i class:on={benchmark === 1}></i>
		</span>
	</button>
	<DashTrendChart accuracyPct={accuracyValue} />
</div>

<style lang="postcss">
	/* Delta colour modifiers: the shared `.db-delta` weight/spacing lives in
	   `app.css`; only the semantic tint is component-local. */
	:global(.db-anchorline .db-delta.db-delta-pos) {
		color: var(--yes);
	}

	:global(.db-anchorline .db-delta.db-delta-neg) {
		color: var(--no);
	}

	:global(.db-anchorline .db-delta.db-delta-mute) {
		color: var(--fg-mute);
	}
</style>
