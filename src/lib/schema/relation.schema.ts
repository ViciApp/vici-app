import { RelationCategory, RelationState } from '#lib/enums/relation.ts';
import { UserRole } from '#lib/enums/user.ts';
import { PrincipalTextSchema } from '@dfinity/zod-schemas';
import * as z from 'zod';

const RelationCategorySchema = z.enum(RelationCategory);

const RelationStateSchema = z.enum(RelationState);

export const RelationSchema = z.strictObject({
	category: RelationCategorySchema,
	state: RelationStateSchema,
	participants: z.array(PrincipalTextSchema),
	viewerPrincipal: PrincipalTextSchema.optional(),
	viewerRole: z.enum(UserRole).optional(),
	isFriend: z.boolean().optional()
});

/**
 * Typed outcome of `sendFriendRequest`: known non-success cases are
 * statuses, not traps, so the FE can surface a specific message (and,
 * for `rejected_cooldown`, the `retryAtMs` the wait is counted from).
 * Unexpected failures still trap and reach the FE as thrown errors.
 */
export const FriendRequestOutcomeSchema = z.strictObject({
	status: z.enum([
		'sent',
		'auto_accepted',
		'already_friends',
		'already_pending',
		'rejected_cooldown'
	]),
	retryAtMs: z.number().optional()
});
