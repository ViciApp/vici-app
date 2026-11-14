import type { RegistryDid } from '#declarations';
import { functions } from '#declarations/satellite/satellite.api.ts';
import { addOracle, getOracle, manageOraclePrincipals } from '#lib/api/registry.api.ts';
import { VICI_ORACLE_V1 } from '#lib/constants/app.constants.ts';
import { UserRole } from '#lib/enums/user.ts';
import { getIdentity, safeGetIdentityOnce } from '#lib/services/identity.services.ts';
import { loadWithCertification } from '#lib/services/query-update.services.ts';
import { listRoles } from '#lib/services/roles.services.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import type { Identity } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import type { PrincipalText } from '@junobuild/schema';

/**
 * Fetches the canonical Vici oracle registration (if any).
 *
 * Returns `undefined` when the oracle has not been registered yet, in which
 * case the admin must call {@link registerViciOracle} to create it.
 *
 * Performs a single certified update. Prefer {@link loadViciOracle} for UI
 * flows that benefit from the fast-then-certified render pattern.
 */
export const getViciOracle = async (): Promise<RegistryDid.Oracle | undefined> => {
	const identity = await safeGetIdentityOnce();

	return await getOracle({ identity, oracleId: VICI_ORACLE_V1, certified: true });
};

/**
 * Callback-based variant of {@link getViciOracle}. No-op when the user is not
 * signed in (mirrors `safeGetIdentityOnce` auth gating without throwing).
 */
export const loadViciOracle = async ({
	onLoad,
	onUpdateError
}: {
	onLoad: (options: { certified: boolean; response: RegistryDid.Oracle | undefined }) => void;
	onUpdateError?: (error: unknown) => void;
}): Promise<void> => {
	const identity = await getIdentity();

	if (isNullish(identity)) {
		return;
	}

	return loadWithCertification<RegistryDid.Oracle | undefined>({
		identity,
		request: ({ certified, identity: reqIdentity }: { certified: boolean; identity: Identity }) =>
			getOracle({ identity: reqIdentity, oracleId: VICI_ORACLE_V1, certified }),
		onLoad,
		onUpdateError
	});
};

/**
 * An oracle settler paired with its nickname for admin UIs. Mirrors the
 * `UserRoleEntry` shape so the settlers list can reuse the Roles list layout.
 * `nickname` is set when the principal has a real profile, and `undefined`
 * when none exists: settlers can be granted by raw principal, so the nickname
 * is best-effort enrichment, not a guarantee.
 */
export interface OracleSettlerEntry {
	principal: PrincipalText;
	nickname?: string;
}

/**
 * Resolves each settler principal to its nickname via the satellite profile
 * query, returning entries that carry both. Reads the raw satellite result
 * (not the `getProfile` shell, whose fallback nickname is a shortened
 * principal) so a missing profile yields `nickname: undefined` rather than a
 * synthetic stand-in. Per-principal lookups are best-effort: a failed or
 * empty one degrades to the bare principal.
 */
export const resolveOracleSettlers = (principals: PrincipalText[]): Promise<OracleSettlerEntry[]> =>
	Promise.all(
		principals.map(async (principal): Promise<OracleSettlerEntry> => {
			try {
				const { profile } = await functions.getProfile({ principalStr: principal });
				const nickname = profile?.nickname.trim();

				return nonNullish(nickname) && nickname.length > 0
					? { principal, nickname }
					: { principal };
			} catch {
				return { principal };
			}
		})
	);

/**
 * Registers the Vici oracle with an initial list of authorized principals.
 *
 * Only controllers or Engine `OracleAdmin` role holders on the registry can
 * call this successfully.
 */
export const registerViciOracle = async ({
	authorizedPrincipals
}: {
	authorizedPrincipals: PrincipalText[];
}): Promise<void> => {
	const identity = await safeGetIdentityOnce();

	const params: RegistryDid.AddOracleParams = {
		oracle_id: VICI_ORACLE_V1,
		metadata: {
			name: 'Vici Oracle v1',
			description: [
				{
					plain: 'Default settlement oracle for Vici prediction markets',
					markdown: [],
					html: []
				}
			],
			website: []
		},
		authorized_principals: authorizedPrincipals.map((p) => Principal.fromText(p))
	};

	await addOracle({ identity, params });
};

// Note: direct add/remove of oracle settlers used to live here. It is now driven
// automatically by the `syncRoleToEngine` satellite hook (see
// `src/satellite/services/engine-sync.services.ts`): assigning the `ADMIN` or
// `SOLVER` role to a user both grants them `OracleAdmin` on the Vici engine and
// adds them to `VICI_ORACLE_V1.authorized_principals`. For manual reconciliation,
// see `.agents/workflows/icdc-engine-operations.md`.

/**
 * Set of `UserRole` values that should be mirrored into the Vici oracle's
 * `authorized_principals`. Kept in lockstep with `shouldBeOracleSettler` in
 * `src/satellite/services/engine-sync.services.ts`: if that mapping changes,
 * update both.
 */
const SETTLER_ROLES: ReadonlySet<UserRole> = new Set([UserRole.ADMIN, UserRole.SOLVER]);

/**
 * Summary returned by {@link reconcileOracleSettlersFromRoles}.
 */
export interface OracleSettlerReconcileResult {
	added: PrincipalText[];
	removed: PrincipalText[];
}

/**
 * One-shot reconciliation of `VICI_ORACLE_V1.authorized_principals` against the current
 * `roles` collection. Closes the gap left by the event-driven `syncRoleToEngine` hook
 * for role docs that pre-date the oracle's registration (or pre-date the hook itself):
 * those grants log `oracle_settler_skipped_missing_oracle` and never get retried.
 *
 * Bidirectional: adds principals whose role grants settlement (ADMIN/SOLVER) but who
 * are missing from the oracle, and removes principals authorized on the oracle but no
 * longer holding a settler role. The underlying canister uses a `BTreeSet`, so
 * duplicate adds and missing removes are silent no-ops.
 *
 * Throws if the oracle is not yet registered: call {@link registerViciOracle} first.
 */
export const reconcileOracleSettlersFromRoles = async (): Promise<OracleSettlerReconcileResult> => {
	const oracle = await getViciOracle();

	if (isNullish(oracle)) {
		throw new Error('Vici oracle is not registered yet — register it before reconciling.');
	}

	const desired = new Set(
		(await listRoles())
			.filter((entry) => SETTLER_ROLES.has(entry.role))
			.map((entry) => entry.principal)
	);
	const current = new Set(oracle.authorized_principals.map((p) => p.toText()));

	const added = [...desired].filter((p) => !current.has(p));
	const removed = [...current].filter((p) => !desired.has(p));

	if (added.length === 0 && removed.length === 0) {
		return { added: [], removed: [] };
	}

	const identity = await safeGetIdentityOnce();
	const params: RegistryDid.ManageOraclePrincipalsParams = {
		oracle_id: VICI_ORACLE_V1,
		add_principals: added.map((p) => Principal.fromText(p)),
		remove_principals: removed.map((p) => Principal.fromText(p))
	};

	await manageOraclePrincipals({ identity, params });

	return { added, removed };
};
