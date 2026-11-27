import type {
	MarketEventSchema,
	MarketMetadataInputSchema,
	MarketMetadataSchema,
	MarketTagIndexSchema,
	MarketWhyNowSchema
} from '#lib/schema/market-metadata.schema.ts';
import type * as z from 'zod';

export type MarketWhyNow = z.infer<typeof MarketWhyNowSchema>;
export type MarketEvent = z.infer<typeof MarketEventSchema>;
export type MarketMetadataInput = z.infer<typeof MarketMetadataInputSchema>;
export type MarketMetadata = z.infer<typeof MarketMetadataSchema>;
export type MarketTagIndex = z.infer<typeof MarketTagIndexSchema>;
