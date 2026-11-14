// Mirrors an app role assignment onto the on-chain engine registry: the
// minimum grant/revoke diff to bring the engine roles in line with the
// user's stored role, plus the oracle authorized-principals set for roles
// that settle. Calls sign with the service admin identity; the target
// principal is the user's derived custodial identity, the same principal
// the engine sees on that user's own calls. Idempotent by construction: an
// already-granted / not-granted answer from the registry is a success.

import { nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import type { RegistryDid } from '../declarations';
import { adminRegistry } from '../engine/actors';
import { VICI_ENGINE_ID } from '../engine/registry';
import { logger } from '../lib/logger';

/** The single oracle whose authorized principals mirror settling roles. */
export const VICI_ORACLE_V1 = 'VICI_ORACLE_V1';

/** Grantable app roles; 'user' is the canonical no-role state. */
export type GrantableRole = 'admin' | 'solver' | 'creator';

export const GRANTABLE_ROLES: readonly GrantableRole[] = ['admin', 'solver', 'creator'];

export const isGrantableRole = (value: string): value is GrantableRole =>
	(GRANTABLE_ROLES as readonly string[]).includes(value);

type EngineRoleVariant = RegistryDid.EngineRole;

/** App role to the set of engine roles that principal should hold. */
const ROLE_TO_ENGINE_ROLES: Record<GrantableRole, EngineRoleVariant[]> = {
	admin: [{ Creator: null }, { OracleAdmin: null }],
	solver: [{ OracleAdmin: null }],
	creator: [{ Creator: null }]
};

const engineRoleKey = (role: EngineRoleVariant): string => Object.keys(role)[0] ?? '';

const mappedRoles = (role: GrantableRole | undefined): EngineRoleVariant[] =>
	nonNullish(role) ? ROLE_TO_ENGINE_ROLES[role] : [];

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

/**
 * Whether the role should also be an authorized settler on the oracle.
 * Derived from OracleAdmin membership: anyone who can manage oracles in the
 * single-oracle setup is also expected to settle.
 */
const shouldBeOracleSettler = (role: GrantableRole | undefined): boolean =>
	mappedRoles(role).some((r) => engineRoleKey(r) === 'OracleAdmin');

/** Whether a stored role may settle markets, and so record the settlement
 * activity that follows an on-chain settle. */
export const isSettlingRole = (role: string): boolean =>
	isGrantableRole(role) && shouldBeOracleSettler(role);

const errToString = (err: RegistryDid.EngineError | RegistryDid.OracleError): string =>
	Object.keys(err)[0] ?? 'unknown';

const isIdempotentEngineError = ({
	method,
	err
}: {
	method: 'grant' | 'revoke';
	err: RegistryDid.EngineError;
}): boolean =>
	(method === 'grant' && 'RoleAlreadyGranted' in err) ||
	(method === 'revoke' && 'RoleNotGranted' in err);

const applyEngineRole = async ({
	method,
	principal,
	role
}: {
	method: 'grant' | 'revoke';
	principal: Principal;
	role: EngineRoleVariant;
}): Promise<void> => {
	const actor = await adminRegistry();
	const params: RegistryDid.GrantEngineRoleParams = {
		grantee: principal,
		engine_id: VICI_ENGINE_ID,
		role
	};
	const result =
		method === 'grant'
			? await actor.grant_engine_role(params)
			: await actor.revoke_engine_role(params);

	if ('Ok' in result) {
		logger.info(
			`engine role ${method}: ${engineRoleKey(role)} for ${principal.toText()} on ${VICI_ENGINE_ID}`
		);

		return;
	}

	if (isIdempotentEngineError({ method, err: result.Err })) {
		logger.info(
			`engine role ${method} idempotent: ${engineRoleKey(role)} for ${principal.toText()}`
		);

		return;
	}

	throw new Error(`${method}_engine_role failed: ${errToString(result.Err)}`);
};

const manageOraclePrincipal = async ({
	principal,
	action
}: {
	principal: Principal;
	action: 'add' | 'remove';
}): Promise<void> => {
	const actor = await adminRegistry();
	const result = await actor.manage_oracle_principals({
		oracle_id: VICI_ORACLE_V1,
		add_principals: action === 'add' ? [principal] : [],
		remove_principals: action === 'remove' ? [principal] : []
	});

	if ('Ok' in result) {
		logger.info(`oracle settler ${action}: ${principal.toText()} on ${VICI_ORACLE_V1}`);

		return;
	}

	// A fresh install may not have registered the oracle yet: the role grant
	// still succeeded, so log and keep going; an operator can reconcile by
	// bootstrapping the oracle and replaying the role change.
	if ('OracleNotFound' in result.Err) {
		logger.error(
			`oracle settler ${action} skipped, oracle ${VICI_ORACLE_V1} missing (principal ${principal.toText()})`
		);

		return;
	}

	throw new Error(`manage_oracle_principals failed: ${errToString(result.Err)}`);
};

/**
 * Issues the minimum grant/revoke calls to bring the engine in sync with a
 * role transition, then mirrors settler membership onto the oracle's
 * authorized set (a BTreeSet upstream, so duplicate adds and missing
 * removes are no-ops). Revokes run before grants, exactly like the original
 * reconciliation.
 */
export const syncRoleToEngine = async ({
	principalText,
	prevRole,
	nextRole
}: {
	principalText: string;
	prevRole: GrantableRole | undefined;
	nextRole: GrantableRole | undefined;
}): Promise<void> => {
	const principal = Principal.fromText(principalText);
	const { toGrant, toRevoke } = diffRoles({
		previous: mappedRoles(prevRole),
		next: mappedRoles(nextRole)
	});

	for (const role of toRevoke) {
		await applyEngineRole({ method: 'revoke', principal, role });
	}

	for (const role of toGrant) {
		await applyEngineRole({ method: 'grant', principal, role });
	}

	const wasSettler = shouldBeOracleSettler(prevRole);
	const isSettler = shouldBeOracleSettler(nextRole);

	if (!wasSettler && isSettler) {
		await manageOraclePrincipal({ principal, action: 'add' });
	} else if (wasSettler && !isSettler) {
		await manageOraclePrincipal({ principal, action: 'remove' });
	}
};

/** Exposed for unit testing: the mapping + diff internals. */
export const __testOnly = {
	ROLE_TO_ENGINE_ROLES,
	diffRoles,
	engineRoleKey,
	shouldBeOracleSettler
};
