# Satellite Patterns

Idiomatic TypeScript patterns for the Juno satellite. If a pattern here
disagrees with code in `src/satellite/`, the code wins (truth hierarchy
in [governance.md](../governance.md)). Update this page in the same PR —
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

- **Always `j.strictObject`** at the top level — extra properties are
  rejected.
- **Reuse `$lib/schema/*.schema.ts`** whenever the FE consumes the same
  shape (so the FE-side schema and the satellite-side schema can never
  drift).
- **Quirk to know:** at the time of writing, the schema layer doesn't
  accept the literal property names `principal` / `query` in some
  positions — use `principalStr` / `queryStr` and re-map inside the
  handler. (See the `TODO` comments in `src/satellite/index.ts`.)
- **`PrincipalTextSchema`** comes from `@junobuild/schema`. Use it for
  every principal-typed arg; don't hand-write a regex.
- **Keep handlers thin.** The function passed to `handler:` should
  immediately delegate to `services/<area>.services.ts`. The schema
  declaration + the dispatch table are the only logic that belongs in
  `index.ts`.

## Wire-format quirk: `Vec<NestedStruct>` results need snake_case

If a typed query returns `j.array(SomeNestedSchema)`, the items land on the
wire in **snake_case** — not the camelCase you'd expect from the schema.
Get this wrong and the canister traps on every read with
`'Error converting from js JsonData into type Candid: missing field
<snake_case_name>'`.

### Why

Sputnik's `JsonData` derive macro generates a mirror struct with
`#[serde(rename_all = "camelCase")]` for fields it wraps, so the JSON↔Rust
handoff normally uses camelCase. **But** the macro only wraps fields
explicitly marked `#[json_data(nested)]`, and Juno's TS→Rust codegen does
**not** add that attribute to `Vec<NestedStruct>` fields. For example:

```rust
// ✅ getProfile — `profile` IS nested → wire format is camelCase
pub struct AppGetProfileResult {
    #[json_data(nested)]
    pub profile: Option<AppGetProfileResultProfile>,
}

// ❌ listLeaderboard — `items` is NOT nested → wire format reverts to
//    the inner struct's original `Deserialize` impl, no rename_all,
//    i.e. snake_case
pub struct AppListLeaderboardResult {
    pub items: Vec<AppListLeaderboardResultItems>,
}
```

So `app_get_profile` works with camelCase, but `app_list_leaderboard`,
`app_search_profiles`, `app_list_friends`, etc. expect snake_case on the
wire.

### The fix that doesn't work

`.transform()` on the result schema is **not** a valid workaround. It
produces a `ZodEffects`, and juno's schema → Rust codegen only accepts
`ZodObject` — it throws
`"Unsupported type: unrepresentable schema (z.symbol, z.undefined, …
are not supported)"`, the CLI's silent `catch{}` swallows it, and the
whole `juno functions build` exits with code 1 producing **zero** files in
`target/deploy/`. (See git history for the Saturday afternoon we lost to
this.) Avoid `.transform()` / `.refine()` / `.passthrough()` anywhere in a
`defineQuery` / `defineUpdate` result schema for the same reason.

### The fix that does work

For every `Vec<NestedStruct>` result, declare a **parallel snake_case wire
schema** in
[`src/satellite/utils/wire-format.utils.ts`](../../../src/satellite/utils/wire-format.utils.ts)
and a matching `toWire…` converter, then use them in `index.ts`:

```ts
// in src/satellite/utils/wire-format.utils.ts
export const UserProfileWireSchema = j.strictObject({
	owner: PrincipalTextSchema,
	total_trades: j.number().default(0), // snake_case here
	// …
	preferences: j
		.strictObject({
			default_amount: j.strictObject({ flow: j.string(), manual: j.string() })
		})
		.optional()
});

export const toWireProfile = (profile: AppProfileLike): WireUserProfile => ({
	owner: profile.owner,
	total_trades: profile.totalTrades ?? 0 // camelCase → snake_case
	// …
});

// in src/satellite/index.ts
export const listLeaderboard = defineQuery({
	result: j.strictObject({
		items: j.array(UserProfileWireSchema) // ← wire schema, not the FE schema
	}),
	handler: () => ({
		items: listLeaderboardFn().map(toWireProfile) // ← convert per item
	})
});
```

juno's codegen reads the wire schema's field names verbatim → the Rust
struct shape is byte-identical to before. The handler emits snake_case →
Zod parse passes through → JSON.stringify produces snake_case → Rust
deserializer is happy.

### When to apply

