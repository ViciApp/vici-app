// Account lifecycle surface: soft delete (with league resolutions and the
// blocking pre-flight), recovery, hibernate/resume, and the admin retention
// sweep the worker also runs on a cadence.

import { isNullish } from '@dfinity/utils';
import { Elysia, t } from 'elysia';
import {
	deleteMyAccount,
	findBlockingLeagueIds,
	hibernateMyAccount,
	recoverMyAccount,
	resumeMyAccount,
	sweepExpiredDeletions
} from '../account/lifecycle';
import { forbidden, requireAdmin, requireUser, unauthenticated } from '../auth/guard';

export const accountRoutes = new Elysia({ prefix: '/api/v1/account' })
	.post(
		'/delete',
		async ({ request, set, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			return await deleteMyAccount({
				userId: user.id,
				reason: body.reason,
				note: body.note ?? '',
				leagueResolutions: body.leagueResolutions
			});
		},
		{
			body: t.Object({
				reason: t.String(),
				note: t.Optional(t.String()),
				leagueResolutions: t.Optional(
					t.Array(
						t.Object({
							leagueId: t.String(),
							action: t.Union([t.Literal('transfer'), t.Literal('delete')]),
							transferTo: t.Optional(t.String({ format: 'uuid' }))
						})
					)
				)
			})
		}
	)
	.post('/recover', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		return await recoverMyAccount(user.id);
	})
	.post('/hibernate', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		return await hibernateMyAccount(user.id);
	})
	.post('/resume', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		return await resumeMyAccount(user.id);
	})
	// Pre-flight for the delete CTA: leagues the caller must resolve first.
	.get('/blocking-leagues', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		return { leagueIds: await findBlockingLeagueIds(user.id) };
	})
	.post('/admin/sweep', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		const admin = requireAdmin(user);

		if (isNullish(admin)) {
			return forbidden(set);
		}

		return await sweepExpiredDeletions();
	});
