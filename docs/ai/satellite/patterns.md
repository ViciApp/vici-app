# Satellite Patterns

Idiomatic TypeScript patterns for the Juno satellite. If a pattern here
disagrees with code in `src/satellite/`, the code wins (truth hierarchy
in [governance.md](../governance.md)). Update this page in the same PR:
that's the [meta-update rule](../governance.md#meta-update-rule).

## The four primitives

The satellite exposes four primitives, all from `@junobuild/functions`:

| Primitive      | Purpose                                                          | Wired in `index.ts` via                                          |
| -------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| `defineQuery`  | Typed read endpoint, callable from the FE.                       | `export const <name> = defineQuery({ … })`                       |
| `defineUpdate` | Typed write endpoint, callable from the FE.                      | `export const <name> = defineUpdate({ … })`                      |
| `defineAssert` | Pre-write veto on a datastore collection. Throws to reject.      | `defineAssert<AssertSetDoc>({ collections, assert })`            |
| `defineHook`   | Post-write trigger on a datastore collection. Side effects only. | `defineHook<OnSetDoc>({ collections, run })` (and `OnDeleteDoc`) |

Pick the right one:

- **Need to read state by RPC?** `defineQuery`.
- **Need to mutate state by RPC?** `defineUpdate`.
- **Need to validate before a doc write lands?** `assertSetDoc` via
  `defineAssert`.
- **Need to react after a doc write / delete?** `onSetDoc` /
  `onDeleteDoc` via `defineHook`.

## Schema-first

Every `defineQuery` and `defineUpdate` declares its argument shape and
result shape via `@junobuild/schema`:

```ts
export const getProfile = defineQuery({
	args: j.strictObject({
		principalStr: PrincipalTextSchema
	}),
	result: j.strictObject({
		profile: j.optional(UserProfileSchema)
	}),
	handler: ({ principalStr }) => ({
		profile: getProfileFn(principalStr)
	})
});
```

Rules:

- **Always `j.strictObject`** at the top level: extra properties are
  rejected.
- **Reuse `#lib/schema/*.schema.ts`** whenever the FE consumes the same
  shape (so the FE-side schema and the satellite-side schema can never
  drift).
- **Quirk to know:** at the time of writing, the schema layer doesn't
  accept the literal property names `principal` / `query` in some
  positions; use `principalStr` / `queryStr` and re-map inside the
  handler. (See `getUserRankAndCount` and `searchProfiles` in
  `src/satellite/index.ts`.)
- **`PrincipalTextSchema`** comes from `@junobuild/schema`. Use it for
  every principal-typed arg; don't hand-write a regex.
- **An endpoint that stores what an anonymous caller sends bounds it**
  in its schema: `.max()` on the array and on every string, from named
  constants in the domain's constants file. Its handler also refuses
  what only the server may write. `trackEvents` takes at most
  `ANALYTICS_MAX_EVENTS_PER_BATCH` events with capped strings
  ([`analytics.constants.ts`](../../../src/lib/constants/analytics.constants.ts)),
  and `trackEventsFn` drops an event in `SERVER_ANALYTICS_EVENT_NAMES`.
- **Keep handlers thin.** The function passed to `handler:` should
  immediately delegate to `services/<area>.services.ts`. The schema
  declaration + the dispatch table are the only logic that belongs in
  `index.ts`.

## Wire format: nested results are camelCase

Typed query and update results reach the wire in **camelCase**, for
`j.array(Nested)` and `j.optional(Nested)` alike. Juno's TS→Rust codegen
(CLI ≥ 0.15.6, the version CI pins) marks both `Vec<NestedStruct>` and
`Option<NestedStruct>` fields `#[json_data(nested)]`, so the `JsonData`
mirror struct uses `rename_all = "camelCase"` for both:

```rust
pub struct AppListFriendResolvedResultsResult {
    #[json_data(nested)]
    pub items: Vec<AppListFriendResolvedResultsResultItems>,
}
```

Older toolchains left `Vec` fields unmarked, which put them in snake_case
and trapped every read with `missing field <snake_case_name>`. Building the
satellite with an older CLI brings that back: always build with the pinned
version (`npm i -g @junobuild/cli@0.15.6`, as `checks.yml` does).

### Wire schemas are converters, not renames

[`src/satellite/utils/wire-format.utils.ts`](../../../src/satellite/utils/wire-format.utils.ts)
holds a `*WireSchema` + `toWire…` (and, where the FE needs it, `fromWire…`)
for results whose domain shape does not fit the wire as is: defaults,
optional fields, enum normalisation (for example `toWireProfile` and
`toWireLeague`). Keys stay camelCase, matching the app-side types. A result
whose domain schema already fits (for example `listFriendResolvedResults`
returning `j.array(ResolvedResultSchema)`) uses that schema directly; no
converter is needed.

The frontend side follows the same rule: a service returns the generated
client's row as is when it already has the domain type. It keeps a
projector only for a real conversion: a default, a narrowing of a loose
wire string union (`projectLeagueWire`, `projectBattleWire`) or an
`undefined` to `null` normalisation (`projectMatchWire`). A projector that
copies every field one to one is dead weight; drop it.

