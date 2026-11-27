# The API client (the backend seam)

The app has one backend: the HTTP API in
[`backend/`](../../../backend/README.md), served under `/api/v1/...`. The
browser holds no signing identity. Sessions are HttpOnly cookies, every
account-scoped engine call is signed server-side with the caller's derived
custodial identity, and public engine reads ride the API's HTTP bridge. The
one direct canister read left in the frontend is the public order book (plus
the public ICRC fee query the VXP sweep reserves for); both run under
`AnonymousIdentity`.

Read this page before adding an API call to a frontend service.

## The seam

Three files under `src/lib/web2/`, plus the base URL helper:

- [`client.ts`](../../../src/lib/web2/client.ts): thin typed fetch client.
  Every request sends `credentials: 'include'` (the client holds no auth
  state) and non-2xx responses throw `Web2ApiError` carrying `status` plus
  the stable `code` from the API's `{ error: string }` envelope (plus
  `amounts` when an `insufficient_balance` order refusal carries them). One
  typed wrapper per endpoint, shape mapping only.
- [`engine-wire.ts`](../../../src/lib/web2/engine-wire.ts): the bridge
  returns the canisters' candid responses serialized to JSON (bigints as
  decimal strings, principals as text, optionals still `[] | [value]`). The
  per-type mappers convert each payload back into the exact `#declarations`
  types, so utils, stores and components consume candid shapes. Mappers are
  field-explicit on purpose: a blanket digits-to-bigint pass cannot tell an id
  string from a serialized bigint.
- [`session.ts`](../../../src/lib/web2/session.ts): the cookie-session store
  (see "Auth").
- `web2ApiBaseUrl()` in [`#lib/env/app.env.ts`](../../../src/lib/env/app.env.ts)
  reads `VITE_WEB2_API_URL`.

## Env vars

| Var                       | Values              | Default | Effect                                                                                                                                                                                             |
| ------------------------- | ------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_WEB2_API_URL`       | origin URL          | empty   | Base of the HTTP API. Empty = same-origin relative (reverse-proxy shape). `fly.web.toml` bakes the production value.                                                                               |
| `VITE_TURNSTILE_SITE_KEY` | Cloudflare site key | empty   | Public key of the Turnstile widget in front of the anonymous endpoints (`turnstileSiteKey()` in `#lib/env/app.env.ts`). Empty sends an empty token, which the API accepts only outside production. |

## The service pattern

1. **Call the API from the owning `*.services.ts` module.** Buffering,
   debounce, validation, UX and error swallowing stay in the service; the
   `client.ts` wrapper only sends bytes and maps shapes.
2. **Static imports only.** Never `await import()` a wrapper.
3. **One typed wrapper per endpoint in `client.ts`**, typed to the route's
   wire contract. If the wire shape differs from the app shape, map it inside
   the wrapper, not in the service. A money or identity endpoint parses its
   body with a schema from `#lib/schema/web2-api.schema.ts` through
   `parsedRequest`: a body that does not match throws `Web2ApiError`
   `invalid_response` with the 2xx status, so a caller reads the outcome as
   unknown, never as success.
4. **A single HTTP read is the final pass.** Loaders built for a
   query-then-update pair (`onLoad({ certified, response })`) receive the one
   API response as `certified: true`.
5. **Components never call `client.ts`.** They go through a service.

### The identity rename

The API keys a user by an opaque account id (`userId`, a uuid). The app's
domain shapes carry that identity in a single `owner` string
(`UserProfile.owner`, `Relation.participants`, `ResolvedResult.owner`,
`UserStatsDoc.owner`), and the league surfaces in `LeagueDoc.owner`,
`LeagueMemberDoc.member`, `AffiliationDoc.member`, `BattleDoc.proposer` and
`friendMembers`. The `client.ts` wrappers carry the `userId` → `owner`
rename and re-narrow the loose wire string unions (`visibility`, `role`) back
to the app enums. Duel `sideA` / `sideB` hold account ids.

## Auth

- **Session state: `web2/session.ts`.** `loadWeb2Session()` probes `/me` (a
  401 is the signed-out steady state, not an error), `adoptWeb2Session(user)`
  seeds it from a login response, and `clearWeb2Session()` revokes
  server-side then drops local state.
- **Session follows the cookie: `watchWeb2Session()`.** Tabs share the
  cookie, so a sign-in or sign-out in one tab changes the account of every
  tab. A request the API refuses as `unauthenticated` (the `client.ts`
  session-lost handler; any other 401, such as a wrong sign-in code, is not
  one) signs the tab out. The account is re-read from `/me` when another tab
  changes it (a `BroadcastChannel`) and when the tab is shown again.
