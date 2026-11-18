<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	/**
	 * Zone 2 · Stack: the holdings card. Shows total holdings as the headline
	 * with in-play (backed) and today's net delta as compact sub-stats. Tapping
	 * the card opens the {@link DashStackSheet} breakdown.
	 *
	 * `holdingsDisplay` / `inPlayDisplay` are pre-formatted whole-VXP strings
	 * from the shared `vxp-holdings` derived; `todayDelta` is the signed net VXP
	 * change across the recent settlement window (whole VXP).
	 */
	import { ChevronRight } from '@lucide/svelte/icons';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		/** Total holdings (available + backed), formatted whole-VXP. */
		holdingsDisplay: string;
		/** Backed VXP currently locked in open calls / orders, formatted. */
		inPlayDisplay: string;
		/** Signed net VXP delta over the recent window, or `null` when unknown. */
		todayDelta: number | null;
		/** Figures not loaded yet: render pulsing placeholders instead of 0. */
		loading: boolean;
		/**
		 * `user_stats` (which backs TODAY) not fetched yet: pulse its placeholder
		 * instead of the static em-dash a loaded-but-quiet window shows.
		 */
		todayLoading: boolean;
		onOpen: () => void;
	}

	let { holdingsDisplay, inPlayDisplay, todayDelta, loading, todayLoading, onOpen }: Props =
		$props();

	const todayPositive = $derived(nonNullish(todayDelta) && todayDelta >= 0);
</script>

<!-- While loading, the breakdown sheet would expose the same misleading
     zero/partial figures the placeholders hide: keep the card inert. -->
<button class="db-wallet" disabled={loading} onclick={onOpen} type="button">
	<div class="db-left">
		<div class="db-k">{t({ locale: $localeStore, key: 'dash.holdings.eyebrow' })}</div>
		<div class="db-v num" class:db-ph={loading}>
			{loading ? t({ locale: $localeStore, key: 'dash.rank.placeholder' }) : holdingsDisplay}<span
				class="db-vu">VXP</span
			>
		</div>
	</div>
	<div class="db-wright">
		<div class="db-stat">
			<div class="db-kk">{t({ locale: $localeStore, key: 'dash.build.in_play' })}</div>
			<div class="db-vv num" class:db-ph={loading}>
				{loading ? t({ locale: $localeStore, key: 'dash.rank.placeholder' }) : inPlayDisplay}
			</div>
		</div>
		<div class="db-stat">
			<div class="db-kk">{t({ locale: $localeStore, key: 'dash.build.today' })}</div>
			<div
				class="db-vv num"
				class:db-ph={todayLoading}
				class:down={nonNullish(todayDelta) && !todayPositive}
				class:up={todayPositive}
			>
				{#if todayLoading || isNullish(todayDelta)}
					{t({ locale: $localeStore, key: 'dash.rank.placeholder' })}
				{:else}
					{t({
						locale: $localeStore,
						key: todayPositive ? 'dash.build.today_pos' : 'dash.build.today_neg',
						params: { value: Math.abs(todayDelta) }
					})}
				{/if}
			</div>
		</div>
		<span class="db-wchev" aria-hidden="true">
			<ChevronRight size={15} strokeWidth={2} />
		</span>
	</div>
</button>
