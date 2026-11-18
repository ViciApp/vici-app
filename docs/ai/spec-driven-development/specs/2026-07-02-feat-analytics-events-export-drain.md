# Spec: Analytics-events export + drain for the cockpit warehouse

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#1085)

**Authored retroactively.** The export/drain endpoints shipped in #1083
(keyset paging fix) and #1085 (drain delete) without the mandatory
satellite spec; this is the decision record reconstructed from the merged
implementation. It documents only the **export + drain** half of the
analytics pipeline: the capture side (`trackEvents`, the `events` /
`event_rollups` collections, the `AnalyticsEventName` Candid variant) is
pre-existing (#883) and is context here, not scope.

## Goal

The private `vici-cockpit` warehouse can pull the raw product-analytics
`events` log off the satellite page by page and then delete each page
once it has been durably persisted, so the on-chain `events` collection
stays a small **buffer** instead of an ever-growing log. This keeps every
analytics read cheap and within the IC query instruction budget as event
volume grows.

## Context

- Endpoints live in `src/satellite/services/analytics.services.ts`,
  wired in `src/satellite/index.ts`:
  - `getAnalyticsEventsFn({ afterUpdatedAtNs?, afterKey?, limit })`:
    admin-gated `defineQuery`; returns the next page of `events` flattened
    to rows plus `hasMore`.
  - `deleteAnalyticsEventsFn({ keys })`: admin-gated `defineUpdate`;
    deletes the given keys, returns `{ deleted }`.
  - Pre-existing siblings: `trackEventsFn` (capture) and
    `getAnalyticsSummaryFn` (daily rollups).
- Collections `EVENTS` and `EVENT_ROLLUPS` in
  `src/lib/constants/collections.constants.ts`: both controllers-scoped;
  the privileged `*DocStore` APIs run as an admin via
  `getAdminAccessKeys()[0][0]`, because the end user is not a controller.
- Admin gate: `isAdmin({ caller })` in `src/satellite/services/_authz.ts`
  (the cockpit founder principal).
- Event doc shape + name union: `src/lib/types/analytics-event.ts`;
  runtime Zod mirror `src/lib/schema/analytics-event.schema.ts`.
- Generated surface: `src/satellite/satellite_extension.did`
  (`app_get_analytics_events`, `app_delete_analytics_events`) and the FE
  declarations under `src/declarations/satellite/**`.

## Scope

1. **Keyset export.** `getAnalyticsEventsFn` pages `events` by the native
   (indexed) **key** order via `paginate.start_after`, bounded by
   `paginate.limit`. Event keys are `${ns}-${sessionId}-${index}` and the
   collection is append-only, so key order **is** chronological order. A
   `(afterUpdatedAtNs, afterKey)` keyset cursor is echoed back so a page
   boundary that splits a same-`updated_at` group resumes mid-group rather
   than skipping rows. A timestamp-only cursor (ns set, key blank) is
   rejected loudly rather than stalling pagination.
2. **Drain delete.** `deleteAnalyticsEventsFn` deletes each key with its
   current `version`; missing keys are skipped so the call is
   **idempotent**: a page whose warehouse write landed but whose delete
   didn't can be retried safely.
3. **Buffer semantics.** After a page is durably ingested, the cockpit
   calls the drain with that page's keys, keeping `events` bounded.

### Out of scope

- The capture path (`trackEvents`) and the inline `event_rollups` bump.
- The cockpit-side warehouse (separate `vici-cockpit` repo).
- Any change to the `AnalyticsEventName` taxonomy.

## Linked issues

No open issue in this repo matches. #1083 was driven by a production
IC0522 (see Decisions); #1085 completes the drain it enables.

## Analytics

**No new product analytics.** These endpoints are the analytics
_infrastructure_ (an ops/admin export + drain), not user-facing
behaviour, so they emit no events themselves and add no name to the
taxonomy. Instrumenting an admin drain would be noise.

## Technical requirements (satellite / backend, mandatory)

- **Performance.** Both calls are O(page), not O(collection). Export pages
  on the datastore's native key index (`start_after` + `limit`); delete is
  an O(log n) keyed op per key. This is the whole point: `listDocsStore`
  materializes the collection per call, so an unbounded `events` blows the
  5B-instruction query budget (IC0522). The drain keeps the buffer small
  so reads stay cheap.
- **Instruction budget.** Export capped at `MAX_EXPORT_LIMIT` rows per
  call; drain capped at `MAX_EXPORT_LIMIT` keys per call: one call stays
  well under budget regardless of total event count.
- **Memory & storage.** No new collection. `events` is a drained
  **buffer** (bounded by ingest cadence), not a permanent log; the
  permanent store is the off-chain warehouse. `event_rollups` persists
  (one small doc per day) and is unaffected.
- **Scalability.** At 10×/100× event volume the buffer grows only between
  drains; steady-state size is `ingest_rate × drain_interval`. Export /
  drain cost is independent of total historical volume once drained.
- **Upgrade & compatibility.** Satellite code change →
  `npm run juno:functions:build`, commit regenerated `.did` + FE
  declarations. Additive endpoints, not breaking. Requires a **manual
  satellite wasm upgrade** (auto-upgrade is off).
- **Security.** Both endpoints `isAdmin`-gated (cockpit founder
  principal); a non-admin caller is rejected. `*DocStore` runs as a
  controller for the controllers-scoped `EVENTS` collection. Event bodies
  are behavioural-only; the only identity is the pseudonymous principal,
  which never leaves the satellite except into the private warehouse.
- **Parameters.** `MAX_EXPORT_LIMIT` and `MAX_EVENTS_PER_BATCH` in
  `analytics.services.ts`; do not restate.

## Implementation outline

As shipped in #1083 (export keyset paging) and #1085 (drain):

1. `getAnalyticsEventsFn`: key-ordered `listDocsStore` page, keyset
   filter + sort, flatten to `AnalyticsEventExportRow`, return `hasMore`.
2. `deleteAnalyticsEventsFn`: per-key `getDocStore` → `deleteDocStore`
   with version; skip missing; return `{ deleted }`.
3. Regenerate bindings; wire both in `src/satellite/index.ts`.

## Acceptance criteria

- [x] Export returns pages in chronological key order with a resumable
      keyset cursor; a full page reports `hasMore: true`.
- [x] A timestamp-only cursor is rejected rather than stalling.
- [x] Drain is idempotent: re-deleting an already-drained page is a
      no-op that reports `deleted` only for keys still present.
- [x] Both endpoints reject non-admin callers.
- [x] Export cost stays within the query budget after draining, where an
      un-drained collection previously hit IC0522.

## Decisions

- **Page by key, not `updated_at`.** The datastore has no secondary index
  on `updated_at`; ordering/matching on it forced Juno to load and sort
  the entire collection every call, hitting IC0522 even at `limit=1`.
  Because keys are chronological and unique, `start_after` on the key is a
  complete keyset cursor and the walk stays O(page). (#1083)
- **Drain rather than retain.** Keeping `events` permanently on-chain
  makes every read scale with all history. Draining after durable ingest
  keeps the buffer small; the warehouse is the system of record. (#1085)
- **Idempotent delete.** Skip-missing on delete lets the cockpit safely
  retry a page whose ingest committed but whose drain didn't.
