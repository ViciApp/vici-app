# Workflow: add an API endpoint

Paths are under `backend/` unless they start with `src/lib/web2/`. Patterns referenced here are in [`../patterns.md`](../patterns.md).

1. **Find the owner.** The endpoint goes in the route file of its area (`src/routes/<area>.ts`); its logic in the matching `src/<domain>/`. A new area means a new route file and a `.use(...)` line in `src/index.ts` next to the others.
2. **Write the domain function first.** Raw parameterized SQL through `query` / `tx`; take `q: TxQuery = query` if a caller may run it in a transaction. Failures are a domain `class XError extends Error {}`, not a status code. Check [`../reusability.md`](../reusability.md) before writing any helper.
3. **Add the handler.** Gate with `requireUser` (and `requireAdmin` for admin), validate the body or query with Elysia `t`, call the domain function, map each domain error to a stable snake_case code with `instanceof`, rethrow the rest. Rate-limit with `enforceLimit` if it is unauthenticated and sends email, issues a session or can be enumerated. Serialize candid values with `toJson`.
4. **Test it** in `tests/<topic>.test.ts` through `app.handle(new Request(...))`: the 401 / 403 paths, the validation failure, each mapped error code and the success shape. Collision-free fixtures ([`../testing.md`](../testing.md)).
5. **Wire the frontend** in the same PR only when small; otherwise a second PR. The typed wrapper goes in `src/lib/web2/client.ts`, the branch in the owning service ([`frontend/web2-backend-mode.md`](../../frontend/web2-backend-mode.md)). If the route serves a new error code the app shows, add its i18n key in every locale.
6. **Gates:** `bun run typecheck && bun test` in `backend/`, root `npm run lint`. If the route sits on a [protected path](../../governance.md#boundaries) (auth, account, admin, claim, engine, vxp, wallet), say so in the PR body.
