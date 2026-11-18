import type { TokenIdSchema, TokenSchema } from '#lib/schema/token.schema.ts';
import type * as z from 'zod';

export type TokenId = z.infer<typeof TokenIdSchema>;

export type Token = z.infer<typeof TokenSchema>;
