# Web2 backend mode (the backend seam)

The app can talk to two backends: the current on-chain stack (satellite +
canisters, the default) and an HTTP API served from
[`backend/`](../../../backend/README.md) under `/api/v1/...`. The switch
is a build-time flag; a build without the flag behaves exactly as today.

This page is the contract for how a domain gets a dual-mode path. Read it
before adding any `isWeb2Backend()` branch.

## The seam

Two files under `src/lib/web2/`:

- [`backend-mode.ts`](../../../src/lib/web2/backend-mode.ts):
  `isWeb2Backend()` / `backendMode()` read `VITE_BACKEND`, and
  `web2ApiBaseUrl()` reads `VITE_WEB2_API_URL`. Defaults: `web3` mode,
  empty base URL (same-origin relative paths).
- [`client.ts`](../../../src/lib/web2/client.ts): thin typed fetch client.
  Every request sends `credentials: 'include'` (sessions are HttpOnly
  cookies; the client holds no auth state) and non-2xx responses throw
  `Web2ApiError` carrying `status` plus the stable `code` from the API's
  `{ error: string }` envelope. One typed wrapper per endpoint, shape
  mapping only.

## Env vars

| Var                 | Values           | Default | Effect                                                                       |
| ------------------- | ---------------- | ------- | ---------------------------------------------------------------------------- |
| `VITE_BACKEND`      | `web3` \| `web2` | `web3`  | Selects the backend for domains that have a dual-mode path. Build-time only. |
| `VITE_WEB2_API_URL` | origin URL       | empty   | Base of the HTTP API. Empty = same-origin relative (reverse-proxy shape).    |

## Swapped domains

| Domain                                          | Where the branch lives                                                                                                                                                                                                                    | Notes                                                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Analytics                                       | `analytics.services.ts` (flush call site)                                                                                                                                                                                                 | The reference for the per-service swap below.                                                                              |
| Auth                                            | `authn/SignInProviderStack.svelte`, `authn/Authn.svelte`, `Logout.svelte`                                                                                                                                                                 | The identity layer, not a per-service swap. See "Auth" below.                                                              |
| Profiles + social                               | `profile.services.ts`, `user-stats.services.ts`, `relation.services.ts`, `relation-queries.services.ts`, `leaderboard.services.ts`                                                                                                        | Per-service swaps. Plus the app-shell hydration in `Authn.svelte`. See "Profiles and social" below.                        |
| Markets + public engine reads                   | `market.services.ts`, `market-metadata.services.ts`, `market-translation.services.ts`, `resolution.services.ts`, `trade.services.ts`, `standings.services.ts`, `collateral.services.ts`                                                   | Public reads only. See "Markets and public engine reads" below.                                                            |
| Engine account ops + wallet                     | `order.services.ts`, `position.services.ts`, `trade.services.ts`, `collateral.services.ts`, `wallet.service.ts`, `send.services.ts`                                                                                                       | The session-gated engine surface and the custodial wallet. See "Engine account operations and the custodial wallet" below. |
| Leagues + battles + worlds + tournaments        | `leagues.services.ts`, `worlds.services.ts`, `tournament.services.ts`, `storage.services.ts` (league cover), `standings.services.ts` (league slice)                                                                                       | The social competition surfaces. See "Leagues, battles, worlds and tournaments" below.                                     |
| VXP + referrals + school + account + activities | `vxp-awards.services.ts`, `referral.services.ts`, `school-verification.services.ts`, `account.services.ts`, `activity.services.ts`, `activity-reaction.services.ts`, `profile.services.ts` (own email), `identity.services.ts` (sign-out) | The last app domain set. See "VXP, referrals, school, account lifecycle and activities" below.                             |

## The swap pattern (exemplar: analytics flush)

[`analytics.services.ts`](../../../src/lib/services/analytics.services.ts)
is the reference. The rules it demonstrates:

