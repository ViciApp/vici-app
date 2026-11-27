import { j, PrincipalTextSchema } from '@junobuild/schema';

/**
 * Locale id on the wire. We stay as `j.string()` (not `j.enum([...])`) because
 * several registered locale ids contain a hyphen (e.g. `zh-Hans`) and the
 * Juno candid converter doesn't tolerate hyphens in enum variants. The
 * satellite service validates the value
 * against `SUPPORTED_LOCALES` from
 * [src/lib/constants/locale.constants.ts](src/lib/constants/locale.constants.ts)
 * at write time.
 */
const AppLocaleSchema = j.string();

/**
 * Per-outcome translation entry. `id` is the on-chain outcome id and `title`
 * is the translated outcome title.
 */
const OutcomeTranslationSchema = j.strictObject({
	id: j.string(),
	title: j.string()
});

export const MarketTranslationInputSchema = j.strictObject({
	title: j.string(),
	description: j.string(),
	resolution: j.string(),
	outcomes: j.array(OutcomeTranslationSchema).default([])
});

export const MarketTranslationSchema = j.strictObject({
	seriesId: j.string(),
	locale: AppLocaleSchema,
	title: j.string(),
	description: j.string(),
	resolution: j.string(),
	outcomes: j.array(OutcomeTranslationSchema).default([]),
	updatedAt: j.number(),
	updatedBy: PrincipalTextSchema
});

export const UpsertMarketTranslationArgsSchema = j.strictObject({
	seriesId: j.string(),
	locale: AppLocaleSchema,
	data: MarketTranslationInputSchema
});

export const GetMarketTranslationArgsSchema = j.strictObject({
	seriesId: j.string(),
	locale: AppLocaleSchema
});

export const ListMarketTranslationsArgsSchema = j.strictObject({
	seriesId: j.string()
});

export const ListMarketTranslationsForLocalesArgsSchema = j.strictObject({
	seriesIds: j.array(j.string()),
	locales: j.array(AppLocaleSchema)
});
