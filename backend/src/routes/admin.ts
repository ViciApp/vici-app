// Administration surface: role grant/revoke (mirrored to the engine
// registry), the runtime app settings, and the queue of provisional accounts
// that login / claim adoption left for manual resolution. Every endpoint is
// admin-gated; requireUser first so the 401/403 split stays honest.

import { isNullish } from '@dfinity/utils';
import { Elysia, t } from 'elysia';
import { isGrantableRole } from '../admin/engine-sync';
import { listRoleAssignments, revokeUserRole, RoleError, setUserRole } from '../admin/roles';
import {
	deleteAppSetting,
	getAppSetting,
	listAppSettings,
	upsertAppSetting
} from '../admin/settings';
import { listAdoptionConflicts } from '../auth/adoption';
import {
	forbidden,
	requireAdmin,
	requireUser,
	unauthenticated,
	type AuthedUser
} from '../auth/guard';

interface StatusContext {
	status?: number | string;
}

const gate = async (
	request: Request,
	set: StatusContext
): Promise<{ admin: AuthedUser } | { error: { error: string } }> => {
	const user = await requireUser(request);

	if (isNullish(user)) {
		return { error: unauthenticated(set) };
	}

	const admin = await requireAdmin(request);

	if (isNullish(admin)) {
		return { error: forbidden(set) };
	}

	return { admin };
};

export const adminRoutes = new Elysia({ prefix: '/api/v1/admin' })
	.get('/roles', async ({ request, set }) => {
		const gated = await gate(request, set);

		if ('error' in gated) {
			return gated.error;
		}

		return { items: await listRoleAssignments() };
	})
	.put(
		'/roles/:userId',
		async ({ request, set, params, body }) => {
			const gated = await gate(request, set);

			if ('error' in gated) {
				return gated.error;
			}

			if (!isGrantableRole(body.role)) {
				set.status = 400;

				return { error: 'invalid_role' };
			}

			try {
				return { assignment: await setUserRole({ userId: params.userId, role: body.role }) };
			} catch (err) {
				if (err instanceof RoleError) {
					set.status = 404;

					return { error: err.message };
				}

				throw err;
			}
		},
		{
			params: t.Object({ userId: t.String({ format: 'uuid' }) }),
			body: t.Object({ role: t.String() })
		}
	)
	.delete(
		'/roles/:userId',
		async ({ request, set, params }) => {
			const gated = await gate(request, set);

			if ('error' in gated) {
				return gated.error;
			}

			try {
				return await revokeUserRole({ userId: params.userId });
			} catch (err) {
				if (err instanceof RoleError) {
					set.status = 404;

					return { error: err.message };
				}

				throw err;
			}
		},
		{ params: t.Object({ userId: t.String({ format: 'uuid' }) }) }
	)
	.get('/legacy-adoption-conflicts', async ({ request, set }) => {
		const gated = await gate(request, set);

		if ('error' in gated) {
			return gated.error;
		}

		return { items: await listAdoptionConflicts() };
	})
	.get('/settings', async ({ request, set }) => {
		const gated = await gate(request, set);

		if ('error' in gated) {
			return gated.error;
		}

		return { items: await listAppSettings() };
	})
	.get('/settings/:key', async ({ request, set, params }) => {
		const gated = await gate(request, set);

		if ('error' in gated) {
			return gated.error;
		}

		const setting = await getAppSetting(params.key);

		if (isNullish(setting)) {
			set.status = 404;

			return { error: 'not_found' };
		}

		return { setting };
	})
	.put(
		'/settings/:key',
		async ({ request, set, params, body }) => {
			const gated = await gate(request, set);

			if ('error' in gated) {
				return gated.error;
			}

			return { setting: await upsertAppSetting({ key: params.key, value: body.value }) };
		},
		{ body: t.Object({ value: t.Unknown() }) }
	)
	.delete('/settings/:key', async ({ request, set, params }) => {
		const gated = await gate(request, set);

		if ('error' in gated) {
			return gated.error;
		}

		return await deleteAppSetting(params.key);
	});
