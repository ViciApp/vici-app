import { TokenIdSchema } from '#lib/schema/token.schema.ts';
import type { TokenId } from '#lib/types/token.ts';
import * as z from 'zod';

const TokenIdStringSchema = z.string();

export const parseTokenId = (tokenIdString: z.infer<typeof TokenIdStringSchema>): TokenId => {
	const validString = TokenIdStringSchema.parse(tokenIdString);

	return TokenIdSchema.parse(Symbol(validString));
};
