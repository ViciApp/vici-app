# Satellite testing

## What exists today

- **Few satellite unit tests.** `npm test` runs the pure-logic specs under `src/tests/` (Node's runner, `tsx --test`); `src/tests/satellite/` holds the few that cover `src/satellite/`: specs of pure helpers in `src/satellite/utils/` that import nothing from `@junobuild/functions` at runtime, and of asserts whose host reads are stubbed as shown below. There are no `@junobuild/functions` mocks in the repo.
- **The satellite is covered end to end** by the Juno Playwright suite against the emulator (`npm run e2e`, see [`frontend/testing.md`](../frontend/testing.md#e2e-playwright)), and the engine wiring by `npm run test:engine-sync` (`scripts/test/test-engine-sync.sh`).
- **The build is a check too.** `npm run juno:functions:build` must succeed and leave no drift; CI's `satellite-schema` job fails on any.

## Adding a test

- Pure satellite logic (validation, diffing, wire conversion) that imports nothing from `@junobuild/functions` can be specced today: put it under `src/tests/satellite/<path>.spec.ts`, mirroring `src/satellite/`, with `node:test` and `node:assert/strict`, as the specs under `src/tests/lib/` do.
- An assert whose host reads are `getAdminAccessKeys()` (a controller check) and `decodeDocData` can be specced by defining the globals the SDK calls, `__juno_satellite_get_admin_access_keys` and `__juno_satellite_datastore_raw_data_to_text` (a `TextDecoder` decode), and removing them after each test: see `src/tests/satellite/services/vxp-awards.services.spec.ts` (the controller check alone) and `src/tests/satellite/services/tournament.services.spec.ts`. Build doc bytes with `TextEncoder`, since `encodeDocData` is a host call too.
- `src/tests/mocks/satellite-host.mock.ts` holds those globals for reuse, plus `time()` and an in-memory `getDocStore`, and builds `AssertSetDocContext` / `AssertDeleteDocContext` values: `installSatelliteHost(docs)` in `beforeEach`, its `restore()` in `afterEach`. `src/tests/satellite/index.spec.ts` runs contexts through the `assertSetDoc` / `assertDeleteDoc` dispatch itself and checks that every `write: 'public'` collection in `juno.config.ts` has both asserts.
- Logic tangled with `getDocStore` / `setDocStore` is not unit-testable yet. Extract the pure part into a function first (that is the seam), spec it, and leave the I/O shell to the E2E suite. Do not add a mocking library without approval.
- A hook or endpoint change is verified on the emulator: deploy with `npm run juno:functions:upgrade:dev` and describe the manual steps in the PR's `# Tests`.
