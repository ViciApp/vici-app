<script lang="ts">
	import { untrack } from 'svelte';
	import {
		classificationMicros,
		classificationTags,
		MACRO_IDS,
		microsOfMacro,
		normalizeStoredTags,
		type MacroId,
		type MicroId
	} from '#lib/constants/market-taxonomy.constants.ts';
	import { MarketWhyNowKind } from '#lib/enums/market-metadata.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { categoryLabel } from '#lib/utils/market-tags.utils.ts';
	import { tagColor } from '#lib/utils/tag-color.utils.ts';

	interface Props {
		whyKind: MarketWhyNowKind;
		whyText: string;
		/** Stored tags: micro ids (primary first) followed by Layer-3 free tags. */
		tags: string[];
		suggested: boolean;
		subtitle: string;
		isAdmin: boolean;
		onWhyKindChange: (value: MarketWhyNowKind) => void;
		onWhyTextChange: (value: string) => void;
		onTagsChange: (value: string[]) => void;
		onSuggestedChange: (value: boolean) => void;
		onSubtitleChange: (value: string) => void;
	}

	const {
		whyKind,
		whyText,
		tags,
		suggested,
		subtitle,
		isAdmin,
		onWhyKindChange,
		onWhyTextChange,
		onTagsChange,
		onSuggestedChange,
		onSubtitleChange
	}: Props = $props();

	// Structured view of the stored tags. `selectedMicros` is primary-first
	// (the classification's own order); the free-tag text seeds once from the
	// non-micro values (further edits are user-driven so it isn't re-synced).
	const selectedMicros = $derived(classificationMicros(tags));
	let activeMacro = $state<MacroId>(MACRO_IDS[0]);
	// One-time seed from the loaded free tags; further edits are user-driven so
	// it is intentionally not re-synced from the prop (untrack marks that).
	let freeTagText = $state(untrack(() => classificationTags(tags).join(', ')));

	// Parse the comma/space-separated free-tag input into lowercase-kebab ids,
	// dropping blanks and de-duplicating. Micro ids typed here still resolve to
	// the micro layer via `normalizeStoredTags` (micros are emitted first).
	const parseFreeTags = (value: string): string[] => {
		const out: string[] = [];

		for (const raw of value.split(/[\s,]+/)) {
			const kebab = raw
				.trim()
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-+|-+$/g, '');

			if (kebab.length > 0 && !out.includes(kebab)) {
				out.push(kebab);
			}
		}

		return out;
	};

	// Emit the flattened storage array: micros first (primary first), then the
	// free tags, normalized (trimmed / de-duplicated, order preserved).
	const emit = ({ micros, freeTags }: { micros: MicroId[]; freeTags: string[] }): void => {
		onTagsChange(normalizeStoredTags([...micros, ...freeTags]));
	};

	const toggleMicro = (micro: MicroId): void => {
		const current = classificationMicros(tags);
		const next = current.includes(micro)
			? current.filter((value) => value !== micro)
			: [...current, micro];

		emit({ micros: next, freeTags: parseFreeTags(freeTagText) });
	};

	const removeMicro = (micro: MicroId): void => {
		emit({
			micros: classificationMicros(tags).filter((value) => value !== micro),
			freeTags: parseFreeTags(freeTagText)
		});
	};

	const onFreeTagsInput = (value: string): void => {
		freeTagText = value;
		emit({ micros: classificationMicros(tags), freeTags: parseFreeTags(value) });
	};

	const microLabel = (micro: MicroId): string =>
		categoryLabel({ category: micro, variant: 'full', locale: $localeStore });
</script>

