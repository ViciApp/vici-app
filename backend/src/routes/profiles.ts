// Profile surface: own-profile read/write, the availability probe (signed in,
// or anonymous behind a bot check), public lookup by id or handle and search, the
// server-authoritative Flow swipe counter, and the dashboard stat caches. Reads that back public surfaces stay public;
// everything caller-scoped is session-gated.

import { isNullish } from '@dfinity/utils';
import { Elysia, t } from 'elysia';
import { requireUser, unauthenticated } from '../auth/guard';
import { UUID_RE } from '../lib/constants';
import { badRequest, clientIp, serviceUnavailable } from '../lib/http';
import { issueHumanProof, verifyHumanProof } from '../lib/human-proof';
import { enforceLimit } from '../lib/rate-limit';
import { HOUR_IN_MS, MINUTE_IN_MS, TEN_MINUTES_IN_MS } from '../lib/time';
import { MAX_TURNSTILE_TOKEN_LENGTH, verifyTurnstileToken } from '../lib/turnstile';
import { InvalidDayKeyError, NoProfileError, recordFlowSwipe } from '../profiles/flow';
import {
	checkNicknameAvailability,
	NICKNAME_CHECK_PROOF_TTL_MS,
	NICKNAME_CHECK_SCOPE,
	NICKNAME_CHECK_TURNSTILE_ACTION
} from '../profiles/nickname';
import {
	countProfiles,
	getProfileByHandle,
	getProfileRow,
	getProfileView,
	ProfileValidationError,
	searchProfiles,
	shapeOwnProfile
} from '../profiles/profile';
import { upsertMyProfile } from '../profiles/profile-write';
import { getUserStats, upsertUserStats } from '../profiles/stats';
import { mintFlowOvertime } from '../vxp/flow';
import { runProfileAwardTriggers } from '../vxp/triggers';

// Search is public and enumerable, so it is limited per client IP. The budget
// leaves room for a debounced live search behind a shared school network.
const PROFILE_SEARCH_LIMIT_PER_HOUR = 300;

// A visitor needs one proof per window; a few more cover a reload, a second
// tab or an IP change. Each one also costs a Cloudflare round-trip.
const NICKNAME_CHECK_PROOF_LIMIT_PER_TEN_MINUTES = 10;
// The client debounces the probe, so even fast typing and retyping stays well
// under 30 a minute; the hourly cap bounds what a solved proof can enumerate
// while leaving room for a shared school or office network.
const PUBLIC_NICKNAME_CHECK_LIMIT_PER_MINUTE = 30;
const PUBLIC_NICKNAME_CHECK_LIMIT_PER_HOUR = 300;

// The add-friend input is a typed handle; anything longer is not one.
const PROFILE_BY_HANDLE_MAX_LENGTH = 64;

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
			const profile = await upsertMyProfile({
				userId: user.id,
				body: (body ?? {}) as Record<string, unknown>
			});

			// Only the registration grant rides the profile write. The streak,
			// call-count, achievement and comeback fields here are the client's
			// display copy and never mint: those awards read server-side truth
			// on the trade activity write.
			await runProfileAwardTriggers({ userId: user.id });

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
	.post(
		'/nickname-check-proof',
		async ({ request, set, body }) => {
			const ip = clientIp(request);
			const limited = enforceLimit({
				set,
				name: 'nickname_check_proof',
				ip,
				limit: NICKNAME_CHECK_PROOF_LIMIT_PER_TEN_MINUTES,
				windowMs: TEN_MINUTES_IN_MS
			});

			if (limited) {
				return limited;
			}

			const verdict = await verifyTurnstileToken({
				token: body.turnstileToken,
				ip,
				action: NICKNAME_CHECK_TURNSTILE_ACTION
			});

			if (verdict === 'failed') {
				set.status = 403;

				return { error: 'turnstile_failed' };
			}

			if (verdict === 'unavailable' || verdict === 'unconfigured') {
				return serviceUnavailable(set, `turnstile_${verdict}`);
			}

			const { proof } = issueHumanProof({
				scope: NICKNAME_CHECK_SCOPE,
				ip,
				ttlMs: NICKNAME_CHECK_PROOF_TTL_MS
			});

			// A relative lifetime, so a client whose clock is off still renews in time.
			return { proof, ttlMs: NICKNAME_CHECK_PROOF_TTL_MS };
		},
		{
			body: t.Object({ turnstileToken: t.String({ maxLength: MAX_TURNSTILE_TOKEN_LENGTH }) })
		}
	)
	.get(
		'/public-nickname-availability',
		async ({ request, set, query: params }) => {
			const ip = clientIp(request);

			for (const { name, limit, windowMs } of [
				{
					name: 'public_nickname_check_minute',
					limit: PUBLIC_NICKNAME_CHECK_LIMIT_PER_MINUTE,
					windowMs: MINUTE_IN_MS
				},
				{
					name: 'public_nickname_check_hour',
					limit: PUBLIC_NICKNAME_CHECK_LIMIT_PER_HOUR,
					windowMs: HOUR_IN_MS
				}
			]) {
				const limited = enforceLimit({ set, name, ip, limit, windowMs });

				if (limited) {
					return limited;
				}
			}

			if (!verifyHumanProof({ proof: params.proof, scope: NICKNAME_CHECK_SCOPE, ip })) {
				set.status = 403;

				return { error: 'human_proof_required' };
			}

			// Same validator and the same answer as the signed-in probe, which
			// says only whether the handle is free and why not, never who holds it.
			return await checkNicknameAvailability({ nickname: params.nickname });
		},
		{ query: t.Object({ nickname: t.String(), proof: t.Optional(t.String()) }) }
	)
	.get(
		'/by-handle',
		async ({ request, set, query: params }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			// One indexed lookup per guess would otherwise sidestep the search cap.
			const limited = enforceLimit({
				set,
				name: 'profile_by_handle',
				ip: clientIp(request),
				limit: PROFILE_SEARCH_LIMIT_PER_HOUR,
				windowMs: HOUR_IN_MS
			});

			if (limited) {
				return limited;
			}

			const profile = await getProfileByHandle(params.handle);

			if (isNullish(profile)) {
				set.status = 404;

				return { error: 'not_found' };
			}

			return { profile };
		},
		{ query: t.Object({ handle: t.String({ maxLength: PROFILE_BY_HANDLE_MAX_LENGTH }) }) }
	)
	.get(
		'/search',
		async ({ request, set, query: params }) => {
			const limited = enforceLimit({
				set,
				name: 'profile_search',
				ip: clientIp(request),
				limit: PROFILE_SEARCH_LIMIT_PER_HOUR,
				windowMs: HOUR_IN_MS
			});

			if (limited) {
				return limited;
			}

			return { items: await searchProfiles(params.q) };
		},
		{ query: t.Object({ q: t.String() }) }
	)
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
				computedAtMs: t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
			})
		}
	)
	// Public: the landing page's registered-users figure, one aggregate.
	.get('/count', async () => ({ count: await countProfiles() }))
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
