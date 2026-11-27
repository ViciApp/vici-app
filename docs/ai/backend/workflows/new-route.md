# Workflow: add an API endpoint

Paths are under `backend/` unless they start with `src/lib/api-client/`. Patterns referenced here are in [`../patterns.md`](../patterns.md).

1. **Find the owner.** The endpoint goes in the route file of its area (`src/routes/<area>.ts`); its logic in the matching `src/<domain>/`. A new area means a new route file and a `.use(...)` line in `src/index.ts` next to the others.
2. **Write the domain function first.** Raw parameterized SQL through `query` / `tx`; take `q: TxQuery = query` if a caller may run it in a transaction. Failures are a domain `class XError extends Error {}`, not a status code. Check [`../reusability.md`](../reusability.md) before writing any helper.
3. **Add the handler.** Gate with `requireUser` (and, for admin, `requireAdmin(user)` on the user it returned), validate the body or query with Elysia `t`, call the domain function, map each domain error to a stable snake_case code with `instanceof`, rethrow the rest. Rate-limit it as [Rate limiting](../patterns.md#rate-limiting) says. Serialize candid values with `toJson`.
4. **Test it** in `tests/<topic>.test.ts` through `app.handle(new Request(...))`: the 401 / 403 paths, the validation failure, each mapped error code and the success shape. Collision-free fixtures ([`../testing.md`](../testing.md)).
5. **Wire the frontend** in the same PR only when small; otherwise a second PR. The typed wrapper goes in `src/lib/api-client/client.ts`, the call in the owning service ([`frontend/api-client.md`](../../frontend/api-client.md)). If the route serves a new error code the app shows, add its i18n key in every locale.
6. **Gates:** `bun run typecheck && bun test` in `backend/`, root `npm run lint`. If the route file is in the [boundaries table](../../governance.md#boundaries), say so in the PR body.