- **Array results (`j.array(NestedSchema)`)** — always use the wire schema.
  Currently affected: `listLeaderboard`, `searchProfiles`,
  `listMarketTranslations`, `listFriends`, `listFollowers`,
  `listFollowing`, `listFriendRequests`, `listSentFriendRequests`.
- **`Option<NestedSchema>` results** (e.g. `getProfile.profile`) — leave
  camelCase as-is. Juno emits `#[json_data(nested)]` on `Option<T>` so
  the camelCase mirror handles it correctly.
- **Primitive results** (`j.boolean()`, `j.number()`, `j.string()`,
  `j.array(j.string())`, …) — no conversion needed; primitives don't
  trigger the bug.

If the upstream Juno codegen ever starts emitting `#[json_data(nested)]`
on `Vec<NestedStruct>` fields too, the wire schemas become redundant and
can be dropped in one PR — point all the `index.ts` results back at the
FE schemas and delete the converters.

## Hooks — collection dispatch table

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
  dispatch table until it's mapped — the type system enforces "every
  registered collection has a handler".
- Calling `fn[...]?.(context)` makes the hook a no-op for any collection
  that slipped through (defensive against the satellite hot-reloading the
  whitelist).

`defineAssert<AssertSetDoc>` and the `onDeleteDoc` hook follow the same
pattern — keep them consistent.

When a single collection needs **more than one** assert (or hook), compose
them into one dispatch-table entry rather than widening the table value to
an array. The `profiles` slot maps to `assertProfile`, a small composed
function that calls `assertValidNickname` then `assertDailyGoalMonotonic`
in turn (a throw from either rejects the write); this mirrors the
`onProfileSetComposed` hook composition below. Each sub-assert stays
exported from its service so it remains independently unit-testable.

## Hooks fire ONLY for client writes, never for serverless `setDocStore`

`onSetDoc` / `onDeleteDoc` run **only** when the document is written
through the public client API (`@junobuild/core` `setDoc` from the
browser). A write made from inside the satellite via
`@junobuild/functions/sdk` `setDocStore` / `deleteDocStore` — i.e. from
an endpoint handler or another hook — does **not** trigger the hook.
(In junobuild/juno: `api/db.rs` `set_doc` calls `set_doc_store` _then_
`invoke_on_set_doc`; the SDK `set_doc_store` in `db/store.rs` runs
asserts + insert and stops there. Asserts still run on serverless
writes — only the post-write hook is skipped.)

Consequences:

- A hook only works if its trigger collection is written **by the
  browser** (e.g. `profiles` via FE `setDoc` → the profile hooks fire).
- **An "endpoint writes a row → a hook fans out" design is broken** —
  the hook never fires. Either write the trigger row from the client, or
  do the work **inline in the endpoint** (make the handler `async` and
  call the logic directly). This is exactly what bit the referral VXP
  payout: `redeemReferralCode` (endpoint) created the `referrals` row via
  `setDocStore` expecting `onReferralSetForVxpPayout` to pay both bonuses,
  so every bonus sat permanently `owed`. It is now driven off the
  **client-written `activities` trigger** instead: the referral settles
  (`settleReferralPayout`) when the referred user makes their first
  prediction — a client `setDoc` to `activities`, whose `onSetDoc` hook
  genuinely fires (`onTradeActivityForReferral`) — with a `settleReferral`
  endpoint as the manual retry/backfill path. The `onReferralSetForVxpPayout`
  hook on the (serverless-written) referrals row stays wired only as a
  harmless safety net for client writes.
- Make the inline work **idempotent + retry-safe** (lock → act →
  finalize, short-circuit on already-done), and expose a settle/retry
  endpoint so a failed transfer can be re-driven — there is no hook replay
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
  even when the probe was `available` — there's always a race window
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
  "transition to CANCELLED state via `setDocStore`" — that would be a
  second write that itself races with the recipient's accept. A
  versioned delete is the only single-write move the datastore exposes
  that detects mid-flight conflicts.
- **Validate state in the same handler.** Read → check state &
  ownership → delete in one canister call. The narrow window between
  `getDocStore` and `deleteDocStore` is covered by the version lock.
- **FE refreshes after the catch.** When the trap fires (e.g. the
  counterparty won the race), the FE should still re-fetch the store so
  the UI lands on the real on-chain state (e.g. the request now shows
  under "Active" because accept won). See `handleCancel` in
  [`src/lib/components/social/FriendsList.svelte`](../../../src/lib/components/social/FriendsList.svelte)
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
  `utils/logger.utils.ts` (`engine_sync_skipped_missing_oracle`,
  `engine_sync_error`, …) so operators can grep Juno Console for the
  failure mode without breaking the hook.

