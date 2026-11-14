// Social surface: the friendship state machine, follows, the activity feed
// with like reactions and rollup counts, and the friend-scoped
// resolved-results digest with its admin maintenance endpoints.

import { isNullish, nonNullish } from '@dfinity/utils';
import { Elysia, t } from 'elysia';
import { isSettlingRole } from '../admin/engine-sync';
import { forbidden, requireAdmin, requireUser, unauthenticated } from '../auth/guard';
import { UUID_RE } from '../lib/constants';
import { badRequest } from '../lib/http';
import {
	ACTIVITY_DETAILS_MAX_LENGTH,
	ACTIVITY_TITLE_MAX_LENGTH,
	ActivityNotFoundError,
	ActivityValidationError,
	createActivity,
	getReactionCounts,
	isActivityType,
	likeActivity,
	listActivities,
	listReactions,
	recomputeActivityReactionCounts,
	unlikeActivity
} from '../social/activities';
import {
	acceptFriendRequest,
	cancelFriendRequest,
	checkFriendship,
	followUser,
	listFollowers,
	listFollowing,
	listFriendRequests,
	listFriends,
	listSentFriendRequests,
	rejectFriendRequest,
	RelationError,
	sendFriendRequest,
	unfollowUser,
	unfriendUser
} from '../social/relations';
import { listFriendResolvedResults, pruneResolvedResults } from '../social/resolved-results';
import { runTradeActivityTriggers } from '../vxp/triggers';

export const DEFAULT_ACTIVITY_LIMIT = 50;
export const MAX_ACTIVITY_LIMIT = 500;
export const DEFAULT_REACTIONS_LIMIT = 1000;
export const MAX_REACTIONS_LIMIT = 1000;

/** Each list surface carries its own ceiling, so a surface whose default
 * exceeds another surface's cap (reactions vs activities) stays reachable. */
export const boundedLimit = ({
	raw,
	fallback,
	max
}: {
	raw: string | undefined;
	fallback: number;
	max: number;
}): number => {
	const parsed = Number(raw ?? fallback);

	if (!Number.isInteger(parsed) || parsed < 0) {
		return fallback;
	}

	return Math.min(parsed, max);
};

