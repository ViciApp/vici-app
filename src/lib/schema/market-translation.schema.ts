import { PrincipalTextSchema } from '@dfinity/zod-schemas';
import * as z from 'zod';

/**
 * Locale id on the wire. We stay as `z.string()` (not `z.enum([...])`) because
 * several registered locale ids contain a hyphen (e.g. `zh-Hans`) and the
 * Juno candid converter doesn't tolerate hyphens in enum variants. The
 * satellite service validates the value
 * against `SUPPORTED_LOCALES` from
 * [src/lib/constants/locale.constants.ts](src/lib/constants/locale.constants.ts)
 * at write time.
 */
const AppLocaleSchema = z.string();

/**
 * Per-outcome translation entry. `id` is the on-chain outcome id and `title`
 * is the translated outcome title.
 */
const OutcomeTranslationSchema = z.strictObject({
	id: z.string(),
	title: z.string()
});

export const MarketTranslationInputSchema = z.strictObject({
	title: z.string(),
	description: z.string(),
	resolution: z.string(),
	outcomes: z.array(OutcomeTranslationSchema).default([])
});

export const MarketTranslationSchema = z.strictObject({
	seriesId: z.string(),
	locale: AppLocaleSchema,
	title: z.string(),
	description: z.string(),
	resolution: z.string(),
	outcomes: z.array(OutcomeTranslationSchema).default([]),
	updatedAt: z.number(),
	updatedBy: PrincipalTextSchema
});
