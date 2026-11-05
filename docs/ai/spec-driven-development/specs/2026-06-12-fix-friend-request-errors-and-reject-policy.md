# Spec: User-friendly add-friend errors + friend-request reject policy

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#838)

## Goal

When adding a friend fails, the user learns **why** in plain words
instead of a blank "Failed to send request": already friends, request
already pending, or "they declined — you can try again in 6 days"
(scaled down to hours / minutes / seconds as the window shrinks).
Unexpected failures stay friendly but carry a short technical detail
the user can screenshot so we can diagnose. Behind it, the reject
policy becomes recoverable: the **rejecter** may re-initiate anytime,
the **rejected sender** may retry after a cooldown — today a single
rejection permanently bricks friend requests between the pair, in both
directions. All friendship rules land in `docs/ai/PRODUCT.md` as the
product-rules record.

## Context

- Add-friend sheet: `src/lib/components/arena/AddFriendSheet.svelte`,
  submitted by `handleAddSubmit` in
  `src/lib/components/arena/FriendsTab.svelte`, which maps only the
  FE-side `not_found` / `self` codes and collapses everything else to
  `arena.friends.error.send_failed`.
- FE service: `sendFriendRequest` in
  `src/lib/services/relation.services.ts` — resolves `@handle` /
  principal via `searchProfiles`, then calls the satellite.
- Satellite: `sendFriendRequest` in
  `src/satellite/services/relation.services.ts` — throws
  `Friend request already exists with state: <state>` for any existing
  relation (PENDING-where-caller-is-sender / ACTIVE / REJECTED). The
  mutual-request auto-accept (A→B pending + B adds A → ACTIVE) already
  exists there.
- Reject: `rejectFriendRequest` flips the relation doc to
  `RelationState.REJECTED` and nothing ever clears it — `accept` and
  `cancel` only operate on PENDING docs, `unfriend` only deletes ACTIVE
  ones. The doc's `updated_at` (ns) is the rejection time, since the
  reject write is the last write a REJECTED doc receives.
- Structured endpoint results with a reason enum are an established
  pattern: `checkNicknameAvailability` in `src/satellite/index.ts`
  returns `{ available, reason? }`. Returning a typed status beats
  parsing trap message strings through the agent error chain.