### The fix that doesn't work

`.transform()` on a result schema is **not** a valid way to reshape it. It
produces a `ZodEffects`, and juno's schema → Rust codegen only accepts
`ZodObject`; it throws
`"Unsupported type: unrepresentable schema (z.symbol, z.undefined, …
are not supported)"`, the CLI's silent `catch{}` swallows it, and the
whole `juno functions build` exits with code 1 producing **zero** files in
`target/deploy/`. Avoid `.transform()` / `.refine()` / `.passthrough()`
anywhere in a `defineQuery` / `defineUpdate` result schema for the same
reason: convert in the handler with a `toWire…` function instead.

## Hooks: collection dispatch table

The repo's pattern (see
[`src/satellite/index.ts`](../../../src/satellite/index.ts)) is:

1. Declare a `const setDocCollections = [...] as const;` whitelist of
   collections this hook runs for.
2. Derive a TS union type from that array.
3. Map each collection to its handler in a `Record<Union, …>` table
   inside `defineHook`.

```ts
const setDocCollections = [Collection.ACTIVITIES, Collection.PROFILES, Collection.ROLES] as const;

type OnSetDocCollection = (typeof setDocCollections)[number];

export const onSetDoc = defineHook<OnSetDoc>({
	collections: setDocCollections,
	run: async (context) => {
		const fn: Record<OnSetDocCollection, RunFunction<OnSetDocContext>> = {
			[Collection.PROFILES]: onProfileSetForVxpOnboarding,
			[Collection.ACTIVITIES]: onTradeActivityForVxpOnboarding,
			[Collection.ROLES]: syncRoleToEngineOnSet
		};

		await fn[context.data.collection]?.(context);
	}
});
```

Why this shape:

- A new collection added to the whitelist becomes a TS error at the
  dispatch table until it's mapped; the type system enforces "every
  registered collection has a handler".
- Calling `fn[...]?.(context)` makes the hook a no-op for any collection
  that slipped through (defensive against the satellite hot-reloading the
  whitelist).

`defineAssert<AssertSetDoc>` and the `onDeleteDoc` hook follow the same
pattern; keep them consistent.

When a single collection needs **more than one** assert (or hook), compose
them into one dispatch-table entry rather than widening the table value to
an array. The `profiles` slot maps to `assertProfile`, a small composed
function exported from `profile.services.ts` next to its sub-asserts, that
calls `assertNewProfileAllowed`, `assertValidNickname` and
`assertDailyGoalUnchanged` in turn (a throw from any rejects the write);
`assertProfilePrivate` in `profile-private.services.ts` does the same for
`profile_private`. A composed assert lives in the service that owns the
collection, never in `index.ts`, which only wires the dispatch table. Each
sub-assert stays exported so it remains independently unit-testable.

## Hooks fire ONLY for client writes, never for serverless `setDocStore`

`onSetDoc` / `onDeleteDoc` run **only** when the document is written
through the public client API (`@junobuild/core` `setDoc` from the
browser). A write made from inside the satellite via
`@junobuild/functions/sdk` `setDocStore` / `deleteDocStore`, i.e. from
an endpoint handler or another hook, does **not** trigger the hook.
(In junobuild/juno: `api/db.rs` `set_doc` calls `set_doc_store` _then_
`invoke_on_set_doc`; the SDK `set_doc_store` in `db/store.rs` runs
asserts + insert and stops there. Asserts still run on serverless
writes; only the post-write hook is skipped.)

Consequences:

- A hook only works if its trigger collection is written **by the
  browser** (e.g. `profiles` via FE `setDoc` → the profile hooks fire).
- **An "endpoint writes a row → a hook fans out" design is broken**:
  the hook never fires. Either write the trigger row from the client, or
  do the work **inline in the endpoint** (make the handler `async` and
  call the logic directly). This is exactly what bit the referral VXP
  payout: `redeemReferralCode` (endpoint) created the `referrals` row via
  `setDocStore` expecting `onReferralSetForVxpPayout` to pay both bonuses,
  so every bonus sat permanently `owed`. It is now driven off the
  **client-written `activities` trigger** instead: the referral settles
  (`settleReferralPayout`) when the referred user makes their first
  prediction: a client `setDoc` to `activities`, whose `onSetDoc` hook
  genuinely fires (`onTradeActivityForReferral`), with a `settleReferral`
  endpoint as the manual retry/backfill path. The `onReferralSetForVxpPayout`
  hook on the referrals row only runs for a `set_doc` through the public API,
  which `assertSetReferral` allows to a controller alone (a hand-written row in
  the Console).
- Make the inline work **idempotent + retry-safe** (lock → act →
  finalize, short-circuit on already-done), and expose a settle/retry
  endpoint so a failed transfer can be re-driven; there is no hook replay
  to fall back on.

## Pair every `defineAssert` with a `defineQuery` probe