export const socialRoutes = new Elysia({ prefix: '/api/v1/social' })
	// Relations
	.get('/friends', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		return { items: await listFriends(user.id) };
	})
	.get('/followers', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		return { items: await listFollowers(user.id) };
	})
	.get('/following', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		return { items: await listFollowing(user.id) };
	})
	.get(
		'/friendship',
		async ({ request, set, query: params }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			return { isFriend: await checkFriendship({ userA: params.userA, userB: params.userB }) };
		},
		{ query: t.Object({ userA: t.String(), userB: t.String() }) }
	)
	.get('/friend-requests', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		return { items: await listFriendRequests(user.id) };
	})
	.get('/friend-requests/sent', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		return { items: await listSentFriendRequests(user.id) };
	})
	.post(
		'/friend-requests',
		async ({ request, set, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			try {
				return await sendFriendRequest({ senderId: user.id, targetId: body.target });
			} catch (err) {
				if (err instanceof RelationError) {
					return badRequest(set, err.message);
				}

				throw err;
			}
		},
		{ body: t.Object({ target: t.String({ format: 'uuid' }) }) }
	)
	.post('/friend-requests/:relationId/accept', async ({ request, set, params }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		try {
			await acceptFriendRequest({ relationId: params.relationId, callerId: user.id });

			return { ok: true };
		} catch (err) {
			if (err instanceof RelationError) {
				return badRequest(set, err.message);
			}

			throw err;
		}
	})
	.post('/friend-requests/:relationId/reject', async ({ request, set, params }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		try {
			await rejectFriendRequest({ relationId: params.relationId, callerId: user.id });

			return { ok: true };
		} catch (err) {
			if (err instanceof RelationError) {
				return badRequest(set, err.message);
			}

			throw err;
		}
	})
	.delete('/friend-requests/:relationId', async ({ request, set, params }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		try {
			await cancelFriendRequest({ relationId: params.relationId, callerId: user.id });

			return { ok: true };
		} catch (err) {
			if (err instanceof RelationError) {
				return badRequest(set, err.message);
			}

			throw err;
		}
	})
	.delete('/friends/:userId', async ({ request, set, params }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		try {
			await unfriendUser({ callerId: user.id, targetId: params.userId });

			return { ok: true };
		} catch (err) {
			if (err instanceof RelationError) {
				return badRequest(set, err.message);
			}

			throw err;
		}
	})
	.post(
		'/follow',
		async ({ request, set, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			try {
				await followUser({ senderId: user.id, targetId: body.target });

				return { ok: true };
			} catch (err) {
				if (err instanceof RelationError) {
					return badRequest(set, err.message);
				}

				throw err;
			}
		},
		{ body: t.Object({ target: t.String({ format: 'uuid' }) }) }
	)
	.delete('/follow/:userId', async ({ request, set, params }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		try {
			await unfollowUser({ senderId: user.id, targetId: params.userId });

			return { ok: true };
		} catch (err) {
			if (err instanceof RelationError) {
				return badRequest(set, err.message);
			}

			throw err;
		}
	})
	// Activities
	.get('/activities', async ({ query: params, set }) => {
		const { type } = params;

		if (nonNullish(type) && !isActivityType(type)) {
			return badRequest(set, 'unknown_activity_type');
		}

		return {
			items: await listActivities({
				limit: boundedLimit({
					raw: params.limit,
					fallback: DEFAULT_ACTIVITY_LIMIT,
					max: MAX_ACTIVITY_LIMIT
				}),
				type: nonNullish(type) && isActivityType(type) ? type : undefined
			})
		};
	})
	.post(
		'/activities',
		async ({ request, set, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			// A settlement activity follows an on-chain settle and fans out
			// every participant's resolved result, so only a role that can
			// settle may record one.
			if (body.type === 'settlement' && !isSettlingRole(user.role)) {
				return forbidden(set);
			}

			try {
				const activity = await createActivity({
					userId: user.id,
					type: body.type,
					targetUser: body.targetUser,
					marketId: body.marketId,
					title: body.title,
					details: body.details,
					timestamp: body.timestamp
				});

				// A trade activity nudges the onboarding call-count milestones and
				// the referral settlement, best-effort, after the write commits;
				// both count the engine's executed fills, not activities.
				if (activity.type === 'trade') {
					await runTradeActivityTriggers({ userId: user.id });
				}

				set.status = 201;

				return { activity };
			} catch (err) {
				if (err instanceof ActivityValidationError) {
					return badRequest(set, err.message);
				}

				// A replayed key (same user, timestamp, type) collides on the
				// primary key; answer it as a conflict rather than a fault.
				if (
					typeof err === 'object' &&
					nonNullish(err) &&
					(err as { code?: string }).code === '23505'
				) {
					set.status = 409;

					return { error: 'activity_exists' };
				}

				throw err;
			}
		},
		{
			body: t.Object({
				type: t.String(),
				targetUser: t.Optional(t.String({ format: 'uuid' })),
				marketId: t.Optional(t.String()),
				title: t.String({ maxLength: ACTIVITY_TITLE_MAX_LENGTH }),
				details: t.Optional(t.String({ maxLength: ACTIVITY_DETAILS_MAX_LENGTH })),
				timestamp: t.Number()
			})
		}
	)
	.get('/activity-reactions', async ({ query: params }) => ({
		items: await listReactions({
			limit: boundedLimit({
				raw: params.limit,
				fallback: DEFAULT_REACTIONS_LIMIT,
				max: MAX_REACTIONS_LIMIT
			})
		})
	}))
	.post(
		'/activity-reactions/counts',
		async ({ body }) => ({
			items: await getReactionCounts({ activityKeys: body.activityKeys })
		}),
		{ body: t.Object({ activityKeys: t.Array(t.String(), { maxItems: 1000 }) }) }
	)
	.post(
		'/activity-reactions',
		async ({ request, set, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			try {
				await likeActivity({
					likerId: user.id,
					activityKey: body.activityKey,
					timestamp: body.timestamp,
					activityTitle: body.activityTitle,
					marketId: body.marketId
				});

				return { ok: true };
			} catch (err) {
				if (err instanceof ActivityValidationError) {
					return badRequest(set, err.message);
				}

				if (err instanceof ActivityNotFoundError) {
					set.status = 404;

					return { error: 'not_found' };
				}

				throw err;
			}
		},
		{
			body: t.Object({
				activityKey: t.String(),
				timestamp: t.Number(),
				activityTitle: t.String(),
				marketId: t.Optional(t.String())
			})
		}
	)
	.delete(
		'/activity-reactions',
		async ({ request, set, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			await unlikeActivity({ likerId: user.id, activityKey: body.activityKey });

			return { ok: true };
		},
		{ body: t.Object({ activityKey: t.String() }) }
	)
	.post('/admin/recompute-reaction-counts', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		const admin = requireAdmin(user);

		if (isNullish(admin)) {
			return forbidden(set);
		}

		return await recomputeActivityReactionCounts();
	})
	// Resolved results
	.get(
		'/resolved-results',
		async ({ request, set, query: params }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			// Non-uuid entries can never match a row; drop them up front so the
			// typed array bind cannot fail on a malformed id.
			const friendIds = params.friends
				.split(',')
				.map((id) => id.trim())
				.filter((id) => UUID_RE.test(id));

			return { items: await listFriendResolvedResults({ friendIds }) };
		},
		{ query: t.Object({ friends: t.String() }) }
	)
	.post('/admin/prune-resolved-results', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		const admin = requireAdmin(user);

		if (isNullish(admin)) {
			return forbidden(set);
		}

		return await pruneResolvedResults();
	});
