# Workflow: Sync a Juno write into the icdc-core Vici engine

Use when you need to mirror a Juno datastore change (or a satellite
update) into the on-chain icdc-core Vici engine on `eng_0`.

The canonical example is **role syncing**: Juno is the source of truth
for a user's `UserRole`, and the satellite hook
[`syncRoleToEngine`](../../../../src/satellite/services/engine-sync.services.ts)
mirrors that into `grant_engine_role` / `revoke_engine_role` /
`manage_oracle_principals` calls on the Vici engine.

> **Architecture & rationale:**
> [`docs/engine-integration.md`](../../engine-integration.md) — read this
> first if you haven't seen the engine model.

## Decide whether you really need a hook

| Scenario                                               | Where the call belongs                                                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Single user-initiated action (e.g. "create market")    | `#lib/services/<thing>.services.ts` from the FE.                                                                  |
| Reaction to a doc write (e.g. role doc → engine grant) | A satellite `onSetDoc` / `onDeleteDoc` hook here.                                                                 |
| Bulk / scheduled reconciliation                        | Out-of-band script under `scripts/init/`.                                                                         |
| Manual operator override                               | `dfx canister call` — see [`icdc-engine-operations.md`](../../../../.agents/workflows/icdc-engine-operations.md). |

If a user-initiated FE action is enough, **don't add a hook**. Hooks are
for the case where the source of truth is a doc that can be set from
many places (admin UI, scripts, future integrations).

## Steps

1. **Identify the source of truth.** Which collection's docs encode the
   state you want to mirror? Confirm it's actually authoritative — if
   half the writes happen via `dfx`, the hook will be permanently out of
   sync.

2. **Implement the diff.** For every hook input, compute the **delta**
   between the previous and the new doc. Only emit the registry calls
   that correspond to changes. The mapping for roles lives in
   `engine-sync.services.ts` as `ROLE_TO_ENGINE_ROLES` +
   `shouldBeOracleSettler`. Mirror that style — name the mapping
   table, keep it close to the hook.

3. **Stay idempotent.**
   - `RoleAlreadyGranted` and `RoleNotGranted` are no-ops at the
     protocol level — wrap them in a result helper that doesn't surface
     them as errors.
   - The oracle's `authorized_principals` is a `BTreeSet`; duplicate
     adds and missing removes are silent.
   - Document the idempotency assumption in a code comment so the next
     reader doesn't accidentally tighten it into a hard error.

4. **Handle missing prerequisites.** If your hook depends on registry
   state that may not exist yet (oracle not bootstrapped, engine not
   registered), log a stable skip tag and return — don't fail the hook.
   `engine-sync.services.ts` uses
   `engine_sync_skipped_missing_oracle` for this. Operators can replay
   the write later (see
   [`icdc-engine-operations.md`](../../../../.agents/workflows/icdc-engine-operations.md)).

5. **Use the right caller.** Cross-canister calls from the satellite
   run with the satellite's principal. The Vici engine's `admins` set
   already includes that principal (set by
   [`scripts/init/init.icdc-engine.sh`](../../../../scripts/init/init.icdc-engine.sh)).
   If you find yourself wishing for a different caller, surface the
   question — don't smuggle a delegated identity into a hook.

6. **Update `eng_0`-specific assumptions** in one place. The engine ID
   is pinned in
   [`src/lib/constants/icdc.constants.ts`](../../../../src/lib/constants/icdc.constants.ts)
   as `VICI_ENGINE_ID`. Don't hard-code `"eng_0"` anywhere else.

7. **Smoke-test.**

   ```bash
   npm run test:engine-sync           # local
   npm run test:engine-sync -- --staging
   ```

   The script verifies the engine exists, the satellite is in `admins`,
   `allowed_roles` contains both `Creator` and `OracleAdmin`, and (on
   local) `grant_engine_role` / `revoke_engine_role` round-trip works.
   See
   [`.agents/workflows/icdc-engine-reset.md`](../../../../.agents/workflows/icdc-engine-reset.md).

8. **Document the mapping.** Update
   [`docs/engine-integration.md`](../../engine-integration.md#role-mapping)
   if the role / engine-role mapping changes. Mention what callers /
   data has to do to migrate if the change is breaking.

9. **Quality gates.**

   ```bash
   npm run format && npm run lint && npm run check
   npm run juno:functions:build
   ```

10. **PR title.** `feat(satellite): sync <new-thing> into engine` or
    `feat(engine): mirror <X>` (matching the most relevant scope).

## Don'ts

- Hard-code `"eng_0"` outside `icdc.constants.ts`.
- Re-trigger a write loop. Don't `setDoc` back into the same collection
  from inside its hook without a termination guard.
- Throw to the FE for a missing oracle / engine — the FE didn't cause
  it. Log + return.
- Silently swallow errors. Use the logger taxonomy
  (`engine_sync_error` / `engine_sync_skipped_*`) so operators can grep.
- Keep stale mapping data only in code comments. The
  authoritative table is in code; mirror it in
  `docs/engine-integration.md` so non-engineers can read it.
