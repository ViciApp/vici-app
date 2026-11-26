# Spec: Waitlist, claim the reserved handle at account creation

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Draft

Part **W3** of the waitlist; the parts and how they stack are listed in [`2026-11-27-feat-handle-waitlist.md`](./2026-11-27-feat-handle-waitlist.md). **Stacks on W1.** Buildable in parallel with W2. Must be merged, with W2, before the first person is admitted. Implementation PR title: `feat(waitlist): claim the reserved handle at account creation`.

It also states how two drafts of the challenge links work must change now that the landing no longer signs people up: `specs/2026-11-26-feat-landing-calls-conversion.md` (part B) and `specs/2026-11-26-feat-challenge-links-landing.md` (part A4). Both live on the branch `claude/landing-xgugio-challenge-links-spec` and are not on `main` at authoring time; this spec does not edit them, it lists the edits they need.

## Goal

A person who reserved a handle and was admitted creates their account by signing in with the email they joined with. The account is born with the reserved handle: they do not pick one again, nobody could have taken it meanwhile, and it does not matter which provider proved the email or which device they are on. Whoever invited them is credited at that moment, and the predictions they tapped on the landing, if still on that device, are offered for confirmation then.

## Context

- **From W1.** `waitlist_reservations` (`email`, `handle`, `handle_key`, `claimed_at`, `claimed_user_id`, `invited_referral_code`, `invited_challenge_id`), the waitlist clause and `excludeReservationEmail` in `checkNicknameAvailability` (`backend/src/profiles/nickname.ts`), `lockHandleKey`, the status read and the app-side cache in `src/lib/services/waitlist.services.ts`. After W1 a reserved handle is unavailable to every account, its owner included.
- **How an account gets its handle today.** A first verified sign-in provisions the user in `resolveIdentity` (`backend/src/auth/identity.ts`), with the proven email on its `auth_identities` row. The profile is created by the app's first profile write: `ensureProfile` in `src/lib/services/profile.services.ts` seeds a nickname ("first-touch bootstrap"), then `drainPendingOnboarding` in `src/lib/services/onboarding-handoff.services.ts` applies the handle stashed by the onboarding screen through `applyOnboardingPicks`, reporting `collision` when it was taken meanwhile. Every write ends in `upsertMyProfile` and `assertValidNickname` (`backend/src/profiles/profile-write.ts`), then `runProfileAwardTriggers` (the starter VXP).
- **The onboarding screen.** `src/lib/components/onboarding/Onboarding.svelte`: handle field with the live probe, provider stack, rendered at `/signup`; `/signin` is the returning-user screen and also provisions an account for an address it has never seen.
- **Referral machinery.** `redeemReferralCode` and `claimReferralFriendship` in `backend/src/account/referrals.ts` (one redemption per referee ever, a sign-up window, no self-redeem); on the app side the drain redeems a stashed `referralCode` with a bounded retry. Invite landings: `src/lib/components/arena/InviteLanding.svelte` behind `src/routes/i/[code]` and `src/routes/join/[code]`, `src/routes/league/[code]`, and the `?ref=` capture in `src/routes/(app)/+layout.svelte`.
- **Legacy accounts.** An address with a legacy identity adopts its imported account, which already has a profile and a handle (`backend/src/auth/adoption.ts`). W1's pending decision 4 decides whether such an address can be on the list at all.

## Scope

### 1. The server puts the handle on the account

In `upsertMyProfile`, inside its transaction:

- **At profile creation** (no stored row for the caller): look up a confirmed, unclaimed reservation whose `email` equals the verified email of any of the caller's `auth_identities` rows. If there is one, the reserved handle **replaces** whatever nickname the request carries, the availability check runs with `excludeReservationEmail`, and after the insert the row gets `claimed_at = now()` and `claimed_user_id`. The response carries the stored profile, so the app shows the handle the server chose.
- **On a later write**, the owner of an unclaimed reservation may set their profile to their reserved handle (same exemption, same stamp). Any other handle follows today's rules.
- "Verified" means what `resolveIdentity` already requires of every caller: a code-proven address or a provider-asserted one. So Google with the same address claims a handle reserved with an email code, and the reverse (pending decision 1).
- The claim does not depend on admission: admission only decides who gets through the gate (W2). An allowlisted tester with a reservation claims it the same way.
- A stashed onboarding handle that differs from the reserved one is dropped by the drain (it would otherwise overwrite the reserved handle one write later): `applyOnboardingPicks` is not given a handle when the profile came back with a claimed reservation, and the drain reports it with its own outcome so the layout can say "@handle was held for you.".
- Changing the handle afterwards follows the existing handle-change rules, exactly as for any account.

### 2. The app knows there is a reservation

- `GET /api/v1/waitlist/mine` (session-gated): `{ reservation: { handle, state, challengeId? } | null }` for the caller's verified emails. Used after sign-in to show the held handle and to hand a challenge back to the answer hook (section 5).
- **Onboarding screen.** When the browser holds a waitlist cache whose server state is `admitted` (W1's `restore()`), the handle field shows the reserved handle, read-only, with a line saying it is held and which sign-in to use; the probe is skipped. On a device with no cache the screen is unchanged: whatever the person types, the account gets the reserved handle, and they are told.
- **Arriving from the admission email** (the link goes to `/signin`, W2): sign in, the account is provisioned, the first profile write claims the handle, onboarding is complete with no handle step.
- `state` becomes `joined` on the status read once claimed, so the landing can stop saying "on the waitlist" on a returning visit.

### 3. Leftovers

A confirmed, unclaimed reservation whose email belongs to an account that already has a profile (an address linked to an account after the fact) will never be claimed at creation. An hourly sweep in W1's `waitlist-prune` job deletes such rows once the account is older than a day. Nothing else in this part expires a reservation (W1 and W2 own retention).

### 4. Inviter credit follows the reservation

If W1's pending decision 12 is accepted, the reservation remembers the last invite or challenge link the visitor arrived through. At the claim, after the profile insert and outside its transaction, the server applies it:

- `invited_referral_code`: `redeemReferralCode` then `claimReferralFriendship`, the calls the app's drain makes today.
- `invited_challenge_id`: the challenge redeem of the challenge links API (part A1), when that part is merged; until then the column is written and not acted on.

A terminal refusal (unknown code, own code, already redeemed) is final and logged; a fault leaves the attribution on the row for the next profile write. The app's own stash keeps working for a person who signs up directly: the one-redemption-per-person rule makes the two paths safe together.

League invites (`/league/[code]`) are not carried on a reservation: the person joins the league from its link once they have an account.

### 5. Edits required to the challenge links drafts

**Part B, landing calls (conversion).** Its mechanics stand: nothing is placed without an explicit confirmation, at the price of that moment. What changes:

- **When.** "At sign-up" becomes "when an admitted waitlister creates the account, or an existing account signs in". The sheet opens after the claim of section 1, on the device that holds the taps. Part B no longer ships with the landing go-live: it must be in place before the first admission.
- **How long taps are kept.** Seven days does not span a wait of unknown length (pending decision 3).
- **The line after a tap.** The visitor has no account and no VXP and cannot have either yet, so "You called Yes with 50 VXP. If you're right, you earn N VXP." no longer describes anything that will happen soon (pending decision 4).
- **Its section 5.** "Challenge a friend" on the landing asked for a handle and then issued a link bound to a real prediction. A waitlister has no prediction, so no verified link can exist (pending decision 5). The challenge action after the confirmation sheet, inside the app, is unchanged.
- **The hand-off.** Pending calls and the challenge intent are copied into the pending-onboarding payload when sign-in starts, from `/signin` as well as from the onboarding screen, since the admission email leads to `/signin`.
- **Its end-to-end tests** gain the steps join, admit, create the account, before the sheet.

**Part A4, the receiving end of a challenge link.**

- **The page.** Unchanged for a signed-in visitor. For a signed-out visitor the lead card and the line are unchanged; the action leads to the waitlist capsule, not to sign-up.
- **Inviter credit** (its section 4). The `challengeId` stashed in the pending-onboarding payload is also sent with the waitlist code request and stored on the reservation; the credit is applied at account creation by section 4 above. Last touch still wins, decided at the moment of joining.
- **Answering** (its section 5). The browser-side challenge context expires long before an admission. After the claim, `/waitlist/mine` returns the `challengeId`; the app seeds the context from it, so the person's first call on that market records the answer, if the market is still open. The challenger hears about it then, not when the friend joined the list (pending decision 6).
- **Its acceptance criterion** "a sign-up after opening a link credits that challenger once" becomes "an account created by a waitlister who joined after opening a link credits that challenger once".
- Parts A1, A2 and A3 are unaffected: links are issued by people who have accounts.

### 6. Invite links while sign-up is closed

`InviteLanding.svelte` ends in "create account", which the gate now refuses for anyone not admitted. Its action changes to open the landing's waitlist capsule with the invite stashed (pending decision 7).

### Out of scope

- Reservation, hold, retention: W1. Admission, the gate, the emails: W2.
- The challenge links API, previews and in-app action: parts A1 to A3.
- Storing landing taps on the server (unless pending decision 3 picks it; that would be a spec of its own).
- A sign-in link that needs no code.
- Handle-change rules.
- Legacy account adoption: untouched. An adopted account already has a profile, so section 1's creation rule never fires for it.

## Linked issues

Open issues were searched on 26 Nov 2026 (six open). #543 (anti-farm: gate referral and onboarding payouts on an authoritative trade) is adjacent to section 4: the redemption moves from the client to the server but its gate, curve and cap are unchanged, so this neither fixes nor widens it. `Part of` is not claimed. No issue is linked.

## Analytics

Instrument.

| Event                  | Where                     | When                                  | Props                                                                                                                                    |
| ---------------------- | ------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `waitlist_claimed`     | server, with `userId`     | a profile write claimed a reservation | `value` (whole days between joining and the claim), `label` (the provider of the creating sign-in), `ok` (an inviter credit was applied) |
| `referral_redeemed`    | server (existing name)    | section 4 applied a credit            | `source: 'waitlist'` or `'waitlist_challenge'`                                                                                           |
| `onboarding_completed` | app (existing, unchanged) | the drain finishes                    | as today; `source: 'waitlist'` when the handle came from a reservation                                                                   |
| `signed_up`            | app (existing, unchanged) | the account is created                | as today; this is the first moment it fires for a waitlister                                                                             |

`waitlist_claimed` is an addition to the taxonomy (both halves of the app pair, and `ANALYTICS_EVENT_NAMES` plus `SERVER_ANALYTICS_EVENT_NAMES` in `backend/src/analytics/taxonomy.ts`). If `referral_redeemed` is client-only today, it joins the server list. No email and no handle is sent.

## Technical requirements (satellite / backend: mandatory)

- **Performance.** One extra indexed lookup on a profile creation (reservations by the caller's emails) and one on a write that sets a handle. Nothing on other profile writes. `/waitlist/mine` is one lookup, called once after sign-in.
- **Memory and storage.** No table and no column: W1 already carries `claimed_at`, `claimed_user_id` and the attribution.
- **Scalability.** Constant per account creation. A burst of admissions turns into a burst of first sign-ins, each a handful of indexed statements.
- **Upgrade and compatibility.** No migration. `upsertMyProfile` may now store a nickname other than the one requested: additive for clients that read the response, and the app does. During a deploy an old machine creates the profile with the requested handle and leaves the reservation unclaimed; the later-write rule of section 1 and the leftover sweep cover it, and the first admissions should not overlap a deploy. No `.did`, no bindings, nothing breaking.
- **Security.** The claim matches on emails the server itself verified at sign-in; nothing the client sends selects a reservation. A person cannot claim a handle reserved with an address they did not prove. Protected paths touched: `backend/src/profiles/profile-write.ts` and `nickname.ts`, `backend/src/account/referrals.ts` (called, not changed), `backend/src/routes/waitlist.ts`.
- **Parameters.** None introduced beyond the sweep's one-day age, a named constant in `backend/src/waitlist/reservations.ts`.

## Implementation outline

1. `backend/src/waitlist/claim.ts`: `findClaimableReservation({ q, userId })`, `markReservationClaimed({ q, id, userId })`, `applyReservationAttribution({ userId, reservation })`, `readMyReservation({ userId })`.
2. `backend/src/profiles/profile-write.ts`: the creation rule and the later-write exemption of section 1, under `lockHandleKey`; attribution applied after the transaction commits.
3. `GET /waitlist/mine` in `backend/src/routes/waitlist.ts`; `joined` on the status read; the leftover sweep in the prune job.
4. App: `getMyWaitlistReservation` in `src/lib/web2/client.ts` and `waitlist.services.ts`; `Onboarding.svelte` read-only handle state; the drain's reserved-handle outcome in `onboarding-handoff.services.ts` and its toast in `src/routes/(app)/+layout.svelte`; the challenge context seed; `InviteLanding.svelte` per pending decision 7; i18n keys in every catalog (`onboarding.waitlist.*`).
5. **Docs in the same PR:** `PRODUCT.md` ("Onboarding: one screen" and "Onboarding: picks persist across every sign-in provider": a reserved handle wins over a typed or stashed one; "Friendship rules": credit through the waitlist; "Legacy app: new accounts move to vici.app": the sentence saying the new app's sign-up is unchanged, and where an invite link from the legacy app now lands), `docs/ai/frontend/web2-backend-mode.md`, `backend/README.md`.

**Tests**

- `backend/tests/waitlist-claim.test.ts`: a first profile write for an account whose email holds a reservation stores the reserved handle whatever the request carried, in the owner's form, and stamps the claim; the same through a Google identity with that address; an account with another email cannot take the handle and gets its own; a second write does not claim twice; the owner can set the reserved handle on a later write; the starter grant fires once; a referral attribution is redeemed and the friendship written, a terminal refusal is swallowed, a fault leaves it for the next write; `/waitlist/mine` (401, none, waiting, admitted, joined); the leftover sweep.
- `backend/tests/profile-guards.test.ts`: every existing case unchanged for accounts without a reservation.
- App: the drain drops a stashed handle when a reservation was claimed and reports the outcome; the onboarding screen's read-only state.
- E2E (`e2e-web2/waitlist-claim.spec.ts`): join on the landing, admit, sign in from a clean browser with the email code and land in the app as the reserved handle; the same with Google; type another handle on the onboarding screen and still get the reserved one, with the notice; an invite link opened before joining credits the inviter at account creation.

**Rollout.** With W2, before the first admission. Rollback: the previous image; accounts created meanwhile keep their handles, reservations not yet claimed go back to being unavailable to everyone, their owners included, until the code returns.

**Risks**

- **A profile write that changes its input.** `upsertMyProfile` storing another nickname than the one sent is new; any caller that trusts its own copy over the response would show the wrong handle until reload.
- **The wrong sign-in.** Someone who joined with one address and signs in with another gets an ordinary account (if the gate lets them in at all) and no reserved handle. The admission email and the onboarding line name the address; the reservation stays claimable by the right one.
- **Taps rarely survive the wait.** Whatever pending decision 3 picks, most landing taps will not be confirmable by the time the account exists: markets close and prices move. Part B's sheet must read well with zero rows left.
- **Credit applied late.** An inviter is credited weeks after the invite, and only if the friend is admitted and signs up.

## Acceptance criteria

- [ ] An account created with the email of a reservation has the reserved handle from its first profile write, on any device, with no handle step.
- [ ] It works with the email code and with any provider that asserts the same verified address.
- [ ] No other account can take that handle before or after, while the reservation holds it.
- [ ] A different handle typed or stashed during onboarding does not replace the reserved one, and the person is told.
- [ ] The reservation is marked claimed once, and the landing shows a returning visitor as joined.
- [ ] An invite or challenge attribution on the reservation credits the inviter once at account creation.
- [ ] Accounts without a reservation behave exactly as before.
- [ ] The two challenge links drafts are updated as section 5 lists, by their owners, before their status moves from Draft.
- [ ] `PRODUCT.md` describes the shipped behaviour; `bun run typecheck && bun test`, `npm run quality`, `npm run check`, `npm test` and `npm run e2e:web2` pass.

## Open questions

1. **What does a first sign-in from `/signin` do today on the web2 build for an address with no account and no stash:** which write creates the profile, with which nickname, and is onboarding marked complete? Section 1 assumes the first profile write is the creation point for every path.
2. **Does every caller of the profile write use the returned profile** (`ensureProfile`, `applyOnboardingPicks`, the settings editor), so a server-chosen handle shows at once?
3. **Is `referral_redeemed` emitted by the app only**, and does the referee's bonus notice depend on the app-side redeem? If so the server-side credit needs its own notice.
4. **Part A1's redeem function** name and contract, once merged, for `invited_challenge_id`.
5. **Does the landing page PR persist taps already**, and where (part B's own open question 1)? It decides where pending decision 3 is implemented.

## Pending decisions

1. **Which sign-ins can take the reserved handle.** Recommended: any sign-in that proves the same email, so a person who joined with an email code can create the account with Google under that address. Alternative: only the email-code sign-in (stricter, but someone who taps "Continue with Google" would lose their handle without understanding why).
2. **Can the person pick another handle while creating the account?** Recommended: no; the account starts with the reserved handle, and it can be changed afterwards under the normal handle-change rule. Alternative: pre-fill it but let them type another, in which case the reserved one is released.
3. **Landing taps and the wait.** Recommended: keep them on the visitor's device until the market closes (still at most 10), and offer them for confirmation at account creation if they are still there. Alternatives: store them with the reservation so they follow the person to any device (more data kept about people who have no account yet, and a new server surface); or drop the conversion and make a landing tap only open the waitlist.
4. **The line after a tap on the landing.** Recommended: a line that promises nothing yet, for example "Yes at 62%. Calls open with the waitlist.". Alternative: keep "You called Yes with 50 VXP. If you're right, you earn N VXP.", accepted earlier when sign-up was immediate.
5. **"Challenge a friend" on the landing.** Recommended: not offered to people who can only join the waitlist, since a verified link needs a real prediction; the landing offers the plain "share this question" link, and the invite credit still works through it if the friend joins. Alternative: a waitlist invite link of its own ("@maya is on the list, join her"), a new kind of link to design and protect.
6. **Tell the inviter when a friend joins the waitlist?** Recommended: no; they are told when the friend has an account and answers, as designed. Alternative: an inbox note at the join, which needs the inviter's consent rules extended to people who are not users yet.
7. **Invite links while sign-up is closed.** Recommended: the invite page sends the visitor to the waitlist with the invite remembered. Alternative: leave it leading to sign-up, where a non-admitted person is refused and reads the line pointing to the waitlist.

## Decisions

- **The server sets the handle; the app only shows it** (author's technical choice). The account can be created from `/signin`, from the onboarding screen, on another device, through any provider; the profile write is the one place they all pass. A client-side pre-fill alone would lose the handle on every path that skips the screen.
- **The claim is tied to account creation, not to admission.** Admission is the gate's concern; keeping the two apart lets an allowlisted tester or a later open sign-up honour reservations with no extra rule.
- **Attribution is applied by the server from the reservation.** The browser that opened the invite is often not the one that creates the account weeks later.
