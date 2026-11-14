# Frontend Structure & Naming

The folder taxonomy is **closed**: do not add new top-level folders under
`src/lib/` (or `src/`) without explicit user approval. Place new code in
the folder that already owns the concern.

## Top level (`src/`)

```
src/
├── app.css                 Tailwind theme + design tokens (primary, background, card, …)
├── app.d.ts                Ambient SvelteKit types
├── app.html                HTML shell
├── custom-events.d.ts      Ambient custom-event types for Svelte
├── landing.css             Unscoped landing styles (`.lp-*`, `.dnav-*`), imported by app.css
│
├── routes/                 SvelteKit file-based routing, one folder per URL
│   ├── (app)/              App shell group: +layout.svelte mounts navs, loaders, hosts
│   │   ├── +layout.svelte
│   │   └── admin/ app/ arena/ calibration/ dash/ flow/ info/ markets/
│   │       notifications/ portfolio/ profile/ settings/ wallet/
│   ├── about/ claim/ signin/ signup/ welcome/        Public pages
│   ├── i/[code]/ join/[code]/ league/[code]/ m/[id]/ Invite / share links
│   ├── auth/callback/google/                         OAuth callback flow
│   ├── +layout.svelte
│   ├── +layout.ts
│   └── +page.svelte        Root landing gate (signed in → /flow, else WelcomePage)
│
├── lib/                    Application code (cross-route)
│   ├── components/         UI grouped by feature (see below)
│   ├── services/           Side-effectful orchestration (`*.services.ts`)
│   ├── api/                Wrappers around generated declarations (`*.api.ts`)
│   ├── canisters/          IC actor factories (`*.canister.ts`)
│   ├── stores/             Writable / readable Svelte stores (`*.store.ts`)
│   ├── derived/            Derived stores (`*.derived.ts`)
│   ├── schema/             Zod schemas (`*.schema.ts`)
│   ├── validation/         Validation helpers (assertions, parsers)
│   ├── enums/              Plain TS enums (UserRole, Permission, …)
│   ├── types/              TS interfaces / types
│   ├── constants/          Static config / lookup tables / routes / canister IDs
│   ├── utils/              Pure helpers: no I/O, no DOM
│   ├── actors/             Generic actor helpers
│   ├── actions/            Svelte `use:` actions (e.g. click-outside)
│   ├── assets/             Bundled assets imported by code (flags/ behind COUNTRY_FLAGS)
│   ├── dev/                Dev-build-only hooks (Playwright e2e reset, open sign-ups)
│   ├── env/                Runtime env types
│   └── web2/               HTTP-backend seam (approved, migration-scoped: mode
│                           flag + typed /api/v1 client; grows one adapter per
│                           swapped domain and is absorbed into api/ + services/
│                           when the satellite is decommissioned; see
│                           web2-backend-mode.md)
│
├── satellite/              Juno satellite (TS canister functions). See ../satellite/.
├── service-worker/         Navigation-fallback worker for the OAuth callback (see its header)
├── tests/                  Unit tests mirroring src/ (see testing.md)
└── declarations/           Generated bindings (DO NOT hand-edit)
```

### Components: feature folders today

`src/lib/components/` is split by feature. Look here before creating a new
top-level group:

- `admin/`: admin console surfaces.
- `arena/`: Arena surface: social-graph UI (relations, comments, discussion).
- `artwork/`: generative visual primitives shared across features
  (e.g. `FlowArtFrame`: per-category SVG marks rendered by
  `#lib/utils/flow-art.utils.ts`). Parallel to `characters/`.
