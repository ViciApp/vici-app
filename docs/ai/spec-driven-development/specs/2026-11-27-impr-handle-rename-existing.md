# Spec: Rename existing handles to the handle rule

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Draft

Part R2 of three. The split table and the rule itself are in [`2026-11-27-impr-handle-rule-and-lookalikes.md`](./2026-11-27-impr-handle-rule-and-lookalikes.md) (R1). PR title: `feat(profile): rename existing handles to the handle rule`. Builds on R1.

## Goal

Every handle stored on vici.app satisfies the rule of R1. An account whose handle did not is renamed to the closest compliant handle (`antonio.ventilii` becomes `antonioventilii`, `José` becomes `jose`); when two accounts would land on the same handle, one keeps it and the other gets a variant. The owner reads a report of every rename and every collision before anything is written. A renamed person is told, can change the result once without waiting, and friends who still type the previous handle still find them.

## Context

- **Where handles live.** Only in `profiles.nickname` (with `nickname_key`, and `handle_key` from R1). Every other table refers to the account by `user_id`. The API ranks, lists friends and renders the inbox by joining `profiles` at read time (`backend/src/profiles/leaderboard.ts`, `backend/src/profiles/profile.ts`, `src/lib/stores/inbox.store.ts`), so no server-side copy of a handle goes stale.
- **Who is in `profiles` today.** Accounts created on vici.app, and one provisional `claim_pending` account per legacy principal written by the import (`backend/scripts/etl/transforms.ts`, `importProfiles`), adopted at first sign-in (`backend/src/auth/adoption.ts`). Soft-deleted and hibernated accounts keep their row and their handle (`deleted_at_ms`, `hibernated_at_ms`).
- **Rows with a handle but no key.** When an imported handle folds to a key that is already held, the import keeps the text and stores an empty `nickname_key` (warning "imported without a reserved handle"). Two accounts then show the same handle. These rows are in scope.
- **Handles that cannot survive cleaning.** The minimum was 2 characters and the maximum 16; the satellite assertion checks no maximum at all, and the legacy sign-in bootstrap seeded the raw principal (63 characters with hyphens) when the display name gave nothing usable. Handles written in non-Latin scripts were legal.
- **Reserved handles** were only refused by the app (R1 moves the check to the API), so a stored `admin` or `Support` is possible.
- **Cooldown.** `handle_last_change_ms` and `HANDLE_COOLDOWN_DAYS`, enforced in `assertValidNickname` (`backend/src/profiles/profile-write.ts`). The app's `HandleEditor.svelte` mirrors it from the profile.
- **Profile writes are full documents.** The app upserts the whole profile, handle included, on every stats sync. A browser that loaded the profile before the rename will send the previous handle back.
- **Links.** No route carries a handle: invite, league and referral links are code based (`src/routes/i/[code]`, `src/routes/join/[code]`, `src/routes/league/[code]`, `?ref=`). `SharePopover.svelte` falls back to the handle as the `?ref=` token while the referral code loads. Shared card images are rendered with the handle of the moment.
- **Email.** `backend/src/lib/email.ts` sends one-time codes only (`sendOtpEmail`); `profiles.email` and `auth_identities` hold addresses.
- **Migrations** are forward-only SQL run at release (`docs/ai/backend/workflows/new-migration.md`). They cannot print a report and wait for a yes, so the rename itself is an operator-run script, as the import scripts are.
- **Waitlist.** If `waitlist_reservations` exists (see `2026-11-27-feat-handle-waitlist.md`), its `handle` / `handle_key` columns hold handles under the wider rule too.

## Scope

### 1. How a handle is cleaned

One pure function, `compliantHandleFor(previous)`, in `backend/src/profiles/handle-rename.ts`, returns a base and a reason:

