# Spec: One handle rule and no lookalike handles

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Draft

One scoped PR cannot hold this work, so it is split into three specs. Each has its own status and its own PR, and they are stacked in this order:

| Part   | Spec                                                                                                                         | PR title                                                           | Builds on                                                                         |
| ------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| **R1** | this file: the rule and the lookalike key for every handle that is created or changed on vici.app                            | `feat(profile): one handle rule and no lookalike handles`          | the public handle check PR (`src/lib/utils/nickname.utils.ts`), not on `main` yet |
| R2     | [`2026-11-27-impr-handle-rename-existing.md`](./2026-11-27-impr-handle-rename-existing.md)                                   | `feat(profile): rename existing handles to the handle rule`        | R1                                                                                |
| R3     | [`2026-11-27-impr-handle-rule-legacy-satellite-and-import.md`](./2026-11-27-impr-handle-rule-legacy-satellite-and-import.md) | `feat(satellite): handle rule on the legacy app and in the import` | R1 and R2 (the rename planner)                                                    |

The rollout order across the three parts, and the one ordering constraint that matters (no legacy import between the R2 apply and R3), is in R2 "Rollout".

## Goal

A handle picked or changed anywhere on vici.app is lowercase `a` to `z` and `0` to `9` only, 3 to 15 characters. A handle reads as "already taken" when another account holds the same letters and digits once case, accents and the separators `.`, `_`, `-` are ignored, so `antonio.ventilii`, `antonio_ventilii`, `Antonioventilii` and `antonioventílii` can never coexist with a newly picked `antonioventilii`. Accounts that already hold a handle outside the rule keep it untouched until R2 renames them.

## Context

**Two rules exist today, on one field.** The handle is `profiles.nickname`.

- `src/lib/constants/profile.constants.ts` holds the nickname rule: `MIN_NICKNAME_LENGTH` 2, `MAX_NICKNAME_LENGTH` 16, `NICKNAME_PATTERN` (letters of any language, combining marks, digits, `.`, `_`, `-`), `sanitizeNickname`, and `nicknameUniqueKey` (trim, NFKD, strip combining marks, lowercase; separators kept, so `a_b` and `ab` are different handles today).
- The same file holds the stricter handle editor rule: `MIN_HANDLE_LENGTH` 3, `MAX_HANDLE_LENGTH` 15, `cleanHandle` (letters of any language, digits, `_`; case and accents kept).
- `src/lib/components/onboarding/Onboarding.svelte` validates with the nickname rule; `src/lib/components/profile/HandleEditor.svelte` with the handle editor rule. A handle legal at sign-up can be illegal in the editor.
- `RESERVED_HANDLES` (same file) is checked by those two components only. The API does not know the list, so a request that bypasses the app can take `admin`.
- `HANDLE_COOLDOWN_DAYS` (30) and `handleCooldownDaysLeft`: one change per window, enforced by the server from `handle_last_change_ms`. A write whose key equals the stored key is not a change (no cooldown, the stamp must not move).

**The API is the authority on vici.app.** `backend/src/profiles/nickname.ts` mirrors the bounds, the pattern and the key, and `checkNicknameAvailability` answers `required`, `too_short`, `too_long`, `invalid` or `taken` from `profiles.nickname_key`. `backend/src/profiles/profile-write.ts` (`assertValidNickname`) runs it on every full-document profile upsert, with a grandfather clause: an unchanged stored handle that is too long or out of charset still saves. `nickname_key` carries a partial unique index, `profiles_nickname_key_uniq` (`backend/src/db/migrations/0004_profiles_social.sql`). The mirrors are pinned by `backend/tests/shared-drift/domain-limits.test.ts`.

**Other places a handle is produced or matched.**