1. **Branch at the transport call site, inside the owning `*.services.ts`
   module.** Everything else (buffering, debounce, validation, UX, error
   swallowing) stays shared; only the line that sends bytes switches.
2. **Static imports only.** Import `isWeb2Backend` and the client wrapper
   at the top of the module. Never `await import()` inside the branch.
3. **Add a typed wrapper in `client.ts` per endpoint**, typed to the wire
   contract of the HTTP API route. If the wire shape differs from the
   satellite shape, map it inside the wrapper, not in the service.
4. **Default path is byte-for-byte today's behavior.** The `web3` branch
   must remain the exact pre-seam code; a diff with `VITE_BACKEND` unset
   must change nothing observable.

```ts
if (isWeb2Backend()) {
	await postEvents({ events });
} else {
	await functions.trackEvents({ events });
}
```

## Rollout status: all app domains are dual-mode

Every app data domain (analytics, auth, profiles + social, markets +
public engine reads, engine account ops + wallet, leagues + worlds +
tournaments, VXP + referrals + school + account + activities) now carries
a dual-mode path per the table above. What remains on the on-chain stack
in web2 mode is deliberate, not backlog; the full list, collected from the
per-domain sections:

- **Login stats sync** (`calculateAndSyncStats` and its
  `persistMyUserStats` / `syncMyMonthlyStats` writes): reads the on-chain
  clearing history, so it is simply not run in web2 mode.
- **Order books** (`getOrderBook` and the book read inside `placeOrder`'s
  market-order walk): public IC data read anonymously in BOTH modes; no
  HTTP surface exists for it.
- **Bulk metadata projections** (`market-tags.services.ts`): public
  satellite `listDocs` scans until a public bulk-metadata HTTP read
  exists.
- **Market creation / forking and admin settlement**
  (`createMarket`, `forkMarket`, `settleMarket`): user-signed registry /
  clearing writes; curator / admin surfaces stay on the on-chain identity,
  as do `registerIcrcAsset` and the roles / admin services.
- **Complete-set mint / redeem**: no HTTP route and no live caller.
- **Direct ICRC ledger / index reads and user-held transfers**: web2 mode
  surfaces custodial balances and routes sends through withdrawals; the
  paged ledger history returns empty there.
- **League standings slice** (`getLeagueStandings`): empty in web2 mode
  until a member-filtered bridge read with the identity mapping exists;
  web2 standings entries also keep the on-chain principal as `owner`.
- **Market discussion comments** (`discussion.services.ts`): the comments
  collection has no HTTP route; the surface stays on the satellite (and is
  effectively read-only without a Juno identity).
- **Landing proof figure** (`landing-proof.services.ts`): an anonymous
  public satellite count; works identically from a web2 build.
- **On-chain sign-in plumbing** (`apple-signin.services.ts` and the Juno
  identity layer): replaced wholesale by the session flow in web2 mode.

## Auth

Auth is not a per-service swap: the whole identity layer switches, because
half-swapped auth would leave reads and writes authenticated against
different identities. In web2 mode there is no local identity to read. The
browser holds an HttpOnly session cookie set by the API, and "signed in"
derives from `GET /api/v1/me` succeeding, not from an on-chain delegation.

- **Session state — `web2/session.ts`.** A small store (`web2SessionStore`)
  is the cookie-session counterpart to the on-chain identity flow.
  `loadWeb2Session()` probes `/me` (a 401 is the signed-out steady state,
  not an error), `adoptWeb2Session(user)` seeds it from a login response,
  and `clearWeb2Session()` revokes server-side then drops local state.
- **Session bootstrap — `Authn.svelte`.** `onMount` branches: web2 runs
  `loadWeb2Session()` in place of Juno's `onAuthStateChange`. The on-chain
  path is left byte-for-byte as it was.
