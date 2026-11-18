import { MarketIdSchema } from '#lib/schema/market.schema.ts';
import type { MarketId } from '#lib/types/market.ts';
import * as z from 'zod';

const MarketIdStringSchema = z.string();

export const parseMarketId = (marketIdString: z.infer<typeof MarketIdStringSchema>): MarketId => {
	const validString = MarketIdStringSchema.parse(marketIdString);

	return MarketIdSchema.parse(validString);
};
