// Role administration semantics: persisted role transitions with the engine
// registry mocked at the actor boundary, verifying the exact grant/revoke
// diff, the oracle settler mirror, the idempotent-error tolerance, and the
// missing-oracle skip.

import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { __testOnly } from '../src/admin/engine-sync';
import { listRoleAssignments, revokeUserRole, setUserRole } from '../src/admin/roles';
import { query } from '../src/db/client';
import type { ClearingService, RegistryDid, RegistryService } from '../src/declarations';
import { setEngineActorProvider } from '../src/engine/actors';
import { userIcPrincipalText } from '../src/lib/keys';
import { createTestUser, ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

let restore: (() => void) | undefined;

afterEach(() => {
	restore?.();
	restore = undefined;
});

interface RecordedCall {
	method: 'grant' | 'revoke' | 'oracle';
	role?: string;
	grantee?: string;
	engineId?: string;
	oracleId?: string;
	add?: string[];
	remove?: string[];
}

const roleKey = (role: RegistryDid.EngineRole): string => Object.keys(role)[0] ?? '';

const mockRegistry = ({
	grantResult,
	revokeResult,
	oracleResult
}: {
	grantResult?: RegistryDid.EngineResult;
	revokeResult?: RegistryDid.EngineResult;
	oracleResult?: RegistryDid.OracleResult;
} = {}): RecordedCall[] => {
	const calls: RecordedCall[] = [];

	const registry = {
		grant_engine_role: (params: RegistryDid.GrantEngineRoleParams) => {
			calls.push({
				method: 'grant',
				role: roleKey(params.role),
				grantee: params.grantee.toText(),
				engineId: params.engine_id
			});

			return Promise.resolve(grantResult ?? { Ok: null });
		},
		revoke_engine_role: (params: RegistryDid.GrantEngineRoleParams) => {
			calls.push({
				method: 'revoke',
				role: roleKey(params.role),
				grantee: params.grantee.toText(),
				engineId: params.engine_id
			});

			return Promise.resolve(revokeResult ?? { Ok: null });
		},
		manage_oracle_principals: (params: RegistryDid.ManageOraclePrincipalsParams) => {
			calls.push({
				method: 'oracle',
				oracleId: params.oracle_id,
				add: params.add_principals.map((p) => p.toText()),
				remove: params.remove_principals.map((p) => p.toText())
			});

			return Promise.resolve(oracleResult ?? { Ok: null });
		}
	};

	restore = setEngineActorProvider({
		clearing: () => Promise.resolve({} as unknown as ClearingService),
		registry: () => Promise.resolve(registry as unknown as RegistryService)
	});

	return calls;
};

const storedRole = async (userId: string): Promise<string | undefined> => {
	const rows = await query<{ role: string }>(`select role from users where id = $1`, [userId]);

	return rows[0]?.role;
};

describe('mapping table', () => {
	test('admin maps to Creator + OracleAdmin, solver to OracleAdmin, creator to Creator', () => {
		const keys = (role: 'admin' | 'solver' | 'creator'): string[] =>
			__testOnly.ROLE_TO_ENGINE_ROLES[role].map(__testOnly.engineRoleKey);

		expect(keys('admin')).toEqual(['Creator', 'OracleAdmin']);
		expect(keys('solver')).toEqual(['OracleAdmin']);
		expect(keys('creator')).toEqual(['Creator']);
		expect(__testOnly.shouldBeOracleSettler('admin')).toBeTrue();
		expect(__testOnly.shouldBeOracleSettler('solver')).toBeTrue();
		expect(__testOnly.shouldBeOracleSettler('creator')).toBeFalse();
		expect(__testOnly.shouldBeOracleSettler(undefined)).toBeFalse();
	});
});

describe.if(dbAvailable)('role sync', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	describe('grant', () => {
		test('granting admin persists the role and mirrors both engine roles plus the settler add', async () => {
			const calls = mockRegistry();
			const userId = await createTestUser();
			const principal = userIcPrincipalText(userId);

			const assignment = await setUserRole({ userId, role: 'admin' });

			expect(assignment).toEqual({ userId, role: 'admin', principal });
			expect(await storedRole(userId)).toBe('admin');
			expect(calls).toEqual([
				{ method: 'grant', role: 'Creator', grantee: principal, engineId: 'eng_0' },
				{ method: 'grant', role: 'OracleAdmin', grantee: principal, engineId: 'eng_0' },
				{ method: 'oracle', oracleId: 'VICI_ORACLE_V1', add: [principal], remove: [] }
			]);
		});

		test('an admin-to-solver change issues only the minimum diff and keeps settler membership', async () => {
			mockRegistry();
			const userId = await createTestUser();

			await setUserRole({ userId, role: 'admin' });

			restore?.();

			const calls = mockRegistry();

			await setUserRole({ userId, role: 'solver' });

			expect(await storedRole(userId)).toBe('solver');
			// Creator goes, OracleAdmin stays, and the oracle set is untouched
			// (the settler status did not change).
			expect(calls).toEqual([
				{
					method: 'revoke',
					role: 'Creator',
					grantee: userIcPrincipalText(userId),
					engineId: 'eng_0'
				}
			]);
		});

		test('an already-granted engine answer reads as success', async () => {
			mockRegistry({ grantResult: { Err: { RoleAlreadyGranted: null } } });
			const userId = await createTestUser();

			expect(await storedRole(userId)).toBe('user');

			await setUserRole({ userId, role: 'creator' });

			expect(await storedRole(userId)).toBe('creator');
		});

		test('a missing oracle is tolerated: the role grant stands', async () => {
			mockRegistry({ oracleResult: { Err: { OracleNotFound: null } } });
			const userId = await createTestUser();

			await setUserRole({ userId, role: 'solver' });

			expect(await storedRole(userId)).toBe('solver');
		});

		test('a genuine engine refusal surfaces after the role persisted', async () => {
			mockRegistry({ grantResult: { Err: { Unauthorized: null } } });
			const userId = await createTestUser();

			expect(setUserRole({ userId, role: 'creator' })).rejects.toThrow(
				'grant_engine_role failed: Unauthorized'
			);
			expect(await storedRole(userId)).toBe('creator');
		});
	});

	describe('revoke', () => {
		test('revoking clears the column and mirrors the full revoke including the settler removal', async () => {
			mockRegistry();
			const userId = await createTestUser();
			const principal = userIcPrincipalText(userId);

			await setUserRole({ userId, role: 'admin' });

			restore?.();

			const calls = mockRegistry({ revokeResult: { Err: { RoleNotGranted: null } } });

			const result = await revokeUserRole({ userId });

			expect(result).toEqual({ userId, revoked: true });
			expect(await storedRole(userId)).toBe('user');
			// Both mapped roles are revoked (idempotent answers tolerated) and the
			// settler membership is removed.
			expect(calls).toEqual([
				{ method: 'revoke', role: 'Creator', grantee: principal, engineId: 'eng_0' },
				{ method: 'revoke', role: 'OracleAdmin', grantee: principal, engineId: 'eng_0' },
				{ method: 'oracle', oracleId: 'VICI_ORACLE_V1', add: [], remove: [principal] }
			]);
		});

		test('revoking a plain user is a clean no-op with no engine calls', async () => {
			const calls = mockRegistry();
			const userId = await createTestUser();

			expect(await revokeUserRole({ userId })).toEqual({ userId, revoked: false });
			expect(calls).toHaveLength(0);
		});
	});

	describe('listing', () => {
		test('role holders list with their engine principal', async () => {
			mockRegistry();
			const userId = await createTestUser();

			await setUserRole({ userId, role: 'creator' });

			const assignments = await listRoleAssignments();
			const mine = assignments.find((a) => a.userId === userId);

			expect(mine).toEqual({ userId, role: 'creator', principal: userIcPrincipalText(userId) });
		});
	});
});
