import { RelationCategory, RelationState } from '#lib/enums/relation.ts';
import { UserRole } from '#lib/enums/user.ts';
import { j, PrincipalTextSchema } from '@junobuild/schema';

export const RelationCategorySchema = j.enum(RelationCategory);

export const RelationStateSchema = j.enum(RelationState);

export const RelationSchema = j.strictObject({
	category: RelationCategorySchema,
	state: RelationStateSchema,
	participants: j.array(PrincipalTextSchema),
	viewerPrincipal: PrincipalTextSchema.optional(),
	viewerRole: j.enum(UserRole).optional(),
	isFriend: j.boolean().optional()
});

export const CheckFriendshipArgsSchema = j.strictObject({
	userA: PrincipalTextSchema,
	userB: PrincipalTextSchema
});

/**
 * Typed outcome of `sendFriendRequest`: known non-success cases are
 * statuses, not traps, so the FE can surface a specific message (and,
 * for `rejected_cooldown`, the `retryAtMs` the wait is counted from).
 * Unexpected failures still trap and reach the FE as thrown errors.
 */
export const FriendRequestOutcomeSchema = j.strictObject({
	status: j.enum([
		'sent',
		'auto_accepted',
		'already_friends',
		'already_pending',
		'rejected_cooldown'
	]),
	retryAtMs: j.number().optional()
});