<div class="market-metadata-grid">
	<label>
		<span>{t({ locale: $localeStore, key: 'market.metadata.why_now' })}</span>
		<select
			onchange={(e) => onWhyKindChange(e.currentTarget.value as MarketWhyNowKind)}
			value={whyKind}
		>
			{#each Object.values(MarketWhyNowKind) as kind (kind)}
				<option value={kind}>{kind}</option>
			{/each}
		</select>
		<input
			oninput={(e) => onWhyTextChange(e.currentTarget.value)}
			placeholder={t({
				locale: $localeStore,
				key: 'market.metadata.placeholder.closing_soon'
			})}
			value={whyText}
		/>
	</label>

	<label>
		<span>{t({ locale: $localeStore, key: 'market.metadata.subtitle' })}</span>
		<input
			maxlength="60"
			oninput={(e) => onSubtitleChange(e.currentTarget.value)}
			placeholder={t({
				locale: $localeStore,
				key: 'market.metadata.placeholder.subtitle'
			})}
			value={subtitle}
		/>
	</label>

	<div class="market-metadata-tags">
		<span class="market-metadata-tags-label">
			{t({ locale: $localeStore, key: 'market.metadata.tags' })}
		</span>
		<p class="market-metadata-tags-help">
			{t({ locale: $localeStore, key: 'market.metadata.tags_help' })}
		</p>

		<!-- Selected micros — primary-first; the first chip is the primary
		     classification that drives card art / accent. -->
		{#if selectedMicros.length > 0}
			<div class="market-metadata-tags-grid">
				{#each selectedMicros as micro, index (micro)}
					<button
						style:--chip-accent={tagColor(micro)}
						class="market-metadata-tag-chip selected"
						class:is-primary={index === 0}
						aria-pressed="true"
						onclick={() => removeMicro(micro)}
						type="button"
					>
						{#if index === 0}
							<span class="market-metadata-tag-primary">
								{t({ locale: $localeStore, key: 'market.metadata.tag_primary' })}
							</span>
						{/if}
						{microLabel(micro)} ✕
					</button>
				{/each}
			</div>
		{/if}

		<!-- Macro selector — picks which macro's micros to browse. -->
		<div class="market-metadata-macro-row">
			{#each MACRO_IDS as macro (macro)}
				<button
					style:--chip-accent={tagColor(macro)}
					class="market-metadata-tag-chip"
					class:selected={activeMacro === macro}
					aria-pressed={activeMacro === macro}
					onclick={() => (activeMacro = macro)}
					type="button"
				>
					{categoryLabel({ category: macro, variant: 'full', locale: $localeStore })}
				</button>
			{/each}
		</div>

		<!-- Micros of the active macro — multi-select. -->
		<div class="market-metadata-tags-grid">
			{#each microsOfMacro(activeMacro) as micro (micro)}
				{@const selected = selectedMicros.includes(micro)}
				<button
					style:--chip-accent={tagColor(micro)}
					class="market-metadata-tag-chip"
					class:selected
					aria-pressed={selected}
					onclick={() => toggleMicro(micro)}
					type="button"
				>
					{microLabel(micro)}
				</button>
			{/each}
		</div>

		<!-- Free tags — comma/space separated, lowercase-kebab (e.g.
		     `world-cup, bitcoin-etf`). -->
		<label class="market-metadata-freetags">
			<span>{t({ locale: $localeStore, key: 'market.metadata.free_tags' })}</span>
			<input
				oninput={(e) => onFreeTagsInput(e.currentTarget.value)}
				placeholder={t({ locale: $localeStore, key: 'market.metadata.free_tags_placeholder' })}
				value={freeTagText}
			/>
		</label>
	</div>

	{#if isAdmin}
		<label class="market-metadata-toggle">
			<input
				checked={suggested}
				onchange={(e) => onSuggestedChange(e.currentTarget.checked)}
				type="checkbox"
			/>
			<span>
				<span class="market-metadata-toggle-title">
					{t({ locale: $localeStore, key: 'market.metadata.suggested' })}
				</span>
				<span class="market-metadata-toggle-help">
					{t({ locale: $localeStore, key: 'market.metadata.suggested_help' })}
				</span>
			</span>
		</label>
	{/if}
</div>

<style lang="postcss">
	.market-metadata-grid {
		display: grid;
		gap: 0.875rem;
		margin-bottom: 1rem;
	}

	.market-metadata-grid label {
		display: grid;
		gap: 0.4rem;
	}

	.market-metadata-grid label > span {
		color: var(--text-muted);
		font-size: var(--t-12);
		font-weight: 700;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
	}

	.market-metadata-grid input,
	.market-metadata-grid select {
		width: 100%;
		border: 1px solid var(--border-base);
		border-radius: var(--r-8);
		background: var(--bg-surface);
		color: var(--text-base);
		padding: 0.65rem 0.75rem;
		font: inherit;
	}

	.market-metadata-toggle {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: start;
		gap: 0.6rem;
	}

	.market-metadata-toggle input {
		width: 1.1rem;
		height: 1.1rem;
		margin-top: 0.15rem;
	}

	.market-metadata-toggle-title {
		display: block;
		color: var(--text-base);
		font-size: var(--t-14);
		font-weight: 600;
		letter-spacing: normal;
		text-transform: none;
	}

	.market-metadata-toggle-help {
		display: block;
		color: var(--text-muted);
		font-size: var(--t-12);
		font-weight: 400;
		letter-spacing: normal;
		text-transform: none;
		margin-top: 0.15rem;
	}

	.market-metadata-tags {
		display: grid;
		gap: 0.4rem;
	}

	.market-metadata-tags-label {
		color: var(--text-muted);
		font-size: var(--t-12);
		font-weight: 700;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
	}

	.market-metadata-tags-help {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--t-12);
	}

	.market-metadata-tags-grid,
	.market-metadata-macro-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.market-metadata-macro-row {
		margin-top: 0.5rem;
		padding-bottom: 0.4rem;
		border-bottom: 1px solid var(--border-base);
	}

	.market-metadata-tag-primary {
		font-size: var(--t-10, 10px);
		font-weight: 700;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
		opacity: 0.8;
		margin-right: 0.3rem;
	}

	.market-metadata-freetags {
		display: grid;
		gap: 0.4rem;
		margin-top: 0.5rem;
	}

	.market-metadata-freetags > span {
		color: var(--text-muted);
		font-size: var(--t-12);
		font-weight: 700;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
	}

	.market-metadata-freetags input {
		width: 100%;
		border: 1px solid var(--border-base);
		border-radius: var(--r-8);
		background: var(--bg-surface);
		color: var(--text-base);
		padding: 0.65rem 0.75rem;
		font: inherit;
	}

	.market-metadata-tag-chip {
		border: 1px solid var(--border-base);
		border-radius: var(--r-pill, 999px);
		background: var(--bg-surface);
		color: var(--text-base);
		padding: 0.35rem 0.8rem;
		font: inherit;
		font-size: var(--t-13);
		font-weight: 500;
		cursor: pointer;
		transition:
			background 0.15s ease,
			border-color 0.15s ease,
			color 0.15s ease;
	}

	.market-metadata-tag-chip:hover {
		border-color: var(--text-base);
	}

	.market-metadata-tag-chip.selected {
		background: color-mix(in srgb, var(--chip-accent, var(--text-base)) 16%, var(--bg-surface));
		border-color: color-mix(in srgb, var(--chip-accent, var(--text-base)) 55%, transparent);
		color: var(--text-base);
	}

	.market-metadata-tag-chip.is-primary {
		border-color: var(--chip-accent, var(--text-base));
	}
</style>
