# Spec: Team-only sign-in in the app

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: In progress (#1789)

Part 2 of 2. Part 1 is [`2026-11-27-feat-team-only-signin-api.md`](./2026-11-27-feat-team-only-signin-api.md): the API refuses every sign-in and every session outside the team allowlist. This part removes the public doors in the app and gives the team one unlinked way in. It builds in parallel with part 1; nothing here is a security boundary.

## Goal

A visitor to vici.app sees only the public product: the landing (`/`, its Markets view), market share pages (`/m/...`), challenge links (`/c/...`), legal pages (`/info/...`) and the waitlist capsule. No page shows a "Sign in" or "Log in" entry point. `/signin`, `/signup`, `/flow` and every other app route send a visitor who is not signed in to `/`. The team signs in at `/team`, a path no page links to, kept out of the sitemap and marked `noindex`; once signed in, a team member uses the app and `/admin` as today.

## Context

(Implementer: ground this in the code on `main` at build time; the open PRs listed below move several of these files.)

- **App shell guard.** `src/routes/(app)/+layout.svelte` bounces a signed-out visitor to `/signin` (`PublicPath.SignIn`), exempting `/markets`, `/markets/*`, `/info/*` and the guest Flow route.
- **Sign-in screens.** `src/routes/signin/+page.svelte` and `src/routes/signup/+page.svelte` render `SignInScreen` (`src/lib/components/authn/`); signed-in callers go to Flow. `PublicPath` lives in `src/lib/constants/routes.constants.ts`.
- **Entry points on public pages.** Sign-in links in `src/lib/components/landing/` (`LandingNav`, `LandingFooter`, `LandingClaim`, `LandingClaimTray`, `LandingMarketsLeadCall`, `LandingMarketsDetail`, `LandingMarketsNote`) and `src/lib/components/layout/DesktopAppNav.svelte`; point-of-action bounces to `/signin` inside the app.
- **Refusal rendering.** The sign-in screen renders `?e=beta` / `beta_closed` with `signin.beta_closed`; part 1 sends OAuth refusals and errors to `/team?e=...`.
- **SEO.** `docs/ai/frontend/seo.md` (deploy-time sitemap, meta tags).
- **Open PRs touching the same files** (check `gh pr list` at build time, rebase on whichever merged): #1767 and #1771 (legacy app removal, web2 naming: `Authn`, `SignInProviderStack*`, `routes.constants`, `(app)/+layout`, `signup`), #1775 and #1783 (signed-out routing and funnel: `(app)/+layout`, `/m/[id]`, `/markets/[id]`, `signup`, landing), #1774 (waitlist capsule: `LandingNav`, `LandingClaim`, `routes.constants`), #1778 (`/c/[id]`).

## Scope

1. **`/team`.** A new route that renders the sign-in screen (same component, providers as today), with `<meta name="robots" content="noindex">`, absent from the sitemap and from every page's links. `PublicPath.Team` in `routes.constants.ts`. It renders the `?e=` refusal markers part 1 sends.
2. **Public routes redirect.** `/signin` and `/signup` send a signed-out visitor to `/` (replace), and a signed-in one to Flow as today. The `(app)` shell sends any signed-out visitor to `/` instead of `/signin`, keeping only the public exemptions the owner listed (legal `/info/*`; `/markets/*` follows what #1775 makes of it, which already routes signed-out visitors to the landing). Guest Flow is retired by #1783; if it is still on `main`, `/flow` signed out goes to `/` too.
3. **No entry points.** Every "Sign in" / "Log in" link or button on a public page is removed (not hidden by CSS). Point-of-action bounces in the app that targeted `/signin` now target `/` or the capsule, whichever the funnel PRs already use.
4. **Sign-out** lands on `/`.
5. **i18n.** One new key, `signin.oauth_failed`, for the `?e=state`, `?e=google` and `?e=apple` markers part 1 now sends to `/team` (before, they went to `/` and showed nothing); keys that become unused (`cta.primary`, the desktop nav's sign-in button) are removed from every catalog.
6. **Docs.** `docs/ai/PRODUCT.md`, `docs/ai/frontend/seo.md` (the unlinked noindex route), `docs/ai/frontend/web2-backend-mode.md` (where sign-in lives).
7. **Tests.** Unit specs for any new pure helper. E2E web2: sign-in helpers (`e2e-web2/pages/web2-app.page.ts`, `e2e-web2/support/fixtures.ts`) go through `/team`; a spec that `/signin`, `/signup` and `/flow` signed out land on `/` and that the landing has no sign-in link.

### Out of scope

- The API gate (part 1): the allowlist, refusals, session checks.
- Any change to the landing's design beyond removing the sign-in doors.
- The legacy (satellite) build, which #1767 removes.

## Linked issues

None found.

## Analytics

None new. `/team` is used by a handful of team members; their visits are not product signal, and the public redirects replace screens rather than add a surface.

## Implementation outline

1. Add `PublicPath.Team` and `src/routes/team/+page.svelte` (noindex head).
2. Turn `/signin` and `/signup` into the redirects above; repoint the `(app)` shell guard.
3. Remove the sign-in entry points listed in Context (grep `PublicPath.SignIn`, `PublicPath.SignUp`, `nav.signin`, `/signin`).
4. Sitemap: confirm `/team` is not emitted.
5. E2E and docs.

## Acceptance criteria

- [ ] No public page renders a link or button to `/signin`, `/signup` or `/team`.
- [ ] Signed out, `/signin`, `/signup`, `/flow`, `/dash`, `/admin` land on `/`.
- [ ] `/team` renders the sign-in screen with `noindex`, and is not in the sitemap.
- [ ] A team member signs in at `/team` and reaches Flow and `/admin`.
- [ ] `/team?e=beta` shows the neutral refusal.
- [ ] Web2 E2E passes, signing in through `/team`.

## Decisions

- **The path is `/team`.** Unlinked and `noindex`; obscurity is not the protection (part 1 is), so a plain name keeps it easy for the team to remember.
- **Redirect to `/`, not a 404.** The owner's decision: the public sees only the landing.
- **Same sign-in screen.** No new UI for the team; the refusal copy already covers a non-team address. On `/team` the footer's switch to sign-up is hidden (`canSwitch={false}`): there is no public sign-up to switch to.
- **The legacy build keeps its doors.** The redirects are gated on `isTeamOnlySignIn()` (`isWeb2Backend()`): vici.market keeps `/signin` and `/signup` (its moved screen) until #1767 removes it, and its E2E suite still signs in there. Only the landing's sign-in links go on both builds.
- **Point-of-action and sign-out destinations** go through two helpers in `new-app-redirect.services.ts`: `signedOutHomePath()` (the `(app)` gate, sign-out, a signed-out save heart) and `signInScreenPath()` (signing in again from inside: switching method, a dismissed refusal, the dev panel). The market page's call and "Claim your @handle" bounces are #1783's capsule funnel.
