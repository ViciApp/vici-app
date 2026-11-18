---
description: day-2 operations on the Vici engine (grant/revoke/audit/kill-switch)
---

Routine operational tasks on the Vici engine on `icdc-core`. See
[../../docs/engine-integration.md](../../docs/engine-integration.md) for the architecture
and role-mapping reference.

All commands assume the running `dfx` identity is either:

- A **controller** of the registry canister, or
- An **admin** of the Vici engine (e.g. one of the `SATELLITE_CONTROLLERS`).

The examples use `--network staging` (icdc-core staging). Replace it with `--network ic` for
**production**, the deployment the live Vici frontend talks to. See
[engine-integration.md](../../docs/engine-integration.md), "icdc-core deployments: staging
and production".

> [!CAUTION]
> `--network ic` commands mutate **production** engine authorization state (role grants,
> oracle settlers, admins, the kill-switch). Double-check the network before running them.

## Reconcile a role grant manually

The `syncRoleToEngine` hook should handle this automatically whenever the `roles`
collection doc is written. Manual reconciliation is only needed if:

- The satellite hook is broken (check Juno Console logs for `engine_sync_error`).
- You need to grant a role to a principal that has no Juno profile yet.

```bash
dfx canister call --network staging registry grant_engine_role "(record {
  engine_id = \"eng_0\";
  grantee = principal \"<user-principal>\";
  role = variant { Creator }
})"
```

Valid roles today: `Creator`, `OracleAdmin`.

## Revoke a single grant

```bash
dfx canister call --network staging registry revoke_engine_role "(record {
  engine_id = \"eng_0\";
  grantee = principal \"<user-principal>\";
  role = variant { Creator }
})"
```

Errors are idempotent: `RoleNotGranted` means the grant didn't exist (safe to ignore).

## Replay sync for a stuck user

If a specific user's role was changed in Juno but the engine wasn't updated (e.g. the
satellite was down at the time), re-save their `roles` doc via the admin UI. The hook is
idempotent, so replaying is safe.

Alternatively, trigger the diff manually from `dfx` with the two calls above.

## Reconcile oracle settlers manually

The `syncRoleToEngine` hook also mirrors `ADMIN` / `SOLVER` roles into
`VICI_ORACLE_V1.authorized_principals`, so this is only needed if:

- The oracle didn't exist when a role was granted (look for `oracle_settler_skipped_missing_oracle`
  in the Juno logs): bootstrap the oracle first via the admin UI, then re-save the user's
  `roles` doc to replay.
- You want to grant settlement rights to a one-off principal (e.g. a tester) without
  assigning a Juno role.

```bash
dfx canister call --network staging registry manage_oracle_principals "(record {
  oracle_id = \"VICI_ORACLE_V1\";
  add_principals = vec { principal \"<user-principal>\" };
  remove_principals = vec {}
})"
```

Remove a settler:

```bash
dfx canister call --network staging registry manage_oracle_principals "(record {
  oracle_id = \"VICI_ORACLE_V1\";
  add_principals = vec {};
  remove_principals = vec { principal \"<user-principal>\" }
})"
```

The underlying list is a `BTreeSet`, so duplicate adds and missing removes are silent no-ops.
Only controllers, the oracle manager, and Engine `OracleAdmin` holders can call this.

## Audit role grants

`list_engines` returns the full audit trail per engine, including `role_grants` with
`(principal, role, granted_at_ns, granted_by)`:

```bash
dfx canister call --network staging registry list_engines --query
```

For a single user, grep the output:

```bash
dfx canister call --network staging registry list_engines --query \
  | grep -A 3 "<user-principal>"
```

## Rotate engine admins

Engine admins are the principals that can grant/revoke roles on the engine. The list lives
on the engine itself and must include the Juno satellite principal (otherwise the hook
breaks) plus at least one human admin for emergencies.

Add admins:

```bash
dfx canister call --network staging registry add_engine_admins "(record {
  engine_id = \"eng_0\";
  principals = vec { principal \"<new-admin-principal>\" }
})"
```

Remove admins:

```bash
dfx canister call --network staging registry remove_engine_admins "(record {
  engine_id = \"eng_0\";
  principals = vec { principal \"<to-remove>\" }
})"
```

> [!NOTE]
> The engine creator (the principal that originally called `register_engine`) cannot be
> removed (`EngineError::CannotRemoveCreator`).

## Kill-switch: disable all role grants without losing the audit log

Shrink the engine's `allowed_roles` to an empty vec. Every existing grant becomes inert
immediately (guards require both an active grant **and** that the role remains in
`allowed_roles`), but `role_grants` is preserved for the audit trail.

```bash
dfx canister call --network staging registry update_engine_allowed_roles "(record {
  engine_id = \"eng_0\";
  allowed_roles = vec {}
})"
```

Re-enable by restoring the original set:

```bash
dfx canister call --network staging registry update_engine_allowed_roles "(record {
  engine_id = \"eng_0\";
  allowed_roles = vec { variant { Creator }; variant { OracleAdmin } }
})"
```