1. Fold with `handleUniqueKey` (R1): lowercase, accents to base letters, the mapped letters to their plain spelling, everything else dropped (separators, symbols, characters of other scripts).
2. Base equal to a reserved key: a generated handle unless the account is on the team allowlist (pending decision 7). Reason `reserved`. This test comes before every length rule: every reserved key is 3 to 15 characters, so checked later it would be accepted as `format`.
3. Base of 3 to 15 characters: that is the candidate. Reason `format`.
4. Base longer than 15: the first 15 characters. Reason `too_long`. A previous handle shaped like a principal or an account id is treated as "never picked one" and gets a generated handle (pending decision 5).
5. Base of 2 characters: digits are appended (pending decision 4). Reason `too_short`.
6. Base of 0 or 1 character (a handle in another script, or made of symbols): a generated handle (pending decisions 1 and 6). Reason `no_latin`.

A candidate produced by rules 4 and 5 (cut or extended) is tested against the reserved keys again and, when it is one, goes to rule 2. Section 2 never assigns a reserved key either.

A handle that already satisfies the rule and is not reserved is never touched.

### 2. Collisions

`planHandleRenames(rows)` in the same file is pure and deterministic: the same rows always give the same plan.

- One account per key keeps its current handle when that handle is compliant and not reserved. Its key is taken before anything else is assigned. When several rows hold the same compliant handle (imported duplicates, stored with an empty `nickname_key`, see Context), only one of them is preserved, chosen by the order of pending decision 2; every other row of that handle goes through the collision rule below with the handle as its candidate, reason `collision`. A compliant but reserved handle (`admin`) is not preserved: it follows rule 2 of section 1.
- The remaining accounts are grouped by candidate. In each group the winner takes the candidate if it is free; the order is pending decision 2.
- Every other member of the group gets the candidate plus the smallest free number, starting at 2, the base cut so the result stays within 15 characters: `antonioventilii` (15) becomes `antonioventili2` (pending decision 3). Reason `collision`.
- "Free" means: not the key of any profile that keeps its handle (a row being renamed in this plan releases its own key first, so `a.b` can receive `ab`), not a reserved key, not already assigned in this plan, and not the confirmed or pending handle of a waitlist reservation.
- Waitlist reservations, when the table exists, are planned in the same pass and always rank after profiles (an account beats a reservation).

### 3. Storage

Migration `backend/src/db/migrations/NNNN_handle_renames.sql`:

| Column                            | Holds                                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `user_id uuid`                    | primary key, `references users (id) on delete cascade`                                                     |
| `previous_handle text`            | the handle before the rename, as stored                                                                    |
| `previous_key text`               | its `nicknameUniqueKey` (case and accents folded, separators kept), also for imported rows that had no key |
| `assigned_handle text`            | the handle the plan gave                                                                                   |
| `reason text`                     | `format`, `collision`, `too_short`, `too_long`, `no_latin`, `reserved` (a `check` constraint)              |
| `batch_id text`                   | the apply run that wrote the row                                                                           |
| `renamed_at timestamptz`          | when                                                                                                       |
| `notice_seen_at timestamptz`      | when the person dismissed the notice                                                                       |
| `free_change_used_at timestamptz` | when the free change was spent                                                                             |
| `email_sent_at timestamptz`       | when the email went out                                                                                    |
| `reverted_at timestamptz`         | set by a rollback                                                                                          |

Index on `previous_key where previous_key <> ''`. One row per account: an account is force-renamed at most once per previous handle, and the import of R3 updates the row in place when a legacy handle changed in between.

`previous_key` is unique for rows that had a key, because it comes from the column that carries `profiles_nickname_key_uniq`; it is the redirect key of section 6. Imported duplicates have no key (they were stored with an empty `nickname_key`), so their previous handle is ambiguous by construction: for them the row also stores `previous_key` as `nicknameUniqueKey(previous_handle)`, and section 6 resolves an old handle shared by several renamed rows deterministically to the earliest-created account among them, never to an unrelated clean winner through `handle_key`. The acceptance test covers both cases.

### 4. The script: report first, then apply

`backend/scripts/handles/rename-existing.ts`, exposed as `bun run handles:rename`:

- **Dry run (the default).** Reads `profiles` (and reservations), computes the plan, writes nothing to the database. Outputs `renames.csv` (user id, account kind `native` / `provisional`, created at, last active day, predictions count, deleted or hibernated flag, previous handle, assigned handle, reason, whether a notice and an email would go out), `collisions.csv` (one line per group: candidate, every member with the same facts, the winner and why), and a printed summary: totals by reason, group count and largest group, the 50 most active renamed accounts, every account that loses a handle it shares with nobody (cut or generated). It also prints a plan hash (SHA-256 of the sorted plan).
- **Apply.** `--apply --batch <id> --expect-plan <hash>`. Recomputes the plan inside one transaction under an advisory lock that the profile write guard also takes for a handle change, and aborts when the hash differs from the reviewed one (somebody registered or changed a handle since the report). Then, in the same transaction: empties `nickname_key` for every affected row, writes `nickname`, `nickname_key` and `handle_key` from the plan, inserts the `handle_renames` rows, renames the reservations. The two-step write avoids a transient unique violation when one account takes a key another is leaving. `handle_last_change_ms` is not touched.
- **Idempotent.** A second apply finds nothing left to rename. Running it after a legacy import that restored previous handles (see Rollout) re-applies the recorded assignments, not a fresh plan.
- **Emails.** `--send-emails --batch <id>`, a separate step after the apply has been checked, one message per row whose `email_sent_at` is null and whose reason calls for an email (pending decision 9).
- **Revert.** `--revert --batch <id>`: for every row of the batch whose profile still holds `assigned_handle`, restores `previous_handle` and the keys and stamps `reverted_at`. An account that has since picked a handle itself is left alone and listed.

### 5. The write guard after a rename

`assertValidNickname` (`backend/src/profiles/profile-write.ts`), for a caller that has a live `handle_renames` row:

- **A stale browser cannot undo the rename.** When the proposed handle equals `previous_handle`, or folds to `previous_key`, the write is treated as "handle unchanged": the rest of the profile saves and the stored handle is kept. Skipping validation is not enough, because `upsertMyProfile` writes `proposed.nickname` (and its keys) into the row whatever the guard decided. So `assertValidNickname` returns the canonical nickname for the write: the stored `assigned_handle` in this case, the proposed one otherwise. `upsertMyProfile` binds that value, and derives `nickname_key` and `handle_key` from it, in place of `proposed.nickname`; the response carries it, so the browser's store picks up the assigned handle. Without this, the full-document upsert of a browser that loaded the profile before the rename would either fail on every stats sync (suffix and generated cases) or put the previous handle back (same-key cases).
- **The forced rename costs no change allowance.** The script leaves `handle_last_change_ms` alone, so somebody who changed their handle 10 days ago still has 20 days to wait, not 30 more.
- **One free change** (pending decision 8). While `free_change_used_at` is null, a handle change is allowed inside the cooldown window; the guard stamps `free_change_used_at` in the same transaction.

### 6. Previous handles keep resolving

`GET /api/v1/profiles/by-handle?handle=`, introduced by R1 (section 4 there) with the `handle_key` lookup only, gains the previous handles here. Signed in, the visibility filter of the profile search: if the text satisfies the rule, the profile with that handle; otherwise the account whose `previous_key` equals `nicknameUniqueKey` of the text; otherwise the profile whose `handle_key` equals its `handleUniqueKey`. The answer carries `renamedFrom` when the match came through `handle_renames`. `resolveTargetUserId` (`src/lib/services/relation.services.ts`) already calls it since R1, and the add-friend sheet (`src/lib/components/arena/AddFriendSheet.svelte`) shows one line, "@antonio.ventilii is now @antonioventilii", before sending the request (pending decisions 10 and 11).

The order matters: `a.b` typed by a friend must reach the account that was `a.b` (now perhaps `ab2`), not the account that won `ab`.

### 7. Telling people

