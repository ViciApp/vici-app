# Spec: Handle rule on the legacy app and in the legacy import

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Draft

Part R3 of three. The split table and the rule are in [`2026-11-27-impr-handle-rule-and-lookalikes.md`](./2026-11-27-impr-handle-rule-and-lookalikes.md) (R1); the rename planner, the `handle_renames` table and the rollout order are in [`2026-11-27-impr-handle-rename-existing.md`](./2026-11-27-impr-handle-rename-existing.md) (R2). PR title: `feat(satellite): handle rule on the legacy app and in the import`. Builds on R1 and R2.

## Goal

A handle changed on vici.market obeys the same rule as on vici.app, and a legacy account arrives on vici.app with a compliant, unique handle however many times the import runs. Handles stored in the satellite are not rewritten: a legacy user keeps seeing the handle they have on vici.market until they move.

## Context

- **The satellite's rule.** `assertValidNickname` and `checkNicknameAvailabilityFn` in `src/satellite/services/profile.services.ts`: minimum `MIN_NICKNAME_LENGTH`, charset `NICKNAME_PATTERN`, no maximum length, uniqueness by `nicknameUniqueKey` (constants from `src/lib/constants/profile.constants.ts`). `RESERVED_HANDLES` is not checked. The cooldown is enforced from `handleLastChangeMs`. A write whose key equals the stored key skips the validity and uniqueness check.
- **Uniqueness is a full scan.** `checkNicknameAvailabilityFn` reads every document of the `profiles` collection (`listDocsStore` with empty params), decodes each and folds its nickname. It runs on every handle-setting write and on every `checkNicknameAvailability` query. There is no index on handles in the satellite.
- **No new accounts.** `assertNewProfileAllowed` (`src/satellite/services/new-profile-gate.services.ts`) refuses profile creation on vici.market, so the only handle writes left are changes by existing accounts through `HandleEditor.svelte`, at most one per account per `HANDLE_COOLDOWN_DAYS`. Since R1 the app already applies the rule in that editor on both builds; the satellite still accepts the wider rule from a direct call.
- **The query's Candid shape.** `checkNicknameAvailability` in `src/satellite/index.ts` declares `reason` as the enum `required`, `too_short`, `invalid`, `taken`.
- **Writing a profile document has side effects.** A `setDoc` on `profiles` runs `assertProfile` and fires the profile hooks (`onProfileSetForVxpOnboarding`, the league stats fan-out), and bumps the document version that open browsers hold; their next full-document write then fails with a version conflict (`src/lib/services/profile.services.ts` documents that race).
- **The import.** `importProfiles` in `backend/scripts/etl/transforms.ts` upserts one `profiles` row per satellite document, `nickname` copied as is, `nickname_key` from `nicknameUniqueKey`; on a key conflict it keeps the text and stores an empty key (two accounts then show one handle). `on conflict (user_id) do update` overwrites `nickname` on every run. The import is re-runnable by design (`backend/README.md`, "Data migration (ETL)"): one bulk run while vici.market is live, a final delta run during the write freeze.
- **The cutover has not happened.** `CLAIM_HANDOFF_ENABLED` in `src/lib/constants/claim.constants.ts` is `false`; legacy accounts are held on vici.market, and their rows on vici.app are provisional (`claim_pending`). The final import is still ahead.
- **What vici.market tells its users today.** `MoveNoticeBanner.svelte` (`src/lib/components/claim/`): VICI is moving, the account will be moved for them.

## Scope

### 1. The satellite takes the rule for changed handles

`src/satellite/services/profile.services.ts`:

- `checkNicknameAvailabilityFn` validates with `MIN_HANDLE_LENGTH`, `MAX_HANDLE_LENGTH`, `HANDLE_PATTERN` and the reserved keys, and compares `handleUniqueKey` of the candidate with `handleUniqueKey` of every scanned profile. So a change to `antonioventilii` is refused while another account holds `antonio.ventilii`.
- Over-length and reserved handles answer the existing `invalid` reason. The query's enum does not change, so no `.did` regeneration is caused by this spec (the build is still run and its output committed, per `AGENTS.md` § 4 rule 9).
- `assertValidNickname`: the check is skipped only when the proposed handle is the stored string, character for character (the grandfather clause of R1). The cooldown keeps comparing keys with `handleUniqueKey`, so tidying one's own handle is free, as on vici.app.
- `resolveTargetPrincipal` (`src/lib/services/relation.services.ts`) matches the typed handle by `handleUniqueKey`.
- The nickname constants (`NICKNAME_PATTERN`, `MIN_NICKNAME_LENGTH`, `MAX_NICKNAME_LENGTH`, `sanitizeNickname`) lose their last reader and are removed from `profile.constants.ts`; `nicknameUniqueKey` stays in the backend only, where `handle_renames.previous_key` needs it.

No stored satellite document is rewritten (pending decision 1). An account whose stored handle is outside the rule keeps it on vici.market and keeps saving its profile.

### 2. The import applies the rule

`importProfiles` uses the planner of R2 (`backend/src/profiles/handle-rename.ts`) for every document:

0. Before any branch: when the account was adopted and its stored handle is neither the document's nickname, nor the live recorded `assigned_handle`, nor the stored value the last import wrote, the handle was chosen on vici.app: the import leaves `nickname` alone and goes to the next document (this is case 5, checked first so cases 1 and 2 can never overwrite it).
1. The account already has a live `handle_renames` row (`reverted_at is null`) whose `previous_handle` is the document's nickname: the recorded `assigned_handle` is written. A row with `reverted_at` set is ignored, so a rollback is never undone by the next import. A re-run changes nothing, and a person who has already seen their handle on vici.app does not see it move.
2. The account has a live row but the document's nickname differs (the handle was changed on vici.market since the last run): the handle is derived again and the row updated in place.
3. No row and the nickname is compliant and free: imported as is.
4. No row and the nickname is outside the rule, reserved or taken: `compliantHandleFor`, then the collision rule of R2 against what is already in `profiles` and what this run has assigned. Existing rows are never displaced by an import; within one run the order is the one decided in R2 pending decision 2. A `handle_renames` row is written with `batch_id` naming the import run.
5. An account that was adopted and has since changed its handle on vici.app keeps that handle (checked first, as step 0).

`nickname_key` and `handle_key` are always written from the final handle. The "imported without a reserved handle" branch disappears: no row is left with a handle and an empty key. `handle_last_change_ms` is imported unchanged, so a rename at import costs no change allowance. `verify-parity.ts` compares handles through the same function, so a renamed handle is not reported as a mismatch.

The import's run summary gains the counts by reason and the list of collisions, the same figures as the R2 report, so the final cutover run can be read before the claim switch is flipped.

### 3. What vici.market says

`MoveNoticeBanner.svelte` gains one line for an account whose handle is outside the rule (computed in the browser: `cleanHandle(nickname) !== nickname`): the handle will be adjusted when the account moves, with a link that opens the handle editor (pending decision 2). No exact handle is promised, since availability is decided at import.

### Out of scope

- Rewriting handles inside the satellite (pending decision 1 recommends against it).
- The satellite's `searchProfiles`, leaderboards and caches: they keep showing stored handles.
- An index of handles in the satellite to replace the scan. The scan is unchanged by this spec and the collection stops growing (no new accounts).
- The claim flow, adoption and account merging (`backend/src/auth/adoption.ts`).
- The cleanup chore (drop `nickname_key`, `handle_key`, `handle_fold`, the grandfather clause) after the cutover.

## Linked issues

Open issues were searched on 27 Nov 2026 (six open). None is related. No closing keyword.

## Analytics

- `handle_renamed` (introduced by R2) is emitted by the import for each account it renames, `label` the reason, `source` `import`. Provisional accounts have no session; the event carries the pseudonymous account link only.
- vici.market: `handle_checked` with the refusal reason in `label`, as R1 defines it, so the same chart covers both builds.
- No new event name. No handle text is sent.

