# Spec: Challenge links, link preview

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Draft

Part **A2** of the challenge links work; the parts and how they stack are listed in [`2026-11-26-feat-challenge-links-api.md`](./2026-11-26-feat-challenge-links-api.md). **Stacks on A1** (it reads the challenge view A1 defines). Independent of A3, A4 and B, and buildable in parallel with them. Ships with the landing go-live.

## Goal

A challenge link pasted into a messenger shows a preview written for that challenge: a title and a description built by the server from the challenger's current state ("@maya called Yes at 38%"), with the generic share image. If anything on the way fails, the preview is the generic share card and the page still loads.

## Context

**Why the server has to do it.** vici.app is a static SPA: `Dockerfile.web` copies the SvelteKit `adapter-static` build into `nginx:alpine`, and `nginx.web.conf` serves `index.html` for every unmatched path. Messengers fetch a link and read its `<head>` without running JavaScript, so every vici.app URL previews as the generic head in `src/app.html`. [`frontend/seo.md`](../../frontend/seo.md) describes the deploy-time head rewriting used for market pages (`scripts/build/generate-seo-assets.ts`, which treats the `app.html` head tags as a contract); a challenge is created at runtime, so deploy-time generation cannot cover it.

**What A1 provides.** `getChallengeView(id)` in `backend/src/social/challenges.ts`: series, current position or none, whether the side changed, the challenger's handle when they consented, whether the market is open, or not found.

**Deploy shape.** The web app (`fly.web.toml`, `vici-app-web`) and the API (`backend/fly.toml`, `api.vici.app`) are separate Fly apps. `clientIp` in `backend/src/lib/http.ts` reads `fly-client-ip`.

## Scope

### 1. Design: nginx includes a head fragment rendered by the API

The same SPA shell is served to everyone. On `/c/<id>` nginx fills the preview tags through a server-side include (SSI) of a small HTML fragment the API renders for that challenge.

- **`src/app.html`** wraps its generic preview tags (title, description, canonical, `og:*`, `twitter:*`) in a named SSI block and follows it with an include of `/__challenge_head/<id>` that names the block as its stub. SSI directives are HTML comments, so wherever SSI is off (every other path, the Juno build, local dev) the document is what a browser reads today.
- **`nginx.web.conf`** gains: a location matching `/c/` followed by the id pattern, with SSI on, serving `index.html`, `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`; an `internal` location `/__challenge_head/` proxying to the API's head endpoint with a sub-second connect and read timeout and a 60 second micro-cache keyed by id; a per-client `limit_req` zone on `/c/`.
- **Failure mode.** On a timeout, a 404 or the API being down, nginx emits the stub: the generic share card. The page loads either way; only the preview degrades.
- **`/c/` is not added to `robots.txt`**: preview crawlers that honour it would then fetch nothing. Indexing is prevented by the header and the meta tag instead.

### 2. The head endpoint

`GET /api/v1/challenges/:id/head` answers `text/html` with a fragment, or 404 with an empty body for a link that reads as not found. It contains only `<title>`, `description`, `og:title`, `og:description`, `og:url` (`https://vici.app/c/<id>` from `env.publicAppUrl`), `og:image` and its companions, `og:type`, the `twitter:*` equivalents and `robots: noindex, nofollow`.