## Client-write stats docs + per-row assert (no scheduler)

Some aggregate stats are cheaper to compute on the FE — the client already
has the source data in memory — than to fan out from a post-write hook. The
reference shapes are `user_stats` (per-user Dash cache) and
`user_monthly_stats` (per-user, per-month gameplay counters that back the
monthly album awards). The pattern:

- **The FE writes its own row.** `calculateAndSyncStats` (which already
  fetches the user's full clearing history) re-derives the snapshot and
  `setDoc`s it under a key the caller owns — `user_stats[${owner}]` or
  `user_monthly_stats[${owner}/${YYYY-MM}]`. No hook, no fan-out.
- **The assert binds the row to its owner.** `assertSetUserStats` /
  `assertSetUserMonthlyStats` reject any write whose key (and embedded
  `owner`) isn't the caller, plus structural sanity (`wins <= calls`,
  bounded arrays, values in range). It does **not** re-derive the counters
  from real history — a determined user could inflate their own row. Use
  this only for **cosmetic** signals (album tiles, Dash cache) with **no VXP
  payout**; anything that moves real value belongs in a hook or an icdc-core
  path that the user can't forge.
- **Lazy month rollover = a new key, not a reset.** Because each month is a
  distinct doc key, "rolling over" is just writing under the new month's key
  on the first sync of that month — no scheduler, no in-place reset. A
  read-side aggregator (`getMonthlyLeaderboardFn`) scans the collection,
  filters by the `/${monthAnchor}` key suffix, and computes the ranking
  on read (including an exact median from each row's bounded sample array).
  Awards are evaluated for the **completed** (prior) month, since the current
  month is still open.
- **Bound every array the user controls.** `user_monthly_stats` caps its
  `monthConsensus` sample array (`MONTHLY_CONSENSUS_LIMIT`), keeping the most
  recent values; the assert enforces the cap so the doc can't be bloated.

Contrast with the hook-driven fan-out (`onProfileSetForAffiliationStats`,
`onProfileSetForLeagueStats`): use a hook when **shared** stats (a school /
league row many users contribute to) must move on the server so no single
user can forge the aggregate. Use the client-write pattern when the row is
**owned by one user** and the signal is cosmetic.

## Soft-delete + lazy hard-delete (no scheduler)

Juno has **no timer primitive**, so any "delete now, purge later"
flow has to model the deferred work as a claim or an admin trigger —
never a scheduled job. The account-deletion flow
([`account.services.ts`](../../../src/satellite/services/account.services.ts))
is the reference shape:

- **Soft-delete = an optional marker field.** `deletedAtMs?: number`
  on the profile schema. PRESENCE means soft-deleted; ABSENCE means
  active. Declare it `j.number().optional()` with **no default** — a
  default would force every legacy/active row to look deleted, and
  absence is the meaningful state. Mirror the field in **both**
  `src/lib/schema/profile.schema.ts` **and**
  `src/satellite/api-schemas.ts` (the encoder trap), and forward it
  verbatim through `withProfileDefaults`.
- **Hide soft-deleted rows from PUBLIC reads, not from the owner.**
  A shared `isSoftDeleted(profile)` helper filters the public query
  endpoints (`listLeaderboard`, `searchProfiles`, `getProfile`).
  `getProfile` knows both the caller and the looked-up principal, so it
  makes the owner an exception — an own-read returns the doc even when
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
- **Hard-delete must not orphan others — transfer, don't just delete.**
  The cascade's owned-league step deletes a league only when no other
  member remains; if members self-joined during the recovery window it
  **transfers** ownership to a deterministic survivor (first remaining
  `LEAGUE_MEMBERS` row in iteration order) — version-locked re-encode of
  `league.owner` + a version-locked bump of that member row's `role` to
  `owner`. The interactive `deleteMyAccount` has an up-front
  `owns_non_empty_league` guard; the guard-less recovery-expiry + sweep
  paths rely on this transfer.
- **Keep the marker monotonic + the side effects once-only.**
  Re-deleting keeps the EARLIEST `deletedAtMs` so the recovery clock
  can't be reset. Recovery clears the field; both are version-locked
  overwrites. `softDeleteProfile` returns an `alreadyDeleted` flag so
  one-time side effects (the anonymous `EXIT_SIGNALS` churn row) are
  skipped on a re-delete — re-deleting must be idempotent, not
  cumulative.

### Hibernation — the reversible sibling state

Hibernation ("Pause 30 days" — the retention off-ramp offered alongside
delete) is a **fully reversible** state that reuses the same optional-marker
shape but never destroys data:

- **Same marker shape.** `hibernatedAtMs?: number` on the profile schema,
  `optional()` with no default, mirrored in **both**
  `src/lib/schema/profile.schema.ts` and `src/satellite/api-schemas.ts`,
  forwarded verbatim through `withProfileDefaults`. PRESENCE = hibernated.
- **Mutually exclusive with soft-delete.** `hibernateMyAccount` refuses
  (`{ ok: false, reason: 'deleted' }`) on an already-soft-deleted profile —
  the two markers never stack. No profile → `{ ok: false, reason: 'no_profile' }`.
- **Hide the same way, via one combined helper.** Public reads switched
  from `!isSoftDeleted` to `!isPubliclyHidden(profile) = !(isSoftDeleted ||
isHibernated)`. The three public filters (`listLeaderboard`,
  `searchProfiles`, `getProfile`) use `isPubliclyHidden`; the owner's own
  `getDoc` read stays ungated so the FE can offer resume.
- **Stats freeze.** A hibernated user is inactive (no trades → no profile
  writes → no fan-out), so the freeze is mostly natural. The two
  profile-write stat fan-out hooks (`onProfileSetForAffiliationStats`,
  `onProfileSetForLeagueStats`) additionally early-return when the AFTER
  profile `isHibernated` — a defensive guard against a stray write fanning
  a delta. This can't suppress the `resumeMyAccount` write: clearing the
  flag leaves `totalTrades` unchanged (zero delta) and the AFTER profile is
  no longer hibernated.
- **Reversible, not monotonic.** `hibernateMyAccount` keeps the EARLIEST
  `hibernatedAtMs` (mirrors soft-delete) but there's no expiry/sweep —
  `resumeMyAccount` clears the field (destructure-drop + re-encode,
  mirroring how recovery clears `deletedAtMs`) and the account is active
  again. Both are version-locked overwrites.

### League resolution — applied immediately, reuse the existing endpoint

`deleteMyAccount` accepts `leagueResolutions?: Array<{ leagueId; action:
'transfer' | 'delete'; transferTo? }>` and applies each BEFORE the
owner-leagues guard:

- **Reuse, don't reimplement, the transfer.** `transferLeagueOwnershipFn`
  reads `msgCaller()` internally, and `deleteMyAccountFn` runs as that same
  caller (the owner) — so it's called directly with no caller threaded
  through, and its `not_owner` / `new_owner_not_member` / … validation is
  the single source of truth. A `delete` action calls the new
  `deleteLeagueFn({ leagueId, callerText, callerBytes })` (owner disband).
- **SDK `deleteDocStore` bypasses asserts.** `deleteLeagueFn` drops every
  `LEAGUE_MEMBERS` row for the league — including the `owner` row, which
  `assertDeleteLeagueMember` forbids on the FE path ("transfer ownership
  first"). The satellite's own store drops never re-enter the assert, which
  is exactly why the cascade (`deleteOwnLeagueMemberships`) and this disband
  can remove owner rows. Distinct from `deleteOwnedEmptyLeagues`, which only
  drops leagues that are _already_ empty.
- **Applied immediately ⇒ not reversed by recovery.** Resolutions are real
  transfers / disbands at delete time, not deferred to hard-delete. A user
  who recovers within the window gets the account back but NOT the
  relinquished leagues. This is the documented delete-v2 contract, not a
  bug. A failed resolution aborts the whole delete (`reason:
'league_resolution_failed'` + `failedLeagueId` + `resolutionReason`);
  resolutions that already committed stand.

## Cross-canister calls

When a hook calls another canister (typically the icdc-core registry):

- The actor lives in `$lib/canisters/<canister>.canister.ts`.
- Build it with the satellite's identity. The satellite principal is
  pre-authorised as an `admin` on the Vici engine (see
  [`docs/engine-integration.md`](../../engine-integration.md#engine-admins)).
- **Never reach back into the FE store layer** from a satellite hook —
  the satellite has no access to it.
- **Never** await indefinitely on a remote call inside a hook without a
  guard. If the registry is down, log + return; the next write will
  retrigger.

### Candid encode/decode — derive from the generated factory, never hand-roll

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
  typed against `$declarations` (`RegistryDid` / `ClearingDid`) and routes its
  runtime Candid types through `candidMethod` — a new `import { IDL }` in a
  service is the smell this pattern exists to prevent.
- Need a method the canister exposes but `candidMethod` can't find? It
  throws — regenerate bindings (`npm run did`) rather than reaching for an
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
`@junobuild/functions/ic-cdk` — **not** SMTP (a canister can't) and
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
  time from a controllers-only `app_config` doc — never the repo. Send a
  **semantic** body (`{ template, to, locale, vars }`) so email copy +
  localization live in the relay, not the canister.
- **Secure randomness via `raw_rand`.** For anything that must be
  unpredictable (a verification code), call the management canister
  (`call({ canisterId: Principal.fromText('aaaaa-aa'), method:
'raw_rand', … })`) — do **not** reuse the `time()`-seeded FNV trick in
  `referral.services.ts`, which is for uniqueness only.
- **Server-owned collections are `controllers`-scoped.** Submissions /
  config the satellite alone reads + writes (via `*DocStore`) use
  `read/write: 'controllers'` in `juno.config.ts` so no client can read a
  stored code digest or tamper with an attempt counter. The plaintext
  code is never persisted — only an `FNV(code|raw_rand_salt)` digest,
  with the attempt cap + TTL + per-principal/email rate limit as the real
  guessing defense.

## Owner-private per-user data — `managed` collection + caller-bound assert

Anything a user stores that must not be world-readable (the reference is
the account `email` in `profile_private`) can NOT live on a
`read: 'public'` collection — public read means any anonymous caller can
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
  queries don't help — anything carried by `withProfileDefaults` /
  `toWireProfile` goes to ANY caller, and the raw doc is readable
  regardless. Strip the field from the doc schema, the wire schemas, and
  the read projections in the same PR.
- **Serverless writes on behalf of the owner pass the OWNER's principal
  as the store `caller`** (the one-time email migration that populated
  `profile_private` worked this way), so the doc lands owner-owned and
  the caller-binding assert still holds — asserts run on `setDocStore`
  too. Budget warning for such bulk rewrites: serverless `setDocStore`
  writes cost multiple BILLION instructions each on the Sputnik
  satellite (a 100-doc read-only query fits the 5B query budget, but
  ~10 writes exceed the 40B update limit), so any admin endpoint that
  rewrites docs in bulk MUST be keyset-paged with a page size tunable
  down to a single doc.
- **Add the collection to the hard-delete cascade**
  (`hardDeleteAccountFn`) — a private doc must not outlive its account.

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

## Logging

- Use the helpers in
  [`src/satellite/utils/logger.utils.ts`](../../../src/satellite/utils/logger.utils.ts)
  rather than `console.log` directly.
- Prefer **stable string tags** (`engine_sync_error`,
  `engine_sync_skipped_missing_oracle`, …). Operators grep for them in
  the Juno Console.
- Don't log secrets or full doc bodies — log identifiers + the change.

## Do / don't

- ✅ Reuse FE schemas from `$lib/schema/` so the FE and satellite agree.
- ✅ Keep `index.ts` declarative — schemas + dispatch tables only.
- ✅ Make every hook idempotent.
- ✅ For any VXP award / economy change, follow the invariants in
  [`economy.md`](./economy.md).
- ✅ Validate principals via `PrincipalTextSchema`.
- ✅ Use the snake_case **wire schemas** from
  [`src/satellite/utils/wire-format.utils.ts`](../../../src/satellite/utils/wire-format.utils.ts)
  for **every** `j.array(NestedSchema)` result, with the matching
  `toWire…` converter in the handler — see the
  [`Vec<NestedStruct>` quirk](#wire-format-quirk-vecnestedstruct-results-need-snake_case)
  section above for the why.
- ❌ Use `.transform()` / `.refine()` / `.passthrough()` in any
  `defineQuery` / `defineUpdate` `args` or `result` schema — juno's
  codegen only accepts `ZodObject` and silently kills the build with no
  output on `ZodEffects`.
- ❌ Import `@junobuild/core` (FE-only).
- ❌ Touch `api-schemas.ts`, `satellite.did`, or
  `satellite_extension.did` by hand — regenerate via
  `npm run juno:functions:build && npm run quality` (the Juno CLI emits
  in its own style; `quality` aligns the output with this repo's
  prettier + eslint config). Commit the regenerated
  `src/satellite/{satellite,satellite_extension}.did`,
  `src/satellite/api-schemas.ts`, **and** `src/declarations/satellite/**`.
  This applies whenever you change a `$lib/schema/*.ts` file imported by
  `src/satellite/index.ts` too — CI's `satellite-schema` job fails on
  any drift.
- ❌ Throw inside a hook for an expected condition. Log + return.
- ❌ Add a hook that mutates the **same** doc that triggered it without
  an explicit termination guard — write loops are a real failure mode.
