// School verification surface: the submit/verify round-trip, the public
// directory of schools that reached the threshold, and the admin registry
// CRUD (seeding and corrections).

import { isNullish } from '@dfinity/utils';
import { Elysia, t } from 'elysia';
import { forbidden, requireAdmin, requireUser, unauthenticated } from '../auth/guard';
import { badRequest } from '../lib/http';
import { enforceLimit } from '../lib/rate-limit';
import { HOUR_IN_MS } from '../lib/time';
import {
	adminDeleteSchool,
	adminUpsertSchool,
	listAllSchools,
	listPublicSchools,
	SchoolVerificationError,
	submitSchool,
	verifySchoolCode
} from '../school/verification';

export const schoolRoutes = new Elysia({ prefix: '/api/v1/school' })
	.post(
		'/submit',
		async ({ request, set, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			try {
				return await submitSchool({
					userId: user.id,
					name: body.name,
					country: body.country ?? null,
					email: body.email,
					locale: body.locale
				});
			} catch (err) {
				if (err instanceof SchoolVerificationError) {
					return badRequest(set, err.message);
				}

				throw err;
			}
		},
		{
			body: t.Object({
				name: t.String(),
				country: t.Optional(t.Nullable(t.String())),
				email: t.String(),
				locale: t.Optional(t.String())
			})
		}
	)
	.post(
		'/verify',
		async ({ request, set, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			// Keyed by account, not IP: students on one campus network share an
			// address, and the guessing being bounded is per account.
			const limited = enforceLimit({
				set,
				name: 'school_verify',
				ip: user.id,
				limit: 30,
				windowMs: HOUR_IN_MS
			});

			if (limited) {
				return limited;
			}

			return await verifySchoolCode({
				userId: user.id,
				submissionId: body.submissionId,
				code: body.code
			});
		},
		{ body: t.Object({ submissionId: t.String(), code: t.String() }) }
	)
	.get('/schools', async () => ({ items: await listPublicSchools() }))
	.get('/admin/schools', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		const admin = requireAdmin(user);

		if (isNullish(admin)) {
			return forbidden(set);
		}

		return { items: await listAllSchools() };
	})
	.put(
		'/admin/schools/:schoolId',
		async ({ request, set, params, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			const admin = requireAdmin(user);

			if (isNullish(admin)) {
				return forbidden(set);
			}

			return {
				school: await adminUpsertSchool({
					schoolId: params.schoolId,
					name: body.name,
					country: body.country ?? null,
					domains: body.domains,
					status: body.status
				})
			};
		},
		{
			body: t.Object({
				name: t.String(),
				country: t.Optional(t.Nullable(t.String())),
				domains: t.Array(t.String()),
				status: t.Optional(t.Union([t.Literal('pending'), t.Literal('public')]))
			})
		}
	)
	.delete('/admin/schools/:schoolId', async ({ request, set, params }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		const admin = requireAdmin(user);

		if (isNullish(admin)) {
			return forbidden(set);
		}

		return await adminDeleteSchool(params.schoolId);
	});