- Time formatting: `formatRelativeAgoFromNs` in
  `src/lib/utils/format.utils.ts` already does locale-aware
  largest-unit selection via `Intl.RelativeTimeFormat` — the future
  direction ("in 3 days" / "in 5 hours" / "in 12 minutes" / "in 40
  seconds") reuses the same unit table.

## Scope

1. **Satellite — typed outcome instead of a trap.**
   `sendFriendRequest` returns
   `{ status: 'sent' | 'auto_accepted' | 'already_friends' | 'already_pending' | 'rejected_cooldown', retryAtMs? }`:
   - no existing relation → write PENDING, `sent`;
   - existing PENDING, caller is recipient → flip to ACTIVE (existing
     behaviour), `auto_accepted`;
   - existing PENDING, caller is sender → `already_pending`;
   - existing ACTIVE → `already_friends`;
   - existing REJECTED, caller is the **rejecter**
     (`participants[1]` of the rejected request) → overwrite with a
     fresh PENDING `[caller, target]` (version-locked), `sent`;
   - existing REJECTED, caller is the **rejected sender** and
     `now >= updated_at + cooldown` → overwrite with a fresh PENDING
     (version-locked), `sent`;
   - existing REJECTED, caller is the rejected sender inside the
     cooldown → `rejected_cooldown` with
     `retryAtMs = updated_at(ms) + cooldown`. No write.
   - existing BLOCKED (state exists in the enum; nothing writes it
     today) → treated as unknown/trap, out of the friendly vocabulary
     on purpose.
2. **Cooldown constant.**
   `FRIEND_REQUEST_REJECTED_COOLDOWN_MS` = **7 days** in a new shared
   `src/lib/constants/relation.constants.ts` (satellite already
   imports `#lib/constants/*`, cf. `collections.constants`). Picked as
   a sensible default — flagged in the PR for product sign-off; one
   constant to change.
3. **FE mapping.** `handleAddSubmit` branches on the returned status:
   - `sent` → close sheet (current success path);
   - `auto_accepted` → close sheet + success toast ("you're now
     friends");
   - `already_friends` / `already_pending` → informational toast with
     dedicated copy;
   - `rejected_cooldown` → toast "They declined your last request — you
     can try again {when}", `{when}` from the new formatter below;
   - FE-side `not_found` / `self` keep their existing messages;
   - any thrown/unknown error → friendly copy **plus the raw error
     detail** (trimmed) so a screenshot is diagnosable:
     "Something went wrong — screenshot this and tell us: {detail}".
4. **Future-direction formatter.** `formatRelativeUntilFromMs({
targetMs, locale, nowMs })` in `src/lib/utils/format.utils.ts`:
   `Intl.RelativeTimeFormat`, largest unit ≥ 1 from day → hour →
   minute, falling through to seconds (never an empty/zero phrase).
   The toast renders the value once (static snapshot, no live tick) —
   the unit scaling satisfies the days→…→seconds requirement.
5. **i18n.** New keys under `arena.friends.*` in **all** catalogs in
   `src/lib/constants/messages/` (12 locales).
6. **Product rules doc.** New "Friendship rules" subsection in
   `docs/ai/PRODUCT.md` § Behaviour index recording the full rule set
   (add by handle/principal, self-block, mutual auto-accept, reject
   policy + cooldown, cancel semantics, unfriend, invite bonus
   pointer).

### Out of scope

- A "block" feature (`RelationState.BLOCKED` stays unwired).
- Live-ticking countdown UI inside the toast/sheet.
- Notifying the rejected user when the cooldown lapses.
- Surfacing rejected state in the outgoing-invites list
  (`listSentFriendRequests` filters PENDING only — unchanged).

## Linked issues

Closes #832 — "I cant add my friend @Pablo error Message why?": the
generic toast is replaced by the specific reason, and the
rejected-pair dead end (the likely underlying state) becomes
recoverable per the policy above.

## Analytics

Instrument: yes. One new event, `friend_request_sent`, captured in
`handleAddSubmit` via `track()` (`src/lib/services/analytics.services.ts`)
with `props.label` = outcome from a bounded vocabulary:
`sent | auto_accepted | already_friends | already_pending |
rejected_cooldown | not_found | self | error`. This measures both the
funnel (sends, auto-accepts) and the friction the issue reported
(which block reasons users actually hit). Event name lands in **both**
`src/lib/types/analytics-event.ts` (TS union) and
`src/lib/schema/analytics-event.schema.ts` (Zod mirror). No new prop
dimensions needed — `label` exists.

## Technical requirements (satellite / backend — mandatory)

- **Performance.** `sendFriendRequest` is a user-initiated update call
  (a few per user per day at most). The change adds zero reads — the
  existing-doc read already happens; cooldown math is arithmetic on
  `doc.updated_at`. No new hooks.
- **Memory & storage.** No new collection, no doc-shape change — the
  REJECTED→PENDING transition reuses the same `RELATIONS` doc key
  (sorted participant pair). Rejection time is read from the doc's
  Juno `updated_at`; nothing new is persisted.
- **Scalability.** Per-pair single-doc reads/writes; unaffected by
  user-count growth.
- **Upgrade & compatibility.** Endpoint result changes `void` → record
  with `status` (+ optional `retryAtMs`): schema change → run
  `npm run juno:functions:build` and commit the regenerated
  `satellite.did` / `satellite_extension.did` / `api-schemas.ts` /
  `src/declarations/satellite/**` in the same PR. The FE is the only
  consumer and ships in the same PR; deploy order (satellite upgrade
  before FE) is the usual release flow — not marked breaking.
- **Security.** No collection-rule changes. The caller can only ever
  create/overwrite a relation doc whose key includes their own
  principal; `setDocStore` runs with the real caller as today.
  `retryAtMs` leaks only the rejection time of the caller's own
  rejected request — acceptable.
- **Parameters.** Cooldown lives only in
  `src/lib/constants/relation.constants.ts`
  (`FRIEND_REQUEST_REJECTED_COOLDOWN_MS`); docs reference the constant,
  never the number.

## Implementation outline

1. Add `src/lib/constants/relation.constants.ts` with
   `FRIEND_REQUEST_REJECTED_COOLDOWN_MS`.
2. Satellite `src/satellite/services/relation.services.ts`: change
   `sendFriendRequest` to return the typed outcome per Scope 1.
3. `src/satellite/index.ts`: add a `result` schema
   (`j.strictObject({ status: j.enum([...]), retryAtMs: j.optional(j.number()) })`)
   to the `sendFriendRequest` `defineUpdate`.
4. `npm run juno:functions:build`; commit regenerated files.
5. FE `src/lib/services/relation.services.ts`: return the satellite
   outcome from the service.
6. `FriendsTab.svelte` `handleAddSubmit`: branch on outcome → toasts;
   unknown-error path appends the trimmed detail; fire
   `friend_request_sent` with the outcome label.
7. `src/lib/utils/format.utils.ts`: add `formatRelativeUntilFromMs`.
8. Analytics event name in the TS union + Zod mirror.
9. i18n keys in all 12 catalogs.
10. `docs/ai/PRODUCT.md`: "Friendship rules" subsection.
11. Extend the shared-constants entry in
    `docs/ai/frontend/reusability.md` if the catalog lists constants
    files.

## Acceptance criteria

- [ ] Adding an existing friend shows the "already friends" message —
      no generic failure.
- [ ] Re-sending while a request is pending shows the "already sent"
      message.
- [ ] A rejected sender retrying inside the cooldown sees "try again
      {when}" where `{when}` scales day → hour → minute → second and
      never renders a zero/empty phrase.
- [ ] A rejected sender retrying after the cooldown succeeds (fresh
      PENDING request).
- [ ] The rejecter can send a new request to the rejected party at any
      time, and it succeeds.
- [ ] Mutual pending requests (A→B then B→A) resolve to ACTIVE friends
      without an error (existing behaviour, now documented + covered by
      the `auto_accepted` toast).
- [ ] An unexpected failure shows friendly copy that includes a short
      technical detail suitable for a screenshot report.
- [ ] All new user-visible strings exist in every catalog under
      `src/lib/constants/messages/`.
- [ ] `friend_request_sent` is captured with the outcome label and
      validates against the Zod mirror.
- [ ] `docs/ai/PRODUCT.md` records the full friendship rule set.
- [ ] `npm run quality`, `npm run check`, and
      `npm run juno:functions:build` pass; regenerated files committed.

## Decisions

- **Typed result over thrown errors** for known outcomes — mirrors
  `checkNicknameAvailability`'s reason enum; trap-message string
  parsing through the agent error chain is fragile and can't carry
  `retryAtMs` cleanly. Unknown failures still trap → FE catch-all.
- **Cooldown = 7 days** — not specified by product; chosen as a
  conservative default and isolated in one constant. Flag for
  sign-off in the PR.
- **Rejection time = doc `updated_at`** — avoids a schema/data
  migration; the reject write is provably the last write to a REJECTED
  doc.
- **Static "in X" snapshot, not a ticking countdown** — the message
  lives in a transient toast; unit scaling (days→…→seconds) conveys
  the wait precisely enough without timer plumbing.
- **Rejecter re-initiating flips `participants` order** to
  `[newSender, newTarget]` — the doc key (sorted pair) is unchanged,
  and all role checks (`participants[0]` = sender) stay consistent for
  the new request's lifecycle.