- **Sign-in — `SignInProviderStack.svelte`.** In web2 mode it renders
  `SignInProviderStackWeb2.svelte`: email one-time code (request then verify
  via `requestOtp` / `verifyOtp`), Google as a full-page redirect to
  `googleSignInUrl()` (the API drives the OAuth dance and lands back on the
  app root, where `Authn` picks up the session), and Apple + Passkey shown
  disabled ("coming soon") since neither is wired on this transport yet. The
  on-chain provider stack is untouched behind the same branch.
- **Sign-out — `Logout.svelte`.** web2 calls `clearWeb2Session()`; on-chain
  calls Juno `signOut()`.

Engine calls never read a local identity in web2 mode: public reads ride the
HTTP bridge and the session-gated account surface is signed server-side with
the caller's derived custodial identity (see "Engine account operations and
the custodial wallet"), so no web2 path ever reaches for a Juno identity.
Loaders that only gate on "is someone signed in" use
`identity.services.isSignedIn()`, which is the Juno identity check on the
default backend and the cookie-session store in web2 mode
(`IdentityAwareLoader` runs every polling loader through it).

`client.ts` ships the auth surface: `getProviders()`, `getMe()`,
`requestOtp()`, `verifyOtp()`, `googleSignInUrl()`, `logout()`.

## Account claim

How a legacy on-chain user with no email on file (passkey or Internet
Identity) carries their principal to a web2 account: a signed handoff, no
satellite change, no cross-origin cookie.

- **Legacy build (default backend)**: signed-in users see a dismissible
  banner in the `(app)` shell (`claim/ClaimBanner.svelte`) and a Settings >
  Account row. Both call `claim-handoff.services.startClaimHandoff()`, which
  signs `{ aud: 'vici-web2-claim', principal, issuedAtMs }` with the Juno
  `DelegationIdentity`'s session key, packs payload + full delegation chain +
  signature into a base64url blob (`claim-handoff.utils.ts`, the wire
  contract pinned by the backend shared-drift suite) and opens
  `CLAIM_PORTAL_URL#<blob>` in a new tab. The blob holds no secret: it is a
  bearer proof of principal control, valid for ~10 minutes and never sent to
  any server but the claim API.
- **Web2 build**: `/claim` (`pages/ClaimPage.svelte`) parks the fragment in
  sessionStorage (OAuth redirects drop fragments), strips it from the URL,
  runs the normal web2 sign-in if needed (`SignInProviderStackWeb2`), then
  posts the blob via `client.ts` `postClaim()`.
- **API** (`POST /api/v1/claim`, session-gated): verifies off-chain that the
  chain's root key derives the claimed principal, every delegation link
  signature is valid (ed25519 / secp256k1 raw keys, WebAuthn passkeys, and
  canister signatures certified against the IC root key), nothing is
  expired, and the session key signed a fresh claim message; then inserts
  `legacy_principals` with `matched_via = 'claim'`. Idempotent per account;
  a principal owned by another account answers a stable 409.

Trust model: whoever presents a valid blob within the freshness window
controls the principal, exactly like holding the delegation itself. The
handoff surfaces are deliberately absent from the web2 build and the portal
route redirects home on the default backend; the mode gates live in
`claim-handoff.services.ts`, not in components.

## Profiles and social

This is the worked example of the per-service swap for a data domain, and
the exemplar for the ones that follow.

### The identity rename

The HTTP API keys a user by an opaque account id (`userId`, a uuid) where
the on-chain stack keys by a principal. The app's domain shapes carry that
identity in a single `owner` string (`UserProfile.owner`,
`Relation.participants`, `ResolvedResult.owner`, `UserStatsDoc.owner`), so
the `client.ts` wrappers carry the `userId` → `owner` rename and re-narrow
the loose wire string unions (`visibility`, `role`) back to the app enums.
The result is byte-identical to the satellite services, so every component
and store stays backend-agnostic. In web2 mode `owner` simply holds the
account id instead of a principal.

### Service-layer branches

Each read/write branches on `isWeb2Backend()` inside its owning
`*.services.ts`, calling a `client.ts` wrapper on the web2 side and leaving
the on-chain call untouched on the default side:

- `profile.services.ts`: `getProfile`, `searchProfiles`,
  `checkNicknameAvailability`, `checkFriendship`, `recordFlowSwipe`,
  `upsertProfile`. The composed writers (`patchProfile`, `persistDailyStreak`,
  `applyOnboardingPicks`, `persistPreferences`, `recordActivity`) ride the
  swap for free: they route through `getProfile` + `upsertProfile`.
- `user-stats.services.ts`: `loadMyUserStats` (the Dash read).
- `leaderboard.services.ts`: `getLeaderboard`, `getMyRival`.
- `relation.services.ts`: `sendFriendRequest` (with a web2 `@handle` / account-id
  resolver), `accept` / `reject` / `cancel`, `unfriend`, `follow`, `unfollow`.
- `relation-queries.services.ts`: friends, followers, following, friend
  requests (sent + received), friend-scoped resolved results.

### App-shell hydration

The auth swap left `userStore` (the store the whole authenticated app reads)
unhydrated in web2 mode. `Authn.svelte` now mirrors the cookie session into
it: an `$effect` watches `web2SessionStore` and, when a user resolves, builds
a minimal `User` (`key` / `owner` = account id), reads the profile via
`loadWeb2ProfileShell` (the default shell with `profileExisted: false` for a
brand-new account, so the onboarding drain runs identically), and sets
`userStore`. Sign-out and the signed-out steady state clear it, so the shell
never hangs on `authBusy`. This lives in `Authn.svelte` because it is the
sanctioned identity-layer exception; no other component gains a branch.

### Still on-chain in this domain

- `calculateAndSyncStats` (and its `persistMyUserStats` /
  `syncMyMonthlyStats` writes) reads the on-chain clearing history, so it
  stays on the engine backend until the custody / engine bridge lands. In
  web2 mode the login stats sync is simply not run; the Dash reads whatever
  `user_stats` the API holds (empty until that write path swaps).
- Activities + reactions and the private-email doc (`getMyEmail` /
  `saveMyEmail`) swapped later with the final domain set; see "VXP,
  referrals, school, account lifecycle and activities" below.

## Markets and public engine reads

Market curation (metadata, translations) plus every PUBLIC engine read the
HTTP API bridges (`/api/v1/markets/...`, `/api/v1/engine/...`). The
account-scoped engine surface (orders, positions, collateral, own history)
is the separate swap documented in "Engine account operations and the
custodial wallet"; web2 mode never signs an engine call client-side.

### The wire seam: serialized candid

The engine routes return the canisters' candid responses serialized to
JSON: bigints as decimal strings, principals as text, candid optionals
still `[] | [value]`. [`web2/engine-wire.ts`](../../../src/lib/web2/engine-wire.ts)
holds the explicit per-type mappers that convert each payload back into
the exact `$declarations` candid types (`RegistryDid.Series`,
`ClearingDid.SettlementStatusView`, candles, trade pages, volumes,
collateral assets, leaderboard entries), so utils, stores, and components
consume identical shapes on both transports. Mappers are field-explicit
on purpose: a blanket digits-to-bigint pass cannot tell an id string from
a serialized bigint. The `client.ts` wrappers (`listEngineSeries`,
`getEngineSeries`, `getEngineSettlementStatus`, `getEnginePriceHistory`,
`listEngineSeriesTrades`, `listEngineSeriesVolumes`,
`listEngineSettledSeries`, `listEngineCollateralAssets`,
`listEngineLeaderboard`, plus the markets metadata / translation set)
apply them at the fetch boundary.

### Service-layer branches

- `market.services.ts`: the series catalog (`listSeries`, both the full
  and the unexpired read), per-series `getSeries`, the settlement status
  on the detail fetch, and the traded-volumes batch. The bridge's
  tradeable-now filter stands in for `only_unexpired` (equivalent here:
  no series carries a future start gate). The volumes read drops the
  anonymous short-circuit in web2 mode because the bridge exposes it
  publicly.