- The sign-in bootstrap in `src/lib/services/profile.services.ts` seeds a handle for an account that arrives without one: the sanitised display name, or the raw principal when nothing usable is left. A principal is far longer than 15 characters and carries hyphens.
- The onboarding stash (`PENDING_ONBOARDING_STORAGE_KEY`, drained by `src/lib/services/onboarding-handoff.services.ts`) can hold a handle picked before this change ships.
- Add friend by `@handle`: `resolveTargetUserId` in `src/lib/services/relation.services.ts` runs the profile search and keeps the result whose lowercased nickname equals the typed text exactly.
- `src/lib/constants/handle-pool.constants.ts` (`HANDLE_POOL`, 139 suggestions): every entry already satisfies the rule; only its doc comment still describes the wider charset.
- The public handle check PR (branch `claude/landing-xgugio-public-handle-check`) adds `nicknameFormatIssue` in `src/lib/utils/nickname.utils.ts`, the one format check shared by onboarding and the landing claim capsule, plus the anonymous probe route. It applies the nickname rule.
- The waitlist specs (branch `claude/landing-xgugio-waitlist-spec`, `2026-11-27-feat-handle-waitlist.md`) store `handle` and `handle_key` per reservation with `nicknameUniqueKey`, and plan to move the reserved list to the API as `RESERVED_NICKNAME_KEYS`.

**The legacy app shares this code.** vici.market is the same app built against the Juno satellite. Its server-side rule is the `profiles` assertion in `src/satellite/services/profile.services.ts`, which imports the nickname constants. R1 leaves those constants and the assertion untouched; R3 changes them.

## Scope

### 1. The rule and the key (app)

`src/lib/constants/profile.constants.ts`:

- `HANDLE_PATTERN`: lowercase `a` to `z` and digits only. Length bounds stay `MIN_HANDLE_LENGTH` and `MAX_HANDLE_LENGTH`.
- `handleUniqueKey(raw)`: trim, NFKD, lowercase, replace the Latin letters that have no decomposition by their plain spelling (pending decision 3), then drop every character outside `a` to `z` and `0` to `9`. For a handle that satisfies the rule the key is the handle itself. A handle written entirely in another script folds to an empty key, which never collides.
- `cleanHandle(raw)` becomes the input cleaner for the rule: the same fold, clamped to `MAX_HANDLE_LENGTH`. Typing `José.M` yields `josem` (pending decision 1).
- `sanitizeNickname`, `NICKNAME_PATTERN`, `MIN_NICKNAME_LENGTH`, `MAX_NICKNAME_LENGTH` and `nicknameUniqueKey` stay, used only by the satellite until R3, and their doc comments say so.

`src/lib/utils/nickname.utils.ts` (`nicknameFormatIssue`, from the public handle check PR): bounds and pattern move to the rule, the reserved test moves to `handleUniqueKey`. Onboarding, the handle editor and the landing claim capsule all read this one function, so the three surfaces cannot disagree.

### 2. Surfaces

- `Onboarding.svelte` and `HandleEditor.svelte`: `cleanHandle` on input, `nicknameFormatIssue` for the inline reason, `maxlength` from `MAX_HANDLE_LENGTH`. The editor's "unchanged" test compares the cleaned input with the stored handle, so an owner whose stored handle is `José` can save `jose`.
- Copy: `profile.handle.hint` and every onboarding line that names the allowed characters, in every catalog under `src/lib/constants/messages/`.
- The onboarding stash: `drainPendingOnboarding` runs the stashed handle through `cleanHandle` before the availability probe, so a handle picked under the wider rule is tidied, not dropped.
- The sign-in bootstrap: the seed is `cleanHandle` of the display name; when it is shorter than `MIN_HANDLE_LENGTH`, reserved or taken, the seed is a generated handle (pending decision 5). The principal is never used as a handle.
- `handle-pool.constants.ts`: doc comment only.

### 3. The API

