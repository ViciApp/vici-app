import type {
	MarketTranslationInputSchema,
	MarketTranslationSchema
} from '#lib/schema/market-translation.schema.ts';
import type { j } from '@junobuild/schema';

export type MarketTranslationInput = j.infer<typeof MarketTranslationInputSchema>;
export type MarketTranslation = j.infer<typeof MarketTranslationSchema>;
