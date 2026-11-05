<script lang="ts">
	/**
	 * Holdings breakdown — a "Your VXP" hero equal to total holdings, a
	 * two-segment split bar whose widths track the available / in-play
	 * magnitudes, then two colour-keyed bucket rows (Available, In play) that
	 * sum back to the hero. Pure presentation: the formatted figures and bigint
	 * magnitudes arrive from the host. Shared by the Dash holdings sheet and the
	 * transaction-history summary so the two surfaces read identically.
	 */
	import { ZERO } from '#lib/constants/app.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		/** Total holdings, formatted — the hero figure (available + in play). */
		holdingsDisplay: string;
		/** Spendable VXP, formatted — the Available bucket value. */
		availableDisplay: string;
		/** Backed VXP currently in play, formatted — the In play bucket value. */
		inPlayDisplay: string;
		/** Spendable magnitude (base units) — drives the Available split segment width. */
		availableValue: bigint;
		/** Backed magnitude (base units) — drives the In play split segment width. */
		inPlayValue: bigint;
		/** Open calls behind the in-play stake — pluralises the In play sub-label. */
		openCallCount: number;
	}

	let {
		holdingsDisplay,
		availableDisplay,
		inPlayDisplay,
		availableValue,
		inPlayValue,
		openCallCount
	}: Props = $props();

	const hasAvailable = $derived(availableValue > ZERO);
	const hasInPlay = $derived(inPlayValue > ZERO);
	const hasBar = $derived(hasAvailable || hasInPlay);

	const inPlaySubKey = $derived(
		openCallCount === 0
			? ('dash.build.sheet_inplay_sub_none' as const)
			: openCallCount === 1
				? ('dash.build.sheet_inplay_sub_one' as const)
				: ('dash.build.sheet_inplay_sub_many' as const)
	);
</script>

<div class="db-sheet-h">
	<span class="db-sheet-title">{t({ locale: $localeStore, key: 'dash.build.sheet_your_vxp' })}</span
	>
	<span class="db-sheet-bal num">{holdingsDisplay} <em>VXP</em></span>
</div>

{#if hasBar}
	<div class="db-split" aria-hidden="true">
		{#if hasAvailable}
			<span style:flex-grow={Number(availableValue)} class="db-split-seg avail"></span>
		{/if}
		{#if hasInPlay}
			<span style:flex-grow={Number(inPlayValue)} class="db-split-seg inplay"></span>
		{/if}
	</div>
{/if}

<div class="db-bucket">
	<span class="db-bucket-dot avail" aria-hidden="true"></span>
	<span class="db-bucket-t">
		<span>{t({ locale: $localeStore, key: 'dash.holdings.available' })}</span>
		<em>{t({ locale: $localeStore, key: 'dash.build.sheet_avail_sub' })}</em>
	</span>
	<span class="db-bucket-v num">{availableDisplay}</span>
</div>
<div class="db-bucket">
	<span class="db-bucket-dot inplay" aria-hidden="true"></span>
	<span class="db-bucket-t">
		<span>{t({ locale: $localeStore, key: 'dash.build.in_play' })}</span>
		<em>{t({ locale: $localeStore, key: inPlaySubKey, params: { count: openCallCount } })}</em>
	</span>
	<span class="db-bucket-v num">{inPlayDisplay}</span>
</div>

<style lang="postcss">
	.db-split {
		display: flex;
		gap: 3px;
		height: 8px;
		margin-bottom: 16px;
		border-radius: 999px;
		overflow: hidden;
	}

	.db-split-seg {
		flex-basis: 0;
		min-width: 4px;
		border-radius: 999px;
	}

	.db-split-seg.avail {
		background: var(--accent);
	}

	.db-split-seg.inplay {
		background: var(--fg-faint);
	}

	.db-bucket {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 11px 0;
		border-bottom: 1px solid var(--border-base);
		font-family: var(--font-mono);
	}

	.db-bucket-dot {
		width: 9px;
		height: 9px;
		flex-shrink: 0;
		border-radius: 999px;
	}

	.db-bucket-dot.avail {
		background: var(--accent);
	}

	.db-bucket-dot.inplay {
		background: var(--fg-faint);
	}

	.db-bucket-t {
		display: flex;
		flex: 1;
		min-width: 0;
		flex-direction: column;
		gap: 1px;
	}

	.db-bucket-t span {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-base);
	}

	.db-bucket-t em {
		font-style: normal;
		font-size: 11px;
		color: var(--text-muted);
	}

	.db-bucket-v {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-base);
	}
</style>