- `backend/src/profiles/nickname.ts`: `MIN_HANDLE_LENGTH`, `MAX_HANDLE_LENGTH`, `HANDLE_PATTERN`, `handleUniqueKey`, mirrored from the app and pinned by the drift suite. `checkNicknameAvailability` validates against the rule and answers `taken` when another profile's `handle_key` equals the candidate's key. It gains the `reserved` reason from `RESERVED_HANDLE_KEYS` (the mirror of `RESERVED_HANDLES`; if the waitlist PR landed first this is its `RESERVED_NICKNAME_KEYS`, renamed).
- `backend/src/profiles/profile-write.ts`: a write is checked against the rule unless the proposed handle is the stored string, character for character. That is the whole grandfather clause: an untouched handle outside the rule keeps saving (every stats sync upserts the full profile), anything else must satisfy the rule. The cooldown keeps comparing keys, now with `handleUniqueKey`: an owner who tidies their own handle (`José` to `jose`, `a.b` to `ab` when `ab` is free) changes the stored string without a key change, so it costs no cooldown (pending decision 2).
- New column `profiles.handle_key text not null default ''` with a plain index, written by `upsertMyProfile` next to `nickname_key`. The migration fills it for existing rows with a SQL function `handle_fold(text)` defined in the same file; a parity test pins that function against `handleUniqueKey` over a fixture table that includes every mapped letter. `nickname_key` and its unique index stay as they are: two existing lookalikes (`a.b` and `ab`) share one `handle_key`, so that column cannot be unique before R2.
- Concurrency: `handle_key` is not unique before R2, so the lookup alone does not serialise two writers. Every write that changes a handle first takes `pg_advisory_xact_lock(hashtext('handle:' || new_handle_key))` inside its transaction, then runs the `handle_key` lookup, then writes; a second writer of the same key waits for the first commit and then sees its row. The lock is the one R2's apply and the waitlist reservation share, so the three paths serialise on the same key. Two writers of the same compliant handle also still collide on `profiles_nickname_key_uniq`, as a backstop.
- `GET /api/v1/profiles/nickname-availability` and the anonymous probe of the public handle check PR answer through the same validator. The new `reserved` reason is a wire change for the typed layers: the web2 client's availability type in `src/lib/web2/client.ts`, the shared `NicknameAvailability` union and its reason-to-copy mapper on the app, and the satellite-facing union (which also lacks `too_long` today: the web3 path maps both to its existing `invalid`). Each gets the new members, and the mapper an exhaustive case with its own copy line.

### 4. Add friend by handle

Filtering the search results by key is not enough: `resolveTargetUserId` (web2) gets its candidates from `searchProfilesWeb2`, whose SQL (`backend/src/profiles/profile.ts`) matches `lower(p.nickname) like '%query%'` on the stored text, so typing `antonioventilii` never returns a stored `antonio.ventilii` for any later comparison to see.

So R1 adds a dedicated lookup, `GET /api/v1/profiles/by-handle?handle=` (signed in, `PUBLICLY_VISIBLE_PROFILE_SQL` as the search uses): the profile whose stored handle equals the text, otherwise the profile whose `handle_key` equals `handleUniqueKey` of the text. `handle_key` is not unique before R2, so when two stored lookalikes share the key the answer is deterministic: the one whose handle is compliant, then the earliest created. An empty key answers `404`. The web2 client gets `profileByHandle`, and `resolveTargetUserId` calls it in place of search-and-filter, so `@Antonio.Ventilii` finds `antonioventilii` and `@antonioventilii` finds `antonio.ventilii`. The raw account id fallback stays. R2 extends the same route with previous handles. The satellite path (`resolveTargetPrincipal`) keeps its lowercase match until R3.

### Out of scope

- Renaming handles that already exist, old handles that keep resolving, the notice to renamed users: R2.
- The satellite assertion, the legacy import, vici.market copy: R3.
- Dropping `nickname_key`, `handle_fold`, the legacy nickname constants and the grandfather clause once every handle satisfies the rule: a cleanup chore after the cutover.
- The waitlist tables. If the waitlist PR lands after R1 it uses `HANDLE_PATTERN` and `handleUniqueKey` from the start; if it lands before, R1 switches its validator in the same change as section 3 and R2 covers its stored rows.
- Display names. There is no separate display name: the handle is the only public name, and this spec does not add one.

## Linked issues

