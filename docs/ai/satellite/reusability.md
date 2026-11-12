# Satellite reusability catalog

Search here before writing a helper in `src/satellite/`. Adding a shared one? Add its row in the same PR ([meta-update rule](../governance.md#meta-update-rule)). The satellite also reuses `#lib` constants, schemas, types and pure utils (see [`structure.md`](./structure.md#imports)); for those, search the [frontend catalog](../frontend/reusability.md).

## `src/satellite/utils/`

| File                   | Exports                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `candid.utils.ts`      | `candidMethod({ canister, method })`: the `argTypes` and `result` IDL types of a registry or clearing method, read off the generated factories. The only place outside `src/declarations` that may `import { IDL }`.                                                                                                                                                                                                                                         |
| `logger.utils.ts`      | `logInfo`, `logError`: structured logging with stable string tags                                                                                                                                                                                                                                                                                                                                                                                            |
| `regex.utils.ts`       | `escapeRegex(value)`, for building Juno `matcher` keys from user input                                                                                                                                                                                                                                                                                                                                                                                       |
| `vxp-payout.utils.ts`  | `transferErrorText(TransferError)`: the log text for a failed VXP ledger transfer                                                                                                                                                                                                                                                                                                                                                                            |
| `wire-format.utils.ts` | snake_case wire schemas (`j`) with a `Wire*` type and a `toWire*` converter for Profile, Relation, MarketTranslation, Referral, League, LeagueWithRole, LeagueMember, FriendRecommendedLeague, Battle, Affiliation, AffiliationStats, AffiliationMemberCount, AffiliationChampionship, Tournament, TournamentMatch, MonthlyLeaderboardEntry, BoldCallerEntry; `fromWireProfile`, `fromWireReferral`, `fromWireMarketTranslation` (also used by the frontend) |

## Shared services

| File                               | Exports                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `services/authz.services.ts`       | `isAdmin({ caller })`, `getSeriesCreator(seriesId)`, `isCreatorOrAdmin(...)`: every caller-role check |
| `services/engine-sync.services.ts` | the only mirror of Juno role docs into the icdc-core Vici engine                                      |
| `services/vxp-payout.services.ts`  | `transferWithBadFeeRetry(...)`: the one VXP ledger transfer every award path uses                     |

## Known duplicates (do not add a third)

- **FNV-1a 64** is written three times: `fnv1a64` in `services/referral.services.ts`, `fnv1a64Hex` in `src/lib/types/school-submission.ts` (UTF-8 bytes) and `fnv1a64Hex` in `src/lib/utils/hash.utils.ts` (UTF-16 code units, so a different result for non-ASCII input under the same name).
- **`isRegisteredLocale`** exists in `services/market-translation.services.ts` and `src/lib/stores/locale.store.ts`.