Title per state (the description is always the market's registry title followed by "Think they're wrong?" or, for the last two rows, "What's your call?" / the plain title):

| State                               | Title                                                  |
| ----------------------------------- | ------------------------------------------------------ |
| Position held, side as when created | "@maya called Yes at 38% \| VICI"                      |
| Position held, side changed         | "@maya now says No at 41% \| VICI"                     |
| No position now                     | "@maya challenged you on this \| VICI"                 |
| Market closed, position held        | "@maya called Yes at 38%. This one has closed \| VICI" |
| Any of the above, without consent   | the same with "A friend" in place of the handle        |

- **Image: always the generic share card.** `og:image` is the absolute URL, on the live domain, of the one generic share image the landing ships. There is no per-challenge image.
- **Language:** English, as the rest of the crawler-facing layer is (`seo.md`): a crawler carries no recipient locale. The copy lives in constants next to the renderer.
- **Escaping.** The fragment is injected into the page for every visitor, so it comes from a fixed template with every interpolated value HTML-escaped. The handle is already restricted by the nickname rule; the market title comes from the registry and is escaped; no client-supplied string reaches it.
- **Limits.** The route carries a coarse limit of its own; the client-facing protection is nginx's `limit_req` and micro-cache, since every include reaches the API from the web machine (see open question 2).

### Out of scope

- The JSON read and everything else in the API: A1.
- The page behind `/c/<id>`: A4. Until A4 is merged the path falls through to the SPA's fallback route.
- Previews for the plain question-share link (`/?m=`, A4): generic card, no server work.
- A composited per-challenge image. Not planned; at most a future idea.
- Changing the generic head for the rest of the site.

## Linked issues

GitHub issue search was not possible from the authoring session (no access to the repository's issues). No issue is linked. The implementer searches open issues for "og", "preview" and "share card" before flipping the status and records the result here.

## Analytics

None, deliberately. Preview fetches are made by crawlers, not people, and counting them would pollute product analytics; the page open is counted by A4's `challenge_opened`. Operational visibility (fragment hit and fallback rates) comes from the nginx and API logs.

## Technical requirements (satellite / backend: mandatory)

**Satellite:** not touched. `src/app.html` is shared with the Juno build, where the SSI markers are inert comments.

- **Performance.** One fragment render per id per 60 seconds at most, behind the micro-cache: one indexed select plus the cached registry series, no engine call. Every person opening `/c/<id>` waits for the include: a few milliseconds on a cache hit, bounded by the sub-second timeout on a miss with a slow API.
- **Memory and storage.** No table. The nginx cache zone is capped (a few megabytes: fragments are under 2 KB).
- **Scalability.** A link that goes viral costs the API one render a minute. `limit_req` bounds a preview storm across many ids.
- **Upgrade and compatibility.** No schema, no `.did`. The `app.html` head tags stay a contract with `generate-seo-assets.ts`: the markers go around them, and the script's patterns are only touched if they stop matching (it fails loudly when they do).
- **Security.** HTML injection is the risk; see "Escaping". The include location is `internal`, so no client can request another origin through it. The id reaches the proxy only after matching the id pattern in the location regex.
- **Protected paths touched** (call out in the PR body): `nginx.web.conf`, `Dockerfile.web` and possibly `fly.web.toml` (the API upstream for the include), `src/app.html` head tags.
- **Parameters.** Timeouts, cache lifetime and the request-rate zone are named in `nginx.web.conf` with a comment giving the why; the id pattern mirrors `src/lib/constants/challenge.constants.ts`.

## Implementation outline

1. `renderChallengeHead(view)` in `backend/src/social/challenges.ts` (pure, with an `escapeHtml` helper listed in `backend/reusability.md`), and the `/head` route in `backend/src/routes/challenges.ts`.
2. SSI block and include in `src/app.html`.
3. `nginx.web.conf`: the `/c/` location, the internal include location, the cache path and the `limit_req` zone; the API upstream passed to the image (`Dockerfile.web`, `fly.web.toml`).
4. **Docs in the same PR:** `frontend/seo.md` (a "Runtime head include for challenge links" section and the `app.html` contract note), `backend/README.md` (the route), `PRODUCT.md` (one sentence in the challenge links entry).

**Tests**

- **API** (`backend/tests/challenge-head.test.ts`): the title for each row of the table; consent off never prints the handle; a hostile market title is escaped; not found answers 404 with an empty body; the image URL is absolute and on the configured app origin.
- **Web image smoke check:** a container built from `Dockerfile.web` against a stub upstream: the fragment is present on `/c/<id>`; the generic stub is present when the upstream times out or answers 404; `/` and a market path are byte-identical to the build output's head.
- **Manual, on staging:** WhatsApp, Telegram and iMessage previews of a live link, a revoked link and a link with consent off.
- Playwright cannot cover this (the `e2e` suite does not run nginx).

**Rollout.** Deploy the API route first, then the web image. Until A3 is live nobody holds a link, so the order only matters for the smoke check. Rollback: the previous web image; `/c/<id>` then previews as the generic card.

**Risks**

- **nginx mechanics are unverified** (open question 1). The fallback design changes only `nginx.web.conf` and is recorded under "Decisions".
- **A page path now waits on the API.** Bounded by the timeout, the stub and the micro-cache: an API outage costs a preview, not the page.
- **Preview staleness.** Messengers cache a preview for hours to days; a changed side or a revoked consent can outlive the link's state in chats where it was already unfurled. Nothing server-side can recall it; the page itself is always current.

## Acceptance criteria

- [ ] `curl https://vici.app/c/<id>` (no JavaScript) returns a head whose title and description match the challenger's current state and consent.
- [ ] The preview image is the generic share card, absolute and on vici.app.
- [ ] With the API unreachable, or for an unknown or revoked id, the head is the generic one and the page still loads.
- [ ] Every other path, and the Juno build, serve the same head as before this change.
- [ ] `/c/*` responses carry `noindex` and are not cached.
- [ ] A market title containing markup appears escaped.
- [ ] `seo.md` describes the include.

## Open questions

1. **nginx SSI behaviour in the web image.** Confirm in a container built from `Dockerfile.web`: (a) SSI in a regex location that serves `index.html` through `try_files` processes the directives; (b) the include accepts the id from a location capture or a `set` variable; (c) the stub block is emitted on an upstream timeout and on a 404; (d) the SSI comments in `src/app.html` survive `npm run build` unchanged; (e) the head patterns in `scripts/build/generate-seo-assets.ts` still match with the markers around them. If (a) to (c) fail, switch to the crawler-only proxy under "Decisions". If (d) or (e) fails, emit a dedicated shell copy for `/c/` when the image is built instead of marking `app.html`.
2. **How nginx reaches the API.** Over Fly's private network (is the API listening there?) or through `https://api.vici.app`. Over the public route every include carries the web machine's address, so the API cannot limit per visitor and nginx's own limits are the only ones.
3. **Which file is the generic share card, and on which domain.** `src/app.html` today points its `og:image` and canonical at `https://vici.market/branding/og-image.png`. Confirm the image the landing ships for vici.app and whether the generic head on vici.app should name vici.app; this spec's fragment always names vici.app.
4. **Is vici.app proxied by Cloudflare?** If so its cache and bot rules must neither cache `/c/*` HTML across ids nor challenge preview crawlers.
5. **Open issues.** Run the issue search that was not possible at authoring time.

## Decisions

- **Preview image: always the generic share card** (owner). The per-challenge part of the preview is the title and the description, both from the server. A composited image is out of scope.
- **Preview by an nginx include of an API-rendered head fragment.** Compared with the alternatives:
  - _Proxy `/c/*` to an API endpoint that returns the page._ The API would have to hold the SPA shell and its hashed bundle names in step with the web build, or answer a stub page that redirects, adding a hop and a blank frame for every person and making the page depend on the API being up. Rejected.
  - _Crawler-only proxy_ (nginx maps known preview user agents to the API; people get the SPA). The smallest change, but it serves two documents for one URL and silently degrades for any crawler missing from the list. Kept as the fallback if open question 1 fails, because an unknown crawler still gets the generic card.
  - _Generated images alone._ An image does not solve the tags: title, description and image URL must be in the HTML a crawler fetches.
  - The include serves one document to everyone, needs no crawler list, leaves the SPA shell owned by the web build, and fails to the generic card.
- **English previews.** A crawler has no recipient locale; the page is localised once it loads.
- **No analytics on preview fetches.** They are crawler traffic.
