# Workflow: change the database schema

Paths are under `backend/`. `src/db/**` is a [protected path](../../governance.md#boundaries): call the change out in the PR body.

1. **Add a file, never edit one.** Migrations are `src/db/migrations/NNNN_snake_name.sql` with the next four-digit number. A merged migration is history: a fix to it is a new migration (see `0014_fix_ck_ledger_refs.sql`).
2. **Explain the why at the top** in a SQL comment block, as `0016_withdrawal_network_fee.sql` does: what the column or table holds, and what existing rows get.
3. **Make it safe to re-run and safe on live data.** `add column if not exists`, `drop constraint if exists` before re-adding it, defaults that keep old rows valid, `check` constraints for invariants. The runner (`src/db/migrate.ts`) applies each file in one transaction, in lexical order, and records it in `_migrations`; Fly runs it as the release command before the new code serves traffic, so the previous release must keep working against the new schema.
   - **Renaming a column takes two releases.** The first adds the new column with the same checks, copies the old one into it, and keeps both in step: the new code reads the new column and writes both, and a trigger fills the new column when an old machine writes only the old one (`0021_battle_amount.sql`). The next release drops the trigger and the old column and stops writing it.
4. **Idempotency belongs in the schema.** A job or a credit that must happen once gets a unique key, and the code writes with `on conflict`.
5. **Update the code that reads the table** in its domain, and any seed that mirrors app constants (ledger ids are pinned by `tests/shared-drift/custody-assets.test.ts`).
6. **Test against a migrated database:** `bun run migrate` then `bun test`; suites call `ensureMigrated()`. Check the migration on a database that already holds rows from earlier runs, not only on a fresh one.