## Technical requirements (satellite / backend: mandatory)

- **Performance.**
  - Call frequency on the satellite: the availability query runs while somebody types in the handle editor (debounced, a handful per editing session); the assertion's scan runs once per handle change, at most once per account per 30 days. Profile creation is closed, so there is no sign-up traffic.
  - Instruction budget: the scan stays one pass over the collection. Per document it already pays the decode of the whole profile and one fold; this spec replaces the fold by one with one more replace over at most 16 characters (63 for a principal-shaped handle). The decode dominates, so the budget moves by a few percent at most. The figure to record in the PR is measured, not estimated: instructions of `checkNicknameAvailability` before and after on the test harness (`src/tests/satellite/services/profile.services.spec.ts`) at the production document count and at 10 times it (open question 1).
  - Import: one primary-key lookup on `handle_renames` and one or two indexed `exists` per document, inside the existing per-collection transaction.
- **Memory and storage.** Nothing new in the satellite: no collection, no field, no document rewritten. In Postgres, `handle_renames` rows for renamed legacy accounts (sized in R2).
- **Scalability.** The satellite's profile count is frozen by the sign-up gate, so the scan no longer grows; at 10 and 100 times the count it would hit the query instruction cap as it would today, which is why new accounts were moved off it. The import stays linear in documents.
- **Upgrade and compatibility.** No change to the profile schema, to `juno.config.ts`, `juno.collections.json` or the `Collection` constants. The Candid surface is unchanged (the `reason` enum is kept); `npm run juno:functions:build` is still run, and `src/declarations/satellite/*` copied to `backend/src/declarations/satellite/` if the output differs. Not breaking: stored documents stay valid, and only a direct call that sets a handle outside the rule is newly refused.
- **Security.** Collection rules and caller permissions are untouched. The reserved list becomes server-enforced on the satellite.
- **Parameters.** `src/lib/constants/profile.constants.ts` (`MIN_HANDLE_LENGTH`, `MAX_HANDLE_LENGTH`, `HANDLE_PATTERN`, `RESERVED_HANDLES`, `HANDLE_COOLDOWN_DAYS`); the satellite reads them directly.

## Implementation outline

1. `src/satellite/services/profile.services.ts`: validator and assertion on the rule; specs in `src/tests/satellite/services/profile.services.spec.ts`.
2. `relation.services.ts` (`resolveTargetPrincipal`); removal of the legacy nickname constants and of their drift entries in `backend/tests/shared-drift/domain-limits.test.ts`.
3. `npm run juno:functions:build`, `npm run quality`; commit regenerated output if any.
4. `backend/scripts/etl/transforms.ts` (`importProfiles`), `verify-parity.ts`, the run summary; `backend/tests/etl-transforms.test.ts`.
5. `MoveNoticeBanner.svelte` and its i18n keys in every catalog.
6. Docs in the same PR: `PRODUCT.md` ("Legacy app: new accounts move to vici.app" gains the handle adjustment at the move; "Handles: one rule" notes that vici.market enforces it for changes), `docs/ai/satellite/patterns.md` (the nickname example names the rule), `backend/README.md` (import mapping note for handles).

## Tests

- Satellite specs: a change to a handle with a capital, an accent, a separator, 2 or 16 characters is refused as `invalid`; a compliant handle is refused as `taken` against a stored lookalike; a reserved handle is refused; a stored handle outside the rule still saves unchanged; tidying one's own handle inside the cooldown window passes and does not move the stamp; the cooldown still applies to a real change.
- `backend/tests/etl-transforms.test.ts`: each of the five cases of section 2; two runs over the same export give identical rows; a legacy handle changed between runs is re-derived; an adopted account's own handle is not overwritten; no row ends with a handle and an empty key; a collision between a legacy document and an existing vici.app account leaves the existing account untouched.
- The R2 dry run after an import reports zero renames.

## Acceptance criteria