Write-time guards (`defineAssert`) reject collisions at the door, but
they only fail _after_ the user has invested in typing, signing in, and
hitting save. To close that gap, every assertion that can plausibly
reject for a user-correctable reason (duplicate nickname, taken slug,
quota exceeded, …) should:

1. **Extract the core validator** into a pure function that takes the
   candidate value + optional "exclude self" key and returns a typed
   outcome (`{ available: true } | { available: false; reason: ... }`).
2. **Have the assertion call it** and throw the appropriate user-facing
   message when `available` is `false`. The assertion stays the source
   of truth for what "valid" means.
3. **Expose a `defineQuery` wrapper** that returns the same typed
   outcome, so the FE can render an inline hint (debounced behind every
   keystroke) without parsing thrown strings.

Concrete example: `checkNicknameAvailabilityFn` in
[`src/satellite/services/profile.services.ts`](../../../src/satellite/services/profile.services.ts)
backs both `assertValidNickname` and the
`checkNicknameAvailability` query in
[`src/satellite/index.ts`](../../../src/satellite/index.ts). The FE
service wrapper lives at
[`src/lib/services/profile.services.ts`](../../../src/lib/services/profile.services.ts)
(`checkNicknameAvailability`); the onboarding flow and the profile-edit
form share it.

Two rules:

- The query is a **hint**, not a contract. Never skip the assertion
  even when the probe was `available`; there's always a race window
  between probe and write.
