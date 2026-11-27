import type { FriendRequestOutcomeSchema, RelationSchema } from '#lib/schema/relation.schema.ts';
import type * as z from 'zod';

export type Relation = z.infer<typeof RelationSchema>;

export type FriendRequestOutcome = z.infer<typeof FriendRequestOutcomeSchema>;
