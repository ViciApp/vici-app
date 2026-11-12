# Workflow: Add a satellite hook (`onSetDoc` / `onDeleteDoc` / `assertSetDoc`)

Use when you need to react to (or veto) a write into a Juno datastore
collection.

## Decide which kind

| You need…                                                       | Use                               |
| --------------------------------------------------------------- | --------------------------------- |
| Reject some writes before they land (validation, auth)          | `assertSetDoc` via `defineAssert` |
| Run side effects after a doc is written (mirror, audit, notify) | `onSetDoc` via `defineHook`       |
| Run side effects after a doc is deleted                         | `onDeleteDoc` via `defineHook`    |

## Steps

1. **Confirm the collection exists.** Check
   [`juno.config.ts`](../../../../juno.config.ts) and
   [`src/lib/constants/collections.constants.ts`](../../../../src/lib/constants/collections.constants.ts).
   If the collection is new, add it in **both** files in the same PR.

2. **Add the handler.** In
   `src/satellite/services/<area>.services.ts`, export a function whose
   signature matches the hook context:

   ```ts
   import type { OnSetDocContext } from '@junobuild/functions';

   export const onMyCollectionSet = async (context: OnSetDocContext): Promise<void> => {
   	// 1. Read what changed.
   	const before = context.data.data.before;
   	const after = context.data.data.after;

   	// 2. Compute the diff (idempotent!).
   	if (deepEqual(before, after)) return;

   	// 3. Side effects (cross-canister calls, logging, …).
   };
   ```

   For `assertSetDoc`, use `AssertSetDocContext` and **throw** to reject
   the write with a meaningful message. The thrown string surfaces to
   the FE.

3. **Wire it in `src/satellite/index.ts`.**
   - Add the collection to the matching `*Collections` `as const` array
     (creates / updates the type union).
   - Add the entry in the dispatch `Record<…>` so TS proves every
     collection has a handler.

   ```ts
   const setDocCollections = [..., Collection.MY_NEW_COLLECTION] as const;

   const fn: Record<OnSetDocCollection, RunFunction<OnSetDocContext>> = {
   	...,
   	[Collection.MY_NEW_COLLECTION]: onMyCollectionSet
   };
   ```

4. **Make it idempotent.** Hooks can fire more than once (replays,
   manual re-saves). Read the [Idempotency in hooks](../patterns.md#idempotency-in-hooks)
   section before declaring done.

5. **Logging.** Use
   [`src/satellite/utils/logger.utils.ts`](../../../../src/satellite/utils/logger.utils.ts)
   with stable string tags (`my_collection_skipped_missing_X`,
   `my_collection_error`). Operators grep for them in the Juno Console.

6. **Don't loop.** If your hook writes back to the same collection,
   guard against re-entry. The simplest pattern is "only mutate if the
   incoming doc lacks the marker we'd set", e.g. a `version` bump or a
   sentinel field. Without that guard, every set retriggers the hook.

7. **Build and test.**

   ```bash
   npm run juno:functions:build       # compiles the satellite functions
   ```

   For local end-to-end:

   ```bash
   juno emulator start                # in another terminal
   npm run deploy                     # if needed
   npm run init:icdc                  # bootstrap engine + oracles + demo data
   ```

   See [`.agents/workflows/deployment.md`](../../../../.agents/workflows/deployment.md).

8. **Quality gates.**

   ```bash
   npm run format
   npm run lint
   npm run check
   ```

9. **Update docs** if you introduced a new pattern (cross-canister call
   shape, new logger tag taxonomy, new collection convention): edit
   [`patterns.md`](../patterns.md) per the
   [meta-update rule](../../governance.md#meta-update-rule).

10. **PR title.** `feat(satellite): add <hook> for <collection>` (or
    `fix(satellite): …` / `refactor(satellite): …`).

## Don'ts

- Throwing inside an `onSetDoc` for an expected condition. Log + return.
- Hand-editing `api-schemas.ts` or `satellite.did` after the build.
- Forgetting to add the collection to **both** `juno.config.ts` and
  `collections.constants.ts`.
- Mutating the same doc that triggered the hook without a termination
  guard (write-loop hazard).
- Importing `@junobuild/core` from satellite code.