- `authn/`: authentication / Internet Identity / OAuth flows.
- `authz/`: authorization (role gating, guards rendering).
- `characters/`: character SVGs (Vici, Oracle, Trickster, Flame).
- `claim/`: legacy-to-new-app migration banners.
- `dash/`: Dashboard surfaces.
- `dev/`: dev-build-only tooling (`TweaksPanel`).
- `guest/`: signed-out guest conversion funnel.
- `icons/`: bespoke icons not covered by `@lucide/svelte`.
- `layout/`: app chrome (`ScreenHeader`, `PageScaffold`, `DesktopAppNav`, `MobileNav`, `WelcomeNav`).
- `landing/`: public marketing sections (`WelcomeHero`, `WelcomeProof`, `WelcomeFooter`, …).
- `leagues/`: leagues, battles and the affiliation picker.
- `loaders/`: loader shells and the `LoaderXxx` cache fillers mounted by `Loaders`.
- `market/`: prediction-market UI (filters, cards, detail, order book, …).
- `menagerie/`: the achievement trophy layer.
- `onboarding/`: first-run / profile onboarding flows.
- `pages/`: page-level shells composed inside specific routes.
- `portfolio/`: user portfolio surfaces (positions, balances).
- `profile/`: user profile (own + public).
- `pwa/`: Add-to-Home-Screen install sheet.
- `saved-markets/`: the market bookmark toggle.
- `settings/`: settings screen row primitives (`SetRow`, `SetToggle`, …).
- `ui/`: app-local UI primitives (see
  [`reusability.md`](./reusability.md#ui-primitives-libcomponentsui)).
- `wallet/`: collateral / token / send-receive UI.
- `worlds/`: Worlds (school / country) battle cards and prompts.

Add a new `components/<feature>/` folder only if the concern doesn't fit
any of the above. Surface the question in the PR description.

## Naming conventions

These are **strict**. ESLint / `svelte-check` do not enforce all of them,
so agents must.

### File suffixes

| Suffix               | Meaning                                                    | Example                                        |
| -------------------- | ---------------------------------------------------------- | ---------------------------------------------- |
| `*.svelte`           | Component (PascalCase filename)                            | `MarketCard.svelte`, `SignInModal.svelte`      |
| `*.svelte.ts`        | Module that uses Svelte 5 runes outside a component        | _(rare today; introduce as needed)_            |
| `*.services.ts`      | Side-effectful module (calls APIs, mutates stores, toasts) | `market.services.ts`, `collateral.services.ts` |
| `*.api.ts`           | Wrapper around a canister actor / generated declaration    | `clearing.api.ts`, `registry.api.ts`           |
| `*.canister.ts`      | IC actor factory                                           | `clearing.canister.ts`                         |
| `*.store.ts`         | Writable / readable Svelte store factory                   | `markets.store.ts`, `user.store.ts`            |
| `*.derived.ts`       | Derived Svelte store                                       | `markets.derived.ts`                           |
| `*.schema.ts`        | Zod schema                                                 | `profile.schema.ts`                            |
| `*.utils.ts`         | Pure helpers: no I/O, no side effects, no DOM access       | `format.utils.ts`, `market.utils.ts`           |
| `*.constants.ts`     | Compile-time constants, enums, lookup tables               | `app.constants.ts`, `locale.constants.ts`      |
| `*.ts` (in `types/`) | Interfaces / types                                         | `market.ts`, `profile.ts`                      |
| `*.ts` (in `enums/`) | Plain TS enums                                             | `user.ts` (`UserRole`), `permission.ts`        |

### Casing

| Thing                    | Style                         | Example                               |
| ------------------------ | ----------------------------- | ------------------------------------- |
| `.svelte` filename       | `PascalCase`                  | `MarketCard.svelte`                   |
| `.ts` filename           | `kebab-case`                  | `market-price-history.utils.ts`       |
| Folder                   | `kebab-case` (or single word) | `market/`, `wallet/`, `address-book/` |
| Component name           | `PascalCase`                  | `MarketCard`                          |
| TS type / interface      | `PascalCase`                  | `MarketSummary`                       |
| Function / variable      | `camelCase`                   | `formatBalance`                       |
| Constant export          | `SCREAMING_SNAKE`             | `VICI_ENGINE_ID`                      |
| Test ID / data attribute | `kebab-case`                  | `data-tid="market-card"`              |

### Time variables: `_ms` / `_ns`

Time values must carry their unit in the variable name:

- **`_ms`**: milliseconds. Default for business logic
  (`marketExpiry_ms`, `createdAt_ms`).
- **`_ns`**: nanoseconds. Use when the value crosses an IC protocol
  boundary or an idempotency key (`requestId_ns`, `submittedAt_ns`).

Convert with `MILLISECOND_IN_NANOSECONDS` from
`#lib/constants/app.constants` (divide nanoseconds by it, as
`market.utils.ts` does), and name a helper after the unit it takes, so
the caller sees which one to pass (`formatRelativeAgoFromNs` in
`format.utils.ts`).

### Terminology: "prediction", never "bet"

Use **"prediction"** in code identifiers, comments, and any user-visible
copy. The exception is when calling external libraries that already use
the word "bet"; wrap the boundary so it doesn't leak into Vici code.

The ban covers the whole betting lexicon in **every** locale, not just the
word "bet": no "wager" / "stake" / "odds", no `Apuesta` / `Aposta` /
`Mise` / `Posta` / `Einsatz` / `赌注` in user-visible copy. The single
deliberate exception is the legal disclosure (`footer.disclosure`,
"cannot be wagered" and its translations); never reword it.

### Imports: aliases only

The local rule `local-rules/no-relative-imports` is **`error`** under
`src/**`. Import through the subpath imports declared in
[`package.json`](../../../package.json) `imports` (SvelteKit 3 deprecates
`config.alias`, and there is no `svelte.config.js`). Paths under them need
the file extension (`.ts`, `.svelte`; `.d.ts` for type-only imports of
generated bindings that have no runtime file). Bare `#declarations` is the
one extensionless import: `package.json` maps it straight to
`src/declarations/index.ts`:

| Import          | Path               |
| --------------- | ------------------ |
| `#lib`          | `src/lib`          |
| `#declarations` | `src/declarations` |
| `#satellite`    | `src/satellite`    |
| `#root`         | repo root          |

```ts
import { localeStore } from '#lib/stores/locale.store.ts';
import type { Market } from '#lib/types/market.ts';
import { clearingApi } from '#lib/api/clearing.api.ts';
import { ZERO } from '#lib/constants/app.constants.ts';
import { syncRoleToEngineOnSet } from '#satellite/services/engine-sync.services.ts';
import { t } from '#lib/utils/i18n.utils.ts';
import type { _SERVICE as ClearingService } from '#declarations/clearing/clearing.d.ts';
```

### Forbidden imports / patterns

- Relative imports across folders (`../../...`) under `src/**` (eslint
  `local-rules/no-relative-imports`).
- Hand-edits to `src/declarations/**` (regenerate via `npm run did`).
- Hand-edits to `src/satellite/satellite.did` /
  `src/satellite/satellite_extension.did` /
  `src/satellite/api-schemas.ts` (regenerated by
  `npm run juno:functions:build`).
- `0n` literal: use `ZERO` from `#lib/constants/app.constants.ts` (eslint).
- `return undefined;`: bare `return;` for early exits, or comment-explain
  in `catch` blocks (eslint).
- Direct comparisons against `null`/`undefined` (`x === null`,
  `x !== undefined`, loose `== null`, …): use `isNullish` / `nonNullish`
  from `@dfinity/utils` (eslint).
- Hardcoded user-visible strings in `.svelte` templates: route through
  `t({ locale: $localeStore, key })` from `#lib/utils/i18n.utils.ts`. The
  ESLint rule `local-rules/no-bare-svelte-text` flags this in components
  that already import `i18n.utils`. See [`i18n.md`](./i18n.md).
- **Dynamic `import()` of internal (`#lib/**`) modules: avoid it.** The
  codebase intentionally has **none**, and new ones are not welcome. It was
  previously used to paper over circular dependencies; that is the wrong
  fix. **Circular references are solved by extraction, not by deferring the
  import to runtime:** a cycle means a shared symbol lives in the wrong
  module, so pull it into its own small, scoped module that both sides
  import statically. Worked example: the read-only relation queries were
  split into
  [`relation-queries.services.ts`](../../../src/lib/services/relation-queries.services.ts),
  away from the mutation layer in `relation.services.ts`, so
  `group.services` and `relation.services` no longer form a cycle. If you
  hit a circular dependency, split the module; do not reach for `await import()`. (This is a hard project preference; keep modules small
  and single-purpose rather than gigantic ones that import each other.)

## Where to put new files (decision tree)

1. **Is it a new screen?** Add a route folder under `src/routes/(app)/<path>/`
   (or `src/routes/<path>/` for a public page) whose `+page.svelte` is a thin
   shell rendering one page component from `src/lib/components/pages/`. The
   screen's UI lives in that page component and feature folders, not in the
   route file.
2. **Is it a generic UI primitive (Button, Card, Modal, Tooltip)?** → look
   in `#lib/components/ui/` first; only add a new primitive if neither it
   nor an existing component covers it.
3. **Is it specific to a feature (market, wallet, arena, admin, …)?** →
   `#lib/components/<feature>/<Name>.svelte`.
4. **Is it a side-effectful operation?** → `*.services.ts` under
   `#lib/services/`.
5. **Is it a thin wrapper around a canister actor?** → `*.api.ts` under
   `#lib/api/`. Use the matching `#lib/canisters/*.canister.ts` for the
   actor factory.
6. **Is it a pure helper?** → `*.utils.ts` under `#lib/utils/`.
7. **Is it a constant / enum / lookup table?** → `*.constants.ts` in
   `#lib/constants/`, or a TS enum in `#lib/enums/` if it's a closed set
   of named values used as a discriminator.
8. **Is it a Svelte store?** → `*.store.ts` under `#lib/stores/`.
9. **Is it a derived store?** → `*.derived.ts` under `#lib/derived/`.
10. **Is it a Zod schema for an external boundary?** → `*.schema.ts` under
    `#lib/schema/`.
11. **Is it generated?** → don't create it by hand. Run the generator.
12. **None of the above?** → ask. Don't invent a folder.