- **In the app.** `GET /api/v1/profiles/handle-rename` answers the caller's live row (`previousHandle`, `handle`, `reason`, `freeChangeAvailable`) or `204`; `POST /api/v1/profiles/handle-rename/seen` stamps `notice_seen_at`. A separate route, not a profile field: the profile schema (`src/lib/schema/profile.schema.ts`) is shared with the satellite, and a new field there would force a satellite rebuild for a web2-only notice. `HandleRenameNotice.svelte` (`src/lib/components/profile/`, a `BottomSheet`, web2 builds only) opens once after sign-in: "Your handle is now @antonioventilii. It was @antonio.ventilii. Handles are lowercase letters and numbers now.", with `Keep it` and `Change it` (opens `HandleEditor`, which reads `freeChangeAvailable` to stay enabled inside the cooldown window). Copy under `profile.handle.renamed.*` in every catalog.
- **By email** (pending decision 9): `sendHandleRenamedEmail` in `backend/src/lib/email.ts`, previous and assigned handle, the reason in one sentence, a link to the app.
- **Legacy accounts not yet moved** see the notice at their first sign-in on vici.app; R3 covers what vici.market says before that.

### 8. What changes for everything that shows or stores a handle

| Surface                                                  | Effect                                                                                                                     | Handling                                                        |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Profile pages and URLs                                   | none: no route carries a handle                                                                                            | nothing to redirect                                             |
| Invite, league and referral links                        | none: code based                                                                                                           | none                                                            |
| `?ref=` share links that carry the handle fallback       | the fallback already strips everything but letters and digits; whether it resolves to an account at all is open question 4 | none unless the answer is yes                                   |
| Add friend by `@handle`                                  | the previous handle no longer matches the profile search                                                                   | section 6                                                       |
| `@handle` in inbox cards, friend lists, feeds, standings | rendered from the live profile, so they show the assigned handle on next load                                              | none                                                            |
| Mentions                                                 | there is no mention feature and no stored text that embeds a handle (chats and comments are dormant and not imported)      | none                                                            |
| Leaderboards, league and Worlds standings                | the API ranks on request and joins `profiles`; no cached copy of a handle                                                  | none                                                            |
| Browser caches (`profiles.store`, `user.store`, loaders) | show the previous handle until the next fetch; the user's own profile write is covered by section 5                        | none                                                            |
| Share card images already sent                           | keep the previous handle forever                                                                                           | accepted                                                        |
| Account deletion ("Type your handle to confirm")         | the assigned handle is the one to type                                                                                     | the notice names it                                             |
| Analytics                                                | events carry a pseudonymous account link and never a handle; warehouse joins are on the account id                         | none                                                            |
| Admin search by handle                                   | previous handle no longer found by substring                                                                               | the admin search also looks at `handle_renames.previous_handle` |
| Support mail quoting a previous handle                   | not found by handle                                                                                                        | same admin search                                               |

### Out of scope

- The rule for new and changed handles: R1. The satellite, vici.market and the import: R3.
- A public "formerly @x" line on profiles (pending decision 11 recommends against it).
- Renaming accounts with an empty handle. They have nothing to clean; they pick a handle the next time they pass through the handle screen. They are counted in the report.
- Merging duplicate accounts of one person (`legacy_adoption_conflicts`): unchanged.
- Dropping `nickname_key`, `handle_key`, `handle_fold` and the grandfather clause: the cleanup chore after the cutover.

## Linked issues

Open issues were searched on 27 Nov 2026 (six open). None is related. No closing keyword.

## Analytics

- `handle_renamed` (new, server event through `captureServerEvents`, added to `SERVER_ANALYTICS_EVENT_NAMES`, the TS union in `src/lib/types/analytics-event.ts` and the Zod mirror in `src/lib/schema/analytics-event.schema.ts`): one per renamed account at apply, `label` the reason, `source` `migration`.
- `handle_rename_notice` (new, client): `label` `shown` / `kept` / `change_opened`.
- `handle_changed` is not new work if it exists; if the taxonomy has no event for a successful handle change, add it with `source` `editor` and `ok` true when the free change was used. This is the number that says whether people accept the assigned handle.

