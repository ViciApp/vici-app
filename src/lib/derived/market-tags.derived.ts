import {
	classificationMacros,
	classificationMicros,
	MACRO_IDS,
	MICRO_IDS,
	type MacroId,
	type MicroId
} from '#lib/constants/market-taxonomy.constants.ts';
import { cachedNotInitialized } from '#lib/derived/cached.derived.ts';
import { marketTagsStore } from '#lib/stores/market-tags.store.ts';
import { derived, type Readable } from 'svelte/store';

const EMPTY_TAGS: Record<string, string[]> = {};

/**
 * Cached `seriesId → string[]` lookup (micro ids first, then free tags).
 * Falls back to an empty object so consumers can read it without a
 * nullish-check on every render. Pair with {@link marketTagsNotInitialized}
 * when the page also needs to distinguish "still loading" from "loaded but
 * empty".
 */
export const marketTags: Readable<Record<string, string[]>> = derived(
	marketTagsStore,
	($store) => $store ?? EMPTY_TAGS
);

/**
 * The macros that actually carry at least one live market, in canonical
 * {@link MACRO_IDS} order. Drives the browse category bar so the UI only
 * ever shows populated branches (never an empty macro chip).
 */
export const populatedMacros: Readable<MacroId[]> = derived(marketTags, ($marketTags) => {
	const present = new Set<MacroId>();

	for (const tags of Object.values($marketTags)) {
		for (const macro of classificationMacros(tags)) {
			present.add(macro);
		}
	}

	return MACRO_IDS.filter((macro) => present.has(macro));
});

/**
 * The micros that actually carry at least one live market, in canonical
 * {@link MICRO_IDS} order. Drives the sub-chip row under a selected macro so
 * only populated subcategories are offered.
 */
export const populatedMicros: Readable<MicroId[]> = derived(marketTags, ($marketTags) => {
	const present = new Set<MicroId>();

	for (const tags of Object.values($marketTags)) {
		for (const micro of classificationMicros(tags)) {
			present.add(micro);
		}
	}

	return MICRO_IDS.filter((micro) => present.has(micro));
});

export const marketTagsNotInitialized: Readable<boolean> = cachedNotInitialized(marketTagsStore);
