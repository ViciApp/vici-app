# Spec: Waitlist, claim the reserved handle at account creation

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Draft

Part **W3** of the waitlist; the parts and how they stack are listed in [`2026-11-27-feat-handle-waitlist.md`](./2026-11-27-feat-handle-waitlist.md). **Stacks on W1.** Buildable in parallel with W2 and W6; W4 stacks on this part. Must be merged, with W2, before the first person is admitted. Implementation PR title: `feat(waitlist): claim the reserved handle at account creation`.

## Goal

A person who reserved a handle and was admitted creates their account by signing in with the mailbox they joined with, by email code or with Google. The handle they reserved is already in the handle field: they keep it with one tap, or type another, in which case the reserved one is released for anyone. Nobody else could have taken it meanwhile. Whoever invited them is credited at that moment. And while sign-up is closed, an invite link from the app opens the landing with the waitlist capsule ready and remembers the invite.

## Context

- **From W1.** `waitlist_reservations` (`email_key`, `handle`, `hold_ended_at`, `account_user_id`, `invited_referral_code`, `invited_challenge_id`), `emailMailboxKey`, the waitlist clause and `excludeReservationKey` in `checkNicknameAvailability` (`backend/src/profiles/nickname.ts`), `lockHandleKey`, the status read and the app-side cache in `src/lib/services/waitlist.services.ts`. After W1 a reserved handle is unavailable to every account, its owner included.
- **How an account gets its handle today.** A first verified sign-in provisions the user in `resolveIdentity` (`backend/src/auth/identity.ts`), with the proven address on its `auth_identities` row. The profile is created by the app's first profile write: `ensureProfile` in `src/lib/services/profile.services.ts` seeds a handle ("first-touch bootstrap"; under the handle rule spec the seed is the cleaned display name or a generated handle), then `drainPendingOnboarding` in `src/lib/services/onboarding-handoff.services.ts` applies the handle stashed by the onboarding screen through `applyOnboardingPicks`. Every write ends in `upsertMyProfile` and `assertValidNickname` (`backend/src/profiles/profile-write.ts`), then `runProfileAwardTriggers` (the starter VXP).
- **The onboarding screen.** `src/lib/components/onboarding/Onboarding.svelte`, rendered at `/signup`: handle field with the live probe, provider stack. `/signin` is the returning-user screen and also provisions an account for an address it has never seen.
- **Referral machinery.** `redeemReferralCode` and `claimReferralFriendship` in `backend/src/account/referrals.ts`: one redemption per referee ever, no self-redeem, and only within `REFERRAL_SIGNUP_WINDOW_MS` (one day) of the referee's profile creation. On the app side the drain redeems a stashed `referralCode` with a bounded retry. The challenge links API (A1, branch `claude/landing-xgugio-challenge-links-api`) adds `POST /api/v1/challenges/:id/redeem`, which writes the same single referral row with its `challenge_id`.
- **Invite entry points.** `src/lib/components/arena/InviteLanding.svelte` behind `src/routes/i/[code]` and `src/routes/join/[code]`; the `?ref=` capture in `src/routes/(app)/+layout.svelte`; `src/routes/league/[code]`. Each stashes into the pending-onboarding payload and leads to sign-up.
- **Provider discovery.** `GET /api/v1/auth/providers` (`backend/src/routes/auth.ts`) is the public read the sign-in screens already make.
- **Legacy accounts.** An address with a legacy identity adopts its imported account, which already has a profile and a handle (`backend/src/auth/adoption.ts`); W1 keeps such mailboxes off the list.

## Scope

### 1. The owner can take the handle, and only the owner

In `checkNicknameAvailability` and `upsertMyProfile`, inside the write's transaction and under `lockHandleKey`:

- **Whose reservation.** The caller's reservation is the confirmed one, hold not ended, whose `email_key` equals `emailMailboxKey` of the verified address of any of the caller's `auth_identities` rows. "Verified" is what `resolveIdentity` already requires: a code-proven address or a provider-asserted one. So Google under the same mailbox takes a handle reserved with an email code, and the reverse.
- **Exemption.** The availability check runs with `excludeReservationKey` for the caller: their own reserved handle reads as available to them, in the signed-in probe and on the write. To everyone else it stays taken.
- **Claim.** A profile write that stores the reserved handle sets `hold_ended_at = now()` and `account_user_id`. From then on the profile's own index holds the handle.
- **Release.** `POST /api/v1/waitlist/mine/release` (session-gated) sets the same two columns without the handle being taken: the reserved handle is free for anyone at once. The app calls it when the person confirms a different handle while creating the account. It refuses when the caller's profile does not exist yet, so a handle is never released before the person has one.
- **Nothing is taken silently.** The server never rewrites the handle a request carries. If the app wrote another handle and never called release (a lost request, an older client), the reservation keeps holding for its owner, who can still switch to it; W2's 30-day window and the sweep of section 3 end it.
- The claim does not depend on admission: admission decides who gets through the gate (W2). An allowlisted tester with a reservation claims it the same way.
- After the claim the handle follows the existing change rules like any other.