- **Writes in an account's name confirm the cookie first.** A profile PUT is a
  full-doc write onto the cookie's account, so `upsertProfile` and
  `saveMyEmail` run `assertWeb2SessionOwner(owner)` (a `/me` read) before it:
  when the cookie belongs to another account the store moves to it and the
  write is refused with `Web2SessionChangedError`.
- **App-shell hydration: `Authn.svelte`.** `onMount` starts the watcher and
  the probe. An `$effect` mirrors `web2SessionStore` into `userStore`: a
  resolved user builds a `User` (`key` / `owner` = account id), reads the
  profile via `loadWeb2ProfileShell` (the default shell with
  `profileExisted: false` for a brand-new account, so the onboarding drain
  runs), and sets `userStore`. A signed-out probe releases `authBusy`
  directly; a live one leaves it held until the hydration sets the user,
  because `authBusy` false with no user is what the `(app)` gate reads as
  signed out. Every transition runs `resetIdentityScopedState`.
- **Sign-in: `SignInProviderStack.svelte`.** Email one-time code
  (`requestOtp` / `verifyOtp`), Google as a full-page redirect to
  `googleSignInUrl()` (the API drives the OAuth dance and lands back on the
  app root, where `Authn` picks up the session), and Apple + Passkey shown
  disabled ("coming soon"). Beta-gate refusals arrive as the OTP error code
  or, for OAuth, as a `/signin?e=` marker: `beta_closed` / `e=beta` render
  `signin.beta_closed`, and `legacy_account_pending` / `e=legacy` render
  `signin.legacy_pending.*` with a link to `LEGACY_APP_URL`
  (`#lib/constants/auth.constants.ts`). Gate semantics live in
  [`backend/README.md`](../../../backend/README.md#beta-access-gate).
- **Sign-out and identity probes: `identity.services.ts`.** `signOut()`
  revokes the cookie session; `isSignedIn()` and `getSignedInOwner()` read
  the session store (`IdentityAwareLoader` runs every polling loader through
  `isSignedIn`); `anonymousIdentity()` is the identity threaded through the
  shared fetchers for the public on-chain reads.

## Domain notes

### Profiles and social

- `profile.services.ts`: `patchProfile` builds the patch on the session's own
  row (`getMyProfile`), never on the public `getProfile` read.
  `getMyJoinedAtMs` reads the session account's `createdAt`. The caller's own
  email lives on their profile row (never on a public profile object;
  `mapProfile` drops it), read via `getMyProfileEmail` and written by a
  read-modify-write through the profile PUT; with no profile row yet the write
  is skipped, since writing a default shell would falsely flip a fresh account
  to "existed" for the onboarding drain.
- `handle-availability.services.ts`: a visitor before sign-up probes
  `/public-nickname-availability` with a Turnstile-backed proof (one solve per
  window, see the "Anonymous handle probe" section of
  [`backend/README.md`](../../../backend/README.md)).
- `leaderboard.services.ts` / `menagerie.services.ts`: the API ranks from
  settled history, never `points` (see
  [`PRODUCT.md`](../PRODUCT.md#global-leaderboard-qualify-gate--confidence-adjusted-ranking)).
- The profile's computed stats (`user_stats`, category accuracy, menagerie
  inputs) are server-computed; the client runs no stats sync.

### Markets and public engine reads

- `market.services.ts`: the series catalog, per-series reads, settlement
  status and traded volumes ride the bridge (`/api/v1/engine/...`). The
  tradeable-now filter stands in for `only_unexpired` (no series carries a
  future start gate). On the market detail the order book fails open (an
  empty book, priced as unknown) so an unreachable IC read never blanks the
  page.
- `market-tags.services.ts`: the catalog-wide tag and metadata projections
  read `GET /api/v1/markets/metadata` (public).
- `market-metadata.services.ts` / `market-translation.services.ts`: reads and
  curator-gated upserts; the API already speaks the app's camelCase shapes.
- `resolution.services.ts`: `getSettledSeriesIds` fails open to the empty set
  so one engine error never blanks every market list.
- `landing-proof.services.ts`: `GET /api/v1/profiles/count` (public).

### Engine account operations and the custodial wallet

- `order.services.ts`: `placeOrder` submits limit orders via
  `/engine/orders/limit` and walks the book with `/engine/orders/market`; the
  book read inside the walk is the public anonymous on-chain query, with the
  caller's own resting orders excluded by id from the session-gated own-orders
  read. Order refusals arrive as a 4xx with a stable code (table in
  [`backend/README.md`](../../../backend/README.md#order-rejections));
  `orderRejectionMessage` in `canisters/clearing.errors.ts` maps each code to
  a `trade.error.*` key. A new code goes in the API table and in
  `ORDER_REJECTION_KEYS`; the shared-drift suite fails until both agree.
- `position.services.ts` / `trade.services.ts`: positions and the user's own
  trade history read `/engine/positions` and `/engine/trade-history`, scoped
  to the visible market catalog.
- `collateral.services.ts`: deposits post to `/engine/collateral/deposit`
  (the API approves and deposits from the custodial identity; the clearing
  `asset_id` resolves client-side from the public catalog). The playground
  VXP auto-sweep reads its amount through `getSweepableVxpAmount()`, the
  custodial balance less two public ledger fees. Account state reads
  `/engine/account?domain=<variant>`, delivered as the `certified: true`
  pass.
- `wallet.services.ts`: `/wallet/balances` keyed back to the app's token ids
  by symbol (an asset whose read fails is left out, never reported as zero;
  `LoaderBalances` keeps the last known balance), and the receive address
  `/wallet/deposit-address/ic`.
- `send.services.ts` `sendToken`: a self-custody withdrawal request
  (`POST /wallet/withdrawals`). The idempotency key belongs to the send
  (asset, amount, destination): the Wallet page keeps it with
  `send.utils.ts` `pendingSendFor`, and `pendingSendAfterError` keeps it only
  while the outcome is unknown (network failure, timeout, 408, 5xx). The Send
  tab offers only assets `withdrawable` on `/wallet/assets`.
- `transaction-history.services.ts`: `loadVxpLedgerHistory` returns
  `undefined` (the index keys history by principal and the API exposes no
  custodial transfer feed yet), so `/dash/transactions` shows its unavailable
  state.

### Leagues, battles, worlds and tournaments

- Everything rides `/api/v1/leagues`, `/api/v1/battles`, `/api/v1/worlds` and
  `/api/v1/tournaments`. The invite code is minted server-side (the returned
  league carries it); battle ids are uuids; accept / kickoff baselines are
  stamped server-side.
- `loadLeaguesByIds` hydrates the league directory from the caller's own list
  reads, because no public by-id league read exists; an id outside them falls
  back to the shortened-id render.
- League cover images: `storage.services.ts` posts the client-downscaled
  bytes as multipart to `/leagues/:id/image`, which stamps the serving URL on
  the league row.
- Lazy triggers: founder-award settlement (Leagues page), the tournament draw
  and round resolution (Tournament page) and the Worlds podium claim (Worlds
  page) still fire on page mount. The API also runs them from its worker;
  they are idempotent server-side, so whichever side gets there first wins.
- `getLeagueStandings` (`standings.services.ts`) returns an empty result: the
  bridge leaderboard has no member filter. Member-scoped standings slices
  render their empty states until a member-filtered read exists.

### VXP, referrals, school, account lifecycle and activities

- Awards fire inside the matching API routes from server-side truth: the
  activity POST runs the trade triggers (onboarding call-count milestones,
  referral settlement, Flow volume milestones, achievements the engine
  history proves); the Flow swipe POST is only the daily counter and the
  overtime mint; the profile PUT carries only the registration grant. So
  `logActivity` posting a trade is all the trade awards need (see
  [`economy.md`](../economy.md#caps-and-gates-the-anti-farming-spine)).
- `referral.services.ts`: the code is assigned server-side on first read;
  error reasons are rethrown as the Error message so the onboarding drain's
  terminal-reason matching stays shared.
- `school-verification.services.ts` and `worlds.services.ts` writes run under
  a 15s hang guard.
- `account.services.ts`: delete pre-flight, delete (with league
  resolutions), recover, hibernate, resume; the flow's closing sign-out goes
  through `identity.services.ts` `signOut`.
- `challenge.services.ts`: challenge links (`/api/v1/challenges`).

## Guardrails

- Components and stores never call `client.ts`; the seam lives in services.
  The identity layer is the sanctioned exception (`Authn.svelte`,
  `SignInProviderStack.svelte`, `web2/session.ts`).
- Analytics event payloads stay behavioural and pseudonymous; the server
  stamps time and identity.
- Constants mirrored between `src/` and `backend/` (locales, market taxonomy,
  analytics taxonomy, VXP tunables, vendored engine declarations, custody
  asset seeds) are pinned by the drift suite in `backend/tests/shared-drift/`;
  see "Mirrored constants" in [`backend/README.md`](../../../backend/README.md).
  Keep both sides in the same PR.
