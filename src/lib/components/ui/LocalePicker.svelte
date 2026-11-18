<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import { Check, ChevronDown, Globe, Search } from '@lucide/svelte/icons';
	import CountryFlag from '#lib/components/ui/CountryFlag.svelte';
	import {
		LOCALE_REGISTRY,
		localeLanguageGroups,
		type AppLocale,
		type LocaleEntry
	} from '#lib/constants/locale.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	/**
	 * Two-axis (Language ▸ Region) locale picker: the shared inner content
	 * behind the landing globe popover, the landing mobile sheet and the
	 * Settings sheet.
	 *
	 * Languages list from `localeLanguageGroups()`; a multi-region language
	 * (Spanish, Portuguese) renders an expandable header drilling into its
	 * regional editions, while a single-region language collapses to one direct
	 * pick row. An explicit choice exposes a "Use automatic" reset (rendered by
	 * the host surface) so a user is never trapped.
	 *
	 * Flags diverge from emoji: country region rows render the SVG
	 * `CountryFlag` for their ISO region, while language headers and
	 * supra-national rows (`worldFlag`) render the lucide `Globe`.
	 */
	interface Props {
		/** Currently active locale (reflected as selected / expanded). */
		current: AppLocale;
		/** Apply a locale choice. */
		onPick: (locale: AppLocale) => void;
		/** Autofocus the search input on mount (popover/sheet open). */
		autoFocus?: boolean;
		/** Max height of the scrollable list region, in px. */
		maxHeight?: number;
	}

	const { current, onPick, autoFocus = true, maxHeight = 360 }: Props = $props();

	let query = $state('');

	// Accent-folded lower-case normaliser so a search for "espanol" still
	// matches "Español".
	const norm = (value: string): string => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

	const trimmedQuery = $derived(norm(query.trim()));

	const groups = localeLanguageGroups();

	// The active locale's registry entry: drives which language header is
	// pre-expanded and which region row is selected.
	const currentEntry = $derived<LocaleEntry | undefined>(
		LOCALE_REGISTRY.find(({ id }) => id === current)
	);
	const currentLang = $derived(currentEntry ? currentEntry.id.split('-')[0] : null);

	// A `hidden` base locale (e.g. `es`) is never rendered as a region row, so
	// when it is the active locale, possible via legacy storage or browser
	// detection, no option would show as selected. Represent it by its group's
	// neutral (worldFlag) region, falling back to the first visible region, so
	// the current selection is always reflected by a rendered option.
	const selectedEntry = $derived.by<LocaleEntry | undefined>(() => {
		if (!currentEntry || currentEntry.hidden !== true) {
			return currentEntry;
		}

		const group = groups.find(({ lang }) => lang === currentLang);

		return group?.regions.find(({ worldFlag }) => worldFlag) ?? group?.regions[0] ?? currentEntry;
	});
	const selectedId = $derived<AppLocale | undefined>(selectedEntry?.id);

	// Track which language header is open. Seed from the active language so a
	// returning user lands with their language drilled in.
	let openLang = $state<string | null>(null);
	let openLangSeeded = $state(false);

	$effect(() => {
		if (!openLangSeeded && nonNullish(currentLang)) {
			openLang = currentLang;
			openLangSeeded = true;
		}
	});

	const matchesQuery = (group: (typeof groups)[number]): boolean => {
		if (trimmedQuery.length === 0) {
			return true;
		}

		if (norm(group.label).includes(trimmedQuery) || norm(group.name).includes(trimmedQuery)) {
			return true;
		}

		return group.regions.some(
			(region) =>
				norm(region.regionLabel).includes(trimmedQuery) ||
				norm(region.name).includes(trimmedQuery) ||
				norm(region.id).includes(trimmedQuery)
		);
	};

	const visibleGroups = $derived(groups.filter(matchesQuery));

	const toggleLang = (lang: string) => {
		openLang = openLang === lang ? null : lang;
	};
</script>

