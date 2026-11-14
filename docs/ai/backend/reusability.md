# Web2 API reusability catalog

Search here before writing a helper in `backend/`. Adding a shared one? Add its row in the same PR ([meta-update rule](../governance.md#meta-update-rule)). Paths are under `backend/src/`.

## `lib/` (cross-domain infrastructure, complete)

| File            | Exports                                                                                                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bytes.ts`      | `concatBytes` (joins byte arrays into a fresh `Uint8Array`)                                                                                                                                                                                             |
| `constants.ts`  | `ZERO` (bigint zero; the `0n` literal is lint-restricted); `UUID_RE` (canonical uuid text, any case)                                                                                                                                                    |
| `cookie.ts`     | session, OAuth-state and Apple-state cookie names; `buildCookie`, `sessionCookie` / `clearSessionCookie`, the OAuth and Apple state cookie set / clear helpers, `readCookie`                                                                            |
| `crypto.ts`     | `randomToken`, `peppered` (HMAC with the session pepper), `constantTimeEqual`, `generateOtp`, `signState` / `verifySignedState`                                                                                                                         |
| `email.ts`      | `sendEmail`, `sendOtpEmail`; `setEmailTransport` (test seam)                                                                                                                                                                                            |
| `http.ts`       | `clientIp(request)`; `StatusContext`, `badRequest(set, code)` (400) and `serviceUnavailable(set, code)` (503), each with an `{ error }` code                                                                                                            |
| `ic-agent.ts`   | `buildAgent(identity?)`                                                                                                                                                                                                                                 |
| `keys.ts`       | HKDF key derivation: `Chain` / `CHAINS`, `deriveUserKey`, `deriveServiceKey`, `publicKeyForChain`, `userIcIdentity` / `userIcPrincipalText`, `treasuryIcIdentity` / `treasuryIcPrincipalText`, `adminIcIdentity`, `engineReaderIcIdentity`              |
| `logger.ts`     | `logger.{debug,info,warn,error}`, gated by `LOG_LEVEL`                                                                                                                                                                                                  |
| `rate-limit.ts` | `rateLimit`, `enforceLimit`, `resetRateLimits` (test seam)                                                                                                                                                                                              |
| `time.ts`       | `msToNs`, `nowNs` (nanosecond timestamps for protocol fields and dedup stamps); `optionalMs` (nullable ms column read as `::text`); `MONTH_ANCHOR_RE` (UTC `YYYY-MM` month anchor); `HOUR_IN_MS`, `DAY_IN_MS` (every duration written in hours or days) |

## Shared modules outside `lib/`

| File                                       | Exports                                                                                                                                        |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `env.ts`                                   | `env` (validated config), `loadEnv`                                                                                                            |
| `db/client.ts`                             | `pool`, `query`, `tx`, `TxQuery`, `isDbUnavailable`                                                                                            |
| `auth/guard.ts`                            | `requireUser`, `requireAdmin`, `unauthenticated`, `forbidden`, `AuthedUser`                                                                    |
| `engine/actors.ts`                         | reader / user / admin actor factories for Clearing, Registry and ledgers; `setEngineActorProvider` (test seam)                                 |
| `engine/clearing.ts`, `engine/registry.ts` | typed canister wrappers; `registry.ts` also owns `VICI_ENGINE_ID` (the engine id the app is registered under)                                  |
| `engine/cache.ts`                          | `cached({ key, ttlMs, load })`, `PUBLIC_READ_TTL_MS` (the one TTL of public engine reads), `retain` / `getRetained`, `clearCache` (test seam)  |
| `engine/result.ts`                         | `expectOk(result, label)`: unwraps a candid `Result`, throwing with the method label on `Err`                                                  |
| `engine/serialize.ts`                      | `toJson` (bigint → string, `Principal` → text, bytes → hex, recursive)                                                                         |
| `engine/order-rejections.ts`               | `ORDER_REJECTIONS` (code table), `orderRejectedError`                                                                                          |
| `chains/types.ts`                          | `ChainAdapter`, `DepositEvent`, `TransferParams`, `TransferStatus`; `TransferRejectedError`, `TransferUnverifiableError`, `ChainDisabledError` |
| `chains/registry.ts`                       | `getAdapter`, `listAdapters`, `enabledAdapters`, `isChain`                                                                                     |
| `chains/ic/icrc.ts`                        | `encodeTransferMemo`, `icrcTransferErrorVariant`, `transferErrorText`, `DEDUP_SAFE_WINDOW_MS`, shared by withdrawals and VXP payouts           |
| `custody/assets.ts`                        | `Asset`, `listEnabledAssets`, `getAssetById`, `getAssetBySymbol`, `isVxp`, `isWithdrawable`                                                    |
| `custody/ledger.ts`                        | `postLedgerEvent(event, q?)` (double-entry, idempotent per event key), `accountBalance`                                                        |
| `vxp/triggers.ts`                          | `runProfileAwardTriggers`, `runTradeActivityTriggers` (post-write award hooks for routes)                                                      |
| `vxp/payout.ts`                            | `transferVxpToUser`, `transferVxpWithBadFeeRetry`, `getVxpBalance`, `getTreasuryVxpBalance`; `setVxpLedgerProvider` (test seam)                |

## Shared with the app

The API holds deliberate mirrors of app constants, pinned by `tests/shared-drift/`: see [`backend/README.md` "Mirrored constants"](../../../backend/README.md#mirrored-constants). Never import app code with value imports into `backend/` (the backend CI job does not install the root `node_modules`).
