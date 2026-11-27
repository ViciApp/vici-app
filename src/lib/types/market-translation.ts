import type {
	MarketTranslationInputSchema,
	MarketTranslationSchema
} from '#lib/schema/market-translation.schema.ts';
import type * as z from 'zod';

export type MarketTranslationInput = z.infer<typeof MarketTranslationInputSchema>;
export type MarketTranslation = z.infer<typeof MarketTranslationSchema>;