- When the query exposes an `exclude` parameter (typically the
  editor's principal), wire it through to the assertion's "skip my
  own doc" filter so the two layers can never disagree.

## Atomic cancel via version-locked delete

When an endpoint cancels a pending state-machine doc (e.g. retract a
friend request the sender just sent), the cancel must not race with the
counterparty mutating that same doc (e.g. recipient accepting the
request). The Juno datastore exposes exactly one primitive for this:
`deleteDocStore` accepts a `doc.version`, and the canister traps if the
on-chain version moved between read and delete.

```ts
export const cancelFriendRequest = ({ relationId }: { relationId: string }): void => {
	const caller = msgCaller();
	const callerText = caller.toText();

	const doc = getDocStore({
		collection: Collection.RELATIONS,
		key: relationId,
		caller
	});

	if (isNullish(doc)) {
		throw new Error('Relation does not exist');
	}

	const relation = decodeDocData<Relation>(doc.data);

	if (relation.participants[0] !== callerText) {
		throw new Error('Only the sender can cancel a friend request.');
	}

	if (relation.state !== RelationState.PENDING) {
		throw new Error(`Cannot cancel a request in state "${relation.state}".`);
	}

	deleteDocStore({
		collection: Collection.RELATIONS,
		key: relationId,
		doc: { version: doc.version }, // ← version lock = atomicity
		caller
	});
};
```

Rules:

- **Single write, conflict-detecting.** Do not implement cancel as a
  "transition to CANCELLED state via `setDocStore`"; that would be a
  second write that itself races with the recipient's accept. A
  versioned delete is the only single-write move the datastore exposes
  that detects mid-flight conflicts.
- **Validate state in the same handler.** Read → check state &
  ownership → delete in one canister call. The narrow window between
  `getDocStore` and `deleteDocStore` is covered by the version lock.
- **FE refreshes after the catch.** When the trap fires (e.g. the
  counterparty won the race), the FE should still re-fetch the store so
  the UI lands on the real on-chain state (e.g. the request now shows
  under "Active" because accept won). See `handleCancelSent` in
  [`src/lib/components/arena/FriendsTab.svelte`](../../../src/lib/components/arena/FriendsTab.svelte)
  for the pattern.

## Idempotency in hooks

Hooks fire **after** the write, but they can fire more than once
(replays, retries, manual re-saves). Make them idempotent.

- **Diff before acting.** `engine-sync.services.ts` computes the diff
  between the previous and new role and only emits the calls that
  changed. Mirror that style.
- **Treat already-applied results as no-ops.** `RoleAlreadyGranted` /
  `RoleNotGranted` from the registry are silent successes. Wrap them in
  a `Result`-style helper rather than throwing.
- **Log skips, don't fail them.** Use the logger in
  `utils/logger.utils.ts` (`oracle_settler_skipped_missing_oracle`,
  `engine_sync_error`, …) so operators can grep Juno Console for the
  failure mode without breaking the hook.

## Client-write stats docs + per-row assert (no scheduler)

Some aggregate stats are cheaper to compute on the FE (the client already
has the source data in memory) than to fan out from a post-write hook. The
reference shapes are `user_stats` (per-user Dash cache) and
`user_monthly_stats` (per-user, per-month gameplay counters that back the
monthly album awards). The pattern:

- **The FE writes its own row.** `calculateAndSyncStats` (which already
  fetches the user's full clearing history) re-derives the snapshot and
  `setDoc`s it under a key the caller owns: `user_stats[${owner}]` or
  `user_monthly_stats[${owner}/${YYYY-MM}]`. No hook, no fan-out.
- **The assert binds the row to its owner.** `assertSetUserStats` /
  `assertSetUserMonthlyStats` reject any write whose key (and embedded
  `owner`) isn't the caller, plus structural sanity (`wins <= calls`,
  bounded arrays, values in range). It does **not** re-derive the counters
  from real history, and `user_monthly_stats` accepts any month; a
  determined user could inflate their own row. Use this only for
  **display** (album tiles, Dash cache, the live Worlds month window): no
  VXP is ever ranked or paid from these rows. Anything that moves real value
  reads a source the user can't forge: the Worlds podium and tournament
  matches are ranked from settled history read from the clearing canister
  (`settled-history.services.ts`), the same source league battles are scored
  from.
- **Lazy month rollover = a new key, not a reset.** Because each month is a
  distinct doc key, "rolling over" is just writing under the new month's key
  on the first sync of that month; no scheduler, no in-place reset. A
  read-side aggregator (`getMonthlyLeaderboardFn`) scans the collection,
  filters by the `/${monthAnchor}` key suffix, and computes the ranking
  on read (including an exact median from each row's bounded sample array).
  Awards are evaluated for the **completed** (prior) month, since the current
  month is still open.
- **Bound every array the user controls.** `user_monthly_stats` caps its
  `monthConsensus` sample array (`MONTHLY_CONSENSUS_LIMIT`), keeping the most
  recent values; the assert enforces the cap so the doc can't be bloated.

Contrast with the hook-driven fan-out (`onProfileSetForLeagueStats`), which
keeps a **shared** row (a league's `league_stats`) moving on the server, signed
as a controller so no single member writes the aggregate. Its counters still
follow each member's client-reported `totalTrades`, so the row is a display
cache too, and tournament matches read settled history instead. Use the client-write pattern when the row is
**owned by one user** and the signal is cosmetic.

## Soft-delete + lazy hard-delete (no scheduler)

Juno has **no timer primitive**, so any "delete now, purge later"
flow has to model the deferred work as a claim or an admin trigger;
never a scheduled job. The account-deletion flow
([`account.services.ts`](../../../src/satellite/services/account.services.ts))
is the reference shape:

- **Soft-delete = an optional marker field.** `deletedAtMs?: number`
  on the profile schema. PRESENCE means soft-deleted; ABSENCE means
  active. Declare it `j.number().optional()` with **no default**; a
  default would force every legacy/active row to look deleted, and
  absence is the meaningful state. Mirror the field in **both**
  `src/lib/schema/profile.schema.ts` **and**
  `src/satellite/api-schemas.ts` (the encoder trap), and forward it
  verbatim through `withProfileDefaults`.
- **Hide soft-deleted rows from PUBLIC reads, not from the owner.**
  A shared `isSoftDeleted(profile)` helper filters the public query
  endpoints (`listLeaderboard`, `searchProfiles`, `getProfile`).
  `getProfile` knows both the caller and the looked-up principal, so it
  makes the owner an exception: an own-read returns the doc even when
  soft-deleted (matching the FE's raw Juno `getDoc` path, which is also
  never gated) so the FE can still offer recovery.
- **Extract the cascade, parametrise by principal.** The hard-delete
  (`hardDeleteAccountFn({ callerText, callerBytes })`) takes the
  principal explicitly and does **not** call `msgCaller()`, so the
  same code path serves both the lazy purge (on a too-late recovery)
  and the admin sweep (`sweepExpiredDeletions`, gated by `isAdmin`).
  The admin sweep keys each purge off the **doc key**, not the decoded
  `owner` field (profile writes don't enforce `owner === key`), and
  runs `Principal.fromText` + the cascade **outside** the malformed-row
  try/catch so a purge failure is logged + counted as an under-purge
  instead of being silently swallowed as a skipped bad row.
- **Hard-delete must not orphan others: transfer, don't just delete.**
  The cascade's owned-league step deletes a league only when no other
  member remains; if members self-joined during the recovery window it
  **transfers** ownership to a deterministic survivor (first remaining
  `LEAGUE_MEMBERS` row in iteration order): version-locked re-encode of
  `league.owner` + a version-locked bump of that member row's `role` to
  `owner`. The interactive `deleteMyAccount` has an up-front
  `owns_non_empty_league` guard; the guard-less recovery-expiry + sweep
  paths rely on this transfer.
- **Purge the data, keep the one-time awards one-time.** The cascade
  deletes every award doc, so it first records an anonymous marker per
  one-time award the account was paid (`recordAccountAwardMarkers`, see
  [economy invariants](./economy.md#invariants)); a principal that signs
  up again starts over everywhere but there.
- **Keep the marker monotonic + the side effects once-only.**
  Re-deleting keeps the EARLIEST `deletedAtMs` so the recovery clock
  can't be reset. Recovery clears the field; both are version-locked
  overwrites. `softDeleteProfile` returns an `alreadyDeleted` flag so
  one-time side effects (the anonymous `EXIT_SIGNALS` churn row) are
  skipped on a re-delete; re-deleting must be idempotent, not
  cumulative.

### Hibernation: the reversible sibling state

Hibernation ("Pause 30 days", the retention off-ramp offered alongside
delete) is a **fully reversible** state that reuses the same optional-marker
shape but never destroys data:

- **Same marker shape.** `hibernatedAtMs?: number` on the profile schema,
  `optional()` with no default, mirrored in **both**
  `src/lib/schema/profile.schema.ts` and `src/satellite/api-schemas.ts`,
  forwarded verbatim through `withProfileDefaults`. PRESENCE = hibernated.
- **Mutually exclusive with soft-delete.** `hibernateMyAccount` refuses
  (`{ ok: false, reason: 'deleted' }`) on an already-soft-deleted profile;
  the two markers never stack. No profile → `{ ok: false, reason: 'no_profile' }`.
- **Hide the same way, via one combined helper.** Public reads switched
  from `!isSoftDeleted` to `!isPubliclyHidden(profile) = !(isSoftDeleted ||
isHibernated)`. The three public filters (`listLeaderboard`,
  `searchProfiles`, `getProfile`) use `isPubliclyHidden`; the owner's own
  `getDoc` read stays ungated so the FE can offer resume.
- **Stats freeze.** A hibernated user is inactive (no trades → no profile
  writes → no fan-out), so the freeze is mostly natural. The profile-write
  stat fan-out hook (`onProfileSetForLeagueStats`) additionally
  early-returns when the AFTER profile `isHibernated`: a defensive guard
  against a stray write fanning a delta. This can't suppress the `resumeMyAccount` write: clearing the
  flag leaves `totalTrades` unchanged (zero delta) and the AFTER profile is
  no longer hibernated.
- **Reversible, not monotonic.** `hibernateMyAccount` keeps the EARLIEST
  `hibernatedAtMs` (mirrors soft-delete) but there's no expiry/sweep;
  `resumeMyAccount` clears the field (destructure-drop + re-encode,
  mirroring how recovery clears `deletedAtMs`) and the account is active
  again. Both are version-locked overwrites.

### League resolution: applied immediately, reuse the existing endpoint

`deleteMyAccount` accepts `leagueResolutions?: Array<{ leagueId; action:
'transfer' | 'delete'; transferTo? }>` and applies each BEFORE the
owner-leagues guard:

- **Reuse, don't reimplement, the transfer.** `transferLeagueOwnershipFn`
  reads `msgCaller()` internally, and `deleteMyAccountFn` runs as that same
  caller (the owner); so it's called directly with no caller threaded
  through, and its `not_owner` / `new_owner_not_member` / … validation is
  the single source of truth. A `delete` action calls the new
  `deleteLeagueFn({ leagueId, callerText, callerBytes })` (owner disband).
- **The disband deletes as a controller.** `deleteLeagueFn` drops every
  `LEAGUE_MEMBERS` row for the league, including the `owner` row, which
  `assertDeleteLeagueMember` forbids to everyone but a controller
  ("transfer ownership first"). Serverless `deleteDocStore` runs that
  assert too, so once the endpoint has checked the caller owns the league
  it signs the deletes with `controllerCaller(...)`, as the account purge
  (`hardDeleteAccountFn`) does for every row it removes. Distinct from the cascade's
  `disbandOrTransferOwnedLeagues`, which only drops leagues that are
  _already_ empty and hands the others to a remaining member.
- **Applied immediately ⇒ not reversed by recovery.** Resolutions are real
  transfers / disbands at delete time, not deferred to hard-delete. A user
  who recovers within the window gets the account back but NOT the
  relinquished leagues. This is the documented delete-v2 contract, not a
  bug. A failed resolution aborts the whole delete (`reason:
'league_resolution_failed'` + `failedLeagueId` + `resolutionReason`);
  resolutions that already committed stand.

## Renaming a stored doc field

Juno docs are never rewritten in place, so a renamed field lives on under
its old name in every doc written before the change. Give the collection
**one read helper** that takes the new field, falls back to the old one,
and returns the doc without the old key, and route every decode through
it (asserts, endpoints, the FE `getDoc` paths, the web2 mapping). Writes
then carry only the new name, including a doc spread back into a
`setDoc`. The assert compares the normalised docs, so an immutable field
still matches across a legacy current doc and a renamed proposal. The
reference is `readBattleDoc` in
[`battle.ts`](../../../src/lib/types/battle.ts) (`wager` became
`amount`); the Postgres side of the same rename keeps both columns for a
release (see the backend
[migration workflow](../backend/workflows/new-migration.md)).

## Cross-canister calls

When a hook calls another canister (typically the icdc-core registry):

- The actor lives in `#lib/canisters/<canister>.canister.ts`.
- Build it with the satellite's identity. The satellite principal is
  pre-authorised as an `admin` on the Vici engine (see
  [`docs/engine-integration.md`](../../engine-integration.md#engine-admins)).
- **Never reach back into the FE store layer** from a satellite hook:
  the satellite has no access to it.
- **Never** await indefinitely on a remote call inside a hook without a
  guard. If the registry is down, log + return; the next write will
  retrigger.

### Candid encode/decode: derive from the generated factory, never hand-roll

A satellite `call({ args, result })` needs the `IDL.Type`s for the
method's arguments and return value. **Never hand-write them** (no
`IDL.Record({ … })` / `IDL.Variant({ … })` inline in a service file): a
copy of an icdc-core struct silently drifts from the real interface the
moment the upstream `.did` changes, and a Candid decode trap is the only
warning you get.

Instead read them straight off the generated `idlFactory` via
[`candidMethod`](../../../src/satellite/utils/candid.utils.ts):

```ts
const { argTypes, result } = candidMethod({ canister: 'registry', method: 'get_series' });
const series = await call<[] | [RegistryDid.Series]>({
	canisterId: REGISTRY_CANISTER_ID,
	method: 'get_series',
	args: [[argTypes[0], seriesId]],
	result
});
```

- The `IDL` namespace must live in exactly one place outside
  `src/declarations/**`: `candid.utils.ts`. Every other satellite file stays
  typed against `#declarations` (`RegistryDid` / `ClearingDid`) and routes its
  runtime Candid types through `candidMethod`: a new `import { IDL }` in a
  service is the smell this pattern exists to prevent.
- Need a method the canister exposes but `candidMethod` can't find? It
  throws: regenerate bindings (`npm run did`) rather than reaching for an
  inline definition.
- For **IC system canisters** (management `aaaaa-aa`, ledgers, CMC, …) don't
  vendor or derive anything: Juno ships named runtime IDL types under
  `@junobuild/functions/canisters/*`. school's `raw_rand` uses
  `result: IcManagementIdl.raw_rand_result` (from
  `@junobuild/functions/canisters/ic-management`); the icrc ledger calls use
  the `IcrcLedgerCanister` wrapper.

## HTTPS outcalls + off-chain relay (the `vici-courier` email service)

When the satellite must reach the public internet (e.g. send a
transactional email), it uses `httpRequest` from
`@junobuild/functions/ic-cdk`, **not** SMTP (a canister can't) and
**never** by holding a vendor secret (node operators can read canister
state). The pattern, as built for school-email verification
([`school.services.ts`](../../../src/satellite/services/school.services.ts)):

- **`isReplicated: false`.** A non-idempotent side effect (sending one
  email) must run on a single node, not the whole subnet (~13–40×). The
  receiving relay also dedupes on an `idempotency-key` header for the
  belt-and-braces case.
- **Outcall a thin off-chain relay, not the vendor.** The relay
  ([`vici-courier`](https://github.com/ViciApp/vici-courier), a
  Bun/Elysia app on Fly.io) holds the real vendor key and is
  IPv6-reachable (IC outcalls are IPv6-only; many vendor APIs are not).
  The satellite holds only a **rotatable bearer token**, read at call
  time from a controllers-only `app_config` doc; never the repo. Send a
  **semantic** body (`{ template, to, locale, vars }`) so email copy +
  localization live in the relay, not the canister.
- **Secure randomness via `raw_rand`.** For anything that must be
  unpredictable (a verification code), call the management canister
  (`call({ canisterId: Principal.fromText('aaaaa-aa'), method:
'raw_rand', … })`); do **not** reuse the `time()`-seeded FNV trick in
  `referral.services.ts`, which is for uniqueness only.
- **Server-owned collections are `controllers`-scoped.** Submissions /
  config the satellite alone reads + writes (via `*DocStore`) use
  `read/write: 'controllers'` in `juno.config.ts` so no client can read a
  stored code digest or tamper with an attempt counter. The plaintext
  code is never persisted; only an `FNV(code|raw_rand_salt)` digest,
  with the attempt cap + TTL + per-principal/email rate limit as the real
  guessing defense.

## Owner-private per-user data: `managed` collection + caller-bound assert

Anything a user stores that must not be world-readable (the reference is
the account `email` in `profile_private`) can NOT live on a
`read: 'public'` collection: public read means any anonymous caller can
`list_docs` the whole collection, and principals are enumerable (the
collection keys themselves, plus the clearing leaderboard). The pattern:

- **A dedicated collection, `read/write: 'managed'`** (owner +
  controllers), keyed by the owner's principal. The owner reads/writes
  their own doc via plain Juno `getDoc`/`setDoc`; server-side consumers
  (admin endpoints, exports) read it via `getDocStore`.
- **Bind key + embedded owner to the caller in an assert.** `managed`
  still lets any authenticated user CREATE a doc under a free key, so
  without `assertSetProfilePrivate`-style binding a third party could
  squat another user's principal key before their first write (blocking
  or forging the value server-side consumers read by key).
- **Never put the field on a public doc "for convenience".** Typed
  queries don't help: anything carried by `withProfileDefaults` /
  `toWireProfile` goes to ANY caller, and the raw doc is readable
  regardless. Strip the field from the doc schema, the wire schemas, and
  the read projections in the same PR.
- **Serverless writes on behalf of the owner pass the OWNER's principal
  as the store `caller`** (the one-time email migration that populated
  `profile_private` worked this way), so the doc lands owner-owned and
  the caller-binding assert still holds; asserts run on `setDocStore`
  too. Budget warning for such bulk rewrites: serverless `setDocStore`
  writes cost multiple BILLION instructions each on the Sputnik
  satellite (a 100-doc read-only query fits the 5B query budget, but
  ~10 writes exceed the 40B update limit), so any admin endpoint that
  rewrites docs in bulk MUST be keyset-paged with a page size tunable
  down to a single doc.
- **Add the collection to the hard-delete cascade**
  (`hardDeleteAccountFn`): a private doc must not outlive its account.

## Build-wide write gates with an `app_config` kill switch

When a rule must hold for every client (a modified one included) but stay
switchable without a redeploy, put it in an assert and read the switch from a
controllers-scoped `app_config` doc. The reference is the new-profile gate
([`new-profile-gate.services.ts`](../../../src/satellite/services/new-profile-gate.services.ts)),
which refuses to CREATE a `profiles` doc, or a `profile_private` doc for a
principal with no profile, because new accounts live on the new stack:

- **Inspect creates only.** An assert sees `data.current`; absent means
  create. Updates and every serverless `setDocStore` on an existing doc pass
  untouched, so recovery, school verification and Flow swipe writes keep
  working.
- **Armed by default, off by doc.** No doc means armed. A controller turns it
  off by writing `app_config/new_profile_gate` with `{ "enabled": false }`
  (Juno Console, Datastore); deleting the doc re-arms it. Read the doc as a
  controller (`getAdminAccessKeys()[0][0]`) since `app_config` is
  controllers-scoped, and fail closed when no controller is available.
- **Emulator exemption by canister id.** The Playwright suite creates
  profiles on the emulator and has no controller identity to write the
  switch, so the gate skips the emulator's fixed satellite id
  (`canisterSelf()`); a deployed satellite can never carry it.
- **Run the cheap gate before expensive siblings** in the composed assert
  (`assertProfile` checks it before the nickname scan).

## Public-write collections: owner or controller on every write and delete

Juno's `write: 'public'` rule does no owner check: any caller may create,
update or delete any doc of such a collection. Every public-write collection
in [`juno.config.ts`](../../../juno.config.ts) therefore has both a set and a
delete assert wired in `index.ts` (`src/tests/satellite/index.spec.ts` fails
when one is missing), and each assert lets through only:

- **the doc's owner**, read from the key or the payload the set assert binds
  to the caller: a profile's key, an activity's or a reaction's key segment,
  a league's `owner`, a month row's key prefix.
  `assertOwnerOrController` in
  [`authz.services.ts`](../../../src/satellite/services/authz.services.ts)
  is the shared check;
- **a satellite controller**, which is how the satellite itself writes (see
  below);
- **a narrow, named cross-user rule** where the app needs one, written in the
  collection's assert: the league owner kicks a member or changes a role, a
  relation's participants end an active friendship and its sender withdraws
  a pending request, an admin grants or removes a role.

Two more rules hold on a user-owned doc:

- **An identity field in the payload must equal the key.** Reads report the
  doc and look up its role by that field, so `assertProfileOwnerField`
  refuses a profile whose `owner` is not its key, and the reads take the
  identity from the key anyway (`decodeStoredProfile`).
- **A field only the satellite decides is unchanged by any other caller.**
  The owner may write the doc but must carry the stored value of such a
  field (`assertSchoolStatusUnchanged` for a profile's `schoolStatus`); the
  endpoint that decides it signs as `controllerCaller(...)`. A league's
  `owner` is one: `assertSetLeague` takes a new owner only from a
  controller, and `transferLeagueOwnership` writes it as one once the new
  owner is checked to be a member.

A collection whose docs the satellite computes has no owner path at all: the
assert accepts only a controller (`assertControllerWrite`) and the endpoint
or hook that computes the doc signs its write with `controllerCaller(...)`.
That covers `relations` (every set goes through the friend-request
endpoints), `market_metadata` and `market_translations` (the upsert
endpoints check creator-or-admin, then write as a controller),
`league_stats` (fanned out by the profile and user-stats hooks),
`vxp_onboarding` (the onboarding payout ladder), `vxp_awards` (every award
path, through `persistAward` / `updateAward`), `exit_signals` (the
account deletion writes the churn row as a controller, so the doc's Juno
owner is never the departing principal), and the dormant `chats` and
`comments`. A delete with no app flow behind it is controller-only too
(`exit_signals`, `user_stats`).

**A secret that gates a write never sits on a public doc.** A league's
invite code is the only way into it, so it lives in the controllers-only
`league_invites` collection
([`league-invite.services.ts`](../../../src/satellite/services/league-invite.services.ts)),
not on the `read: 'public'` league doc, and only the league's own members
read it back (`listMyLeagues`). The write it gates goes through an
endpoint that checks it: `assertSetLeagueMember` admits a new member row
only from a controller (beyond the founder's own row), and
`joinLeagueByInvite` writes it as one once the code matches. Referral codes
follow the same rule: the controllers-only `referral_codes` collection is
read and written only by
[`referral.services.ts`](../../../src/satellite/services/referral.services.ts),
signing as a controller, which assigns a code when a profile is created and
resolves one for `lookupReferralCode`, `getMyReferralCode`, the redeem and
the friendship claim, so no client lists the codes or who owns them.

**Guessing such a secret is bounded per account.** `lookupLeagueByInvite`
(an update for this reason) and `joinLeagueByInvite` resolve a league
invite code through `resolveInviteCode`
([`league-invite-cap.services.ts`](../../../src/satellite/services/league-invite-cap.services.ts)),
which records each code that opened no league in the controllers-only
`league_invite_attempts` collection and refuses an account past its hourly
cap of misses, a right code included.

**Storage collections too.** A `write: 'public'` Storage collection lets any
caller upload over or delete any asset, so it has an `assertUploadAsset` and
an `assertDeleteAsset` entry in `index.ts` and a `maxSize` in
`juno.config.ts` (the spec checks all three). `league_images`
([`league-image.services.ts`](../../../src/satellite/services/league-image.services.ts))
admits only the owner of the league its path names
(`leagueImageFullPath` in `#lib/types/league.ts` builds the path, and
`leagueIdFromImageFullPath` reads it back) or a controller, and only
`LEAGUE_IMAGE_CONTENT_TYPE`: an HTML or SVG asset would be served from the
app's own origin.

**Every serverless write passes the same asserts.** `setDocStore` and
`deleteDocStore` run them with the `caller` they are given, so a satellite
path that acts for the system rather than for the caller (the account purge,
the league disband, an endpoint-computed doc) signs as
`controllerCaller(...)` and keeps the real caller for reads.

## Endpoint-computed docs: controller-only assert

When every doc of a `read: 'public'` collection is computed by a satellite
endpoint, and something of value (a prize, a ranking) reads it, no client
may write it. The reference is the monthly tournament
([`tournament.services.ts`](../../../src/satellite/services/tournament.services.ts)):
`tournaments` and `tournament_matches` decide who claims the tournament
prize.

- **Gate the caller first in the set and delete asserts.** A
  `write: 'public'` rule does no owner check, so the assert is the only
  guard: `assertSetTournament`, `assertSetTournamentMatch` and
  `assertDeleteTournamentDoc` reject any caller for which
  `isControllerText` is false, before decoding the payload. The shape and
  write-once checks still run for the controller.
- **The endpoint signs its writes as a controller.** Serverless
  `setDocStore` / `deleteDocStore` run the asserts with the `caller` they
  are given, so the draw and round-resolution endpoints pass
  `controllerCaller(...)` for every write and keep the real caller for
  reads. Anyone may still call the endpoint; it computes the doc itself.
- **Prefer the assert over `write: 'controllers'`.** The rule lives in
  code and ships with the satellite build; a `juno.config.ts` rule change
  needs `juno config apply` on every satellite.

## Logging

- Use the helpers in
  [`src/satellite/utils/logger.utils.ts`](../../../src/satellite/utils/logger.utils.ts)
  rather than `console.log` directly.
- Prefer **stable string tags** (`engine_sync_error`,
  `oracle_settler_skipped_missing_oracle`, …). Operators grep for them in
  the Juno Console.
- Don't log secrets or full doc bodies; log identifiers + the change.

## Do / don't

- ✅ Reuse FE schemas from `#lib/schema/` so the FE and satellite agree.
- ✅ Keep `index.ts` declarative: schemas + dispatch tables only.
- ✅ Make every hook idempotent.
- ✅ For any VXP award / economy change, follow the invariants in
  [`economy.md`](./economy.md).
- ✅ Validate principals via `PrincipalTextSchema`.
- ✅ Build the satellite with the pinned juno CLI (0.15.6), which keeps
  nested results camelCase, and reshape a result with a `toWire…`
  converter from
  [`src/satellite/utils/wire-format.utils.ts`](../../../src/satellite/utils/wire-format.utils.ts)
  in the handler when its domain shape does not fit; see
  [Wire format](#wire-format-nested-results-are-camelcase).
- ❌ Use `.transform()` / `.refine()` / `.passthrough()` in any
  `defineQuery` / `defineUpdate` `args` or `result` schema; juno's
  codegen only accepts `ZodObject` and silently kills the build with no
  output on `ZodEffects`.
- ❌ Import `@junobuild/core` (FE-only).
- ❌ Touch `api-schemas.ts`, `satellite.did`, or
  `satellite_extension.did` by hand; regenerate via
  `npm run juno:functions:build && npm run quality` (the Juno CLI emits
  in its own style; `quality` aligns the output with this repo's
  prettier + eslint config). Commit the regenerated
  `src/satellite/{satellite,satellite_extension}.did`,
  `src/satellite/api-schemas.ts`, **and** `src/declarations/satellite/**`.
  This applies whenever you change a `#lib/schema/*.ts` file imported by
  `src/satellite/index.ts` too; CI's `satellite-schema` job fails on
  any drift.
- ❌ Throw inside a hook for an expected condition. Log + return.
- ❌ Add a hook that mutates the **same** doc that triggered it without
  an explicit termination guard: write loops are a real failure mode.
