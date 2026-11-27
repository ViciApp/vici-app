# Spec: Challenge links, "Challenge a friend" in the app

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: In progress (#1776)

Part **A3** of the challenge links work; the parts and how they stack are listed in [`2026-11-26-feat-challenge-links-api.md`](./2026-11-26-feat-challenge-links-api.md). **Stacks on A1** (routes and the client transport). Independent of A2, A4 and B, and buildable in parallel with them. Ships with the landing go-live.

## Goal

After any real prediction, a signed-in user can tap "Challenge a friend" on the back of the Flow card or on the market detail page. A sheet shows exactly what the friend will see, asks whether to show the user's @handle and call on this link (on by default), and sends a short verified link. When a friend answers with their own call, the user gets an inbox card.

## Context

- **Share surfaces.** `src/lib/components/market/SharePopover.svelte` (opened from `FlowBackHeader.svelte` on the back of a Flow card) and `MarketDetailShareButton.svelte` on the market detail page share `/m/{slug~id8}?ref=<code>` links. `src/lib/services/share.services.ts` holds `notifyShareFailed`; `src/lib/utils/clipboard.utils.ts` holds `writeToClipboard`; the channel icons are under `src/lib/components/icons/`.
- **Positions.** `src/lib/stores/positions.store.ts` tells whether the viewer holds a position on a series.
- **Inbox.** Derived on the client from server state: `src/lib/stores/inbox.store.ts` builds `InboxNotification` cards (`src/lib/types/inbox.ts`) from stores; read and dismissed state live in `localStorage` (`src/lib/constants/inbox.constants.ts`); `NOTIFICATION_KIND_CONFIG` (`src/lib/constants/notification-kind.constants.ts`) maps a kind to icon and destination. The kind `'challenge'` is in the union and the config and no store produces it today.
- **From A1.** `src/lib/services/challenge.services.ts` (`createChallenge`, `setChallengeConsent`, `revokeChallenge`, `listChallengeAnswers`, `areChallengeLinksEnabled`), `src/lib/types/challenge.ts`. Creation needs a real engine position and returns the same link for the same series.
- **Privacy settings.** Settings → Privacy holds the profile-level sharing choices (`preferences.sharing`).

## Scope

### 1. The action

- "Challenge a friend" appears next to the existing share button on the back of a Flow card (`FlowBackHeader.svelte`) and beside `MarketDetailShareButton.svelte`, whenever the viewer holds a binary position on that market and the market is open. Any market qualifies, not only the curated ones.
- It is hidden when the viewer holds no position there, when the market is closed for predictions, on a non-binary series, and when `areChallengeLinksEnabled()` is false (the web3 build). Components read that function; none branches on the backend.

### 2. The share sheet, with consent

Tapping the action opens a sheet. The link is created when the sheet opens (creation is idempotent, so reopening returns the same link).

- **A preview of what recipients will see**, rendered from the server's response, not from local state: the line "@maya called Yes at 38%. Think they're wrong?" over the market title.
- **The consent toggle:** "Show my @handle and my call on this link", **on by default**. Turning it off changes the preview in place to "A friend called Yes at 38%. Think they're wrong?" and is saved to the link (`setChallengeConsent`) before anything is shared. A note under it states the consequence in one sentence: with it on, anyone with the link sees the handle and this call, even if the profile is private.
- **Send:** `navigator.share` when available, with the text "@maya challenged you on VICI. Think they're wrong?" (or "A friend challenged you on VICI..." without consent) and the URL `https://vici.app/c/<id>`; otherwise WhatsApp, Telegram and "Copy link".
- **Afterwards:** the same sheet, reopened for a market that already has a link, shows the current consent state (still changeable) and "Turn off this link" (`revokeChallenge`, with a confirmation). The sheet also says that the link always shows the user's current position on this market.
- **Failures:** `no_position` (the position was closed in another tab) closes the sheet with a notice; `market_closed` likewise; a rate limit shows the standard "try again later" notice.

### 3. "Your friend answered"

- `src/lib/stores/challenge-answers.store.ts` loads `listChallengeAnswers` with the app shell and on the same refresh points as the other inbox sources, and is cleared on identity change.
- `inbox.store.ts` derives one `'challenge'` card per answer: "@leo called No at 44%. You said Yes at 38%." (the user's side and price are their current ones on that link; when they hold nothing now: "@leo called No at 44% on your challenge."). It deep-links to the market (`mid`). Read and dismissed state use the existing overlays. Cards older than the window the inbox already uses for social cards drop out.
- An answer always comes from a friend (A1 writes the friendship when it records the answer), so the handle is shown.
- A sign-up through the link without a call produces no card: it is credit, shown in the referral list as today.

### Out of scope

- The API: A1. The link preview: A2. The receiving page and the stash that credits the inviter: A4.
- The "Challenge a friend" action on the landing and after onboarding: B (which reuses this sheet; see "Risks").
- A list of "my challenge links" as a screen of its own. Managing a link happens in its sheet.
- Push or email notifications.
- Changes to `SharePopover`'s existing link and image sharing.

## Linked issues

Searched open issues for "challenge" and "share" at implementation (2026-11-27): none matches this work. No issue is linked.

## Analytics

Instrument, with names that exist once A1 is merged (no taxonomy change in this PR):

- `market_shared` with `source: 'challenge'`, `marketId`, `label` = channel (`native` \| `whatsapp` \| `telegram` \| `copy`), `ok` = consent on. Fired when the link is actually sent or copied.
- `notification_opened` with `label: 'challenge'` for the inbox card (already in its documented vocabulary).
- Creation itself is `challenge_created`, recorded by the server in A1; the client adds nothing for it.

No handle and no challenge id is sent.

## Implementation outline

1. `src/lib/components/market/ChallengeShareButton.svelte` and `ChallengeShareSheet.svelte`; mounted in `FlowBackHeader.svelte` and beside `MarketDetailShareButton.svelte`. The sheet takes the series id and a `source` so B can mount the same component.
2. `src/lib/utils/challenge.utils.ts`: `challengeLineKey(view)` mapping a challenge view to its copy key and params (shared with A4; whichever merges first adds it, the other reuses it), and `challengeUrl(id)`.
3. `src/lib/stores/challenge-answers.store.ts`; the derived source and card in `inbox.store.ts`; the clear in `src/lib/services/identity-storage.services.ts` alongside the other inbox state.
4. i18n keys in every catalog under `src/lib/constants/messages/`: `challenge.share.*`, `challenge.line.*`, `inbox.challenge_answer.*`.
5. **Docs in the same PR:** `PRODUCT.md` (the action, the consent rule, the inbox card), `frontend/reusability.md` (sheet, util, store).

**Tests**

- **Pure logic** (`src/tests/`): `challengeLineKey` for every state (side as created, side changed, no position, market closed, each with and without consent); the inbox card derivation (current side, no position, ordering, dismissal).
- **E2E** (`e2e-web2/challenge-share.spec.ts`, fake engine seeded with a position): the action is absent without a position and present with one; the sheet's preview matches the server's values; turning consent off changes the preview and the public read of the link; copy yields a `/c/<id>` URL; reopening returns the same URL; "Turn off this link" makes the public read answer not found; after a second account answers through the API, the first account's inbox shows the card and it opens the market.
- A11y: the toggle is a labelled switch, the sheet traps focus and closes on Escape, the channel buttons are real links and buttons.

**Rollout.** Web build only. The action stays hidden until the landing go-live switch is on (see the open question), because the links it produces lead to the landing.

**Risks**

- **The sheet is shared with B.** B's last step needs this sheet (the consent toggle must not exist twice). B stacks on A1 only, so whichever of A3 and B merges second mounts the component the first one added; if B merges first it adds `ChallengeShareSheet.svelte` and this PR adds only the button and the inbox card. The two implementers must agree on the component's props before either starts.
- **Consent default is on.** It is the owner's decision; the preview in the sheet is what keeps it informed consent.
- **Messenger previews are cached.** Turning consent off, or revoking, cannot recall a preview already unfurled in a chat (A2). The sheet says so next to "Turn off this link".

## Acceptance criteria

- [ ] With a position on an open market, "Challenge a friend" is shown on the back of the Flow card and on the market detail page; without one, on a closed market, and on the web3 build it is not.
- [ ] The sheet's preview shows the server's handle, side and price, and matches what the public read returns.
- [ ] The consent toggle is on by default; turning it off changes the preview to "A friend ..." and the public read stops carrying the handle, before any share.
- [ ] With consent on, the handle is shown on the link even when the profile is private.
- [ ] Sharing sends `https://vici.app/c/<id>`; sharing again for the same market sends the same URL.
- [ ] The owner can change consent later and can turn the link off.
- [ ] When a friend makes a call on the challenged market, one inbox card appears and opens that market.
- [ ] Every string is in every catalog; `npm run quality`, `npm run check`, `npm test` and `npm run e2e:web2` pass.

## Open questions

1. **Landing go-live switch.** Do the landing PRs go live by merge and deploy alone or behind a constant or env flag? The action must follow the same switch.
2. **Open issues.** Run the issue search that was not possible at authoring time.

## Decisions

- **Sharing is consent** (owner). The share sheet asks explicitly to show the @handle and the call for this link, defaults to on, and shows exactly what recipients will see. With consent the receiving page shows handle, side and price even for a private profile or `callsPublic: false`; without it, "A friend called ...". Consent is stored per link and revocable.
- **Any market can be challenged** (owner).
- **An inbox card only for a real answer** (owner): a call on the challenged market, engine-verified. A sign-up alone is credit.
- **Client analytics for the action land in this PR** (owner), not in the landing analytics PR.
- **Create on open, not on send.** The preview must show server data, and creation is idempotent and limited per account, so opening the sheet twice costs nothing.
- **One sheet for share, consent and revoke.** A separate management screen would hide the consent the owner asked to keep in front of the user.
