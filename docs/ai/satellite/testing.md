# Satellite testing

## What exists today

- **No satellite unit tests.** `npm test` runs the pure-logic specs under `src/tests/` (Node's runner, `tsx --test`), and none of them covers `src/satellite/`. There are no `@junobuild/functions` mocks in the repo.
- **The satellite is covered end to end** by the Juno Playwright suite against the emulator (`npm run e2e`, see [`frontend/testing.md`](../frontend/testing.md#e2e-playwright)), and the engine wiring by `npm run test:engine-sync` (`scripts/test/test-engine-sync.sh`).
- **The build is a check too.** `npm run juno:functions:build` must succeed and leave no drift; CI's `satellite-schema` job fails on any.

## Adding a test

- Pure satellite logic (validation, diffing, wire conversion) that imports nothing from `@junobuild/functions` can be specced today: put it under `src/tests/satellite/<path>.spec.ts`, mirroring `src/satellite/`, with `node:test` and `node:assert/strict`, as the specs under `src/tests/lib/` do.
- Logic tangled with `getDocStore` / `setDocStore` is not unit-testable yet. Extract the pure part into a function first (that is the seam), spec it, and leave the I/O shell to the E2E suite. Do not add a mocking library without approval.
- A hook or endpoint change is verified on the emulator: deploy with `npm run juno:functions:upgrade:dev` and describe the manual steps in the PR's `# Tests`.
