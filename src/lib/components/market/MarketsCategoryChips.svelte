<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import {
		microsOfMacro,
		type MacroId,
		type MicroId
	} from '#lib/constants/market-taxonomy.constants.ts';
	import { populatedMacros, populatedMicros } from '#lib/derived/market-tags.derived.ts';
	import { track } from '#lib/services/analytics.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { categoryLabel } from '#lib/utils/market-tags.utils.ts';
	import { tagColor } from '#lib/utils/tag-color.utils.ts';

	/**
	 * Browse category nav for the Markets board: a top macro bar (only the
	 * populated macros, plus an "All" reset) and, when a macro is selected, a
	 * second row of its populated micro sub-chips. Selection state is owned by
	 * the parent (`MarketsPage`) so the same choice drives the board filter;
	 * this component only renders the populated branches and reports changes.
	 *
	 * A chip selection emits a bounded `market_category_filter` analytics
	 * event (macro id, optional micro id: closed taxonomy vocab, no PII).
	 */
	interface Props {
		/** Selected macro, or `undefined` for the "All" (unfiltered) state. */
		selectedMacro?: MacroId;
		/** Selected micro within the macro, or `undefined` for its "All". */
		selectedMicro?: MicroId;
		/** Set the macro filter (`undefined` clears to All). Clears the micro. */
		onSelectMacro: (macro: MacroId | undefined) => void;
		/** Set the micro filter within the active macro (`undefined` = All). */
		onSelectMicro: (micro: MicroId | undefined) => void;
	}

	const { selectedMacro, selectedMicro, onSelectMacro, onSelectMicro }: Props = $props();

	// Micros to offer under the active macro: its taxonomy children narrowed to
	// the ones that actually carry a live market. Empty when no macro is
	// selected, so the sub-row is hidden.
	const microChips = $derived.by<MicroId[]>(() => {
		if (nonNullish(selectedMacro)) {
			const populated = new Set($populatedMicros);

			return microsOfMacro(selectedMacro).filter((micro) => populated.has(micro));
		}

		return [];
	});

	// The selection rides the bounded `label` dimension (macro id, or
	// `macro:micro` when drilled in): closed taxonomy vocab, no PII. The
	// props schema is a closed set shared with the satellite, so `label`
	// carries the category dimension rather than a dedicated field.
	const selectMacro = (macro: MacroId | undefined): void => {
		onSelectMacro(macro);

		if (nonNullish(macro)) {
			track({ name: 'market_category_filter', source: 'markets', label: macro });
		}
	};

	const selectMicro = (micro: MicroId | undefined): void => {
		onSelectMicro(micro);

		if (nonNullish(micro) && nonNullish(selectedMacro)) {
			track({
				name: 'market_category_filter',
				source: 'markets',
				label: `${selectedMacro}:${micro}`
			});
		}
	};
</script>

<div class="cat-chips">
	<div
		class="cat-row no-scrollbar"
		aria-label={t({ locale: $localeStore, key: 'market.category.filter_aria' })}
		role="tablist"
	>
		<button
			class="cat-chip"
			class:is-active={!nonNullish(selectedMacro)}
			aria-selected={!nonNullish(selectedMacro)}
			onclick={() => selectMacro(undefined)}
			role="tab"
			type="button"
		>
			{t({ locale: $localeStore, key: 'market.category.all' })}
		</button>
		{#each $populatedMacros as macro (macro)}
			{@const active = selectedMacro === macro}
			<button
				style:--chip-accent={tagColor(macro)}
				class="cat-chip"
				class:is-active={active}
				aria-selected={active}
				onclick={() => selectMacro(macro)}
				role="tab"
				type="button"
			>
				{categoryLabel({ category: macro, variant: 'full', locale: $localeStore })}
			</button>
		{/each}
	</div>

	{#if microChips.length > 0}
		<div
			class="cat-row cat-row-micro no-scrollbar"
			aria-label={t({ locale: $localeStore, key: 'market.category.subfilter_aria' })}
			role="tablist"
		>
			<button
				class="cat-chip cat-chip-micro"
				class:is-active={!nonNullish(selectedMicro)}
				aria-selected={!nonNullish(selectedMicro)}
				onclick={() => selectMicro(undefined)}
				role="tab"
				type="button"
			>
				{t({ locale: $localeStore, key: 'market.category.all' })}
			</button>
			{#each microChips as micro (micro)}
				{@const active = selectedMicro === micro}
				<button
					style:--chip-accent={tagColor(micro)}
					class="cat-chip cat-chip-micro"
					class:is-active={active}
					aria-selected={active}
					onclick={() => selectMicro(micro)}
					role="tab"
					type="button"
				>
					{categoryLabel({ category: micro, variant: 'full', locale: $localeStore })}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style lang="postcss">
	.cat-chips {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 4px 0 12px;
	}

	.cat-row {
		display: flex;
		gap: 8px;
		padding: 0 var(--spacing-edge);
		overflow-x: auto;
		scroll-snap-type: x proximity;
	}

	.cat-chip {
		flex: 0 0 auto;
		appearance: none;
		cursor: pointer;
		white-space: nowrap;
		padding: 7px 14px;
		border-radius: var(--r-pill);
		border: 1px solid var(--border-strong);
		background: var(--bg-surface);
		color: var(--fg-dim);
		font-family: inherit;
		font-size: var(--t-13);
		font-weight: 600;
		letter-spacing: 0.01em;
		transition:
			background 0.16s ease,
			border-color 0.16s ease,
			color 0.16s ease;
	}

	.cat-chip:hover {
		color: var(--text-base);
		border-color: var(--accent, var(--border-strong));
	}

	/* Active chip: tinted with the category accent (macro hue), falling back
	   to the brand accent for the "All" chip which carries no category colour. */
	.cat-chip.is-active {
		color: var(--chip-accent, var(--accent));
		border-color: color-mix(in srgb, var(--chip-accent, var(--accent)) 45%, transparent);
		background: color-mix(in srgb, var(--chip-accent, var(--accent)) 12%, transparent);
	}

	.cat-chip-micro {
		padding: 5px 12px;
		font-size: var(--t-12);
	}
</style>