- `market-metadata.services.ts` / `market-translation.services.ts`:
  reads and curator-gated upserts; the HTTP API already speaks the app's
  camelCase doc shapes, so these are envelope unwraps.
- `resolution.services.ts`: `getSettledSeriesIds` (bridge read is
  domain-unfiltered, safe because series ids are globally unique) and
  `loadSettlementOutcomes` (same batching, per-series bridge status).
- `trade.services.ts`: price-history candles and the traded-volume tape
  drain. Callback flows deliver the bridge's single response as the final
  `certified: true` pass, since no query/update pair exists on HTTP.
- `standings.services.ts`: the global leaderboard (`getStandings`).
  `getLeagueStandings` returns an empty result in web2 mode (see
  "Leagues, battles, worlds and tournaments" below).
- `collateral.services.ts`: the collateral-asset catalog, without the
  signed-identity gate in web2 mode (the bridge read is public).

### Still on-chain in this domain

- Order books (`order.services.ts` / `getOrderBook`): no HTTP surface
  yet; the anonymous on-chain query is publicly readable, so web2 mode
  still prices lists, decks, and detail pages from it.
- The bulk metadata projections in `market-tags.services.ts`
  (`listMarketTagsBySeries`, `listMarketMetadataBySeries`) scan the
  public `MARKET_METADATA` collection via Juno `listDocs`; the HTTP API
  has no public bulk-metadata list yet (its `/markets/tags` bucket index
  is admin-only), so these stay on the satellite until that read exists.
- Market creation / forking (`createMarket`, `forkMarket`) and admin
  settlement (`resolution.services.ts` `settleMarket`) are user-signed
  registry / clearing writes with no HTTP route yet; curator / admin
  surfaces stay on the on-chain identity.
- Leaderboard identity caveat: web2 standings entries keep the on-chain
  principal as `owner` (clearing's native key) until the engine identity
  mapping lands.

## Engine account operations and the custodial wallet

The fifth swapped domain: everything a signed-in user does against the
engine (orders, positions, own history, collateral moves, account state)
plus the wallet (balances, receive address, sends). In web2 mode the API
holds the custodial keys and signs every account-scoped clearing call with
the caller's derived custodial identity; the browser authenticates each
request with the session cookie only. `engine-wire.ts` grew mappers for the
account payloads (`LimitOrder`, `Position`, `Event`,
`AccountStateResponse`), so stores, utils, and components keep consuming
the exact candid shapes.

### The full trade lifecycle in web2 mode

- `order.services.ts`: `placeOrder` submits limit orders via
  `/engine/orders/limit` and walks the book with `/engine/orders/market`;
  the book read inside the walk stays the public anonymous on-chain query
  (see below), with the caller's own resting orders excluded by id from
  the session-gated own-orders read, since the account's engine principal
  lives server-side. `cancelLimitOrder`, `getUserOrders`, and the loader
  variants ride `/engine/orders` + `/engine/orders/cancel`. The trade
  activity-feed write rides the swapped activities domain (its HTTP POST
  also fires the trade-triggered awards; see the activities section); the
  daily-streak bump keeps riding the swapped profile writes with the
  session account id as owner.
- `position.services.ts` / `trade.services.ts`: positions, the per-series
  position, and the user's own trade history read `/engine/positions` and
  `/engine/trade-history`; the domain scoping still runs through the
  (dual-mode) market catalog. Single web2 responses are delivered as the
  final `certified: true` pass, like every other bridge read.
- `collateral.services.ts`: deposits and withdrawals post to
  `/engine/collateral/*`; the ICRC approval happens server-side under the
  custodial identity, and the clearing `asset_id` still resolves
  client-side from the public collateral catalog. The playground VXP
  auto-sweep reads its sweepable amount through
  `getSweepableVxpAmount()`, which in web2 mode pairs the custodial
  balance with the (public, anonymously read) ledger fee.
- Account state (`getAccountState` / `loadAccountState`,
  `wallet.service.ts` `getCollateralBalances`) reads `/engine/account`,
  which bridges clearing's read-only query. Outside the Settlement domain
  the query's top-level equity / margin figures carry that view's known
  engine-side limitation; the response is still delivered as the
  `certified: true` pass because no refreshed update read is bridged, and
  an uncertified delivery would trip the Settlement-only gate in
  `LoaderCollaterals` and leave the store empty forever.

### The custodial wallet

- `wallet.service.ts` `getLedgerBalances`: `/wallet/balances`, keyed back
  to the app's token ids by symbol (the custody asset catalog mirrors the
  supported IC tokens).