No handle text, previous or assigned, is ever sent.

## Technical requirements (satellite / backend: mandatory)

- **Performance.** The plan is one read of `profiles` (handle, keys, dates, counters) and in-memory grouping: linear in the number of profiles. The apply is one transaction with two updates per renamed row. The write guard gains one primary-key lookup on `handle_renames` per profile write (every stats sync); the by-handle route is at most three indexed lookups.
- **Memory and storage.** One `handle_renames` row per renamed account, about 200 bytes with its indexes; 20,000 renamed accounts are about 4 MB. No growth after the apply apart from the legacy import. Rows go away with the account (`on delete cascade`), so a previous handle does not outlive a deletion.
- **Scalability.** At 100,000 profiles the plan holds a few tens of MB in memory and the apply transaction touches at most that many rows; it is run in a quiet hour. At 1,000,000 the apply would be batched by key range; not needed at today's size (open question 1).
- **Upgrade and compatibility.** One forward-only migration (table and index), safe to re-run. No change to an existing column. No satellite change, no `.did` regeneration. Not breaking for clients: section 5 keeps stale browsers saving.
- **Security.** The script runs with the database credentials of an operator, like the import scripts. The two new routes require a session; `by-handle` applies the visibility filter of the profile search and is rate limited like it, so it reveals no account the search would hide. `handle-rename` only ever answers the caller's own row.
- **Parameters.** Rule, reserved list and cooldown: `src/lib/constants/profile.constants.ts` and its mirror `backend/src/profiles/nickname.ts`. The generated-handle list: `src/lib/constants/handle-pool.constants.ts`, mirrored for the backend and pinned by the drift suite.

## Implementation outline

1. Migration `NNNN_handle_renames.sql`.
2. `backend/src/profiles/handle-rename.ts`: `compliantHandleFor`, `planHandleRenames`, `planHash`, `applyHandleRenames`, `revertHandleRenames`; the advisory lock shared with `upsertMyProfile`.
3. `backend/scripts/handles/rename-existing.ts` and the `handles:rename` script entry; a runbook section in `backend/README.md`.
4. Write guard changes in `profile-write.ts`; routes in `backend/src/routes/profiles.ts`; admin search.
5. App: client wrappers in `src/lib/web2/client.ts`, `resolveTargetUserId`, `AddFriendSheet.svelte`, `HandleRenameNotice.svelte`, `HandleEditor.svelte` (free change), i18n catalogs, analytics names.
6. `sendHandleRenamedEmail`.
7. Docs in the same PR: `PRODUCT.md` ("Handles: one rule" gains the rename, the notice, the free change; "Friends: adding" gains previous handles; "Privacy: what survives an account's deletion" notes the row is deleted with the account), `docs/ai/backend/reusability.md`, `docs/ai/frontend/reusability.md`.

## Tests

- `backend/tests/handle-rename-plan.test.ts` (pure): every example of sections 1 and 2; determinism (shuffled input, same plan and hash); a reserved base (`admin`, `Support`) is never accepted as `format`; a compliant handle is never renamed, except all but one of several rows holding the same compliant handle; a suffix never lands on a taken, reserved or planned key; 15-character bases are cut before the number; three-way groups; rows with an empty key.
- `backend/tests/handle-rename-apply.test.ts` (real Postgres, collision-free fixtures): dry run writes nothing; apply with a stale hash aborts; apply renames, keeps `handle_last_change_ms`, fills `handle_renames`; second apply is a no-op; revert restores and skips an account that changed since.
- `backend/tests/profile-guards.test.ts`: a full-document write carrying the previous handle saves, the row still holds the assigned handle and its keys afterwards, and the response returns the assigned handle; the free change passes inside the window once and only once.
- `backend/tests/profiles-by-handle.test.ts`: the three resolution steps and their order, hidden accounts stay hidden.
- App: component spec for the notice; E2E (`e2e-web2`): a seeded renamed account signs in, reads the notice, changes handle inside the cooldown window; a friend adds them by the previous handle.

