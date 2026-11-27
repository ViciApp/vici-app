# Workflow: Add a new service / API call / store

Use when you need to expose an API route to the UI, orchestrate a
multi-step flow, or create cross-view shared state.

## Decide which layer

```
Component (.svelte)
  ↳ #lib/services/*.services.ts          orchestration, error handling, store mutations
       ↳ #lib/api-client/client.ts       typed wrappers around the HTTP API routes
       ↳ #lib/api/*.api.ts               the public canister reads left (order book, ledger fee)
       ↳ #lib/canisters/*.canister.ts    typed canister actor factories behind them
```

| You need…                                           | Layer                                                                                                                                                                                   |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| To call an API route                                | Add the route in `backend/` (see [`../../backend/workflows/`](../../backend/workflows/)), then a typed wrapper in `#lib/api-client/client.ts` ([`../api-client.md`](../api-client.md)). |
| A new engine read or write                          | Add it to the API's engine bridge (the API signs account calls with the custodial identity), then wrap the route in `client.ts`. The browser never signs a canister call.               |
| A new public canister read the API cannot serve     | Only with a reason: regenerate bindings via `npm run did`, then add a wrapper in `#lib/api/<canister>.api.ts` called with `anonymousIdentity()`.                                        |
| To orchestrate calls + notifications + side effects | `#lib/services/<thing>.services.ts`.                                                                                                                                                    |
| To share reactive state across views                | A Svelte store in `#lib/stores/`.                                                                                                                                                       |
| To compute derived state from stores                | A `derived(...)` Svelte store in `#lib/derived/`.                                                                                                                                       |

## Steps

1. **Backend ↔ FE contract.** The API route lands first (or in the PR
   before). If it needs a new icdc-core method, the icdc-core PR lands
   first, then `npm run did` regenerates both declaration trees.

2. **`#lib/api-client/client.ts` wrapper.** One typed wrapper per route, typed to
   the wire contract; map wire shapes (the `userId` → `owner` rename,
   serialized candid through `engine-wire.ts`) inside the wrapper. A money or
   identity route parses its body with a schema from
   `#lib/schema/api.schema.ts` through `parsedRequest`.

3. **`*.services.ts` orchestration.**
   - File: `#lib/services/<thing>.services.ts`.
   - Gate signed-in work on the session store (`getSessionUser()`), never on a
     local identity.
   - Surface errors via `#lib/stores/notification.store.ts` (toast pattern)
     rather than throwing for expected user errors.
   - Mutate the matching `#lib/stores/*.store.ts` to update the UI.
   - Deliver a single API read to a `{ certified, response }` loader as the
     final `certified: true` pass.

4. **Stores / derived (only if needed).**
   - Add a Svelte store under `#lib/stores/` when the value must be
     observable across views.
   - Add a `derived(...)` store in `#lib/derived/` for cross-store
     computations.
   - Don't cache server data twice; let the store own that.

5. **Catalog update.** If the new service / store is reusable across
   features, add a row in
   [`reusability.md`](../reusability.md). This is the
   [meta-update rule](../../governance.md#meta-update-rule).

6. **Quality gates.**

   ```bash
   npm run format
   npm run lint
   npm run check
   ```

7. **PR.** `feat: expose <thing>` (or `feat(<scope>): …` /
   `refactor(<scope>): …` / `fix(<scope>): …` as appropriate).

## Don'ts

- Call `client.ts` or `fetch` directly from a component.
- Call `#lib/api/*` or `#lib/canisters/*` directly from a component (skip
  the service layer).
- Use the `0n` literal (eslint enforces `ZERO`).
- `return undefined;` (eslint: bare `return;`).
- Hand-edit `src/declarations/**` or any upstream `.did` file.
- Cache server data in a store _and_ in the service; pick one.
- Add a new top-level folder under `src/lib/` to host the new service.
