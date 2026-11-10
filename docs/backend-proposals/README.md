# Backend follow-up proposals

The frontend port of the design prototype is feature-complete. Four
backend follow-ups remain — each is a new satellite collection (or
endpoint) that the existing FE surfaces are designed to consume.

Per the [protected paths](../ai/governance.md#boundaries) (`juno.config.ts`, the satellite interface): any change that
adds collections, hooks, or contract surfaces needs explicit
approval before implementation. **This doc is the approval gate.**

For each proposal below:

- **Why** — which FE surface depends on it (and where to find it).
- **Collection** — name + key shape + doc shape (no Candid yet,
  just the TypeScript interface).
- **Asserts** — set + delete pre-write guards.
- **Hooks** — `onSetDoc` triggers + cross-collection effects.
- **Queries / Updates** — the `defineQuery` / `defineUpdate`
  endpoints the FE will call.
- **Scheduled jobs** — what fires on a cron (when applicable).
- **Open questions** — product / scope decisions that need a call
  before code.

---

## Proposal 1 — Per-affiliation stats aggregation

> **Why:** `WorldsAffiliationDetailPage` and `WorldsBoutDetailPage`
> both show a "stats pending the aggregation backend" hint where
> the per-affiliation accuracy + rank panels would go. This is
> the foundation for proposal 2 below.

### Collection — `AFFILIATION_STATS`

Per-affiliation rolling stats. One doc per `(kind, affiliationId)`
pair. Updated lazily by the resolution-event hook (see _Hooks_
below) — no scheduled recompute needed at the per-affiliation
level.

```ts
// src/lib/types/affiliation-stats.ts
export interface AffiliationStatsDoc {
	/** External id — matches `AffiliationDoc.affiliationId`. */
	affiliationId: string;
	/** `university` | `country` — same enum as `AffiliationDoc.kind`. */
	kind: AffiliationKind;
	/** Member count from the latest `listWorldsRoster` snapshot. */
	members: number;
	/** Total resolved calls across all members in the rolling window. */
	totalCalls: number;
	/** Correct calls in the same window. */
	wins: number;
	/** Same window, restricted to the current featured event. */
	totalCallsFeatured: number;
	winsFeatured: number;
	/** Last update time (ms). */
	updatedAtMs: number;
}
```

Doc key: `${kind}/${affiliationId}` (mirrors the affiliations
collection prefix scheme).

### Asserts

- `assertSetAffiliationStats` — **system-only**. Caller must be
  the satellite identity. Rejects user-initiated writes.

### Hooks

`onSetDoc` on the existing **`ACTIVITIES`** collection (resolution
events): when a doc transitions `pending → win` or `pending → loss`,
read the actor's profile, look up their `affiliations` rows, and
increment the matching `AFFILIATION_STATS` docs.

```ts
// src/satellite/services/affiliation-stats.services.ts
export const onActivityResolvedForAffiliationStats = async (ctx) => {
	// 1. Decode the after-state; bail unless it resolved this tick.
	// 2. Read the actor's affiliations (2 rows max: university +
	//    country).
	// 3. For each affiliation, getOrCreate `AFFILIATION_STATS` doc,
	//    increment totals + featured-event-scoped totals if the
	//    market's `featuredEventTag` matches the active event.
	// 4. setDoc with `updated_at` round-trip for idempotency.
};
```

Idempotency: each activity carries a stable id; the hook stores
the last-processed activity id on the stats doc and skips re-runs.

### Queries

- `getAffiliationStats({ kind, affiliationId })` — single-doc
  lookup. Returns the doc or `undefined`.
- `listAffiliationStats({ kind, limit? })` — returns the kind's
  full roster sorted by `wins / totalCalls` desc (with a minimum
  `totalCalls >= MIN_CALLS_FOR_RANK = 30` gate; below that, the
  affiliation is unranked).

### Open questions

1. **Rolling window length.** Monthly? Lifetime? Mixed (last-30-days
   for current rank, lifetime for the detail card)? Prototype shows
   month + WC bout side-by-side — implies two parallel counters.
2. **`MIN_CALLS_FOR_RANK`.** Prototype hints at 200 ("needs 200
   more calls to qualify"). Confirm.
3. **Featured-event scoping.** Right now the FE surfaces "WC
   accuracy" separately from "month accuracy". Does the backend
   key `featuredEventTag` get a structural slot, or do we just
   parameterise the same fields by event?

---

## Proposal 2 — Worlds podium monthly fan-out

> **Why:** Phase 7 step 5 of the VXP economy.
> Currently the `WorldsPage` shows the prize amounts (400 / 200 /
> 100 VXP for gold / silver / bronze) as a static preview; the
> monthly fan-out that credits VXP to top-3-affiliation members
> doesn't exist.

**Depends on Proposal 1** (needs ranked `AFFILIATION_STATS`).

### Scheduled job

Once per month at month boundary (UTC). Runs in the satellite via
the scheduled-task hook surface (`createScheduledTask` from
`@junobuild/functions`, similar pattern to streak hooks but
cron-driven instead of doc-driven).

```ts
// Pseudocode
for each kind in ['university', 'country']:
  top3 = listAffiliationStats({ kind, limit: 3 })   // already sorted
  for rank, aff in enumerate(top3, start=1):
    prize = VXP_WORLDS_PODIUM[rank]                 // 400 / 200 / 100
    members = listWorldsRosterFn({ kind, affiliationId: aff.id })
    for member in members:
      setDoc<VxpAwardDoc>({
        collection: VXP_AWARDS,
        key: `worlds_podium/${YYYY_MM}/${kind}/${aff.id}/${member}`,
        data: { kind: 'worlds_podium', amount: prize, ... }
      })
```

Idempotency: the doc key `worlds_podium/${YYYY_MM}/...` is unique
per cycle; a re-run no-ops.

### No new collection

Re-uses existing `VXP_AWARDS` (assert already gates: system-only
writes, fixed amount per kind). Just adds `worlds_podium` to the
`VxpAwardKind` enum + branch in `assertSetVxpAward`.

### Open questions

1. **Month boundary.** UTC midnight on the 1st? Or follow the user
   locale somehow (probably not — server-side, UTC is cleanest).
2. **Tie-break.** Two affiliations with identical accuracy — fall
   back to higher `totalCalls`? Higher `members`? Coin-flip
   stable-by-id?
3. **Mid-month affiliation switch.** A user who joined a podium
   affiliation late in the month — full prize or nothing? Prototype
   doesn't say. Suggest: prize requires `joinedAtMs <
monthStartMs`.

---

## Proposal 3 — Monthly tournament backend

> **Why:** `TournamentPage` at `/social/tournament` renders the
> hero + prize tiers but the bracket is a "pending backend" hint
> card. The prototype shows a 16-league single-elimination bracket
> with per-match accuracy and a per-round date.

Largest scope of the four. Two collections, scheduled draw,
scheduled match resolution.

### Collection 1 — `TOURNAMENTS`

One doc per monthly tournament.

```ts
export interface TournamentDoc {
	id: string; // e.g. '2026-05'
	monthStartMs: number;
	monthEndMs: number;
	bracketSize: 8 | 16 | 32; // configurable, default 16
	state: 'open' | 'in_flight' | 'concluded';
	/** League ids in seed order — index 0 plays index 1, etc. */
	seededLeagueIds: string[];
	prizeTiers: ReadonlyArray<{
		place: 1 | 2 | 3 | 4;
		vxp: number;
		stickerId: string;
	}>;
}
```

### Collection 2 — `TOURNAMENT_MATCHES`

One doc per (tournament, round, match-index). Keyed
`${tournamentId}/${round}/${index}`.

```ts
export interface TournamentMatchDoc {
	tournamentId: string;
	round: 'r1' | 'quarter' | 'semifinal' | 'final';
	index: number;
	fromLeagueId: string | null; // null for "TBD"
	toLeagueId: string | null;
	fromAcc: number | null; // 0..1
	toAcc: number | null;
	winnerLeagueId: string | null;
	startMs: number;
	endMs: number;
}
```

### Asserts

- `assertSetTournament` — system-only.
- `assertSetTournamentMatch` — system-only.

### Scheduled jobs

1. **Monthly draw** (1st of month, UTC) — selects the 16
   highest-rank-by-member-count leagues (or per the entry
   criterion we pick, see Open Q below), seeds them into bracket
   order, creates the `TOURNAMENTS` doc + 8 first-round
   `TOURNAMENT_MATCHES`.
2. **Round resolution** (after each round's `endMs`) — for each
   match, compute each league's accuracy in the round window,
   record winner, create next-round matches.
3. **Final settle** — month-end: credit `VXP_AWARDS` for top-4
   league members per `prizeTiers`.

### Queries

- `getCurrentTournament()` — the active `state in ['open', 'in_flight']`
  tournament + all its matches.
- `getTournament({ id })` — one specific past tournament.

### Open questions

1. **Entry criterion.** Who enters? Top-16 by `member count`? Top-16
   by `accuracy`? First-16-to-register?
2. **Round windows.** Prototype shows "DAY 3 OF 7" — implies each
   round is a fixed window. Suggest: r1 = 7 days, quarter = 5,
   semi = 3, final = 7. Confirm.
3. **Minimum calls per match.** Prototype says "minimum number of
   calls is required to qualify". Pick a number.
4. **Re-seeding on bye.** What if a league disbands mid-tournament?

---

## Proposal 4 — Account deletion / exit-signals endpoint

> **Why:** `docs/local-storage.md` lists `vici.exit-signals` as
> "Server — actual account-deletion feedback should hit a real
> endpoint". Settings → Delete account currently has no backend
> wired.

Smallest of the four.

### Collection — `EXIT_SIGNALS`

Append-only log of deletion feedback.

```ts
export interface ExitSignalDoc {
	/** Anonymous — no principal stored. */
	reason: string; // user-picked enum value
	note: string; // optional free-text, max 280 chars
	createdAtMs: number;
}
```

Doc key: random UUID. **No principal field** — the deletion event
itself is anonymous (the principal is gone after).

### Asserts

- `assertSetExitSignal` — append-only (no `current`), shape +
  length checks. Anyone can write (anonymously).

### Update — v2 (soft-delete + recovery + admin sweep, shipped)

Decision 4.1 landed as a **two-phase** model: a soft-delete that
preserves everything, then a hard-delete once the recovery window
elapses. The cascade still exists, but it's deferred — it only runs
on expiry, never on the user-facing delete.

- `deleteMyAccount({ reason, note, leagueResolutions? })` —
  `defineUpdate` that:
  1. **League resolution.** Applies each `leagueResolutions` entry the
     caller passed, BEFORE the blocking guard. Each is `{ leagueId,
action: 'transfer' | 'delete', transferTo? }` (an array of strict
     objects — cleaner in Candid than a map). `transfer` reuses
     `transferLeagueOwnershipFn` (hands the league to `transferTo`, the
     new-owner principal text); `delete` reuses `deleteLeagueFn` (owner
     disband — drops every membership row then the league doc). Only
     leagues the caller actually owns are acted on (a resolution for a
     non-owned league is a clean skip). If any resolution fails, the
     whole delete aborts with `{ ok: false, reason:
'league_resolution_failed', failedLeagueId, resolutionReason }` and
     nothing further runs.
  2. Owner-leagues guard — refuses with `reason:
'owns_non_empty_league'` if, after resolution, the caller still owns
     a non-empty league (decision 4.3); `blockingLeagueIds` lists them.
  3. **Soft-deletes** the caller's profile: sets `deletedAtMs = now`
     on the profile doc via a version-locked overwrite. NO data is
     removed — the nickname stays (so the handle remains reserved),
     and every identity-keyed row survives so recovery can restore
     the account. A second delete keeps the **earliest** `deletedAtMs`
     so the recovery clock can't be reset, and reports `alreadyDeleted`.
  4. Writes the `EXIT_SIGNAL` doc (anonymous) — but ONLY on a first
     delete. A re-delete inside the recovery window (`alreadyDeleted`)
     skips the signal write, so churn isn't over-counted by repeated
     `deleteMyAccount` calls. Returns `{ ok: true, softDeleted }`; the
     FE signs out.

  **Recovery caveat (deliberate).** League resolutions are applied
  IMMEDIATELY (a real transfer / disband), NOT deferred to the
  hard-delete. So a user who soft-deletes while resolving leagues and
  then `recoverMyAccount`s within the window gets their **account** back
  but **not** the relinquished leagues — a transferred league belongs to
  its new owner, a deleted league is gone. Recovery restores
  identity-keyed rows, never the ownership decisions made at delete time.
  This matches the delete-v2 contract; it's a semantics choice, not a bug.

  `deleteLeagueFn({ leagueId, callerText, callerBytes })` is the owner
  disband (refuses `not_owner` / `league_not_found`), distinct from the
  cascade's `disbandOrTransferOwnedLeagues` (which deletes a truly-empty
  owned league but transfers ownership of one that others joined during
  the window, so the hard-delete never orphans members). It's NOT wired
  into the cascade — it's an explicit, caller-chosen resolution that can
  evict other members.

- `recoverMyAccount()` — `defineUpdate`, no args. Reads the caller's
  own profile:
  - not soft-deleted → `{ ok: true, recovered: false }` (no-op).
  - soft-deleted, inside `ACCOUNT_RECOVERY_WINDOW_MS` (30 days) →
    clears `deletedAtMs`, returns `{ ok: true, recovered: true }`.
  - soft-deleted, past the window → runs the hard-delete cascade
    now, returns `{ ok: false, reason: 'expired' }`.
- `sweepExpiredDeletions()` — `defineUpdate`, **admin-guarded** (via
  the shared `isAdmin` check). Scans `PROFILES`, hard-deletes every
  account whose `deletedAtMs` is older than the window, returns `{
swept }`. Juno has no scheduler primitive, so this is triggered
  externally (admin/cron) — same rationale as the worlds-podium
  user-claim.

The hard-delete cascade (profile, VXP awards / onboarding, referral
code + redemption, affiliations, relations, league memberships; shared
audit rows left in place) is extracted into `hardDeleteAccountFn({
callerText, callerBytes })`, parametrised by principal so the sweep can
run it for any account. Owned leagues are resolved last: a league with
no other members left is deleted, but one that gained members during
the recovery window is **transferred** to a surviving member (the first
remaining `LEAGUE_MEMBERS` row in iteration order — `league.owner`
re-encoded and that row's `role` bumped to `owner`, both version-locked)
rather than deleted, so self-joiners are never orphaned. The up-front
`owns_non_empty_league` guard only runs on the interactive
`deleteMyAccount` path; the guard-less recovery-expiry + sweep paths
rely on this transfer.

### Hibernation off-ramp — "Pause 30 days" (reversible, shipped)

The delete flow offers, as a retention off-ramp, a **fully reversible**
alternative to deletion: account hibernation. No data is ever removed —
the account's shared stats freeze and its profile hides from public reads,
but the owner can resume at any time.

- `hibernateMyAccount()` — `defineUpdate`, no args. Sets `hibernatedAtMs =
now` on the caller's profile via a version-locked overwrite. Idempotent
  (keeps the **earliest** mark). Refuses with `{ ok: false, reason:
'deleted' }` when the account is already soft-deleted (the two states are
  mutually exclusive) and `{ ok: false, reason: 'no_profile' }` when the
  caller never onboarded. Otherwise `{ ok: true }`.
- `resumeMyAccount()` — `defineUpdate`, no args. Clears `hibernatedAtMs`
  (destructure-drop + re-encode, mirroring how `recoverMyAccount` clears
  `deletedAtMs`). Returns `{ ok: true, resumed }` — `resumed` is `true` when a hibernation marker was cleared, `false` when the account wasn't hibernated (a no-op).

`hibernatedAtMs?: number` is a second optional marker on the profile schema
(same shape + round-trip semantics as `deletedAtMs`), with no expiry/sweep
— hibernation is reversible, not a delayed delete.

Soft-deleted **or hibernated** profiles are filtered out of the public
reads (`listLeaderboard`, `searchProfiles`, `getProfile`) via the combined
`isPubliclyHidden(profile) = isSoftDeleted(profile) || isHibernated(profile)`
helper. The owner's own profile read goes through Juno `getDoc` (not these
endpoints) and is intentionally NOT gated, so the FE can still offer
recovery (soft-delete) or resume (hibernation). The stats freeze is mostly
natural (a hibernated user is inactive) and defensively enforced: the two
profile-write stat fan-out hooks early-return when the AFTER profile is
hibernated.

### Open questions (resolved)

1. **Profile soft-delete vs hard-delete.** Resolved as soft-delete
   with a 30-day recovery window, then hard-delete on expiry.
2. **Reason enum.** `not-for-me`, `too-busy`, `privacy`,
   `duplicate`, `bugs`, `other` (the six buckets in
   `EXIT_SIGNAL_REASONS`, `src/lib/types/exit-signal.ts`; the
   validator rejects anything else as `invalid_input`).
3. **Owner-leagues blocker.** Refuse + surface a "transfer first"
   guard in the UI. The caller can resolve each owned league inline at
   delete time via `leagueResolutions` (transfer ownership or disband);
   only leagues left unresolved trip the refusal.

---

## Shipped (Proposal 3)

The full tournament chain has landed.

### Foundation

- `TOURNAMENTS` collection + `assertSetTournament` (system + state
  machine `in_flight → concluded`).
- `TOURNAMENT_MATCHES` collection + `assertSetTournamentMatch`
  (key shape, write-once invariants on team / accuracy / winner /
  start-snapshot fields).
- `triggerTournamentDraw({ monthAnchor })` — anyone can call;
  idempotent via doc-key collision on the month anchor. Scans
  `LEAGUE_MEMBERS`, counts members per league, seeds the top-16
  into Round 1 + creates TBD slots for the later rounds so the FE
  bracket renders the skeleton immediately. Snapshots each seeded
  league's `(totalCalls, wins)` into the match doc as a
  start-of-window baseline.
- `getCurrentTournament()` — returns the latest tournament + its
  matches, sorted by round then index.

### Resolution + claim

- `LEAGUE_STATS` collection (`assertSetLeagueStats`) — rolling
  lifetime counters per league. One doc per `leagueId`. Updated
  lazily by `onProfileSetForLeagueStats` on every profile write
  where `totalTrades` advanced; the hook fans the delta out to
  every league the writer belongs to.
- `resolveTournamentRound({ tournamentId, round })` — anyone can
  call once the round window has closed. For each match in the
  round, reads the live `LEAGUE_STATS` for both leagues, computes
  the window delta against the match doc's start-snapshot, applies
  the 50-call forfeit rule (decision 3.3), and picks a winner —
  higher accuracy wins; ties + double-forfeits resolved by
  lower-`leagueId` advance (decision 3.4). Writes the winner +
  accuracies onto the match doc and populates the next round's
  matching slot (with its own start-snapshot frozen on write).
  Idempotent via the match doc's `winnerLeagueId` write-once
  invariant. Auto-flips the tournament to `concluded` when the
  final settles.
- `claimTournamentPrize({ tournamentId })` — user-claim per
  caller. Reads the bracket's winning + losing finalists and the
  semifinal losers; checks the caller's league memberships;
  credits a single `VXP_AWARDS` doc keyed
  `${caller}/tournament_prize/${tournamentId}_place_${1|2|3}`
  per the prize tier table (5000 / 2500 / 1000 VXP). Idempotent
  via the award doc key — a second call returns
  `awardsAlreadyClaimed > 0`. Members of multiple winning leagues
  get only their highest-tier award.
- FE wiring: `TournamentPage` fires the draw on mount, then
  walks forward through the bracket and fires
  `resolveTournamentRound` for each round whose `endMs <= now`.
  Once the tournament concludes, fires `claimTournamentPrize`
  and surfaces a `+N VXP credited` banner on first claim.

---

## Open questions summary (decisions needed before code)

| #   | Decision                     | Default if not specified                                               |
| --- | ---------------------------- | ---------------------------------------------------------------------- |
| 1.1 | Stats rolling window         | Lifetime + monthly side-by-side                                        |
| 1.2 | `MIN_CALLS_FOR_RANK`         | 200 (per prototype)                                                    |
| 1.3 | Featured-event scoping shape | Parameter on existing fields                                           |
| 2.1 | Monthly cycle anchor         | UTC midnight, 1st of month                                             |
| 2.2 | Tie-break order              | accuracy → totalCalls → leagueId asc                                   |
| 2.3 | Mid-month-join eligibility   | Requires `joinedAtMs < monthStartMs`                                   |
| 3.1 | Tournament entry criterion   | Top-16 by total members                                                |
| 3.2 | Round windows (days)         | 7 / 5 / 3 / 7                                                          |
| 3.3 | Min calls per match          | 50 per league                                                          |
| 3.4 | Disband during tournament    | Forfeit; opponent advances                                             |
| 4.1 | Profile delete depth         | Soft delete + 30-day recovery, then hard-delete                        |
| 4.2 | Reason enum values           | `not-for-me` / `too-busy` / `privacy` / `duplicate` / `bugs` / `other` |
| 4.3 | Owner-leagues guard          | Refuse + inline transfer/disband resolution                            |

Approve / amend the defaults above to unblock implementation. Each
proposal can be implemented independently; suggested order is
**1 → 2 → 4 → 3** (smallest dependency tree first).