Open issues were searched on 27 Nov 2026 (six open: #1176, #1142, #1091, #1034, #759, #543). None covers handle rules or lookalike handles. No closing keyword.

## Analytics

No new event. `handle_checked` (already fired by onboarding with `source` and `ok`) gains the refusal reason in its existing bounded `label` prop when `ok` is false: `too_short`, `too_long`, `invalid`, `reserved`, `taken`. That is what shows whether the stricter rule costs sign-ups. The handle text is never sent. The landing capsule's own events belong to the landing analytics PR and reuse the same vocabulary.

## Technical requirements (satellite / backend: mandatory)

- **Performance.** One more indexed `exists` on `profiles.handle_key` per availability probe and per handle-setting write; the add-friend lookup is one or two indexed lookups in place of a `like` scan. The fold is a few string passes over at most 16 characters.
- **Memory and storage.** One text column and one b-tree index on `profiles`: about 40 bytes a row, so about 4 MB at 100,000 profiles.
- **Scalability.** Index lookups only; unchanged at 10 and 100 times the current profile count. The migration's backfill is a single `update` over `profiles`; at 100,000 rows it runs in seconds inside the release transaction.
- **Upgrade and compatibility.** One forward-only migration (`backend/src/db/migrations/NNNN_profiles_handle_key.sql`, the next free number at implementation time): `add column if not exists`, `create or replace function`, the backfill, `create index if not exists`. The previous release keeps working: it ignores the column, and a row it writes during the deploy window gets its `handle_key` from a `before insert or update of nickname` trigger that calls `handle_fold` (the pattern of `0021_battle_amount.sql`); the trigger goes away with the cleanup chore. No satellite change, no `.did` regeneration. Not breaking for stored data; breaking for a client that submits a handle outside the rule, which is the intent.
- **Security.** The reserved list becomes server-enforced. One new signed-in read route (`by-handle`), behind the same visibility filter as the profile search, so it exposes nothing the search does not; no change of caller permissions.
- **Parameters.** Bounds, pattern, reserved list and cooldown live in `src/lib/constants/profile.constants.ts`, mirrored in `backend/src/profiles/nickname.ts`.

## Implementation outline

1. Constants and key in `profile.constants.ts`; `nicknameFormatIssue` switched; unit specs under `src/tests/lib/`.
2. `Onboarding.svelte`, `HandleEditor.svelte`, the landing claim capsule (through the shared check), the stash drain, the bootstrap seed, i18n catalogs.
3. Migration, `handle_fold`, trigger, backfill; `nickname.ts` and `profile-write.ts`; drift suite entries (`domain-limits.test.ts`: bounds, pattern, reserved keys, the letter table).
4. `GET /api/v1/profiles/by-handle` in `backend/src/routes/profiles.ts` (query in `backend/src/profiles/profile.ts`), `profileByHandle` in `src/lib/web2/client.ts`, `resolveTargetUserId` switched to it.
5. Docs in the same PR: `PRODUCT.md` (a "Handles: one rule" entry; "Onboarding: one screen" and "Friends: adding" updated), `docs/ai/frontend/reusability.md` (`cleanHandle`, `handleUniqueKey`, `nicknameFormatIssue`), `backend/README.md` "Mirrored constants".

## Tests

- `src/tests/lib/constants/profile.constants.spec.ts`: the key folds the four lookalikes of the Goal to one value; the mapped letters; other scripts fold to empty; `cleanHandle` output always satisfies `HANDLE_PATTERN` or is shorter than the minimum.
- `backend/tests/profile-guards.test.ts`: a new handle with an uppercase letter, an accent, a separator, 2 or 16 characters is refused; a compliant handle is refused as `taken` against a stored `a.b`, `A_B`, `áb`; a stored handle outside the rule still saves unchanged; tidying one's own handle saves inside the cooldown window without moving the stamp; a reserved handle is refused by a direct API call.
- `backend/tests/profiles-by-handle.test.ts`: `antonioventilii` finds a stored `antonio.ventilii` and the reverse; two stored lookalikes resolve to the same account on every call; hidden accounts stay hidden; an empty key is `404`.
- `backend/tests/handle-fold-parity.test.ts`: `handle_fold` in Postgres equals `handleUniqueKey` for every fixture.
- Migration check on a database that already holds rows from earlier runs, including two rows that share a `handle_key`.
- E2E (`e2e-web2`): onboarding refuses `Antonio.V` as typed by cleaning it live, a second browser sees the cleaned handle as taken.

## Acceptance criteria

- [ ] Onboarding, the handle editor, the landing claim capsule and the API accept exactly the same handles: lowercase `a` to `z` and digits, 3 to 15 characters.
- [ ] With `antonio.ventilii` stored, a write or a probe for `antonioventilii`, `Antonioventilii` or `antonioventílii` answers `taken`.
- [ ] A direct API write of `admin` is refused.
- [ ] An account holding a handle outside the rule can still save its profile, and can tidy its own handle without spending its change allowance.
- [ ] No account is seeded with a principal as its handle.
- [ ] `npm run quality`, `npm run check`, `npm test`, backend `bun test` (drift and parity suites included) pass.

## Open questions

1. **How many production handles break the rule, and how many lookalike groups exist?** The counting SQL is in R2 "Open questions"; run it before R1 merges, since a large number changes how urgent R2 is.
2. **Does production Postgres support `normalize(text, NFKD)`?** It needs version 13 or later and a UTF-8 database. Local and CI run `postgres:16-alpine` (`backend/docker-compose.yml`); confirm the production version (`select version(), getdatabaseencoding();`). If not, the backfill runs from a script and `handle_fold` is dropped from the design.
3. **Has the waitlist PR merged when R1 starts?** It decides which side renames the reserved-keys constant and whether section 3 touches the waitlist validator.

## Pending decisions

1. **What the handle field does while someone types a character that is not allowed.**
   - Recommended: clean it as they type. Capital letters become lowercase, accents drop to the base letter, dots, dashes and other symbols disappear, and a short line under the field says "Lowercase letters and numbers". This is how both fields already behave today for spaces and symbols.
   - Alternative A: leave the text as typed and show an error until the person fixes it. Clearer about why, slower to get through.
   - Alternative B: clean capitals and accents silently, but show an error for dots, dashes and underscores, since removing them changes how the handle reads.
2. **Whether fixing your own handle to the new rule uses up your one change every 30 days.**
   - Recommended: no. Going from `José` to `jose` or from `a.b` to `ab` (when free) is the same handle under the lookalike test, so it is free and does not start the 30 days.
   - Alternative: treat it like any other change. Simpler to explain, but it punishes people who tidy their handle before the automatic rename of R2.
3. **Letters that look like a plain letter but have no accent to strip (`ß`, `ø`, `æ`, `œ`, `ł`, `đ`, `ð`, `þ`, `ı`).**
   - Recommended: a short fixed table treats them as their usual plain spelling for the "already taken" test: `ß` as `ss`, `æ` as `ae`, `œ` as `oe`, `ø` as `o`, `ł` as `l`, `đ` and `ð` as `d`, `þ` as `th`, `ı` as `i`. So an existing `strøm` blocks a new `strom`.
   - Alternative: ignore them (an existing `strøm` and a new `strom` could coexist until R2 renames the first). Less code, a small window for lookalikes.
4. **Which handles are reserved for VICI.** Today: `admin`, `vici`, `root`, `support`, `help`, `mod`, `official`, `team`, `api`, `www`, checked by the app only.
   - Recommended: enforce the list on the server and add the obvious impersonation names: `viciapp`, `vicimarket`, `viciteam`, `vicisupport`, `viciadmin`, `viciofficial`, `moderator`, `staff`, `security`, `system`, `everyone`. Exact match only.
   - Alternative A: enforce the current ten on the server and add nothing.
   - Alternative B: also refuse every handle that starts with `vici`. Stronger against impersonation, but it refuses ordinary words such as `vicious`.
5. **The handle given to an account that signs in without having picked one** (it arrives through the sign-in screen, and its display name gives nothing usable or the result is taken).
   - Recommended: a name from the existing Roman suggestion list plus digits, for example `seneca42`, which the person can change at once (a first handle has no 30-day wait).
   - Alternative A: `user` plus digits. Neutral, off-brand.
   - Alternative B: send the person to the handle screen before anything else. No generated handles, one more step before the app.

## Decisions

Fixed by the owner before this spec:

- Every handle created or changed is lowercase `a` to `z` and `0` to `9`, 3 to 15 characters. No accents, no other scripts, no `.`, `_`, `-`.
- The "already taken" test ignores case, accents and the separators `.`, `_`, `-`.
- Existing handles outside the rule are renamed by a migration (R2), not grandfathered forever.

Taken while authoring, open to challenge in review:

- **A second key column, not a rewrite of `nickname_key`.** Rewriting `nickname_key` with the new fold would break its unique index wherever two existing handles are lookalikes. `handle_key` detects lookalikes now; uniqueness keeps resting on the existing index, which is enough because a compliant handle has identical keys under both folds. Once R2 has run, every stored handle is compliant and `handle_key` is redundant; the cleanup chore removes it.
- **The backfill is SQL, pinned by a parity test.** A script-run backfill would leave a window after deploy in which the lookalike test sees an empty column. The cost is one SQL copy of the fold, held to the TypeScript one by a test.
- **The legacy nickname constants stay until R3.** The satellite imports them; changing them here would change the satellite's rule in a PR that does not touch or test the satellite.
