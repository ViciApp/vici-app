// Profile surface: own-profile read/write, the availability probe, public
// lookup and search, the server-authoritative Flow swipe counter, and the
// dashboard stat caches. Reads that back public surfaces stay public;
// everything caller-scoped is session-gated.

import { isNullish } from '@dfinity/utils';
import { Elysia, t } from 'elysia';
import { requireUser, unauthenticated } from '../auth/guard';
import { InvalidDayKeyError, NoProfileError, recordFlowSwipe } from '../profiles/flow';
import { checkNicknameAvailability } from '../profiles/nickname';
import {
	getProfileRow,
	getProfileView,
	ProfileValidationError,
	searchProfiles,
	shapeOwnProfile,
	upsertMyProfile
} from '../profiles/profile';
import { getUserStats, upsertMonthlyStats, upsertUserStats } from '../profiles/stats';
import { mintFlowOvertime } from '../vxp/flow';
import { runProfileAwardTriggers } from '../vxp/triggers';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface StatusContext {
	status?: number | string;
}

const badRequest = (set: StatusContext, error: string): { error: string } => {
	set.status = 400;

	return { error };
};

export const profilesRoutes = new Elysia({ prefix: '/api/v1/profiles' })
	.get('/me', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		const row = await getProfileRow({ userId: user.id });

		return { profile: isNullish(row) ? null : shapeOwnProfile(row) };
	})
	.put('/me', async ({ request, set, body }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		try {
			// Snapshot the stored slice BEFORE the write: the award triggers run
			// off the before/after delta, mirroring the post-write hook model
			// (only client writes fire awards; internal server writes never do).
			const before = await getProfileRow({ userId: user.id });

			const profile = await upsertMyProfile({
				userId: user.id,
				body: (body ?? {}) as Record<string, unknown>
			});

			await runProfileAwardTriggers({
				userId: user.id,
				before: isNullish(before)
					? undefined
					: {
							dailyStreak: before.daily_streak ?? 0,
							totalTrades: before.total_trades ?? 0,
							unlockedAchievements: before.unlocked_achievements ?? [],
							lastActiveDay: before.last_active_day ?? undefined
						},
				after: {
					dailyStreak: profile.dailyStreak,
					totalTrades: profile.totalTrades,
					unlockedAchievements: profile.unlockedAchievements,
					lastActiveDay: profile.lastActiveDay
				}
			});

			return { profile };
		} catch (err) {
			if (err instanceof ProfileValidationError) {
				return badRequest(set, err.message);
			}

			throw err;
		}
	})
	.get(
		'/nickname-availability',
		async ({ request, set, query: params }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			// The caller's own current nickname never counts as a conflict.
			const result = await checkNicknameAvailability({
				nickname: params.nickname,
				excludeUserId: user.id
			});

			return result;
		},
		{ query: t.Object({ nickname: t.String() }) }
	)
	.get('/search', async ({ query: params }) => ({ items: await searchProfiles(params.q) }), {
		query: t.Object({ q: t.String() })
	})
	.post(
		'/flow-swipe',
		async ({ request, set, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			try {
				const result = await recordFlowSwipe({ userId: user.id, dayKey: body.dayKey });

				// The overtime bonus fires at the daily hard cap, inline with the
				// counter write. Never throws; a payout hiccup leaves the counter
				// result intact.
				if (result.capReached) {
					await mintFlowOvertime({ userId: user.id, dayKey: result.dailyGoalDate });
				}

				return result;
			} catch (err) {
				if (err instanceof NoProfileError) {
					set.status = 409;

					return { error: 'no_profile' };
				}

				if (err instanceof InvalidDayKeyError) {
					return badRequest(set, 'invalid_day_key');
				}

				throw err;
			}
		},
		{ body: t.Object({ dayKey: t.String() }) }
	)
	.get('/me/stats', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		return { stats: (await getUserStats({ userId: user.id })) ?? null };
	})
	.put(
		'/me/stats',
		async ({ request, set, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			try {
				const stats = await upsertUserStats({
					userId: user.id,
					categoryStats: body.categoryStats,
					recentSettlements: body.recentSettlements,
					computedAtMs: body.computedAtMs
				});

				return { stats };
			} catch (err) {
				if (err instanceof ProfileValidationError) {
					return badRequest(set, err.message);
				}

				throw err;
			}
		},
		{
			body: t.Object({
				categoryStats: t.Record(t.String(), t.Object({ calls: t.Number(), wins: t.Number() })),
				recentSettlements: t.Array(
					t.Object({
						marketId: t.String(),
						tag: t.String(),
						win: t.Boolean(),
						settledAtMs: t.Number(),
						vxp: t.Number(),
						contrarian: t.Boolean()
					})
				),
				computedAtMs: t.Number()
			})
		}
	)
	.put(
		'/me/monthly-stats',
		async ({ request, set, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			try {
				const stats = await upsertMonthlyStats({
					userId: user.id,
					monthAnchor: body.monthAnchor,
					monthCalls: body.monthCalls,
					monthWins: body.monthWins,
					monthConsensus: body.monthConsensus,
					updatedAtMs: body.updatedAtMs
				});

				return { stats };
			} catch (err) {
				if (err instanceof ProfileValidationError) {
					return badRequest(set, err.message);
				}

				throw err;
			}
		},
		{
			body: t.Object({
				monthAnchor: t.String(),
				monthCalls: t.Number(),
				monthWins: t.Number(),
				monthConsensus: t.Array(t.Number()),
				updatedAtMs: t.Number()
			})
		}
	)
	.get('/:userId', async ({ request, params }) => {
		// Accounts are keyed by uuid, so any other id (an on-chain principal,
		// say) can never match a row; answer it as absent instead of letting the
		// uuid bind fail the query as a 500.
		if (!UUID_RE.test(params.userId)) {
			return { profile: null };
		}

		// The caller (when signed in) may read their own hidden profile; any
		// other hidden profile reads as absent.
		const user = await requireUser(request);

		const profile = await getProfileView({
			userId: params.userId,
			callerId: user?.id
		});

		return { profile: profile ?? null };
	});
