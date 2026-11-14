# Migration plan: Juno → Supabase (keep icdc-core)

Status: **analysis / proposal**. Staging-only app today; icdc-core is production.

---

## 1. The core fact: two backends, not one

|                        | **Juno satellite** ("app state")                                                                   | **icdc-core** (trading engine)                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Holds                  | profiles, leagues, battles, VXP rewards, referrals, tournaments, affiliations, social graph, stats | order books, positions, collateral, settlement                     |
| Size                   | ~15k LOC · 24 collections · 55 endpoints · 10 hooks · 20 assert guards                             | external IC canisters (registry + clearing)                        |
| Browser reaches it via | `@junobuild/core`                                                                                  | **direct browser→canister calls, signed by II delegation**         |
| Identity               | user IC principal = doc key                                                                        | user IC principal = position/collateral owner, checked every trade |

**Only the satellite migrates. icdc-core and the signing layer stay.**

---

## 2. Scope: migrate vs keep

| Migrate to Supabase                                 | Keep as-is (IC)                                  |
| --------------------------------------------------- | ------------------------------------------------ |
| 24 datastore collections → Postgres tables          | icdc-core registry + clearing (trades)           |
| 55 custom endpoints → RPC/Edge Functions            | Internet Identity (now a **silent signer only**) |
| 10 hooks + 20 asserts → triggers / functions / RLS  | VXP ICRC ledger (on-chain, **history intact**)   |
| `league-images` storage → Supabase Storage          | Engine role model (`eng_0`, oracle)              |
| FE data/auth/storage layer (~68 Juno-coupled files) | -                                                |

---

## 3. Identity: the only novel piece (and it's not the blocker it looks like)

**Misconception to kill:** "principals aren't exportable." A principal is a _public identifier_ (a hash), not a key. Signing is done by an **ephemeral browser session key** authorized by a **delegation**; the principal is **derived deterministically** from `(issuer + dapp origin + OIDC sub)`.

> Same issuer + same OIDC `sub` ⇒ **same principal, every login.** The trading identity never moves and never needs migrating.

**Variant A (recommended):** keep II as a headless signer underneath.

- Supabase Auth = the _app_ login (ideally same Google account).
- One link record: `supabase_user_id ⇄ principal`, joined via shared Google `sub`.
- App data → Supabase, keyed by principal. Trades → icdc-core via II delegation, **unchanged**. Nothing exported, nothing custodial.

**Variant B (more control, more risk):** own a delegation-issuer canister that trusts Supabase JWTs and derives the principal from its `sub`. Only if you want zero II dependency; you'd own a security-critical canister forever.

**The real work here** is not crypto; it's **account-recovery / linking design**: changing the login must not orphan the principal (and its positions/VXP). Bounded auth-design problem; must be decided, not just coded.

---

## 4. VXP: stays on-chain

- Reward logic moves from Juno hooks → Supabase functions, but still calls the **ICRC ledger**.
- Backend holds **one IC service identity** (the VXP treasury minter): custody of the _treasury_, not user keys. Same trust model the satellite has today.
- Port idempotency 1:1 (`{owner}/{awardType}/{awardKey}` + memo encoding).
- Because users keep a real principal, **balances stay attributable and history stays continuous.**

---

## 5. Supabase mapping

| Juno concept                                                       | Supabase                                                                                 |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Owner-scoped collection                                            | table + **RLS** policy (`owner = auth principal`), near 1:1 with Juno's permission model |
| Controllers-scoped collection (`SCHOOL_SUBMISSIONS`, `APP_CONFIG`) | service-role-only table                                                                  |
| `assertSetDoc` guards (state machines, 90-day lock, write-once)    | check constraints + Edge Function validation + RLS                                       |
| `onSetDoc` hooks (cascades, payouts)                               | DB triggers / Edge Functions on insert/update                                            |
| 55 query/update endpoints                                          | Postgres RPC (`supabase.rpc`) or Edge Functions                                          |
| `league-images` storage                                            | Supabase Storage bucket                                                                  |
| VXP ledger calls                                                   | Edge Function → IC ledger via treasury identity                                          |

**Why Supabase over the alternatives:** your hardest logic is _relational ranking/aggregation_ (global leaderboard, rank-and-count, tournament accuracy, affiliation rollups), exactly SQL's strength, and **RLS mirrors Juno's owner-scoped + assert model line-for-line.** It's open-source Postgres, so no lock-in (lift to your own VPS later without a rewrite).

