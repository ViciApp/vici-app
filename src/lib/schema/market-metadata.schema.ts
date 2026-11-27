import { MarketEventDirection, MarketWhyNowKind } from '#lib/enums/market-metadata.ts';
import { PrincipalTextSchema } from '@dfinity/zod-schemas';
import * as z from 'zod';

const MarketWhyNowKindSchema = z.enum(MarketWhyNowKind);
const MarketEventDirectionSchema = z.enum(MarketEventDirection);

export const MarketWhyNowSchema = z.strictObject({
	kind: MarketWhyNowKindSchema,
	text: z.string()
});

export const MarketEventSchema = z.strictObject({
	day: z.number(),
	label: z.string(),
	dir: MarketEventDirectionSchema
});

export const MarketMetadataInputSchema = z.strictObject({
	whyNow: MarketWhyNowSchema.optional(),
	events: z.array(MarketEventSchema).default([]),
	tags: z.array(z.string()).default([]),
	suggested: z.boolean().default(false),
	// Short editorial subtitle rendered as italic accent under the
	// question on the Flow front card (e.g. "Hex contenders · 17.9 %
	// favorite"). Optional: when absent the row is hidden, except
	// for the curated WC-tentpole map kept FE-side in
	// `wc-market-subtitles.constants.ts`. Keep this < ~50 chars; the
	// surface can't accommodate longer.
	subtitle: z.string().optional()
});

export const MarketMetadataSchema = z.strictObject({
	seriesId: z.string(),
	whyNow: MarketWhyNowSchema.optional(),
	events: z.array(MarketEventSchema).default([]),
	tags: z.array(z.string()).default([]),
	suggested: z.boolean().default(false),
	subtitle: z.string().optional(),
	updatedAt: z.number(),
	updatedBy: PrincipalTextSchema
});

// One bucket of the `market tag → seriesId[]` reverse index. The doc key is
// the tag id; `seriesIds` is the de-duplicated set of series carrying that tag.
export const MarketTagIndexSchema = z.strictObject({
	tag: z.string(),
	seriesIds: z.array(z.string()).default([]),
	updatedAtMs: z.number()
});
