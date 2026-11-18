# Backend / API / canisters (Claude pointer)

`docs/ai/` is the source of truth. This card only surfaces a few
high-violation reminders so they land in Claude's prompt; for anything
substantive, read the canonical docs.

**Read first:**

- Web2 API in `backend/` (structure, patterns, catalog, tests, custody) →
  [`docs/ai/backend/README.md`](../../docs/ai/backend/README.md)
- On-chain engine pointer (default rule, bindings regeneration) →
  [`docs/ai/engine/README.md`](../../docs/ai/engine/README.md)
- Engine architecture + role mapping →
  [`docs/engine-integration.md`](../../docs/engine-integration.md)
- Cross-repo PR flow →
  [`docs/ai/pr-and-ci.md#9-cross-repo-changes-icdc-core`](../../docs/ai/pr-and-ci.md#9-cross-repo-changes-icdc-core)

**Easy-to-miss rules:**

- **The Rust risk engine does not live here.** It's in
  [`../icdc-core/`](../../../icdc-core/); this repo only consumes its
  Candid surface via generated bindings. Don't modify it from this repo.
- **Don't hand-edit `src/declarations/**` or `backend/src/declarations/**`**:
  regenerate via `npm run did` and commit both trees with the wiring change.
- **API tests need a real Postgres** and collision-free fixtures: the
  database is never reset between runs. See
  [`docs/ai/backend/testing.md`](../../docs/ai/backend/testing.md).
- **Custody refunds only on a definite rejection.** Read
  [`docs/ai/backend/custody.md`](../../docs/ai/backend/custody.md) before
  touching withdrawals or a chain adapter.
- **Engine model:** Vici registers as engine `eng_0` on the icdc-core
  registry; read [engine-integration.md](../../docs/engine-integration.md)
  before touching any market / oracle path. Engine work happens in the
  icdc-core repo; the wiring here is a separate PR.
