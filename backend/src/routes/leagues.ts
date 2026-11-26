// League surface: CRUD + invite lookup + membership lifecycle + ownership
// transfer + cover images + per-league stats + the founder-award self-heal.
// Session-gated except the cover-image GET (an <img> src cannot carry
// credentials cross-origin).

import { isNullish } from '@dfinity/utils';
import { Elysia, t } from 'elysia';
import { requireUser, unauthenticated } from '../auth/guard';
import {
	deleteLeagueImage,
	locateLeagueImage,
	removeLeagueCover,
	uploadLeagueImage
} from '../leagues/images';
import {
	createLeague,
	deleteLeague,
	LEAGUE_INVITE_CODE_LENGTH,
	LEAGUE_LEGACY_INVITE_CODE_LENGTH,
	LeagueError,
	listChallengeableLeagues,
	listFriendRecommendedLeagues,
	listLeagueMembers,
	listMyLeagues,
	listOwnedLeagueIds,
	lookupLeagueByInvite,
	transferLeagueOwnership,
	updateLeague
} from '../leagues/leagues';
import { joinLeagueByInvite, removeLeagueMember, upsertLeagueMember } from '../leagues/members';
import { getLeagueStats } from '../leagues/stats';
import { badRequest } from '../lib/http';
import { enforceLimit } from '../lib/rate-limit';
import { HOUR_IN_MS } from '../lib/time';
import { settleFounderAwards } from '../vxp/founder';

const PRIVACY_SCHEMA = t.Union([t.Literal('open'), t.Literal('private')]);

// An invite code is a short, guessable string, so the lookup and the join
// share one budget, keyed by account rather than IP: students on one campus
// network share an address, and the guessing being bounded is per account.
const LEAGUE_INVITE_LIMIT_PER_HOUR = 30;
const LEAGUE_INVITE_LIMIT_NAME = 'league_invite';