---

## 6. Scale: 10 vs 1M users

**Flat (no extra effort):** the entire code port, same handlers regardless of user count.

**Scales, bake in now (cheap), it's murder to retrofit:**

- Index + cache/materialize the **global leaderboard** & rank-of-one-user (no full scans).
- Make profile-write **fan-out async/batched**: a 100k-member affiliation = one hot stats row → write contention.
- Materialized views for affiliation/tournament boards; paginated/indexed friendship queries.

**Scales, defer until users arrive (expensive):**

- **VXP ledger throughput**: IC per-canister limit (~hundreds upd/s). At scale, serial `icrc1Transfer` won't keep up → needs a **transfer queue + batching + backpressure.** Same ceiling applies to icdc-core trade throughput. _This is the one thing no agent makes easier._
- Read replicas, connection pooling, materialized-view refresh tuning.
- Zero-downtime cutover (dual-write/backfill) vs. a hard cutover that's fine at small scale.
- Ops: monitoring, on-call, abuse/fraud (referral-farming on VXP), GDPR requests.

> Build the **code** scale-safe from day 1 (free via the port); defer **infra/ops** scaling until real users exist.

---

## 7. Effort (agent-driven, you in the loop)

The code port is high-volume pattern translation, agent-friendly, and the repo is already set up for it (`docs/ai/`, worktree sub-agents, tracker, bot review).

| Item                                                              | Human team | Agent-driven                               |
| ----------------------------------------------------------------- | ---------- | ------------------------------------------ |
| Vertical slice (1 domain end-to-end, FE wired, II still signing)  | weeks      | **1–2 days**                               |
| Full satellite port (all collections/endpoints/hooks), unverified | 4.5–6 mo   | ~1 week agent time                         |
| Identity bridge + recovery                                        | 1–2 mo     | days to build; gated by **your decisions** |
| VXP treasury paths, **verified** correct                          | -          | week+ (real ledger, the time sink)         |
| Data migration + cutover + hardening                              | 1–1.5 mo   | 1–2 weeks                                  |
| **Whole thing**                                                   | **6–8 mo** | **~3–6 weeks**                             |

Binding constraint shifts from typing speed → **verification, irreversible data ops, real infra, and decisions only you can make.** Days for a spike; weeks (not months, not days) for the real thing.

---

## 8. Phased plan

1. **Spike (1–2 days):** profiles + leagues on a real Supabase instance, RLS in place, FE talking to it, II still signing trades. Prove the assembly line + find walls cheaply.
2. **Identity bridge:** `supabase_user_id ⇄ principal` via shared Google `sub`; write + decide the recovery flow.
3. **Port the rest:** remaining collections/endpoints/hooks/asserts, scale-safe (indexes, async fan-out).
4. **VXP:** treasury service identity + reward functions; verify idempotency against the live ledger.
5. **Data migration:** export Juno → transform → backfill → link → verify (batched, idempotent).
6. **Cutover + harden:** hard cutover (small scale) or dual-write (if grown); monitoring; FE de-Juno cleanup.

---

## 9. Alternative target: self-hosted VPS

A bare VPS gives max control + zero lock-in, but **for a small team it's the wrong trade**: you'd spend the first ~2 months rebuilding what Supabase ships on day one (auth, RLS, storage, function runtime, backups, pooling), all of it now your ops burden and on-call. The lock-in fear it answers is **already answered by Supabase**: it's open-source Postgres, so you can lift-and-shift onto your own VPS _later_, without a rewrite, once the team/scale justifies the ops. Recommendation: **Supabase cloud now, VPS as a future option, not a starting point.**

## 10. Note: Firebase vs Supabase

Firebase is the faster auth on-ramp (and you're already in Google Workspace), but it's the weaker fit **for this app**:

- **Firestore is NoSQL** → your hardest queries (leaderboard, rank-and-count, tournament accuracy, affiliation rollups) are painful/expensive; SQL does them natively.
- **Security rules** are clumsier than **RLS**, which maps 1:1 to Juno's owner-scoped + assert model.
- **High lock-in** (vs. Supabase = portable Postgres).
- Workspace ≠ Firebase benefit: using Firebase buys little from Workspace beyond familiarity.
