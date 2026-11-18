import type { FriendRequestOutcomeSchema, RelationSchema } from '#lib/schema/relation.schema.ts';
import type { j } from '@junobuild/schema';

export type Relation = j.infer<typeof RelationSchema>;

export type FriendRequestOutcome = j.infer<typeof FriendRequestOutcomeSchema>;