## Rollout

1. The public handle check PR and R1 are merged and deployed. From here no new lookalike can appear on vici.app.
2. R2 is merged and deployed. Nothing is renamed yet; the notice and the routes are inert without rows.
3. Dry run against production (read-only). The owner reads the report and settles the pending decisions that depend on the numbers.
4. Apply with the reviewed plan hash, in a quiet hour. Spot check, then send the emails.
5. **No legacy import may run between step 4 and the merge of R3.** `importProfiles` upserts `nickname` from the satellite, so a run would put the previous handles back on provisional accounts. If one runs anyway, re-running the apply restores the recorded assignments.
6. R3 is merged; the import is rule aware; the satellite takes the rule for changed handles.
7. At cutover, after the final import, a dry run must report zero renames. The cleanup chore follows.

Rollback at any point after step 4: `--revert` for the batch (R1 stays in place, so no new lookalike appears while the plan is reworked).

## Risks

- **People dislike the handle they were given.** Mitigated by the free change and by never touching a compliant handle. The report lists the most active affected accounts so the owner can look at them one by one.
- **A handle carried meaning in its separators or script** (`mr.x` becomes `mrx`, a Cyrillic name becomes a generated one). Unavoidable under the owner's rule; the notice says why.
- **Impersonation through the freed clean handle.** When the loser of a collision becomes `name2`, the winner holds `name`. Friends typing the previous handle reach the right account (section 6), but a search for `name` shows the winner first.
- **The plan changes between report and apply.** The hash check aborts; rerun the report.
- **A legacy import between apply and R3** restores previous handles (Rollout step 5).
- **Email reaches the wrong person or reads as phishing.** Addresses on provisional legacy accounts were never verified on vici.app; pending decision 9 recommends not emailing them.
- **The same person on two accounts** (a legacy principal and a vici.app account) can collide with themselves; one of their accounts gets the suffix. The adoption flow keeps the account they sign in to, with its handle.

## Acceptance criteria

- [ ] The dry run writes nothing and produces both files, the summary and the plan hash.
- [ ] After the apply, `select count(*) from profiles where nickname <> '' and nickname !~ '^[a-z0-9]{3,15}$'` is 0 and no two profiles share a handle.
- [ ] No account that held a compliant, non-reserved handle was renamed, except the accounts that shared that exact handle with an earlier winner (imported duplicates).
- [ ] `handle_last_change_ms` is unchanged for every renamed account, and each can change its handle once inside the cooldown window.
- [ ] A browser holding the pre-rename profile keeps saving, and the assigned handle survives its writes.
- [ ] Adding a friend by a previous handle reaches the account that held it.
- [ ] A renamed account sees the notice once; dismissing it is remembered across devices.
- [ ] `--revert` restores a batch and skips accounts that changed since.

## Open questions

