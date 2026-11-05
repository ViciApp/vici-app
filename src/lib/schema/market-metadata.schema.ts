import { MarketEventDirection, MarketWhyNowKind } from '#lib/enums/market-metadata.ts';
import { j, PrincipalTextSchema } from '@junobuild/schema';

export const MarketWhyNowKindSchema = j.enum(MarketWhyNowKind);
export const MarketEventDirectionSchema = j.enum(MarketEventDirection);

export const MarketWhyNowSchema = j.strictObject({
	kind: MarketWhyNowKindSchema,
	text: j.string()
});

export const MarketEventSchema = j.strictObject({
	day: j.number(),
	label: j.string(),
	dir: MarketEventDirectionSchema
});

export const MarketMetadataInputSchema = j.strictObject({
	whyNow: MarketWhyNowSchema.optional(),
	events: j.array(MarketEventSchema).default([]),
	tags: j.array(j.string()).default([]),
	suggested: j.boolean().default(false),
	// Short editorial subtitle rendered as italic accent under the
	// question on the Flow front card (e.g. "Hex contenders · 17.9 %
	// favorite"). Optional — when absent the row is hidden, except
	// for the curated WC-tentpole map kept FE-side in
	// `wc-market-subtitles.constants.ts`. Keep this < ~50 chars; the
	// surface can't accommodate longer.
	subtitle: j.string().optional()
});

export const MarketMetadataSchema = j.strictObject({
	seriesId: j.string(),
	whyNow: MarketWhyNowSchema.optional(),
	events: j.array(MarketEventSchema).default([]),
	tags: j.array(j.string()).default([]),
	suggested: j.boolean().default(false),
	subtitle: j.string().optional(),
	updatedAt: j.number(),
	updatedBy: PrincipalTextSchema
});

// One bucket of the `market tag → seriesId[]` reverse index. The doc key is
// the tag id; `seriesIds` is the de-duplicated set of series carrying that tag.
export const MarketTagIndexSchema = j.strictObject({
	tag: j.string(),
	seriesIds: j.array(j.string()).default([]),
	updatedAtMs: j.number()
});

/** Result of `getMarketTags` — every tag bucket of the reverse index, for the
 * cockpit's market classification (admin-gated; see `getMarketTagsFn`). */
export const GetMarketTagsResultSchema = j.strictObject({
	buckets: j.array(
		j.strictObject({
			tag: j.string(),
			seriesIds: j.array(j.string()).default([])
		})
	)
});

export const UpsertMarketMetadataArgsSchema = j.strictObject({
	seriesId: j.string(),
	data: MarketMetadataInputSchema
});

export const GetMarketMetadataArgsSchema = j.strictObject({
	seriesId: j.string()
});