### 2. The app pre-fills it, and it stays editable

- `GET /api/v1/waitlist/mine` (session-gated): `{ reservation: { handle, state, invite? } | null }` for the caller's mailboxes.
- **The first-touch bootstrap** asks for the reservation before it seeds: when there is one, the seed is the reserved handle. An account created from `/signin`, on any device, through any provider, therefore starts with the reserved handle.
- **The onboarding screen.** When the browser holds a waitlist cache whose server state is `admitted` (W1's `restore()`), or once the person has signed in and `/waitlist/mine` answers, the handle field starts with the reserved handle and a line says it was held for them. The field is editable: the probe runs as usual on any other value. Confirming another handle writes it and then calls release; the screen says the reserved handle goes back to everyone before they confirm.
- **The drain.** A handle stashed before sign-in that equals the reserved one is the claim. One that differs is the person's choice only if it was typed on the pre-filled screen; a stash written without knowledge of the reservation (another device, an older visit) does not override the reserved handle: the drain keeps the reserved one and tells the person, who can change it in the handle editor.
- **Arriving from the admission email** (the link goes to `/signin`, W2): sign in, the account is provisioned, the bootstrap seeds the reserved handle, onboarding completes with no handle step.
- W1's status read answers `joined` once `account_user_id` is set, so the landing stops saying "on the waitlist" on a returning visit.

### 3. Leftovers

A reservation whose hold has not ended and whose mailbox belongs to an account that has had a profile for more than `WAITLIST_UNCLAIMED_GRACE_DAYS` (7) is released by W1's `waitlist-prune` job: it covers the lost release call and an address linked to an account after the fact.

### 4. Inviter credit at account creation

The reservation remembers the last invite or challenge link the visitor arrived through (W1). When the account's profile is created, after the write's transaction commits, the server applies it once:

- `invited_referral_code`: `redeemReferralCode` then `claimReferralFriendship`, the calls the app's drain makes today.
- `invited_challenge_id`: A1's challenge redeem, when that part is merged; until then the column is written and not acted on.

It runs at profile creation, so it is always inside the referral window. A terminal refusal (unknown code, own code, already redeemed) is final and logged; a fault leaves the attribution on the row for the next profile write within the window. The app's own stash keeps working for a person who signs up directly: one redemption per person makes the two paths safe together. League invites are not carried on a reservation.

**An inviter who has no account yet** (a waitlister whose link was issued from a landing call, W4) cannot be written as a referrer. That case and its rule are W4's and W5's: this part applies credit only to inviters who have an account when the friend's is created.

### 5. Invite links while sign-up is closed

- `GET /api/v1/auth/providers` gains `signUp: 'open' | 'waitlist'`, `'waitlist'` exactly when the beta gate is enabled without `allowNewUsers`. It says nothing about any address.
- When it is `'waitlist'`, `/i/<code>`, `/join/<code>` and a signed-out `?ref=` capture keep stashing the invite exactly as today, then send the visitor to the landing with the capsule open (`/?claim=1`), not to sign-up. The capsule's code request reads the stash and puts the invite on the reservation.
- When it is `'open'`, nothing changes.
- `/league/<code>` is left as it is (pending decision 1): a league invite is not carried through the waitlist, and its page says the league can be joined once the account exists.

### Out of scope

- Reservation, hold, emails, removal: W1. Admission, the gate, the 30 days: W2.
- Landing calls, their conversion into predictions, "Challenge a friend" for waitlisters: W4. List order and inviter emails: W5.
- The handle rule and the bootstrap's generated seed: the handle rule spec.
- A sign-in link that needs no code.
- Legacy account adoption: untouched. An adopted account already has a profile and W1 gives it no reservation.

## Linked issues

Open issues were searched on 27 Nov 2026 (six open). #543 (anti-farm: gate referral and onboarding payouts on an authoritative trade) is adjacent to section 4: the redemption can now be made by the server but its gate, curve and cap are unchanged. No issue is linked.

## Analytics

Instrument.

| Event                  | Where                     | When                                       | Props                                                                                                                                                       |
| ---------------------- | ------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `waitlist_claimed`     | server, with `userId`     | a reservation's hold ended at an account   | `label` (`kept` or `released`), `value` (whole days between joining and this), `source` (the provider of the sign-in), `ok` (an inviter credit was applied) |
| `referral_redeemed`    | server (existing name)    | section 4 applied a credit                 | `source: 'waitlist'` or `'waitlist_challenge'`                                                                                                              |
| `onboarding_completed` | app (existing, unchanged) | the drain finishes                         | as today, `source: 'waitlist'` when a reservation was found                                                                                                 |
| `signed_up`            | app (existing, unchanged) | the account is created                     | as today; the first moment it fires for a waitlister                                                                                                        |
| `onboarding_step`      | app (existing name)       | an invite link was sent on to the waitlist | `source: 'invite_to_waitlist'`, `label` (`i`, `join`, `ref`)                                                                                                |

`waitlist_claimed` is an addition to the taxonomy (both halves of the app pair, and both lists in `backend/src/analytics/taxonomy.ts`). If `referral_redeemed` is client-only today it joins the server list. No email and no handle is sent.

## Technical requirements (satellite / backend: mandatory)

- **Performance.** One indexed lookup (reservations by the caller's mailbox keys) on a write that sets a handle and on the signed-in probe; nothing on other profile writes. `/waitlist/mine` is one lookup, once after sign-in. `/auth/providers` gains a read of one cached setting.
- **Memory and storage.** No table and no column: W1 carries what this part writes.
- **Scalability.** Constant per account creation. A burst of admissions becomes a burst of first sign-ins, each a handful of indexed statements.
- **Upgrade and compatibility.** No migration. `/auth/providers` gains a field: additive. During a deploy an old machine can create a profile without claiming; the reservation keeps holding for its owner and the next write or the sweep settles it. No `.did`, no bindings, nothing breaking.
- **Security.** The claim matches on addresses the server itself verified at sign-in; nothing the client sends selects a reservation. A person cannot take a handle reserved with a mailbox they did not prove. `signUp` exposes the gate's mode, which the refusal copy already reveals. Protected paths touched: `backend/src/profiles/profile-write.ts` and `nickname.ts`, `backend/src/routes/auth.ts` (one field), `backend/src/account/referrals.ts` (called).
- **Parameters.** `WAITLIST_UNCLAIMED_GRACE_DAYS` in `backend/src/waitlist/reservations.ts`; the referral window is `REFERRAL_SIGNUP_WINDOW_MS`, cited, not restated.

## Implementation outline

1. `backend/src/waitlist/claim.ts`: `findMyReservation({ q, userId })`, `endReservationHold({ q, id, userId })`, `releaseMyReservedHandle({ userId })`, `applyReservationInvite({ userId, reservation })`, `readMyReservation({ userId })`.
2. `backend/src/profiles/nickname.ts` and `profile-write.ts`: the exemption and the claim of section 1; the invite applied after the transaction commits on a profile creation.
3. Routes: `GET /waitlist/mine`, `POST /waitlist/mine/release`; `joined` on the status read; the sweep in the prune job; `signUp` on `/auth/providers`.
4. App: `getMyWaitlistReservation` and `releaseMyReservedHandle` in `src/lib/api-client/client.ts` and `waitlist.services.ts`; the bootstrap seed in `profile.services.ts`; the pre-filled, editable field in `Onboarding.svelte`; the drain's rule in `onboarding-handoff.services.ts` and its notice in `src/routes/(app)/+layout.svelte`; the invite pages and the `?ref=` capture reading `signUp`; `?claim=1` opening the capsule on the landing; i18n keys in every catalog (`onboarding.waitlist.*`).
5. **Docs in the same PR:** `PRODUCT.md` ("Onboarding: one screen" and "Onboarding: picks persist across every sign-in provider": the reserved handle is pre-filled and what releasing it means; "Friendship rules": credit through the waitlist and where invite links lead while sign-up is closed; "Legacy app: new accounts move to vici.app": the sentence saying the new app's sign-up is unchanged), `docs/ai/frontend/api-client.md`, `backend/README.md`.

**Tests**

- `backend/tests/waitlist-claim.test.ts`: the owner's probe says available, another account's says taken; a profile write with the reserved handle ends the hold once and stamps the account; the same through a Google identity and through an alias of the mailbox; an account with another mailbox cannot take it; a write with another handle leaves the reservation holding; release frees the handle for a third account, refuses without a profile, and is idempotent; the starter grant fires once; a referral invite is redeemed and the friendship written, a terminal refusal is swallowed, a fault leaves it for the next write; `/waitlist/mine` (401, none, waiting, admitted, joined); the sweep; `/auth/providers` answers `waitlist` only in strict gate mode.
- `backend/tests/profile-guards.test.ts`: every existing case unchanged for accounts without a reservation.
- App: the bootstrap seeds the reserved handle; the drain keeps it over a stash that did not come from the pre-filled screen; the onboarding field is pre-filled and editable; the invite pages route by `signUp`.
- E2E (`e2e/waitlist-claim.spec.ts`): join on the landing, admit, sign in from a clean browser with the email code and land in the app as the reserved handle; the same with Google; on the onboarding screen change the pre-filled handle, confirm, and see the reserved one become available to a second account; an invite link opened while sign-up is closed lands on the capsule and credits the inviter at account creation.

**Rollout.** With W2, before the first admission. Rollback: the previous image; accounts created meanwhile keep their handles, and reservations not yet claimed go back to being unavailable to everyone, their owners included, until the code returns.

**Risks**

- **The seed depends on a read.** If `/waitlist/mine` fails at the bootstrap, the account starts with a generated handle and the reservation keeps holding; the person must switch to it by hand before the sweep releases it. The bootstrap should retry before it falls back.
- **The wrong sign-in.** Someone who joined with one mailbox and signs in with another gets an ordinary account (if the gate lets them in at all) and no reserved handle. The admission email names the address to use.
- **A released handle is gone at once.** The confirmation on the onboarding screen must say so before the tap.
- **Credit applied late.** An inviter is credited weeks after the invite, and only if the friend is admitted and signs up.
- **`/league/<code>` still leads to a refused sign-up** while the gate is closed.

## Acceptance criteria

- [ ] An account created with a mailbox that holds a reservation starts with the reserved handle, on any device, from the onboarding screen or from `/signin`.
- [ ] It works with the email code and with Google asserting the same verified mailbox.
- [ ] The handle field shows the reserved handle and can be edited; confirming another handle releases the reserved one, which a different account can then take.
- [ ] Until claimed or released, no other account can take the reserved handle, and its owner always can.
- [ ] The server never stores a handle other than the one the request carried.
- [ ] An invite or challenge link remembered on the reservation credits the inviter once, at account creation, when that inviter has an account.
- [ ] While sign-up is closed, `/i/<code>`, `/join/<code>` and `?ref=` open the landing with the capsule ready and the invite ends up on the reservation; while it is open they behave as before.
- [ ] Accounts without a reservation behave exactly as before.
- [ ] `PRODUCT.md` describes the shipped behaviour; `bun run typecheck && bun test`, `npm run quality`, `npm run check`, `npm test` and `npm run e2e` pass.

## Open questions

1. **What does a first sign-in from `/signin` do today on vici.app for an address with no account and no stash:** which write creates the profile, with which handle, and is onboarding marked complete? Section 2 assumes the bootstrap is that write.
2. **Can the drain tell a handle typed on the pre-filled screen from an older stash?** If not, the stash needs a marker written by the screen.
3. **Is `referral_redeemed` emitted by the app only**, and does the referee's bonus notice depend on the app-side redeem? If so the server-side credit needs its own notice.
4. **A1's redeem as a domain function**: the name and contract to call from `applyReservationInvite`, and whether it accepts a call without a browser session.
5. **Does the landing accept a parameter that opens the capsule**, or does the landing page PR need to add `?claim=1`?

## Pending decisions

1. **Whether `/league/<code>` also leads to the waitlist while sign-up is closed.** The owner decision covers `/i/<code>` and `?ref=` only; the facts are known (section 2 of this spec and the Context list the entry points).
   - Recommended: leave it as it is (the scope above). A league invite only makes sense with an account, and carrying a league code on a reservation adds a column and a join step at account creation for a flow few people reach while the gate is closed.
   - Alternative: send it to the landing with the capsule ready and keep the league code on the reservation, joined at account creation like the referral credit. One more promise to keep across the wait.

## Decisions

Owner decisions (27 Nov 2026):

- **Any sign-in that proves the same email can take the reserved handle**: the email code, or Google with that verified email.
- **Onboarding pre-fills the reserved handle and it stays editable.** Picking another one releases the reserved handle.
- **Invite and challenge credit recorded on the reservation is applied at account creation.**
- **While sign-up is closed, app invite links (`/i/<code>`, `?ref=`) open the landing with the capsule ready and remember the invite.**
- Landing calls, "Challenge a friend" and the inviter email were decided with this part and are specified in W4 and W5.

Author's choices (a reviewer may overrule):

- **The server exempts the owner and never rewrites a handle.** With an editable field the server cannot know whether a different handle is a choice or a stale value, so it stores what it is sent, keeps the reservation for its owner, and ends the hold only on an explicit claim or release.
- **The bootstrap seeds the reserved handle**, so the paths that skip the onboarding screen still start with it.
- **A stash from another visit does not override the reservation.** The person asked for that handle with a verified email; a value typed weeks earlier in a browser is weaker evidence.
- **`/join/<code>` follows `/i/<code>`**: it renders the same component.
- **The claim is tied to the account, not to admission**, so an allowlisted tester or a later open sign-up honours reservations with no extra rule.