export const leaguesRoutes = new Elysia({ prefix: '/api/v1/leagues' })
	.get('/mine', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		return { items: await listMyLeagues(user.id) };
	})
	.get('/challengeable', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		return { items: await listChallengeableLeagues(user.id) };
	})
	.get('/friend-recommended', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		return { items: await listFriendRecommendedLeagues(user.id) };
	})
	.get('/invite/:inviteCode', async ({ request, set, params }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		const limited = enforceLimit({
			set,
			name: LEAGUE_INVITE_LIMIT_NAME,
			ip: user.id,
			limit: LEAGUE_INVITE_LIMIT_PER_HOUR,
			windowMs: HOUR_IN_MS
		});

		if (limited) {
			return limited;
		}

		return { league: await lookupLeagueByInvite(params.inviteCode) };
	})
	.post(
		'/',
		async ({ request, set, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			try {
				const league = await createLeague({
					id: body.id,
					name: body.name,
					description: body.description,
					ownerUserId: user.id,
					accentColor: body.accentColor,
					emblem: body.emblem,
					privacy: body.privacy
				});

				// A league disbanded under this id may have left its cover in
				// storage, and the cover GET serves by id: a new league starts bare.
				await removeLeagueCover(league.id);

				set.status = 201;

				return { league };
			} catch (err) {
				if (err instanceof LeagueError) {
					return badRequest(set, err.message);
				}

				throw err;
			}
		},
		{
			body: t.Object({
				id: t.String({ minLength: 1, maxLength: 64 }),
				name: t.String(),
				description: t.Optional(t.String()),
				accentColor: t.Optional(t.String({ maxLength: 32 })),
				emblem: t.Optional(t.String({ maxLength: 8 })),
				privacy: t.Optional(PRIVACY_SCHEMA)
			})
		}
	)
	.patch(
		'/:leagueId',
		async ({ request, set, params, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			try {
				return {
					league: await updateLeague({
						leagueId: params.leagueId,
						callerId: user.id,
						name: body.name,
						description: body.description,
						privacy: body.privacy
					})
				};
			} catch (err) {
				if (err instanceof LeagueError) {
					return badRequest(set, err.message);
				}

				throw err;
			}
		},
		{
			body: t.Object({
				name: t.Optional(t.String()),
				description: t.Optional(t.Nullable(t.String())),
				privacy: t.Optional(PRIVACY_SCHEMA)
			})
		}
	)
	.delete('/:leagueId', async ({ request, set, params }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		const result = await deleteLeague({ leagueId: params.leagueId, callerId: user.id });

		if (!result.ok) {
			set.status = 403;
		}

		return result;
	})
	.post(
		'/:leagueId/transfer-ownership',
		async ({ request, set, params, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			return await transferLeagueOwnership({
				leagueId: params.leagueId,
				callerId: user.id,
				newOwnerUserId: body.newOwnerUserId
			});
		},
		{ body: t.Object({ newOwnerUserId: t.String({ format: 'uuid' }) }) }
	)
	// Membership
	.get('/:leagueId/members', async ({ request, set, params }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		return { items: await listLeagueMembers(params.leagueId) };
	})
	.post(
		'/join',
		async ({ request, set, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			const limited = enforceLimit({
				set,
				name: LEAGUE_INVITE_LIMIT_NAME,
				ip: user.id,
				limit: LEAGUE_INVITE_LIMIT_PER_HOUR,
				windowMs: HOUR_IN_MS
			});

			if (limited) {
				return limited;
			}

			try {
				return {
					member: await joinLeagueByInvite({ inviteCode: body.inviteCode, userId: user.id })
				};
			} catch (err) {
				if (err instanceof LeagueError) {
					return badRequest(set, err.message);
				}

				throw err;
			}
		},
		{
			body: t.Object({
				inviteCode: t.String({
					minLength: LEAGUE_LEGACY_INVITE_CODE_LENGTH,
					maxLength: LEAGUE_INVITE_CODE_LENGTH
				})
			})
		}
	)
	.put(
		'/:leagueId/members/:memberUserId',
		async ({ request, set, params, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			try {
				return {
					member: await upsertLeagueMember({
						leagueId: params.leagueId,
						callerId: user.id,
						memberUserId: params.memberUserId,
						role: body.role
					})
				};
			} catch (err) {
				if (err instanceof LeagueError) {
					return badRequest(set, err.message);
				}

				throw err;
			}
		},
		{
			body: t.Object({
				role: t.Union([t.Literal('owner'), t.Literal('admin'), t.Literal('member')])
			})
		}
	)
	.delete('/:leagueId/members/:memberUserId', async ({ request, set, params }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		try {
			return await removeLeagueMember({
				leagueId: params.leagueId,
				callerId: user.id,
				memberUserId: params.memberUserId
			});
		} catch (err) {
			if (err instanceof LeagueError) {
				return badRequest(set, err.message);
			}

			throw err;
		}
	})
	// Stats
	.get('/:leagueId/stats', async ({ request, set, params }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		return { stats: await getLeagueStats(params.leagueId) };
	})
	// Founder-award self-heal: pays any of the caller's owned leagues that
	// still lack the founder reward. Idempotent on every Leagues-page mount.
	.post('/founder-awards/settle', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		return await settleFounderAwards({
			userId: user.id,
			ownedLeagueIds: await listOwnedLeagueIds(user.id)
		});
	})
	// Cover image
	.post(
		'/:leagueId/image',
		async ({ request, set, params, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			try {
				const league = await uploadLeagueImage({
					leagueId: params.leagueId,
					callerId: user.id,
					bytes: await body.image.arrayBuffer()
				});

				return { league };
			} catch (err) {
				if (err instanceof LeagueError) {
					return badRequest(set, err.message);
				}

				throw err;
			}
		},
		{ body: t.Object({ image: t.File() }) }
	)
	.delete('/:leagueId/image', async ({ request, set, params }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		try {
			return { league: await deleteLeagueImage({ leagueId: params.leagueId, callerId: user.id }) };
		} catch (err) {
			if (err instanceof LeagueError) {
				return badRequest(set, err.message);
			}

			throw err;
		}
	})
	// Public read: renders in <img> tags, so no session gate. Serves a 302 to
	// a short-lived presigned URL (S3) or streams the local file (dev).
	.get('/:leagueId/image', ({ params, set }) => {
		const location = locateLeagueImage(params.leagueId);

		if (location.kind === 'redirect') {
			set.status = 302;
			set.headers['location'] = location.url;

			return '';
		}

		if (location.kind === 'file') {
			set.headers['content-type'] = 'image/jpeg';
			set.headers['cache-control'] = 'public, max-age=300';

			return Bun.file(location.path);
		}

		set.status = 404;

		return { error: 'not found' };
	});