1. **How many handles are affected, and how?** Run on production (read-only). Before R1 is deployed, `handle_key` does not exist; use the inline fold, which ignores the mapped letters of R1 pending decision 3 and so slightly under-counts collisions.

   ```sql
   -- Totals by kind.
   with p as (
     select p.user_id, p.nickname, u.claim_pending,
            regexp_replace(lower(normalize(p.nickname, NFKD)), '[^a-z0-9]', '', 'g') as k
     from profiles p join users u on u.id = p.user_id
   )
   select
     count(*)                                                              as profiles,
     count(*) filter (where nickname = '')                                 as no_handle,
     count(*) filter (where nickname <> '' and nickname !~ '^[a-z0-9]{3,15}$') as outside_the_rule,
     count(*) filter (where nickname ~ '[._-]')                            as has_separator,
     count(*) filter (where nickname ~ '[A-Z]')                            as has_capital,
     count(*) filter (where nickname ~ '[^\x01-\x7F]')                     as has_accent_or_other_script,
     count(*) filter (where nickname <> '' and char_length(k) < 2)         as nothing_left_after_cleaning,
     count(*) filter (where char_length(k) = 2)                            as two_characters,
     count(*) filter (where char_length(k) > 15)                           as longer_than_15,
     count(*) filter (where nickname <> '' and nickname !~ '^[a-z0-9]{3,15}$' and claim_pending) as outside_the_rule_legacy_not_moved
   from p;

   -- Lookalike groups: accounts that land on the same handle.
   with p as (
     select user_id, nickname,
            regexp_replace(lower(normalize(nickname, NFKD)), '[^a-z0-9]', '', 'g') as k
     from profiles where nickname <> ''
   )
   select left(k, 15) as candidate, count(*) as accounts, array_agg(nickname order by nickname) as handles
   from p where char_length(k) >= 3
   group by left(k, 15) having count(*) > 1
   order by accounts desc, candidate;

   -- Handles shown by more than one account today (imported without a key).
   select nickname, count(*) from profiles
   where nickname <> '' and nickname_key = '' group by nickname order by count(*) desc;

   -- Accounts holding a reserved handle.
   select p.user_id, p.nickname, u.role from profiles p join users u on u.id = p.user_id
   where regexp_replace(lower(normalize(p.nickname, NFKD)), '[^a-z0-9]', '', 'g')
         in ('admin','vici','root','support','help','mod','official','team','api','www');
   ```

   After R1, replace the inline expression by `handle_key`. The `users.claim_pending` and `users.role` column names are the ones `backend/README.md` describes; check them against `0002_auth_identity.sql` when running.

2. **Is `profiles.created_at` trustworthy as "who was first"?** For imported rows it is the satellite document's creation time (`doc.createdAtNs`), falling back to the import time when missing. Count the rows where it equals the import run's time.
3. **Can `backend/src/lib/email.ts` and the mail provider send a non-code message, in the recipient's language, within the privacy policy as written?** The policy text and the provider's sending category need a look before pending decision 9 is final.
4. **Does a `?ref=<handle>` link attribute anything today?** `SharePopover.svelte` falls back to the handle; if the API or the satellite resolves that token to an account, previous handles in already shared links stop attributing after the rename and section 6 must cover `?ref=` too. If it resolves nothing, the row in section 8 stands.
5. **Which accounts belong to the team and may keep a reserved handle?** Needed for the allowlist of pending decision 7.
6. **Does the waitlist table exist when R2 is built?** It decides whether reservations are in the plan.

## Pending decisions

1. **Handles written in another alphabet** (Cyrillic, Greek, Arabic, Chinese and so on) have no letters left once cleaned.
   - Recommended: give the account a generated handle (decision 6) and the free change, and say so in the notice. No automatic conversion to Latin letters: there are several competing spellings per language and the result often reads wrong to its owner.
   - Alternative A: convert Cyrillic and Greek with a standard letter table (`Мария` becomes `mariia` or `mariya`), generated handle for the rest. Friendlier when it works, wrong often enough to annoy.
   - Alternative B: do not rename these accounts automatically; at their next sign-in they must pick a handle before they can continue.
2. **When several accounts would get the same handle, who keeps it.** An account that already has exactly that handle always keeps it; the question is the rest.
   - Recommended: the account created first, with deleted or hibernated accounts last. Simple to explain ("first come, first served") and cannot be gamed.
   - Alternative A: the most active account (most predictions, then most recent activity). Protects the people who actually use VICI; an early member who has been quiet loses.
   - Alternative B: the owner decides each group by hand from the report. Only realistic if the report shows a few dozen groups.
   - Alternative C: first created, even over an account that already has the exact handle. Rejected in the recommendation because it renames somebody who did nothing outside the rule.
3. **What the others in the group get.**
   - Recommended: the same handle with the smallest free number, starting at 2 (`antonioventili2`; the name is shortened by one letter when it is already 15 long), plus the free change.
   - Alternative A: the handle plus random digits (`antonioventi48`). Does not reveal who came second; harder to remember.
   - Alternative B: no automatic handle: at next sign-in the person must pick one. Nobody gets a handle they did not choose, but they are blocked until they do, and until then they show under a placeholder.
