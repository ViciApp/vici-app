# Spec: Challenge links, receiving end on the landing

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Draft

Part **A4** of the challenge links work; the parts and how they stack are listed in [`2026-11-26-feat-challenge-links-api.md`](./2026-11-26-feat-challenge-links-api.md). **Stacks on A1** (the public read, redeem, answer and the client transport) **and on the landing page PR** (the deck). Independent of A2, A3 and B, and buildable in parallel with them. Ships with the landing go-live.

## Goal

Opening `https://vici.app/c/<id>` shows the landing with the challenged market as the first card and a line from server data: "@maya called Yes at 38%. Think they're wrong?". Nothing on the page can be changed by editing the URL. If the visitor signs up, the challenger is credited; when the visitor makes their own call on that market, the challenger is told. The same lead-card mechanism also serves the plain "share this question" link, which carries a market and nothing else.

## Context

- **Landing.** The signed-out landing (a swipe deck of curated cards, components under `src/lib/components/landing/` with the `LandingDeck*` prefix, plus an attract demo that plays the deck by itself for a first-time visitor) is delivered by the landing page PR and is not on `main` at authoring time. That PR also adds the "share this question" button to the deck.
- **From A1.** `getChallenge(id)` in `src/lib/services/challenge.services.ts` returns the view (`seriesId`, `position` or null, `sideChanged`, `challenger` or null, `marketOpen`) or not found; `redeemChallenge`, `answerChallenge`; the id pattern in `src/lib/constants/challenge.constants.ts`. The view says nothing about who is reading it: `GET /api/v1/challenges/:id` (`backend/src/routes/challenges.ts`, PR #1732) is public and does not look at the session. With consent off `challenger` is null, and a matching handle would not prove identity anyway, so the client cannot tell the challenger from anyone else. A4 needs a small A1 addition for that (section 1).
- **Sign-up handoff.** `src/lib/components/arena/InviteLanding.svelte` (behind `src/routes/i/[code]` and `src/routes/join/[code]`) stashes `referralCode` into the `PENDING_ONBOARDING_STORAGE_KEY` payload; `drainPendingOnboarding` in `src/lib/services/onboarding-handoff.services.ts` redeems it after sign-in with a bounded retry (`MAX_DRAIN_ATTEMPTS`, `settlePendingSlot`); `src/routes/(app)/+layout.svelte` captures `?ref=` for signed-out visitors only.
- **Market share params.** `marketShareParam` / `parseMarketShareParam` in `src/lib/utils/market-slug.utils.ts` define the `slug~id8` shape; `src/routes/m/[id]/+page.svelte` shows how a param is resolved against the catalog, degrading to "no match" on a collision.
- **Market art.** `src/lib/components/market/MarketArtwork.svelte` renders a market's own artwork from its taxonomy category.
- **Placing a call.** `placeOrder` in `src/lib/services/order.services.ts` is the one path of every real call.
- **Web3 build.** No sign-up there (`areNewSignupsMoved`); `NEW_APP_ORIGIN` in `src/lib/constants/claim.constants.ts` is the new app's origin.

## Scope

### 1. The route

`src/routes/c/[id]/+page.svelte` is public. The id is the only thing it reads from the URL; query parameters never change what is shown.

- **Signed-out:** fetch the challenge view, render the landing with the lead card and the line, stash the attribution (section 4).
- **Signed-in:** go to the market detail (`/markets/{seriesId}`) with a banner carrying the same line and a "Predict in Flow" action (`setPinnedFlowMarket`). The challenger opening their own link gets the market detail with no banner.
- **The owner marker (A1 addition).** The view gains `isOwner: boolean`. The read keeps working signed out; when the request carries a valid session the route resolves it (the session lookup `requireUser` uses, without refusing an anonymous caller) and sets `isOwner` to whether the session's account is the link's challenger; signed out it is always `false`. A response computed for a session is sent `Cache-Control: private` with `Vary: Cookie`, so a shared cache never hands one viewer's marker to another; the preview (A2) reads signed out and is unaffected. The client type in `challenge.services.ts` and its schema gain the field. This is a follow-up PR on A1 (already implemented in #1732), landing before A4; the banner is hidden on `isOwner` and on nothing else.
- **Not found** (unknown, revoked, pruned, challenger hidden), a malformed id, or the API unreachable: the standard landing, no line, no attribution, no error screen.
- **Web3 build:** redirect to the same path on `NEW_APP_ORIGIN`.

### 2. The lead card

- The challenged market becomes the **first card of the deck, followed by the curated cards** (a curated market that is itself challenged is moved to the front, not duplicated). Any market can be challenged, so the deck accepts a series outside the curated set: where the market has no film clip, the card uses the market's own art (`MarketArtwork`).
- **The attract demo is off** when arriving through a link: the visitor came for one card and gets it, still.
- A market closed for predictions is not a card (there is nothing to call): the deck is the standard one and only the line is shown.

### 3. The line

Always the challenger's **current** state, from the server:

| State                               | Line                                                                                                                                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Position held, side as when created | "@maya called Yes at 38%. Think they're wrong?"                                                                                                                                                    |
| Position held, side changed since   | "@maya now says No at 41%. Think they're wrong?"                                                                                                                                                   |
| No position now (fully closed)      | "@maya challenged you on this. What's your call?"                                                                                                                                                  |
| Market closed                       | "@maya called Yes at 38% on this one. It has closed." (with the result when the existing public settlement read names one; without a position: "@maya challenged you on this one. It has closed.") |
| Any of the above, without consent   | the same with "A friend" in place of the handle                                                                                                                                                    |

The handle is shown exactly when the server sends one (the challenger consented for this link); the page applies no rule of its own. The price is the current position's side-framed entry price, shown as a whole percentage.

### 4. Inviter credit

- Opening a valid link signed-out sets `challengeId` in the pending-onboarding payload and **clears any `referralCode` there: last touch wins.** Symmetrically, the `/i/[code]`, `/join/[code]`, `/league/[code]` and `?ref=` stashes clear `challengeId`. The payload therefore never carries both.
- After sign-up, `drainPendingOnboarding` calls `redeemChallenge` in place of the referral redeem, with the same bounded retry and the same terminal-outcome handling (`not_eligible` and not found are terminal, a network failure is retried). The server decides everything else (one inviter per person ever, no double pay: A1).
- A valid link with no current position, or on a closed market, still credits.

### 5. Answering

- The route keeps a `challengeContext` (`id`, `seriesId`) in `localStorage`, with an expiry, for a signed-out visitor who then signs up and for a signed-in visitor sent to the market detail.
- After a successful `placeOrder` on that series, the client posts `answerChallenge(id)` once and clears the context. The server verifies the position in the engine; the client sends no side and no price. A failure is silent and retried on the next call on that series until the context expires.
- This is the hook B's confirmed landing calls go through as well, since they use `placeOrder`.

### 6. The plain "share this question" link

- The deck's share button (added by the landing page PR) produces `https://vici.app/?m=<slug~id8>`: a market and nothing else. No handle, no price, no attribution, no server verification, because it asserts nothing about anyone.
- The landing resolves `m` with `parseLandingMarketParam` (`src/lib/utils/landing-share.utils.ts`, added by the Markets PR #1730), which accepts both shapes `marketShareParam` hands out: `slug~id8`, and the bare full series id it falls back to when a title yields no slug (through `parseBareMarketShareParam` in `market-slug.utils.ts`; `parseMarketShareParam` alone answers `undefined` for that form). The id prefix it returns is matched against the catalog as `/m/[id]` does (one match or none), and that market is the lead card with the attract demo off. No line is shown. An unresolvable or closed market gives the standard landing.
- It sets nothing in the pending-onboarding payload and clears nothing.
- A signed-in visitor on `/?m=` is taken to the market detail.
- Its preview is the generic share card (no server work, A2 not involved).

### Out of scope

- The API (A1), the link preview (A2), issuing a link in the app and the inbox card (A3).
- The landing deck itself, its cards, the attract demo and the share button: the landing page PR. This spec adds the lead-card input, the line and the two entry points.
- The "Challenge a friend" action on the landing and the confirmation of landing taps: B.
- Deep-linking `/m/{slug}` for signed-out visitors (unchanged).

## Linked issues

Searched on 2026-11-27 for open issues matching "challenge", "landing" and "share link": none covers this work (the hits, #1142 on market clause authoring and #543 on gating referral payouts on an authoritative trade, are unrelated). No issue is linked.

## Analytics

Instrument. `challenge_opened` is already in the taxonomy once A1 is merged; this PR is where it is captured.

| Event               | When                                                   | Props                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `challenge_opened`  | the route resolved a view (or failed to)               | `marketId` when known, `label` (`called` \| `side_changed` \| `no_position` \| `market_closed` \| `not_found`), `ok` (handle shown), `source` (`signed_out` \| `signed_in`) |
| `referral_redeemed` | the drain redeemed a challenge (existing name)         | `source: 'challenge'`                                                                                                                                                       |
| `market_viewed`     | the landing opened on a plain question link (existing) | `marketId`, `source: 'question_link'`                                                                                                                                       |

`challenge_answered` is recorded by the server (A1). The challenge id is never sent; no handle is sent.

## Implementation outline

0. **A1 addition, its own PR before this one:** `isOwner` on the challenge view (section 1), the optional session read and cache headers in `backend/src/routes/challenges.ts`, the field in the client type, a test in `backend/tests/challenges.test.ts` (signed out `false`, the challenger `true`, another account `false`, consent off still `true` for the challenger).
1. `src/routes/c/[id]/+page.svelte`, thin: resolve, branch on session, render the landing page component with a `lead` input or redirect.
2. The landing deck accepts `leadSeriesId` and an `attract` switch (coordinate the prop names with the landing page PR); a non-curated lead card renders with `MarketArtwork`.
3. `src/lib/components/landing/LandingDeckChallengeLine.svelte`; `challengeLineKey(view)` in `src/lib/utils/challenge.utils.ts` (shared with A3; whichever merges first adds it).
4. A banner on the market detail page for a signed-in visitor (`src/lib/components/market/MarketDetailChallengeBanner.svelte`).
5. `challengeId` in `PendingOnboarding`, its strict parsing, the redeem branch in the drain and in `settlePendingSlot`; the last-touch clears in `InviteLanding.svelte`, `src/routes/league/[code]` and the `?ref=` capture in `src/routes/(app)/+layout.svelte`.
6. `src/lib/utils/challenge-context.utils.ts` (read, write, expiry) and the answer hook after `placeOrder`, in `order.services.ts`.
7. The `m` parameter on the landing route (`src/routes/+page.svelte`), read through `parseLandingMarketParam`; if #1730 has not merged, this PR adds that function and `parseBareMarketShareParam` as #1730 defines them.
8. The `/c` path next to `PublicPath` in `src/lib/constants/routes.constants.ts`; the context key and expiry in `src/lib/constants/challenge.constants.ts`.
9. i18n keys in every catalog: `landing.deck.challenge.*`, `market.detail.challenge.*`.
10. **Docs in the same PR:** `PRODUCT.md` (the receiving end, last-touch attribution in "Friendship rules", the plain question link), `frontend/reusability.md`.

**Tests**

- **Pure logic** (`src/tests/`): `challengeLineKey` for every row of the table; the last-touch merge of the pending payload in both directions; context expiry; `m` resolution (a `slug~id8` match, a bare full id from an unsluggable title, a collision, unknown).
- **E2E** (`e2e-web2/challenge-landing.spec.ts`, fake engine, links created through the API): the lead card and line for a live link; adding a handle, a side or a price as query parameters changes nothing; a link whose owner flipped side shows "now says"; a closed position shows the neutral line; consent off shows "A friend"; a revoked link shows the standard landing; the attract demo does not start; sign-up through the link makes the challenger the referrer, and an invite link opened afterwards replaces it; a call on the market after sign-up records an answer; a signed-in visitor lands on the market detail with the banner, and the challenger opening their own link, with consent on or off, gets no banner; `/?m=` puts that market first with no line and no attribution.

**Rollout.** Web build only, with the landing go-live. Before it, `/c/<id>` falls through to the SPA fallback. Rollback: the previous web image.

**Risks**

- **The deck contract is not on `main`.** If the deck cannot render an arbitrary series, the lead card falls back to curated markets only and other links show the line over the standard deck; that would contradict the owner's decision, so it must be settled with the landing page PR first (open question 1).
- **Thin market art.** A lead card without a film clip sits next to curated cards that have one. Accepted by the owner; the card must still meet the deck's layout at every breakpoint.
- **Last touch can replace a real inviter.** Someone invited by a friend who later opens a stranger's challenge link credits the stranger. It is the existing behaviour between invite links, and the payout cap and curve bound it.

## Acceptance criteria

- [ ] `/c/<id>` signed-out shows the challenged market as the first card, followed by the curated cards, with the attract demo off.
- [ ] The line matches the challenger's current state for each row of the table, and names the handle only when the server sends one.
- [ ] Editing or adding query parameters changes nothing shown.
- [ ] A market outside the curated set appears as the lead card with its own art.
- [ ] Unknown, revoked and hidden-account links, and an unreachable API, show the standard landing.
- [ ] A sign-up after opening a link credits that challenger once; a later invite link replaces it, and the reverse.
- [ ] A call on the challenged market by the visitor records an answer without the client sending side or price.
- [ ] A signed-in visitor gets the market detail with the banner; the challenger gets it without.
- [ ] `/?m=<slug~id8>`, and `/?m=<series id>` for a title with no slug, open the landing with that market first, no line, no attribution.
- [ ] The web3 build redirects `/c/<id>` to vici.app.
- [ ] Every string is in every catalog; `npm run quality`, `npm run check`, `npm test` and `npm run e2e:web2` pass.

## Open questions

1. **Landing deck contract.** Confirm with the landing page PR: the prop that sets a lead series, how a non-curated series is rendered, and how the attract demo is switched off.
2. **Share button URL.** Confirm the landing page PR's share button emits `/?m=` built with `marketShareParam` (#1730's `landingMarketShareUrl` does); if it already emits another shape, this spec adopts it.
3. **Landing go-live switch.** The route must follow the same switch as the landing.
4. **Open issues.** Run the issue search that was not possible at authoring time.

## Decisions

- **The receiving page always shows the challenger's current state** (owner): a changed side reads "@maya now says No at 41%" with the current position's price; a fully closed position gives the neutral line "@maya challenged you on this. What's your call?"; a closed market gives the past-tense line.
- **Any market can be challenged; the challenged market is the lead card, with its own art where it has no film clip, followed by the curated cards; the attract demo is off when arriving through a link** (owner).
- **Consent decides the handle** (owner): shown with consent regardless of profile privacy, "A friend" without. The page applies what the server sends.
- **"Answered" is a real call on the challenged market, engine-verified; sign-up alone is credit** (owner). Auto-friend happens on answer, never on open (owner), server-side.
- **Client analytics for the receiving end land in this PR** (owner).
- **The plain question link needs no server verification** (owner): it carries a market and asserts nothing about a person. The deck PR adds the button; this spec owns the receiving side.
- **Last touch wins between invite and challenge links.** It is what the existing stash already does between invite links, and the server's one-row-per-referee rule makes any race harmless.
- **`/?m=` rather than reusing `/m/{slug}`.** `/m/` resolves to the market detail behind the app gate; the question link must open the landing deck.