- `getReceiveAddress` (the Receive tab): `/wallet/deposit-address/ic`,
  the custodial IC principal the API derives for the user. Deposits to it
  are detected and credited server-side.
- Sends (`send.services.ts` `sendToken`, used by the Wallet Send tab):
  a user-signed ICRC transfer on the default backend, a self-custody
  withdrawal request (`POST /wallet/withdrawals`) in web2 mode; the API
  executes the transfer from the custodial account and a failed execution
  surfaces like a rejected transfer. `sendIc` / `sendIcrc` stay
  identity-parameterised for on-chain callers (admin tooling).
- The paged ICRC ledger history (`getTransactionsPage`) returns empty in
  web2 mode: index canisters key history by principal and the API exposes
  no custodial transfer feed yet. The wallet still shows clearing rows
  (trades, settlements) through the swapped trade-history read.

### Deliberately on-chain in this domain

- Order books (`order.services.ts` `getOrderBook` / `loadOrderBook`, and
  the book read inside `placeOrder`'s market-order walk) stay anonymous
  on-chain queries in BOTH modes: the book is public IC data and no HTTP
  surface exists for it.
- Complete-set mint / redeem (`trade.services.ts`) has no HTTP route and
  no live caller; it stays on the on-chain identity.
- `registerIcrcAsset` (collateral admin) stays on the on-chain admin
  identity.
- Direct ICRC ledger / index reads and user-held ICRC transfers are
  web3-only by construction; web2 mode surfaces custodial balances and
  routes sends through withdrawals instead.

## Leagues, battles, worlds and tournaments

The social competition surfaces: leagues (CRUD, invites, membership,
ownership transfer, cover images), battles (the full state machine plus
settlement-history resolution), Worlds affiliations (the 90-day lock,
standings, championships, the podium claim) and the monthly tournament
(draw, round resolution, prize claim). All rides `/api/v1/leagues`,
`/api/v1/battles`, `/api/v1/worlds` and `/api/v1/tournaments`.

### The identity rename, continued

Same pattern as profiles: the wire keys people by account id where the
app shapes carry one string field. The `client.ts` mappers rename
`ownerUserId` to `LeagueDoc.owner`, `memberUserId` to
`LeagueMemberDoc.member` / `AffiliationDoc.member`, `proposerUserId` to
`BattleDoc.proposer`, and `friendMemberUserIds` to `friendMembers`. Duel
`sideA` / `sideB` hold account ids in web2 mode. Tournament and stats
shapes are identity-free (league ids and aggregates) and pass through.

### Service-layer branches

- `leagues.services.ts`: every read (`listMyLeagues`, challengeable and
  friend-recommended lists, members, invite lookup) and write
  (`createLeague`, `updateLeague`, join / leave, `setMemberRole`,
  `transferLeagueOwnership`) plus the whole battle surface (propose,
  accept, decline, lazy expire, kickoff, retract, `resolveBattle`,
  `readBattleLiveScore`, `getMyBattleStats`, the battle lists). Web2
  notes: the invite code is minted server-side (the returned league
  carries the definitive code); the API join is idempotent instead of
  throwing on re-join; battle ids are uuids (the route caps ids at 64
  chars); accept / kickoff baselines are stamped server-side, so the
  client never reads `league_stats`; `loadLeaguesByIds` hydrates the
  league directory from the caller's own list reads because no public
  by-id league read exists yet; the share URL stays plain (no `?ref=`)
  until referrals swap.
- League cover images: `storage.services.ts` `uploadLeagueImage` posts
  the (still client-downscaled) bytes as multipart to
  `/leagues/:id/image`, which stores them and stamps the serving URL on
  the league row; the caller's follow-up `updateLeague` write becomes a
  read-back. `deleteLeagueImageByUrl` recovers the league id from the
  canonical `/api/v1/leagues/{id}/image` URL and calls the delete
  route. The stored-URL contract the components render is unchanged.
- `worlds.services.ts`: affiliations (join / leave / switch under the
  same 15s hang guard), the stats reads, member counts, championships,
  and `claimWorldsPodiumPrize`.
- `tournament.services.ts`: `getCurrentTournament` (the API already
  emits the FE doc shapes with explicit nulls), `triggerTournamentDraw`,
  `resolveTournamentRound`, `claimTournamentPrize`.

### Lazy triggers stay, the worker joins

On the default backend the FE fires the idempotent maintenance calls on
page mount because the satellite has no scheduler: founder-award
settlement (Leagues page), the tournament draw and round resolution
(Tournament page), and the Worlds podium claim / month freeze (Worlds
page). The web2 API also runs these as worker cron jobs, but the FE
keeps firing the same triggers through the bridge: they are idempotent
server-side (key collisions and month gates), so behavior parity holds
whichever side gets there first.

### Empty or deferred in this domain

- `getLeagueStandings` (`standings.services.ts`) returns an empty
  result in web2 mode: the bridge leaderboard has no member filter, and
  swapped rosters carry account ids while the clearing ranking keys
  principals. Member-scoped standings slices (league detail, Arena
  hero, friends digest) render their empty states until a
  member-filtered bridge read with the identity mapping exists.
- `getLeagueById` is default-backend only; the web2 branch of
  `loadLeaguesByIds` covers the directory from the caller-visible
  lists, and an id outside them falls back to the shortened-id render.
- Duel-only endpoints without a live FE caller (manual duel resolve,
  battle restart) and the Worlds roster / month-list reads have API
  routes but no `client.ts` wrapper yet, to avoid unused surface.

## VXP, referrals, school, account lifecycle and activities

The final domain set: the calibration reward claim, the referral surface
(code, lookup, redeem, friendship claim, my-referrals list, payout
retry), school-email verification, the account lifecycle (delete /
recover / hibernate / resume), the activity feed with like reactions, and
the caller's own on-file email. Rides `/api/v1/vxp`, `/api/v1/referrals`,
`/api/v1/school`, `/api/v1/account` and `/api/v1/social`.

### Hook parity: awards fire on the HTTP writes

On the satellite, VXP awards ride post-write hooks (a trade activity
fires the onboarding call-count milestones and the referral settlement; a
profile write fires the streak / achievement awards). The HTTP API runs
the same triggers inside the matching routes: the activity POST runs the
trade triggers after the write commits, and the profile PUT diffs the
stored row against the incoming one. So the swapped services need no
extra calls: `logActivity` posting a trade in web2 mode produces exactly
the awards the satellite hook would have. `placeOrder` now logs the trade
activity on both transports for the same reason.

### Service-layer branches

- `vxp-awards.services.ts`: `claimCalibrationReward` posts to
  `/vxp/calibration/claim`; the structured result is shape-identical, the
  session covers the `anonymous` reason (a signed-out call 401s), and the
  web2-only `recorded_only` reason (treasury parallel-run mode: recorded,
  not transferred) was added to the shared reason union. It does not
  block the calibration session. `client.ts` also ships
  `listMyVxpAwards` (`GET /vxp/awards`) for the award-history surface;
  no live FE caller yet.
- `referral.services.ts`: all six functions. The code is assigned
  server-side on first read (no backfill wait); `lookupReferralCode`
  resolves to the owner's account id, which the swapped profile reads
  render as usual. The routes fold the satellite trap reasons into the
  `{ error }` envelope and the service rethrows them as the Error
  message, so the onboarding drain's terminal-reason matching
  (`existing_user_no_bonus`, "already redeemed", ...) stays shared.
- `school-verification.services.ts`: `submitSchool` / `verifySchoolCode`
  under the same shared 15s timeout. The HTTP route re-resolves the
  school from the email domain (plus name / country for a new entry), so
  the `schoolId` hint is not part of its contract; codes are mailed by
  the API directly (Resend) instead of the external relay.
- `account.services.ts`: `listMyBlockingLeagues` (the delete pre-flight),
  `deleteMyAccount` (same structured refusal / resolution round-trip;
  `transferTo` carries the new owner's account id, which the swapped
  league rosters already use), `recoverMyAccount`, `hibernateMyAccount`,
  `resumeMyAccount`. The flow's closing sign-out goes through the
  dual-mode `signOut` in `identity.services.ts` (below).
- `activity.services.ts`: `logActivity` posts to `/social/activities`
  (the route stamps the author from the session and enforces the same
  `${user}#${timestamp}#${type}` key), `getGlobalActivities` and
  `getSettlementActivities` read the public list (type-filtered
  server-side instead of the key-suffix matcher).
- `activity-reaction.services.ts`: like / unlike (the route keeps the
  count rollup transactionally; unlike is idempotent), the reactions
  window, and the count read. The HTTP counts read is key-addressed, so
  the web2 branch derives the keys from the recent activity window first
  (two requests, same O(1)-per-activity result). The received-reactions
  read (the like-received inbox) has no author-scoped HTTP route yet, so
  the web2 branch filters the recent global window by the activity-key
  author prefix, with the same bounded under-reporting as the on-chain
  window scans.
- Own email (`profile.services.ts` `getMyEmail` / `saveMyEmail`): in web2
  the address lives on the caller's own profile row (never surfaced on a
  public profile object; `mapProfile` drops it), read via
  `getMyProfileEmail` and written by a read-modify-write through the
  profile PUT. With no profile row yet the write is skipped: sign-in is
  email-verified on this transport and writing a default shell would
  falsely flip a fresh account to "existed" for the onboarding drain.

