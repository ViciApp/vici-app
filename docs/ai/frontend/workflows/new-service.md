# Workflow: Add a new service / API call / store

Use when you need to expose a canister or Juno operation to the UI,
orchestrate a multi-step flow, or create cross-view shared state.

## Decide which layer

```
Component (.svelte)
  ↳ #lib/services/*.services.ts          orchestration, identity, error handling, store mutations
       ↳ #lib/api/*.api.ts               wrappers around generated #declarations/<canister>
       ↳ #lib/canisters/*.canister.ts    typed canister actor factories
       ↳ @junobuild/core                 datastore + auth (used directly inside services)
```

| You need…                                           | Layer                                                                                                                                                                                                                                                     |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| To call a new method on `clearing` / `registry`     | First add it in `../icdc-core/`, regenerate bindings via `npm run did`, then add a wrapper in `#lib/api/<canister>.api.ts`.                                                                                                                               |
| To call a new method on the satellite canister      | First add it in `src/satellite/` (see [`../../satellite/workflows/new-endpoint.md`](../../satellite/workflows/new-endpoint.md)). Once `npm run juno:functions:build` regenerates `api-schemas.ts`, call it via `@junobuild/core` `call()` from a service. |
| To read / write a Juno datastore document           | Use `setDoc` / `getDoc` / `listDocs` / `countDocs` / `deleteDoc` from `@junobuild/core` inside a service. Don't call them from a component.                                                                                                               |
| To call an HTTP service                             | Wrap behind a service. There is no `#lib/rest/` layer today; introduce one only if you have ≥ 2 callers, with explicit approval.                                                                                                                          |
| To orchestrate calls + notifications + side effects | `#lib/services/<thing>.services.ts`.                                                                                                                                                                                                                      |
| To share reactive state across views                | A Svelte store in `#lib/stores/`.                                                                                                                                                                                                                         |
| To compute derived state from stores                | A `derived(...)` Svelte store in `#lib/derived/`.                                                                                                                                                                                                         |

## Steps

1. **Backend ↔ FE contract.** If a canister method doesn't exist yet:
   - **icdc-core method:** the icdc-core PR lands first (or is tagged
     simultaneously). Then in this repo:

     ```bash
     npm run did    # regenerates src/declarations/** + format + lint
     ```

     Both `src/declarations/**` and the upstream `.did` file are
     generated; never hand-edit. Commit the regenerated declarations
     with the FE wiring in the same PR.

   - **Satellite method:** add it under `src/satellite/services/` and
     wire it into `src/satellite/index.ts` via `defineQuery` /
     `defineUpdate`. Run `npm run juno:functions:build`. See
     [`../../satellite/workflows/new-endpoint.md`](../../satellite/workflows/new-endpoint.md).

2. **`#lib/api/<canister>.api.ts` wrapper (canister methods).**
   - Existing files: `clearing.api.ts`, `registry.api.ts`,
     `icp-index.api.ts`, `icrc-index-ng.api.ts`, `icrc-ledger.api.ts`.
   - Export named async functions returning typed values. Convert
     Candid `opt` / `Result` shapes to idiomatic TS at the boundary.
   - Throw / reject only for unexpected runtime errors. Expected error
     paths should return a typed result.
   - Take `identity` as an explicit argument; the service layer owns
     identity resolution (see step 4).

3. **`#lib/canisters/<canister>.canister.ts` actor factory** (only if
   adding a brand-new canister wrapper).
   - Existing files: `clearing.canister.ts`, `registry.canister.ts`.
   - Use `@icp-sdk/canisters` and the generated `_SERVICE` type from
     `#declarations/<canister>/<canister>.d.ts`.

4. **`*.services.ts` orchestration.**
   - File: `#lib/services/<thing>.services.ts`.
   - Resolve identity at the top:
     - `getIdentityOrAnonymous` for read paths that are also valid
       anonymously.
     - `safeGetIdentityOnce` for actions that require an authenticated
       user (it triggers sign-in once if needed).
   - Surface errors via `#lib/stores/notification.store.ts` (toast pattern)
     rather than throwing for expected user errors.
   - Mutate the matching `#lib/stores/*.store.ts` to update the UI.
   - Validate cross-boundary data with the matching schema from
     `#lib/schema/`.

5. **Stores / derived (only if needed).**
   - Add a Svelte store under `#lib/stores/` when the value must be
     observable across views. Use the `certified.store` pattern when the
     data is certified IC state and you want the standard query → update
     upgrade.
   - Add a `derived(...)` store in `#lib/derived/` for cross-store
     computations.
   - Don't cache server data twice; let the store own that.

6. **Schemas (when crossing the satellite boundary).**
   - Reusable schemas live in `#lib/schema/` and are re-imported by
     `src/satellite/api-schemas.ts` so the satellite and FE share one
     definition. Update both sides in the same PR.

7. **Catalog update.** If the new service / store is reusable across
   features, add a row in
   [`reusability.md`](../reusability.md). This is the
   [meta-update rule](../../governance.md#meta-update-rule).

8. **Quality gates.**

   ```bash
   npm run format
   npm run lint
   npm run check
   ```

9. **PR.** `feat: expose <thing>` (or `feat(<scope>): …` /
   `refactor(<scope>): …` / `fix(<scope>): …` as appropriate).

## Don'ts

- Call `setDoc` / `getDoc` / `listDocs` / `fetch` directly from a
  component.
- Call `#lib/api/*` or `#lib/canisters/*` directly from a component (skip
  the service layer).
- Use the `0n` literal (eslint enforces `ZERO`).
- `return undefined;` (eslint: bare `return;`).
- Hand-edit `src/declarations/**` or any upstream `.did` file.
- Cache server data in a store _and_ in the service; pick one.
- Add a new top-level folder under `src/lib/` to host the new service.
- Hold `identity` in a long-lived variable across awaits; re-resolve at
  the start of each call so the user can sign out / refresh between.
