# Spec: League invite implies a friend invite

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#879)

## Goal

Inviting someone to your league should, by default, also invite them
to be your friend. When a person joins a league through an invite link
that you shared, they auto-friend **you** (the sharer), and, if they
are a brand-new sign-up, the same new-user referral bonus that a plain
friend invite grants applies too. One link, two outcomes: they land in
the league _and_ in your friend graph.

## Context

The two systems already exist and overlap cleanly; this change wires
the league invite to ride the existing referral rails rather than
building new friendship/payout logic.

**League invite (today):**

- Share links are built as `${origin}/league/${league.inviteCode}` in
  `src/lib/components/leagues/LeagueListCard.svelte:144` and
  `src/lib/components/pages/LeagueDetailPage.svelte:475`. The code maps
  to a _league_, never to the person who shared it.
- The landing route is `src/routes/league/[code]/+page.svelte`. It
  validates the slug (`LEAGUE_INVITE_CODE_REGEX`), then: signed-out /
  mid-onboarding → `stashCodeForSignup()` writes `leagueInvite` into the
  `vici:pending-onboarding` slot and routes to `/signup`; signed-in
  returning user → `lookupLeagueByInvite()` + `joinLeagueByInvite()` and
  routes into the league. This route sits **outside** the `(app)` route
  group.

**Friend invite / referral (today), the rails we reuse:**

- Every profile gets an 8-char referral code on creation
  (`assignReferralCodeIfMissing` in
  `src/satellite/services/referral.services.ts`); the FE reads it via
  `getMyReferralCode()` (`src/lib/services/referral.services.ts:18`).
- `src/lib/components/market/SharePopover.svelte` appends a share token
  as `?ref={token}` to share URLs.
- `src/routes/(app)/+layout.svelte:104-165` is a **global `?ref=`
  capture**: an arriving visitor with a valid `?ref=` code has it
  stashed into `vici:pending-onboarding.referralCode` (first-referrer-
  wins; never overwritten), and the post-signin **drain**
  (`drainPendingOnboarding` / `redeemPendingReferralIfAny` in
  `src/lib/services/onboarding-handoff.services.ts`) redeems it. This
  capture **deliberately skips signed-in sessions**: a signed-in user
  is never silently re-attributed.