- [ ] On vici.market, a handle change outside the rule is refused by the satellite even when sent without the app.
- [ ] On vici.market, an account with a handle outside the rule keeps playing and saving its profile unchanged.
- [ ] After an import, every imported handle satisfies the rule, no two profiles share one, and running the import twice changes nothing.
- [ ] An import never changes the handle of an account that already exists on vici.app with a compliant handle.
- [ ] The Candid surface of the satellite is unchanged.
- [ ] The measured instruction count of the availability scan is recorded in the PR body.

## Open questions

1. **How many profile documents does the production satellite hold, and how many are outside the rule?** After `bun run etl:export` (see `backend/README.md`), on the exported file:

   ```bash
   wc -l < profiles.jsonl
   jq -r '.data.nickname // ""' profiles.jsonl | grep -vcE '^[a-z0-9]{3,15}$'
   jq -r '.data.nickname // ""' profiles.jsonl \
     | iconv -f utf-8 -t ascii//TRANSLIT | tr 'A-Z' 'a-z' | tr -cd 'a-z0-9\n' \
     | sort | uniq -d | wc -l
   ```

   The third figure approximates the lookalike groups. The first sizes the scan measurement.

2. **How close is the availability scan to the instruction cap today?** If it is already near, the measurement of this spec becomes a gate, and an index of handle keys in the satellite moves from "out of scope" to a prerequisite.
3. **When is the next import run planned?** R2's rollout forbids a run between its apply and the merge of this spec.
4. **Does the import's `created_at` fallback (the run time, when the satellite document has no creation time) affect any real row?** It decides whether "created first" is reliable for legacy accounts (R2 open question 2).

## Pending decisions

1. **Whether handles are also renamed inside vici.market.**
   - Recommended: no. vici.market only applies the rule to handles that are changed from now on; existing ones stay as they are there and are adjusted when the account is moved to vici.app. Rewriting every stored profile on the legacy system re-triggers its reward and league bookkeeping for each account and can make open browsers fail their next save, for a system that is being retired.
   - Alternative A: rename there too, with a one-off admin operation that walks all profiles in pages. People see the same handle on both sites before the move; it needs its own safeguards against the side effects above and its own dry run.
   - Alternative B: leave vici.market completely alone, including changed handles. Zero legacy work, but a legacy user can still pick a fresh handle with dots or accents that will be renamed weeks later.
2. **Whether vici.market warns affected users before the move.**
   - Recommended: yes, one line in the existing "VICI is moving" notice for accounts whose handle is outside the rule, with a shortcut to pick a compliant handle themselves (free of the 30-day wait when it is only a tidy-up of their own handle).
   - Alternative A: no warning; the notice on vici.app at first sign-in is enough.
   - Alternative B: a warning that shows the exact handle they will get. Clearer, but the exact handle is only known at import, so it would be a promise the system may not keep.
3. **When a legacy handle and a vici.app handle are lookalikes, who keeps it.** This is R2 pending decision 2 seen from the import: the recommendation there (an account that already holds the exact compliant handle keeps it, otherwise the account created first) means a recent vici.app account with `antonioventilii` beats an older legacy `antonio.ventilii`. The alternative "oldest account always wins" would have the import rename a person who already uses vici.app, and would reverse the authoring decision below that an import never displaces an existing vici.app handle. Decide it once, in R2; it is repeated here because the import is where it bites.

## Decisions

Taken while authoring, open to challenge in review:

- **Feasibility on the satellite.** Applying the rule to changed handles is cheap: it swaps the fold inside a scan that already exists and touches no stored data. A stored-data rename is technically possible (an admin `defineUpdate` paging the collection) but costly and risky for the reasons in pending decision 1, so the recommended path renames at import only.
- **The `reason` enum is not extended.** Over-length and reserved answer `invalid`, which keeps the Candid surface and both declaration trees unchanged.
- **The import never displaces an existing vici.app handle**, whatever the collision order decided in R2, so a re-run can never rename a person who already uses the app.
- **The import reads `handle_renames` before deriving**, which is what makes the rename stable across the bulk run, the final run and any re-run.
