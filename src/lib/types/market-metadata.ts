import type {
	MarketEventSchema,
	MarketMetadataInputSchema,
	MarketMetadataSchema,
	MarketTagIndexSchema,
	MarketWhyNowSchema
} from '#lib/schema/market-metadata.schema.ts';
import type { j } from '@junobuild/schema';

export type MarketWhyNow = j.infer<typeof MarketWhyNowSchema>;
export type MarketEvent = j.infer<typeof MarketEventSchema>;
export type MarketMetadataInput = j.infer<typeof MarketMetadataInputSchema>;
export type MarketMetadata = j.infer<typeof MarketMetadataSchema>;
export type MarketTagIndex = j.infer<typeof MarketTagIndexSchema>;
