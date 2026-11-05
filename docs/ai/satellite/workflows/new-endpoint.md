# Workflow: Add a typed satellite endpoint (`defineQuery` / `defineUpdate`)

Use when you need a typed RPC the FE can call, beyond what the Juno
datastore SDK gives you.

## Decide the shape

| You need…                                   | Endpoint kind  |
| ------------------------------------------- | -------------- |
| Read-only access to canister state          | `defineQuery`  |
| Mutates state or makes inter-canister calls | `defineUpdate` |

## Steps

1. **Define / reuse the schemas.**
   - Reuse `#lib/schema/<area>.schema.ts` whenever the same shape is
     consumed by the FE. The whole point of satellite-typed endpoints is
     to share types across the boundary — declaring a duplicate schema in
     the satellite re-introduces drift.
   - For ad-hoc args, use `j.strictObject({ … })` from
     `@junobuild/schema`. For principals, use `PrincipalTextSchema`.
   - **Quirk:** `principal` and `query` are reserved keys in some schema
     positions; use `principalStr` / `queryStr` and re-map inside the
     handler. See `getProfile` / `searchProfiles` in
     [`src/satellite/index.ts`](../../../../src/satellite/index.ts) for
     examples.

2. **Add the handler** under
   `src/satellite/services/<area>.services.ts`:

   ```ts
   export const getMyThingFn = (id: string): MyThing | undefined => {
   	// canister-side read…
   };
   ```

   Keep the handler pure on the inputs it gets. Cross-canister calls and
   logging happen here, not in `index.ts`.

3. **Wire it in `src/satellite/index.ts`** with a thin schema declaration
   - delegation:

   ```ts
   export const getMyThing = defineQuery({
   	args: j.strictObject({
   		id: j.string()
   	}),
   	result: j.strictObject({
   		thing: j.optional(MyThingSchema)
   	}),
   	handler: ({ id }) => ({ thing: getMyThingFn(id) })
   });
   ```

   For `defineUpdate`, the result schema is optional but recommended for
   anything richer than `void`.

4. **Build the satellite.**

   ```bash
   npm run juno:functions:build
   npm run quality   # align with repo prettier + eslint
   ```

   This regenerates:
   - `src/satellite/api-schemas.ts` (typed bindings the build pipeline
     uses).
   - `src/satellite/satellite.did` and
     `src/satellite/satellite_extension.did` (Candid surface).
   - `src/declarations/satellite/{satellite.api.ts,satellite.did.d.ts,satellite.factory.did.js}`
     (FE-side bindings).

   **Commit all regenerated files together with your source change.**
   This rule also fires when you only edit a shared schema file under
   `#lib/schema/*.ts` that the satellite imports (e.g. adding a field to
   `UserProfileSchema`) — the satellite's Candid + the FE IDL must move
   in lockstep with the schema, or `app_get_profile` and friends will
   trap with `Unrecognized key` once the FE writes the new field. CI's
   `satellite-schema` job ([`checks.yml`](../../../../.github/workflows/checks.yml))
   re-runs `juno functions build` and fails on any drift.

5. **Call it from the FE** via `@junobuild/core`'s `call()` (or whatever
   wrapper the project ends up exposing). Wrap the call in a service
   under `#lib/services/` so components don't talk to the satellite
   directly.

6. **Don't break the interface.** If you change an existing endpoint's
   schema, treat it as a breaking change to the satellite Candid:
   - Title prefix: `feat(satellite)!: …` / `refactor(satellite)!: …`.
   - Body: `BREAKING CHANGE:` block listing what callers need to do.
   - Update every FE caller in the same PR (or in a follow-up PR
     pinned in the original's `# Motivation`).

7. **Quality gates.**

   ```bash
   npm run format
   npm run lint
   npm run check
   ```

8. **Update docs.** If the endpoint introduces a new pattern (a new
   schema convention, a new authentication shape, a new helper), update
   [`patterns.md`](../patterns.md) per the
   [meta-update rule](../../governance.md#meta-update-rule).

9. **PR title.** `feat(satellite): add <endpoint>` (`fix(satellite): …`
   / `refactor(satellite): …` as appropriate).

## Don'ts

- Hand-edit `api-schemas.ts`, `satellite.did`, or
  `satellite_extension.did` — always regenerate.
- Put logic in the `handler:` callback. It should call into
  `services/<area>.services.ts` and nothing else.
- Re-declare a schema that already exists in `#lib/schema/`. Import it
  instead.
- Use `console.log` for satellite output. Use the helpers in
  `src/satellite/utils/logger.utils.ts`.
- Skip the FE wrapper. Components call services; services call the
  satellite — never the other way around.
