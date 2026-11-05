<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import Button from '#lib/components/ui/Button.svelte';
	import {
		DEFAULT_LOCALE,
		SUPPORTED_LOCALES,
		type AppLocale
	} from '#lib/constants/locale.constants.ts';
	import {
		getMarketTranslation,
		listMarketTranslations,
		upsertMarketTranslation
	} from '#lib/services/market-translation.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { ButtonStatus } from '#lib/types/components.ts';
	import type { MarketTranslation } from '#lib/types/market-translation.ts';
	import type { Market } from '#lib/types/market.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		market: Market;
	}

	const { market }: Props = $props();

	/**
	 * For binary markets, the YES/NO outcomes are system labels rendered from
	 * the UI catalog — they don't need per-market translation.
	 */
	const translatableOutcomes = $derived(
		market.payoffType === 'Binary' ? [] : (market.outcomes ?? [])
	);

	let selectedLocale = $state<AppLocale>(DEFAULT_LOCALE);
	let titleInput = $state('');
	let descriptionInput = $state('');
	let resolutionInput = $state('');
	let outcomeInputs = $state<Record<string, string>>({});
	const cache = new SvelteMap<AppLocale, MarketTranslation>();
	let loaded = $state(false);
	let status = $state<ButtonStatus>('enabled');
	let savedLocale = $state<AppLocale | undefined>(undefined);
	let error = $state<string | undefined>(undefined);

	const allComplete = $derived(
		titleInput.trim().length > 0 &&
			descriptionInput.trim().length > 0 &&
			resolutionInput.trim().length > 0 &&
			translatableOutcomes.every((o) => (outcomeInputs[o.id] ?? '').trim().length > 0)
	);

	const applyTranslation = (translation: MarketTranslation | undefined) => {
		titleInput = translation?.title ?? '';
		descriptionInput = translation?.description ?? '';
		resolutionInput = translation?.resolution ?? '';
		const map = new Map((translation?.outcomes ?? []).map((entry) => [entry.id, entry.title]));
		outcomeInputs = translatableOutcomes.reduce<Record<string, string>>((acc, outcome) => {
			acc[outcome.id] = map.get(outcome.id) ?? '';

			return acc;
		}, {});
	};

	const loadLocale = async (locale: AppLocale) => {
		error = undefined;

		const cached = cache.get(locale);

		if (cached) {
			applyTranslation(cached);

			return;
		}

		try {
			const translation = await getMarketTranslation({ seriesId: market.id, locale });

			if (translation) {
				cache.set(locale, translation);
			}

			applyTranslation(translation);
		} catch (err: unknown) {
			console.warn('Market translation load failed:', err);
			error = t({ locale: $localeStore, key: 'market.metadata.translations.error.load' });
			applyTranslation(undefined);
		}
	};

	const onLocaleChange = (next: AppLocale) => {
		selectedLocale = next;
		savedLocale = undefined;
		void loadLocale(next);
	};

	const save = async () => {
		if (!allComplete) {
			return;
		}

		status = 'pending';
		error = undefined;

		try {
			const translation = await upsertMarketTranslation({
				seriesId: market.id,
				locale: selectedLocale,
				data: {
					title: titleInput.trim(),
					description: descriptionInput.trim(),
					resolution: resolutionInput.trim(),
					outcomes: translatableOutcomes.map((outcome) => ({
						id: outcome.id,
						title: (outcomeInputs[outcome.id] ?? '').trim()
					}))
				}
			});

			cache.set(selectedLocale, translation);
			savedLocale = selectedLocale;
		} catch (err: unknown) {
			console.warn('Market translation save failed:', err);
			error = t({ locale: $localeStore, key: 'market.metadata.translations.error.save' });
		} finally {
			status = 'enabled';
		}
	};

	onMount(async () => {
		try {
			const all = await listMarketTranslations(market.id);
			const supported = new Set<string>(SUPPORTED_LOCALES.map((l) => l.id));

			cache.clear();

			for (const translation of all) {
				if (supported.has(translation.locale)) {
					cache.set(translation.locale as AppLocale, translation);
				}
			}

			applyTranslation(cache.get(selectedLocale));
		} catch (err: unknown) {
			console.warn('Market translations load failed:', err);
			error = t({ locale: $localeStore, key: 'market.metadata.translations.error.load' });
		} finally {
			loaded = true;
		}
	});
</script>