4. **Handles of 2 characters** (allowed until now).
   - Recommended: add the smallest free number (`jo` becomes `jo1`, or `jo2` if taken).
   - Alternative: generated handle (decision 6). Loses the link to the previous handle entirely.
5. **Handles longer than 15 characters once cleaned.**
   - Recommended: keep the first 15 characters. Handles that are really an account identifier (seeded automatically when the person never picked one) get a generated handle.
   - Alternative: generated handle for all of them.
6. **What a generated handle looks like.**
   - Recommended: a name from the Roman suggestion list plus digits (`seneca42`, `livia307`), the same as R1 pending decision 5.
   - Alternative A: `user` plus digits.
   - Alternative B: `predictor` plus digits (the word the share cards already use as a fallback).
7. **Accounts that hold a reserved handle** (`admin`, `support`, ...).
   - Recommended: rename them to a generated handle, except accounts on a short team list that the owner provides.
   - Alternative A: let every current holder keep it; only new claims are refused. No one is surprised, impersonation risk stays.
   - Alternative B: rename all of them with no exception, and give team accounts their handles by hand afterwards.
8. **The change allowance after a forced rename.** The rename itself never counts as a change. The question is what the person may do next.
   - Recommended: one free change at any time, with no expiry; after it, the normal "once every 30 days" starts from that change.
   - Alternative A: one free change that does not start the 30 days either (so two quick changes are possible).
   - Alternative B: no free change; the person waits out whatever was left of their 30 days. Least code; unfair to somebody renamed to a handle they dislike.
   - Alternative C: unlimited changes for 30 days after the rename.
9. **How people are told.**
   - Recommended: a notice inside the app for every renamed account, the next time they open it. In addition an email, only to accounts that signed in to vici.app with that address and whose handle changed more than cosmetically (a number added, cut, or generated). Legacy accounts that have not moved yet get the in-app notice at their first sign-in on vici.app and no email.
   - Alternative A: in-app notice only. No email work, no risk of a message that looks like phishing; people who rarely open the app find out late.
   - Alternative B: email every renamed account, cosmetic changes included.
   - Alternative C: for purely cosmetic changes (`José` to `jose`), no notice at all.
10. **How long a previous handle keeps finding its owner** when a friend types it in "add friend".
    - Recommended: for as long as the account exists. A previous handle can never be claimed by anyone else (it is outside the rule), so keeping it costs nothing.
    - Alternative A: 12 months.
    - Alternative B: not at all; friends must use the assigned handle or an invite link.
11. **Whether other people can see the previous handle.**
    - Recommended: only somebody who types the previous handle sees "@previous is now @assigned". Nothing on the profile.
    - Alternative: show "formerly @previous" on the profile for a few weeks. Helps recognition, exposes a name the person may have wanted gone.
12. **When to run it.**
    - Recommended: as soon as R2 is deployed and the report is approved, before the legacy cutover. The base is smallest now, and legacy accounts then arrive on vici.app already under the rule.
    - Alternative: once, right after the final legacy import. One event to explain, but lookalikes among existing handles stay until then and every legacy user is renamed at the moment they are also asked to move.

## Decisions

Fixed by the owner before this spec: existing handles outside the rule are renamed, and collisions are resolved, by a migration.

Taken while authoring, open to challenge in review:

- **A script with a report, not a SQL migration, performs the rename.** A release-time migration cannot show its plan and wait for approval, and the owner asked for the report first. The schema it needs is a normal migration.
- **The plan is recomputed at apply and compared by hash**, so what runs is exactly what was read.
- **The redirect key is the previous `nickname_key`**, the only fold under which previous handles are known to be unique.
- **A separate route for the notice**, not a profile field, to leave the schema shared with the satellite untouched.
- **A new folder `backend/scripts/handles/`** next to `backend/scripts/etl/`. The closed taxonomy of `AGENTS.md` § 4 covers `backend/src/`; if a new scripts folder is unwanted, the file sits in `backend/scripts/etl/`.
