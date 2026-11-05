import { VICI_ORACLE_V1 } from '#lib/constants/app.constants.ts';
import { REGISTRY_CANISTER_ID } from '#lib/constants/canisters.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import { VICI_ENGINE_ID } from '#lib/constants/icdc.constants.ts';
import { UserRole } from '#lib/enums/user.ts';
import type { RegistryDid } from '$declarations';
import { candidMethod } from '$satellite/utils/candid.utils';
import { logError, logInfo } from '$satellite/utils/logger.utils';
import { isNullish, nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import type { OnDeleteDocContext, OnSetDocContext } from '@junobuild/functions';
import { call } from '@junobuild/functions/ic-cdk';
import { decodeDocData } from '@junobuild/functions/sdk';

type EngineRoleVariant = RegistryDid.EngineRole;

/**
 * Maps Juno `UserRole` values to the set of `EngineRole`s the corresponding principal should
 * hold on the Vici engine in icdc-core.
 *
 * `CONTROLLER` is empty because canister controllers bypass all engine-role checks.
 */
const ROLE_TO_ENGINE_ROLES: Record<UserRole, EngineRoleVariant[]> = {
	[UserRole.CONTROLLER]: [],
	[UserRole.ADMIN]: [{ Creator: null }, { OracleAdmin: null }],
	[UserRole.SOLVER]: [{ OracleAdmin: null }],
	[UserRole.CREATOR]: [{ Creator: null }]
};

const engineRoleKey = (role: EngineRoleVariant): string => Object.keys(role)[0];

const diffRoles = ({
	previous,
	next
}: {
	previous: EngineRoleVariant[];
	next: EngineRoleVariant[];
}): { toGrant: EngineRoleVariant[]; toRevoke: EngineRoleVariant[] } => {
	const prevKeys = new Set(previous.map(engineRoleKey));
	const nextKeys = new Set(next.map(engineRoleKey));

	return {
		toGrant: next.filter((r) => !prevKeys.has(engineRoleKey(r))),
		toRevoke: previous.filter((r) => !nextKeys.has(engineRoleKey(r)))
	};
};

const isIdempotentEngineError = ({
	method,
	result
}: {
	method: 'grant' | 'revoke';
	result: RegistryDid.EngineResult;
}): boolean => {
	if (!('Err' in result)) {
		return false;
	}

	const err = result.Err;

	if (method === 'grant' && 'RoleAlreadyGranted' in err) {
		return true;
	}

	if (method === 'revoke' && 'RoleNotGranted' in err) {
		return true;
	}

	return false;
};

const errToString = (err: RegistryDid.EngineError | RegistryDid.OracleError): string =>
	Object.keys(err)[0];

/**
 * Whether the given `UserRole` should also be an authorized settler on `VICI_ORACLE_V1`.
 *
 * Today this is derived from whether the role grants `OracleAdmin` on the Vici engine:
 * anyone who can manage oracles in Vici's single-oracle setup is also expected to settle.
 * If the mapping diverges in the future (e.g. adding a "settle-only" role), flip this to a
 * standalone table.
 */
const shouldBeOracleSettler = (role: UserRole | undefined): boolean =>
	nonNullish(role) && ROLE_TO_ENGINE_ROLES[role].some((r) => engineRoleKey(r) === 'OracleAdmin');

const manageOraclePrincipal = async ({
	principal,
	action
}: {
	principal: Principal;
	action: 'add' | 'remove';
}): Promise<void> => {
	const { argTypes, result: resultType } = candidMethod({
		canister: 'registry',
		method: 'manage_oracle_principals'
	});
	const result = await call<RegistryDid.OracleResult>({
		canisterId: REGISTRY_CANISTER_ID,
		method: 'manage_oracle_principals',
		args: [
			[
				argTypes[0],
				{
					oracle_id: VICI_ORACLE_V1,
					add_principals: action === 'add' ? [principal] : [],
					remove_principals: action === 'remove' ? [principal] : []
				}
			]
		],
		result: resultType
	});

	if ('Ok' in result) {
		logInfo({
			message: 'oracle_settler_synced',
			detail: {
				oracle_id: VICI_ORACLE_V1,
				principal: principal.toText(),
				action
			}
		});

		return;
	}

	// The oracle may not have been registered yet (fresh install before `init:registry`
	// ran). Log a warning and keep going — the engine role grant still succeeded, and the
	// admin can reconcile manually by bootstrapping the oracle + replaying the role change.
	if ('OracleNotFound' in result.Err) {
		logError({
			message: 'oracle_settler_skipped_missing_oracle',
			detail: {
				oracle_id: VICI_ORACLE_V1,
				principal: principal.toText(),
				action
			}
		});

		return;
	}

	throw new Error(`manage_oracle_principals failed: ${errToString(result.Err)}`);
};

const grantEngineRole = async ({
	principal,
	role
}: {
	principal: Principal;
	role: EngineRoleVariant;
}): Promise<void> => {
	const { argTypes, result: resultType } = candidMethod({
		canister: 'registry',
		method: 'grant_engine_role'
	});
	const result = await call<RegistryDid.EngineResult>({
		canisterId: REGISTRY_CANISTER_ID,
		method: 'grant_engine_role',
		args: [
			[
				argTypes[0],
				{
					grantee: principal,
					engine_id: VICI_ENGINE_ID,
					role
				}
			]
		],
		result: resultType
	});

	if ('Ok' in result) {
		logInfo({
			message: 'engine_role_granted',
			detail: {
				engine_id: VICI_ENGINE_ID,
				principal: principal.toText(),
				role: engineRoleKey(role)
			}
		});

		return;
	}

	if (isIdempotentEngineError({ method: 'grant', result })) {
		logInfo({
			message: 'engine_role_grant_idempotent',
			detail: {
				engine_id: VICI_ENGINE_ID,
				principal: principal.toText(),
				role: engineRoleKey(role)
			}
		});

		return;
	}

	throw new Error(`grant_engine_role failed: ${errToString(result.Err)}`);
};

const revokeEngineRole = async ({
	principal,
	role
}: {
	principal: Principal;
	role: EngineRoleVariant;
}): Promise<void> => {
	const { argTypes, result: resultType } = candidMethod({
		canister: 'registry',
		method: 'revoke_engine_role'
	});
	const result = await call<RegistryDid.EngineResult>({
		canisterId: REGISTRY_CANISTER_ID,
		method: 'revoke_engine_role',
		args: [
			[
				argTypes[0],
				{
					grantee: principal,
					engine_id: VICI_ENGINE_ID,
					role
				}
			]
		],
		result: resultType
	});

	if ('Ok' in result) {
		logInfo({
			message: 'engine_role_revoked',
			detail: {
				engine_id: VICI_ENGINE_ID,
				principal: principal.toText(),
				role: engineRoleKey(role)
			}
		});

		return;
	}

	if (isIdempotentEngineError({ method: 'revoke', result })) {
		logInfo({
			message: 'engine_role_revoke_idempotent',
			detail: {
				engine_id: VICI_ENGINE_ID,
				principal: principal.toText(),
				role: engineRoleKey(role)
			}
		});

		return;
	}

	throw new Error(`revoke_engine_role failed: ${errToString(result.Err)}`);
};

const readRoleFromDoc = (data: Uint8Array): UserRole | undefined => {
	try {
		const { role } = decodeDocData<{ role: UserRole }>(data);

		return role;
	} catch {
		// Malformed role document: treat as "no role" so the sync diff can proceed without aborting the whole reconciliation.
	}
};

const tryParsePrincipal = (key: string): Principal | undefined => {
	try {
		return Principal.fromText(key);
	} catch {
		// Non-principal keys are skipped silently; throwing would break iteration over unrelated doc keys.
	}
};

const applyDiff = async ({
	principal,
	prevRole,
	nextRole
}: {
	principal: Principal;
	prevRole: UserRole | undefined;
	nextRole: UserRole | undefined;
}): Promise<void> => {
	const previous = nonNullish(prevRole) ? ROLE_TO_ENGINE_ROLES[prevRole] : [];
	const next = nonNullish(nextRole) ? ROLE_TO_ENGINE_ROLES[nextRole] : [];

	const { toGrant, toRevoke } = diffRoles({ previous, next });

	for (const role of toRevoke) {
		await revokeEngineRole({ principal, role });
	}

	for (const role of toGrant) {
		await grantEngineRole({ principal, role });
	}

	// Mirror OracleAdmin membership into the Vici oracle's `authorized_principals` set, so
	// an admin/solver assignment is enough to both manage and actually settle markets. The
	// underlying canister uses a `BTreeSet`, so duplicate adds / missing removes are no-ops.
	const wasSettler = shouldBeOracleSettler(prevRole);
	const isSettler = shouldBeOracleSettler(nextRole);

	if (!wasSettler && isSettler) {
		await manageOraclePrincipal({ principal, action: 'add' });
	} else if (wasSettler && !isSettler) {
		await manageOraclePrincipal({ principal, action: 'remove' });
	}
};

/**
 * Invoked by the `onSetDoc` hook for the `roles` collection.
 *
 * Diffs the previous and proposed `role` fields and issues the minimum number of
 * `grant_engine_role` / `revoke_engine_role` calls to bring the Vici engine in sync with the
 * doc. Idempotent: if the engine already has/lacks the role, the corresponding call short-
 * circuits without error.
 *
 * The doc key must be a principal text — this is enforced by `assertSetRole` upstream.
 */
export const syncRoleToEngineOnSet = async (ctx: OnSetDocContext): Promise<void> => {
	const {
		data: {
			collection,
			key,
			data: { before, after }
		}
	} = ctx;

	if (collection !== Collection.ROLES) {
		return;
	}

	const principal = tryParsePrincipal(key);

	if (isNullish(principal)) {
		logError({
			message: 'engine_sync_invalid_key',
			detail: { key }
		});

		return;
	}

	const prevRole = nonNullish(before) ? readRoleFromDoc(before.data) : undefined;
	const nextRole = readRoleFromDoc(after.data);

	if (isNullish(nextRole)) {
		logError({
			message: 'engine_sync_decode_failed',
			detail: { key, stage: 'after' }
		});

		return;
	}

	try {
		await applyDiff({ principal, prevRole, nextRole });
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		logError({
			message: 'engine_sync_error',
			detail: {
				hook: 'on_set',
				key,
				prev_role: prevRole ?? 'none',
				next_role: nextRole,
				error: msg
			}
		});
		throw e;
	}
};

/**
 * Invoked by the `onDeleteDoc` hook for the `roles` collection.
 *
 * Revokes every engine role previously mapped to the deleted `UserRole`, and removes the
 * principal from `VICI_ORACLE_V1.authorized_principals` if the prior role was a settler.
 *
 * If the deleted doc's `data` cannot be decoded (legacy or partial state), the hook logs
 * `engine_sync_decode_failed` and becomes a **no-op** — we intentionally do NOT blindly
 * revoke the union of all possible engine roles on a decode failure, because that would
 * let a single malformed/transient write silently strip privileges from a principal whose
 * role we just can't see right now. Operators can reconcile manually via
 * `dfx canister call registry revoke_engine_role ...` (see `docs/engine-integration.md`).
 */
export const syncRoleToEngineOnDelete = async (ctx: OnDeleteDocContext): Promise<void> => {
	const {
		data: { collection, key, data: deletedDoc }
	} = ctx;

	if (collection !== Collection.ROLES) {
		return;
	}

	const principal = tryParsePrincipal(key);

	if (isNullish(principal)) {
		logError({
			message: 'engine_sync_invalid_key',
			detail: { key }
		});

		return;
	}

	const prevRole = nonNullish(deletedDoc) ? readRoleFromDoc(deletedDoc.data) : undefined;

	if (nonNullish(deletedDoc) && isNullish(prevRole)) {
		logError({
			message: 'engine_sync_decode_failed',
			detail: { key, stage: 'deleted' }
		});

		return;
	}

	try {
		await applyDiff({ principal, prevRole, nextRole: undefined });
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		logError({
			message: 'engine_sync_error',
			detail: {
				hook: 'on_delete',
				key,
				prev_role: prevRole ?? 'none',
				error: msg
			}
		});
		throw e;
	}
};

/**
 * Exposed for unit testing: the UserRole → EngineRole mapping table.
 */
export const __testOnly = {
	ROLE_TO_ENGINE_ROLES,
	diffRoles,
	engineRoleKey,
	shouldBeOracleSettler
};