<div class="translations">
	<label class="translations-locale">
		<span>{t({ locale: $localeStore, key: 'market.metadata.translations.locale_label' })}</span>
		<select
			onchange={(e) => onLocaleChange(e.currentTarget.value as AppLocale)}
			value={selectedLocale}
		>
			{#each SUPPORTED_LOCALES as locale (locale.id)}
				<option value={locale.id}>{locale.label}</option>
			{/each}
		</select>
	</label>

	{#if !loaded}
		<p class="translations-muted">
			{t({ locale: $localeStore, key: 'market.metadata.loading' })}
		</p>
	{:else}
		{#if error}
			<p class="translations-error">{error}</p>
		{/if}

		<div class="translations-row">
			<div class="translations-cell">
				<span class="translations-label">
					{t({
						locale: $localeStore,
						key: 'market.metadata.translations.original_title'
					})}
				</span>
				<p class="translations-original">{market.title}</p>
			</div>
			<input
				class="translations-input"
				placeholder={t({
					locale: $localeStore,
					key: 'market.metadata.translations.translation_placeholder'
				})}
				bind:value={titleInput}
			/>
		</div>

		<div class="translations-row">
			<div class="translations-cell">
				<span class="translations-label">
					{t({
						locale: $localeStore,
						key: 'market.metadata.translations.original_description'
					})}
				</span>
				<p class="translations-original">{market.description}</p>
			</div>
			<textarea
				class="translations-input translations-textarea"
				placeholder={t({
					locale: $localeStore,
					key: 'market.metadata.translations.translation_placeholder'
				})}
				bind:value={descriptionInput}></textarea>
		</div>

		<div class="translations-row">
			<div class="translations-cell">
				<span class="translations-label">
					{t({
						locale: $localeStore,
						key: 'market.metadata.translations.original_resolution'
					})}
				</span>
				<p class="translations-original">{market.resolution}</p>
			</div>
			<textarea
				class="translations-input translations-textarea"
				placeholder={t({
					locale: $localeStore,
					key: 'market.metadata.translations.translation_placeholder'
				})}
				bind:value={resolutionInput}></textarea>
		</div>

		{#each translatableOutcomes as outcome (outcome.id)}
			<div class="translations-row">
				<div class="translations-cell">
					<span class="translations-label">
						{t({
							locale: $localeStore,
							key: 'market.metadata.translations.original_outcome'
						})}
					</span>
					<p class="translations-original">{outcome.title}</p>
				</div>
				<input
					class="translations-input"
					oninput={(e) => {
						outcomeInputs = {
							...outcomeInputs,
							[outcome.id]: e.currentTarget.value
						};
					}}
					placeholder={t({
						locale: $localeStore,
						key: 'market.metadata.translations.translation_placeholder'
					})}
					value={outcomeInputs[outcome.id] ?? ''}
				/>
			</div>
		{/each}

		{#if !allComplete}
			<p class="translations-hint">
				{t({ locale: $localeStore, key: 'market.metadata.translations.incomplete' })}
			</p>
		{/if}

		<div class="translations-actions">
			<Button onclick={save} status={allComplete ? status : 'disabled'}>
				{t({ locale: $localeStore, key: 'market.metadata.translations.save' })}
			</Button>
			{#if savedLocale === selectedLocale}
				<span class="translations-saved">
					{t({ locale: $localeStore, key: 'market.metadata.translations.saved' })}
				</span>
			{/if}
		</div>
	{/if}
</div>

<style lang="postcss">
	.translations {
		display: grid;
		gap: 0.875rem;
		margin-bottom: 1rem;
	}

	.translations-locale {
		display: grid;
		gap: 0.4rem;
	}

	.translations-locale > span,
	.translations-label {
		color: var(--text-muted);
		font-size: var(--t-12);
		font-weight: 700;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
	}

	.translations-locale select,
	.translations-input {
		width: 100%;
		border: 1px solid var(--border-base);
		border-radius: var(--r-8);
		background: var(--bg-surface);
		color: var(--text-base);
		padding: 0.65rem 0.75rem;
		font: inherit;
	}

	.translations-textarea {
		min-height: 5rem;
		resize: vertical;
	}

	.translations-row {
		display: grid;
		gap: 0.5rem;
		padding: 0.75rem;
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		background: color-mix(in srgb, var(--bg-surface) 60%, transparent);
	}

	.translations-cell {
		display: grid;
		gap: 0.25rem;
	}

	.translations-original {
		margin: 0;
		color: var(--text-base);
		font-size: var(--t-13);
		line-height: var(--leading-normal);
	}

	.translations-muted,
	.translations-hint,
	.translations-saved {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--t-12);
	}

	.translations-error {
		margin: 0;
		color: var(--no);
		font-size: var(--t-13);
	}

	.translations-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
</style>