### The sign-out seam grew one service

`DeleteAccountFlow` (via the settings page's sign-out hook) and
`AccountReturnGate` used to call Juno `signOut()` directly.
`identity.services.ts` now exports a dual-mode `signOut` (delegation drop
on the default backend, cookie-session revoke in web2 mode) and those
components import it instead, staying flag-free. The sanctioned auth trio
(`Authn` / `SignInProviderStack` / `Logout`) is unchanged.

## Guardrails

- Never read `VITE_BACKEND` directly; always go through `backend-mode.ts`
  so the default stays in one place.
- No `isWeb2Backend()` branches in components or stores; the seam lives in
  services. The one sanctioned exception is the identity layer, whose swap
  is inherently UI-driven (one-time-code entry, redirect handoff): the auth
  branches live in `Authn.svelte`, `SignInProviderStack.svelte`, and
  `Logout.svelte`, with the session store in `web2/session.ts`.
- Analytics event payloads stay behavioural and pseudonymous on both
  transports; the server stamps time and identity in both modes.
- Constants mirrored between `src/` and `backend/` (locales, market
  taxonomy, analytics taxonomy, VXP tunables, vendored declarations,
  custody asset seeds) are pinned by the drift suite in
  `backend/tests/shared-drift/` - see "Mirrored constants" in
  [`backend/README.md`](../../../backend/README.md). Editing either side
  of a pair triggers the backend checks; keep both sides in the same PR.
