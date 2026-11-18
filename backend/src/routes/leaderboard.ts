// Leaderboard surface: the visible top slice, the single-pass rank/count
// pair, the caller's rival and the monthly award aggregation. All reads
// back public surfaces except the rival, which is caller-scoped.

import { isNullish } from '@dfinity/utils';
import { Elysia } from 'elysia';
import { requireUser, unauthenticated } from '../auth/guard';
import { UUID_RE } from '../lib/constants';
import { badRequest } from '../lib/http';
import { getMyRival, getUserRankAndCount, listLeaderboard } from '../profiles/leaderboard';
import { getMonthlyLeaderboard } from '../profiles/stats';

export const leaderboardRoutes = new Elysia({ prefix: '/api/v1/leaderboard' })
	.get('/', async () => ({ items: await listLeaderboard() }))
	.get('/rival', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		const { rival, rivalIsTrailing } = await getMyRival({ userId: user.id });

		return { rival: rival ?? null, rivalIsTrailing };
	})
	.get(
		'/monthly/:monthAnchor',
		async ({ params }) => await getMonthlyLeaderboard({ monthAnchor: params.monthAnchor })
	)
	.get('/rank/:userId', async ({ params, set }) => {
		// Accounts are keyed by uuid: any other id would fail the uuid bind in
		// the rank query as a 500.
		if (!UUID_RE.test(params.userId)) {
			return badRequest(set, 'invalid_user_id');
		}

		const { rank, count } = await getUserRankAndCount({ userId: params.userId });

		return { rank: rank ?? null, count };
	});