<div class="lp-picker">
	<div class="lp-search">
		<span class="lp-search-icon" aria-hidden="true">
			<Search size={16} strokeWidth={1.8} />
		</span>
		<!-- svelte-ignore a11y_autofocus -->
		<input
			class="lp-search-input"
			aria-label={t({ locale: $localeStore, key: 'picker.search' })}
			autofocus={autoFocus}
			placeholder={t({ locale: $localeStore, key: 'picker.search' })}
			type="text"
			bind:value={query}
		/>
	</div>

	<!--
		A list of native <button> rows, not a listbox: the container mixes
		section headings and expandable language headers with the selectable
		rows, so listbox/option semantics would misreport. Rows use native
		button semantics and mark the active locale with `aria-current`.
	-->
	<div
		style:max-height="{maxHeight}px"
		class="lp-list"
		aria-label={t({ locale: $localeStore, key: 'a11y.language' })}
		role="group"
	>
		{#if visibleGroups.length === 0}
			<p class="lp-empty num">{t({ locale: $localeStore, key: 'picker.no_match' })}</p>
		{/if}

		{#each visibleGroups as group (group.lang)}
			{#if group.regions.length <= 1}
				{@const [region] = group.regions}
				{@const active = region.id === selectedId}
				<button
					class="lp-row"
					class:is-active={active}
					aria-current={active ? 'true' : undefined}
					onclick={() => onPick(region.id)}
					type="button"
				>
					<span class="lp-flag" aria-hidden="true">
						{#if region.worldFlag}
							<Globe size={17} strokeWidth={1.8} />
						{:else}
							<CountryFlag class="lp-flag-img" countryCode={region.region} />
						{/if}
					</span>
					<span class="lp-row-text">
						<span class="lp-row-title">{group.label}</span>
						{#if group.name !== group.label}
							<span class="lp-row-sub">{group.name}</span>
						{/if}
					</span>
					{#if active}
						<Check class="lp-check" aria-hidden="true" size={17} strokeWidth={2.2} />
					{/if}
				</button>
			{:else}
				{@const expanded = trimmedQuery.length > 0 || openLang === group.lang}
				{@const langActive = currentLang === group.lang}
				{@const activeRegion = langActive ? selectedEntry : undefined}
				<div class="lp-group">
					<button
						class="lp-row lp-row-header"
						class:is-active={langActive && !expanded}
						aria-expanded={expanded}
						onclick={() => toggleLang(group.lang)}
						type="button"
					>
						<span class="lp-flag" aria-hidden="true">
							<Globe size={17} strokeWidth={1.8} />
						</span>
						<span class="lp-row-text">
							<span class="lp-row-title">{group.label}</span>
							<span class="lp-row-sub" class:is-region={activeRegion}>
								{activeRegion
									? activeRegion.regionLabel
									: t({
											locale: $localeStore,
											key: 'picker.regions',
											params: { n: group.regions.length }
										})}
							</span>
						</span>
						<span class="lp-chev" class:is-open={expanded} aria-hidden="true">
							<ChevronDown size={17} strokeWidth={2} />
						</span>
					</button>
					{#if expanded}
						<div class="lp-regions">
							{#each group.regions as region (region.id)}
								{@const active = region.id === selectedId}
								<button
									class="lp-row lp-row-region"
									class:is-active={active}
									aria-current={active ? 'true' : undefined}
									onclick={() => onPick(region.id)}
									type="button"
								>
									<span class="lp-bar" class:is-active={active} aria-hidden="true"></span>
									<span class="lp-flag" aria-hidden="true">
										{#if region.worldFlag}
											<Globe size={17} strokeWidth={1.8} />
										{:else}
											<CountryFlag class="lp-flag-img" countryCode={region.region} />
										{/if}
									</span>
									<span class="lp-row-text">
										<span class="lp-row-title">{region.regionLabel}</span>
										{#if region.name !== region.regionLabel}
											<span class="lp-row-sub">{region.name}</span>
										{/if}
									</span>
									{#if active}
										<Check class="lp-check" aria-hidden="true" size={17} strokeWidth={2.2} />
									{/if}
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		{/each}
	</div>
</div>

<style lang="postcss">
	.lp-picker {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.lp-search {
		position: relative;
		padding: 0.25rem 0.75rem 0.625rem;
	}

	.lp-search-icon {
		position: absolute;
		top: calc(50% - 0.1875rem);
		left: 1.5rem;
		display: inline-flex;
		color: var(--text-muted);
		pointer-events: none;
		transform: translateY(-50%);
	}

	.lp-search-input {
		width: 100%;
		box-sizing: border-box;
		padding: 0.6875rem 0.75rem 0.6875rem 2.375rem;
		border: 1px solid var(--border-strong);
		border-radius: var(--r-12, 12px);
		background: var(--bg-surface);
		color: var(--text-base);
		font-family: var(--font-sans);
		font-size: var(--t-14);
		outline: none;
	}

	.lp-search-input:focus-visible {
		border-color: var(--color-primary);
	}

	.lp-list {
		min-height: 0;
		overflow-y: auto;
		padding: 0 0.5rem 0.5rem;
		-webkit-overflow-scrolling: touch;
	}

	.lp-empty {
		padding: 1.25rem 0;
		font-size: var(--t-12);
		letter-spacing: var(--tracking-allcaps, 0.08em);
		text-transform: uppercase;
		text-align: center;
		color: var(--text-muted);
	}

	.lp-row {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		min-height: 3rem;
		box-sizing: border-box;
		padding: 0.6875rem 0.75rem;
		border: 0;
		border-radius: var(--r-12, 12px);
		background: transparent;
		color: var(--text-base);
		text-align: left;
		cursor: pointer;
		transition: background-color var(--d-hover, 0.12s) var(--ease-vici, ease);
	}

	.lp-row:hover {
		background: color-mix(in srgb, var(--text-base) 6%, transparent);
	}

	.lp-row:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: -2px;
	}

	.lp-row.is-active {
		background: color-mix(in srgb, var(--color-primary) 12%, transparent);
	}

	.lp-row.is-active:hover {
		background: color-mix(in srgb, var(--color-primary) 12%, transparent);
	}

	.lp-row-region {
		padding-left: 1rem;
	}

	.lp-bar {
		position: absolute;
		top: 0.5rem;
		bottom: 0.5rem;
		left: 0;
		width: 2px;
		border-radius: 2px;
		background: transparent;
	}

	.lp-bar.is-active {
		background: var(--color-primary);
	}

	.lp-flag {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 1.875rem;
		height: 1.875rem;
		border-radius: var(--r-8, 8px);
		background: var(--bg-surface);
		border: 1px solid var(--border-base);
		color: var(--text-muted);
		line-height: 1;
	}

	.lp-flag :global(.lp-flag-img) {
		width: 1.25rem;
		height: 0.9375rem;
		border-radius: 2px;
		object-fit: cover;
	}

	.lp-row-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
		gap: 0.0625rem;
	}

	.lp-row-title {
		font-size: var(--t-14);
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.lp-row.is-active .lp-row-title,
	.lp-row-header.is-active .lp-row-title {
		font-weight: 600;
	}

	.lp-row-sub {
		font-size: var(--t-12);
		color: var(--text-muted);
	}

	.lp-row-sub.is-region {
		color: var(--color-primary);
	}

	:global(.lp-check) {
		flex-shrink: 0;
		color: var(--color-primary);
	}

	.lp-chev {
		display: inline-flex;
		flex-shrink: 0;
		color: var(--text-muted);
		transition: transform var(--d-state, 0.2s) var(--ease-vici, ease);
	}

	.lp-chev.is-open {
		transform: rotate(180deg);
	}

	@media (prefers-reduced-motion: reduce) {
		.lp-chev {
			transition: none;
		}
	}

	.lp-regions {
		margin-left: 1.6875rem;
		margin-bottom: 0.25rem;
		padding-left: 0.375rem;
		border-left: 1.5px solid var(--border-base);
	}
</style>