- Redemption reuses the satellite endpoints unchanged: new sign-up
  within the signup window → `redeemReferralCode()` (bilateral
  confirmed friendship + **deferred** new-user VXP bonus, settled on the
  referee's first prediction); otherwise → `claimReferralFriendship()`
  (friendship only, no bonus; idempotent: safe even if the joiner
  already redeemed another referral). The bonus amount and signup window
  are the existing constants in
  `src/lib/constants/referral.constants.ts`.

Because the `?ref=` capture already lives in the `(app)` layout, and
only fires for signed-out visitors, the league flow needs two
additions: (1) league share links must carry the sharer's code, and
(2) the `/league/[code]` landing (outside `(app)`) must route the
sharer's code through the existing redemption, splitting by sign-in
state exactly the way the rest of the codebase does.

## Scope

1. **League share links carry the sharer's referral attribution.** In
   `LeagueListCard.svelte` and `LeagueDetailPage.svelte`, fetch the
   sharer's code via `getMyReferralCode()` and append `?ref={code}` to
   the `/league/${inviteCode}` URL **only when a real referral code
   resolves**. With no code available, share the plain link and append
   no `?ref=` param (no handle fallback: a handle fails
   `REFERRAL_CODE_REGEX` and would be silently dropped on the consuming
   side, so appending it is pointless noise).
2. **The league landing routes the sharer's code by sign-in state**, in
   `src/routes/league/[code]/+page.svelte`, reading
   `page.url.searchParams.get('ref')` and validating with
   `REFERRAL_CODE_REGEX`:
   - **Signed-out / needs-onboarding branch**: stash the validated code
     into `vici:pending-onboarding.referralCode` (first-referrer-wins),
     alongside the existing `leagueInvite` stash. The existing signup
     drain redeems it (friendship + new-user bonus). This mirrors the
     `(app)` capture, which is itself signed-out-only.
   - **Signed-in immediate-join branch**: do **not** write
     `referralCode` into the pending-onboarding slot (that slot's drain
     emits an unrelated "account exists" toast for returning users, and
     the codebase intentionally never re-attributes a signed-in
     session). Instead, after a successful `joinLeagueByInvite()`, call
     `claimReferralFriendship({ code })` directly, best-effort: it
     writes the bilateral friendship, is idempotent, and works whether
     or not the joiner has redeemed a referral before. Failure is
     swallowed (the join already succeeded).

### Out of scope

- **No opt-out toggle.** "By default" is read as the standard implied
  behaviour, not a per-invite switch. A "don't also add as friend"
  option can be a fast-follow.
- **Auto-friending the league owner or all current members.** This
  spec friends the _sharer_ only (the person whose link was used), per
  the product decision. A group-wide friend graph is a separate idea.
- **Any change to the referral payout amount, signup window, cap
  curve, or the satellite referral/friendship endpoints.** Those rails
  are reused verbatim.
- **The `lookupLeagueByInvite` reverse-index optimisation** noted in
  `cohort.services.ts`: unrelated.

## Linked issues

No open issue tracks this. (Open issues reviewed: #810 GDPR, #759 Dash
parity, #543 anti-farm referral gating, #350 flow-grant credit: none
related. Note: #543's concern, that payouts gate on the client-written
activity log rather than an authoritative trade, applies equally to
this path since it reuses the same payout machinery; this spec does not
widen or narrow that surface.)

## Analytics

Instrument by reusing existing taxonomy event **names**: no new event
names, so no dual-source (`analytics-event.ts` +
`analytics-event.schema.ts`) change. These are **new tracking call
sites**: a repo search shows no `track({ name: 'league_invite_sent' })`
or `track({ name: 'referral_redeemed' })` call exists today (the names
live only in the taxonomy type/schema). Both call sites are added during
implementation.

- `league_invite_sent`: emit from the league share handlers
  (`LeagueListCard.svelte` / `LeagueDetailPage.svelte` copy actions),
  with `leagueId` and the `ok` boolean prop marking whether the link
  carried a friend attribution (`ok: true` when a `?ref=` code was
  appended), to measure adoption of the implied-friendship path.
- `referral_redeemed`: emit on successful redemption/claim from the
  friendship paths this spec touches (the signup drain for the
  signed-out branch; the direct `claimReferralFriendship()` call in the
  signed-in branch), with `source: 'league_invite'` so league-originated
  friendships are attributable in the funnel.

No new dimensions needed; `ok`, `leagueId`, and `source` already exist
in `AnalyticsEventProps`. Behavioural only: no PII (the referral code
is a pseudonymous opaque token, not personal data).

## Technical requirements (no satellite / backend change)

This is a **pure-frontend** spec. It adds no collection, doc shape,
hook, endpoint, or schema, and regenerates no bindings: it reuses the
existing `redeemReferralCode` / `claimReferralFriendship` endpoints and
the `?ref=` capture/drain unchanged. The only parameters touched are
the existing referral constants in
`src/lib/constants/referral.constants.ts` (cited, not restated).

## Implementation outline

1. `src/lib/components/leagues/LeagueListCard.svelte`: in `handleCopy`,
   resolve `getMyReferralCode()`; append `?ref={code}` only when a code
   is returned. Cache the lookup so repeated copies don't refetch. Emit
   `league_invite_sent` with `ok` reflecting whether the param was
   added.
2. `src/lib/components/pages/LeagueDetailPage.svelte`: same change in
   its share handler (line ~475).
3. `src/routes/league/[code]/+page.svelte`: read + validate `?ref=`;
   in the signed-out / needs-onboarding branch extend the stash
   (`stashCodeForSignup`, or a sibling helper) to also persist
   `referralCode` (first-referrer-wins); in the signed-in branch, after
   a successful `joinLeagueByInvite()`, call
   `claimReferralFriendship({ code })` best-effort and emit
   `referral_redeemed` with `source: 'league_invite'`.
4. `src/lib/services/onboarding-handoff.services.ts`: pass
   `source: 'league_invite'` (or equivalent) when the signup drain
   redeems a code that originated from a league invite, so the
   `referral_redeemed` emit is attributable. No change to the
   redeem-vs-claim decision logic.
5. i18n: reuse existing `onboarding.handoff.referral_*` and
   `league_invite.*` keys; add a key only if a league-specific success
   toast is warranted (decide during build: default to reuse).

## Acceptance criteria

- [ ] A league share link copied from a card or the league detail page
      includes the sharer's `?ref=` code, and omits the param entirely
      when no code is available.
- [ ] A brand-new user who signs up via a league invite link joins the
      league **and** becomes a confirmed friend of the sharer, **and**
      the new-user referral bonus is owed (settling on their first
      prediction): same outcome as a plain friend invite.
- [ ] An existing signed-in user who joins a league via an invite link
      becomes a confirmed friend of the sharer with no VXP bonus, and
      sees no spurious "account exists" toast.
- [ ] A user who already redeemed a referral and then joins a league via
      a different sharer's link still becomes friends with that sharer.
- [ ] A plain `/league/{code}` link with no `?ref=` still joins the
      league exactly as before (no friendship, no regression).
- [ ] A self-shared link (sharer === joiner) is a harmless no-op (the
      satellite rejects self-referral).
- [ ] `league_invite_sent` is emitted with `ok` from the share
      handlers; league-originated `referral_redeemed` is emitted with
      `source: 'league_invite'`.
- [ ] `npm run quality` and `npm run check` pass. (No
      `npm run juno:functions:build`: satellite untouched.)

## Pending decisions

None: the friend target (the link's sharer), the no-opt-out default,
and the sign-in-state split are decided (see Decisions).

## Decisions

- **Friend the link's sharer, not the league owner or all members.**
  The sharer's identity is carried by embedding _their_ referral code
  in the link they generate, so "whoever shared the link" is exact and
  needs no per-league ownership lookup. (Chosen over "league owner",
  which would mis-attribute when a non-owner member shares, and over
  "all current members", which would fan out unbounded friendship
  writes per join.)
- **Reuse the referral rails wholesale instead of a new league-
  friendship path.** The redeem/claim endpoints and deferred-bonus
  settlement already encode the exact "auto-friendship + new-user bonus"
  semantics requested. Piggybacking the sharer's code on the league link
  means zero satellite change and one tested payout path, at the cost of
  the league link gaining a query param.
- **Split by sign-in state rather than always stashing.** The
  pending-onboarding slot and its drain are signed-out machinery
  (`(app)` capture skips signed-in sessions; the drain toasts "account
  exists" for returning users). The signed-in branch therefore claims
  friendship directly after the join rather than via the slot, which
  also removes the earlier open question about whether the drain fires
  for an already-onboarded returning user.
- **No opt-out toggle in v1.** "By default" reads as the standard
  behaviour; an explicit opt-out is a possible fast-follow, not a
  blocker.
