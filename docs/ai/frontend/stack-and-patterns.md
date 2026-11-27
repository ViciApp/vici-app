# Stack & Patterns

Idiomatic patterns for the **SvelteKit 2 + Svelte 5 + TypeScript +
Tailwind v4** stack as it lives in this repo. If a pattern here disagrees
with code in `src/`, the code wins (truth hierarchy in
[governance.md](../governance.md)). Update this page in the same PR;
that's the [meta-update rule](../governance.md#meta-update-rule).

## Svelte 5: runes everywhere

This project is **Svelte 5** and uses runes for new code:

| Use (new code)                                                                                     | Don't use (Svelte 4 style)                    |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Separate `interface Props { … }` + `let { … }: Props = $props()` (see [Props shape](#props-shape)) | `export let foo`                              |
| `let count = $state(0)`                                                                            | plain `let` for component-local reactive vars |
| `let total = $derived(price * qty)`                                                                | `$: total = price * qty`                      |
| `$effect(() => { /* I/O */ })`                                                                     | side-effect via `$:`                          |
| `<button onclick={fn}>`                                                                            | `on:click`                                    |
| `{#snippet}` + `{@render}`                                                                         | named `<slot>` for new code                   |

### Props shape

Always declare props as a **named `interface Props`** above the
destructuring, declared **inside** the component file. This keeps the
shape easy to read and easy to extend in tests / sibling components:

```svelte
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Market } from '#lib/types/market.ts';

	interface Props {
		market: Market;
		highlight?: boolean;
		onSelect?: (id: Market['id']) => void;
		footer?: Snippet;
	}

	let { market, highlight = false, onSelect = () => {}, footer }: Props = $props();
</script>
```

Rules:

- One `interface Props` per component, declared at the top of the
  `<script>` after imports.
- Required props first, optional / defaulted ones after.
- Callbacks default to a no-op (`() => {}`) so callers can omit them.
- **Avoid `$bindable`** unless explicitly required. The repo prefers
  callback props (`onChange`) over two-way bindings.
- Do **not** inline the type literal into `$props()` for new code; use a
  named `interface Props`.

### Effect hygiene

- Never read state inside an `$effect` and write it back without a guard:
  it loops. Restructure to `$derived` whenever possible.
- The write-then-read order does **not** save you: an effect that assigns
  `foo` and reads `foo` anywhere in the same body still registers `foo` as
  its own dependency. If the assigned value is a fresh identity each run
  (array/object literal, `JSON.parse`, `.map(...)`), the effect re-triggers
  itself until Svelte aborts the whole flush with
  `effect_update_depth_exceeded`, which freezes **every** component on the
  page, not just the offender. Read the just-computed local instead, or wrap
  the read in `untrack(...)`. (Bit the Arena standing hero: its cache-seed
  effect assigned `scopes` a fresh array and then read it in the
  `idx >= scopes.length` clamp, hard-freezing `/arena`.)
- Prefer `$derived` over `$effect`. An `$effect` is for I/O (DOM, network,
  storage). Computation belongs in `$derived` / `$derived.by`.

### Reactive reads: no hidden captures

Props returned by `$props()` and values bound to `$state` are **reactive
accessors**. Reading them outside a reactive context (`$derived`,
`$derived.by`, `$effect`, template expressions, or lifecycle / event
callbacks) captures the **initial value only**; later prop changes will
not propagate.

`svelte-check` flags the obvious form:

```svelte
<script lang="ts">
	let { result }: Props = $props();
	const isSkip = result === 'SKIP'; // ⚠ state_referenced_locally
</script>
```

The linter **does not catch** reads hidden inside a function body that
executes eagerly at module init: the classic offender is an IIFE:

```svelte
<script lang="ts">
	let { correct }: Props = $props();

	// ❌ BUG: `correct` is captured at init; later prop changes won't reflect.
	const phraseKey = (() => {
		if (correct) return 'flow.feedback.right_1';
		return 'flow.feedback.wrong_1';
	})();
</script>
```

The correct shapes:

```svelte
<script lang="ts">
	let { correct }: Props = $props();

	// ✅ Pure derivation: re-runs when `correct` changes.
	const phraseKey = $derived(correct ? 'flow.feedback.right_1' : 'flow.feedback.wrong_1');

	// ✅ Same idea, multi-statement body.
	const phraseKey2 = $derived.by(() => {
		if (correct) return 'flow.feedback.right_1';
		return 'flow.feedback.wrong_1';
	});
</script>
```

If you need a value that is computed **once per mount** but seeded from
non-reactive inputs (e.g. `Math.random()`), keep the seed at module
scope and feed it through `$derived` for the prop-dependent part:

```svelte
<script lang="ts">
	let { correct }: Props = $props();

	const idx = Math.floor(Math.random() * 3); // stable per mount
	const phraseKey = $derived(
		(correct ? RIGHT_KEYS : WRONG_KEYS)[idx] // reactive on `correct`
	);
</script>
```

Rule of thumb: if a `const` at module scope reads a prop or `$state`
binding, directly **or** inside an immediately-invoked function, wrap
it in `$derived` / `$derived.by`. Top-level IIFEs whose bodies touch
reactive bindings are an anti-pattern; the only safe IIFE is one that
lives **inside** a reactive context (`$derived(...)`, `$effect(...)`,
`onMount(...)`, …).

### Stores still exist

Svelte stores (`writable` / `readable` / `derived` from `svelte/store`)
remain the primary cross-route reactive primitive in this repo. The graph
under `#lib/stores/` and `#lib/derived/` is mature; keep adding to it
where it fits an existing shape, rather than splitting the world between
runes and stores.

| Need                                           | Use                                                                    | Where it lives       |
| ---------------------------------------------- | ---------------------------------------------------------------------- | -------------------- |
| Component-local mutable value                  | `$state`                                                               | Inside the component |
| Component-local computed value                 | `$derived` / `$derived.by`                                             | Inside the component |
| Side effect (DOM, network, subscription)       | `$effect` (or `onMount` for true mount work)                           | Inside the component |
| Value shared by 2+ components in the same page | Pass via props / snippets                                              | -                    |
| Value shared across views (markets, wallet, …) | A Svelte `writable` / `readable` store, or a `*.svelte.ts` rune module | `#lib/stores/`       |
| Computed value across stores                   | `derived(...)` Svelte store                                            | `#lib/derived/`      |

Avoid duplicating server / canister state into a local store; fetch via
the service layer and let the service own caching.

## TypeScript

- **No `any`.** Use `unknown` and narrow.
- **No `as unknown as X`** to launder types. Either fix the type, or write
  a narrowing function.
- **No non-null assertion (`!`)** on values that can actually be null;
  use `isNullish` / `nonNullish` from `@dfinity/utils`, optional chaining,
  or an explicit guard with an early return.
- **No direct nullish comparisons** (eslint): `x === null`,
  `x !== undefined`, loose `x == null`, … are all banned: write
  `isNullish(x)` / `nonNullish(x)` from `@dfinity/utils` instead. The
  helpers are type guards, so narrowing works the same.
- **Generated types are the source of truth at canister boundaries.**
  Always import request / response types from the `#declarations` barrel
  (`import type { ClearingDid } from '#declarations'`); never re-declare
  them.
- **Schemas first.** When data crosses a boundary (network, storage),
  validate with the matching `zod` schema from
  `#lib/schema/`.
- **Discriminated unions** for `Result<T>` flows. Look at the closest
  neighbour and follow the same shape.
- **Type imports**: prefer `import type { … }` for types-only;
  `prettier-plugin-organize-imports` will sort them.
- **`BigInt` zero**: forbidden literal `0n` (eslint). Use the `ZERO`
  constant from `#lib/constants/app.constants.ts`.
- **`catch` bindings are always `: unknown`.** Even when the binding is
  unused (`catch (_: unknown)`, `catch (_e: unknown)`). The annotation is
  redundant under `strict` (TS already infers `unknown`), but we write it
  explicitly so intent is visible at the call site and so a future
  `strict: false` slip can't silently widen it back to `any`. Narrow with
  `instanceof Error` or a `zod` schema before reading properties.
- **Optional over a sentinel for "not known yet".** When a numeric field
  can be genuinely unknown (still loading, or empty), model it as
  optional (`field?: number`) and let consumers render a skeleton /
  placeholder for `isNullish`; do not pick a magic in-range default that
  is indistinguishable from a real value. `Market.yesProbability` is the
  worked example: a `0.5` default read as a real coin-flip and showed
  un-loaded markets as 50%. It is now optional, paired with a
  `priceLoaded` boolean that separates _loading_ (skeleton) from
  _loaded-but-empty_ (dash); the probability placeholder is
  `#lib/components/market/MarketProbabilitySkeleton.svelte`. See
  [`PRODUCT.md`](../PRODUCT.md) → "Market probability".

## Service / data flow

```
Component (.svelte)
  ↳ #lib/services/*.services.ts          orchestration, state mutations, error handling
       ↳ #lib/web2/client.ts             typed wrappers around the HTTP API routes
       ↳ #lib/api/*.api.ts               the public canister reads left (order book, ledger fee)
```

- Components **do not** call `client.ts` or `fetch` directly. Always go
  through the matching service module.
- A `*.services.ts` function should:
  - Accept a typed input.
  - Gate "signed in" on the session store (`getWeb2User()` from
    `#lib/web2/session.ts`, or `isSignedIn` / `getSignedInOwner` from
    [`#lib/services/identity.services.ts`](../../../src/lib/services/identity.services.ts));
    a public canister read takes `anonymousIdentity()` from the same module.
  - Surface errors via the project's notification / toast pattern (`#lib/stores/notification.store.ts`).
  - Never throw to the caller for expected user errors; return an
    informative result.

Example shape (from
[`#lib/services/worlds.services.ts`](../../../src/lib/services/worlds.services.ts)):

```ts
import type { AffiliationDoc, AffiliationKind } from '#lib/types/affiliation.ts';
import { withTimeout } from '#lib/utils/async.utils.ts';
import { setAffiliation as setAffiliationWeb2 } from '#lib/web2/client.ts';

export const joinAffiliation = ({
	kind,
	affiliationIdentifier
}: {
	kind: AffiliationKind;
	affiliationIdentifier: string;
}): Promise<AffiliationDoc> =>
	withTimeout({
		operation: setAffiliationWeb2({ kind, affiliationIdentifier }),
		timeoutMs: AFFILIATION_WRITE_TIMEOUT_MS,
		label: 'joinAffiliation'
	});
```

## Engine integration (icdc-core)

Vici talks to the on-chain Rust canisters in `../icdc-core/`. The Engine
model (what `engine_id` to pass, who has `Creator` / `OracleAdmin`, how
app roles are mirrored to the Vici engine) is documented in
[`docs/engine-integration.md`](../../engine-integration.md). When writing
a new market / oracle path, **read that doc first**. The single place that
pins `VICI_ENGINE_ID` is
[`src/lib/constants/icdc.constants.ts`](../../../src/lib/constants/icdc.constants.ts).

### Call size is a FE fixed-amount skin over the CLOB

The engine is a **share-based CLOB**: an order is `(price, qty)` where `qty`
is a number of outcome shares (each pays `1` on win) and the locked margin is
`qty × price`. The UI never exposes shares; it presents a **fixed-amount**
("call size") convention: the slider value is the VXP you spend, you lose
exactly that if wrong, and a win pays `amount / price`. The two are the same
trade, spending `amount` to buy `amount / price` shares, so this is a
**pure FE presentation layer; the ICDC `(price, qty)` convention is
untouched.** The conversion is the one line in
[`executeOutcomeTrade`](../../../src/lib/utils/trade.utils.ts):
`qty = collateral / price`.

The `price` in both the order sizing **and** the "+X VXP" payout preview is the
**order-book execution price**, resolved once by
[`resolveOutcomeExecutionPrice`](../../../src/lib/utils/market.utils.ts) (best
ask for YES, `1 − best bid` for NO, consensus mid only when that side of the
book is empty). Always size previews off this helper, never off the consensus
mid (`yesProbability`): the mid ignores the spread and over-promises the
payout on a thin / one-sided book. Net payout itself is computed by
[`vxpNetWin`](../../../src/lib/utils/vxp-economy.utils.ts) (`amount / price −
amount`, with a `VXP_P_WIN_FLOOR` cap on long-shot display). The flow card does
**not** load full book depth (a known N+1 perf footgun), so the preview models
spread-level slippage from top-of-book, not multi-level depth walking.

A market order fills by walking the book best level first
([`walkMarketOrder`](../../../src/lib/utils/market-order.utils.ts), called by
`placeOrder`). The walk spends **at most the call size**: each level gives no
more than the rest of the sized `qty`, the level's size, and what the rest of
the amount buys at that level's price, so on a thin book the call fills fewer
shares at worse levels instead of costing more than the slider value. The
analytics `value` of a market order is that real cost, not `qty` at the
top-of-book price.

## Identity & auth

- The session is an HttpOnly cookie; `#lib/web2/session.ts` mirrors it and
  `Authn.svelte` hydrates `userStore` from it. The browser holds no signing
  identity: see "Auth" in [`web2-backend-mode.md`](./web2-backend-mode.md).
- Sign-in is the email one-time code and the API-driven Google redirect
  (`SignInProviderStack.svelte`); Apple and Passkey render as "coming soon".
- **Identity-scoped browser storage must be dropped on a principal change.**
  `localStorage` is device-wide and shared across accounts on the same
  browser. Any key holding state that belongs to a specific signed-in user
  (caps, counters, read-state, "seen" flags) WILL bleed into the next
  account unless it is cleared on the auth transition. The single chokepoint
  is
  [`reconcileIdentityScopedStorage`](../../../src/lib/services/identity-storage.services.ts),
  run by
  [`resetIdentityScopedState`](../../../src/lib/services/identity-reset.services.ts),
  the one reset
  [`Authn.svelte`](../../../src/lib/components/authn/Authn.svelte) runs on
  every auth transition in both backend modes (each `onAuthStateChange`
  on-chain, each web2 session hydrate and clear), together with the
  in-memory user-scoped caches. A new user-scoped store registers its reset
  there, never in `Authn` beside it. It compares the new principal against
  a persisted owner (`vici.storage-owner.v1`) and wipes the identity-scoped
  caches **only when the owner actually changes**, never on a same-user
  reload, so the offline-resilient daily-goal mirror survives a refresh.
  When you add a new user-scoped persisted key, register its reset in
  `reconcileIdentityScopedStorage` (and prefer
  routing genuinely cross-device state through `profile.preferences`
  instead; that store already resets on sign-out). A store that loads such
  a key into memory at import must also re-read it on an owner change: a
  web2 account switch keeps the tab alive, so deleting the key alone leaves
  the old copy in memory to be written back under the next owner (the
  inbox does this in `reloadPersistedInboxState`, called from
  `initInboxProgress`). Device-level keys (theme, locale, last-open tab)
  intentionally stay put.
- **A load that lands after an account switch must not count as the next
  account's.** Resetting a store is not enough when a fetch started for the
  previous account is still in flight. The clearing figures carry the
  `owner` they were loaded for (`CollateralStoreData.owner`), and
  [`vxp-holdings.utils`](../../../src/lib/utils/vxp-holdings.utils.ts) reads
  them, and keys the persisted holdings snapshot, only for that owner.

## Tailwind v4 + design tokens

- **Use the project's tokens.** [`src/app.css`](../../../src/app.css)
  exposes the standard semantic palette (`primary`, `background`,
  `foreground`, `card`, `popover`, `muted-foreground`, `success`,
  `destructive`, `border`, `input`, …), plus repo-specific design
  tokens: the prediction signals (`yes` / `no` / `hold` and their
  `-deep` / `-wash` variants), the `danger` ramp (`danger` /
  `danger-deep` / `danger-wash`, a theme-stable terracotta), the
  `laurel` brand ramp (`laurel` /
  `laurel-deep` / `laurel-glow`), `ink`, `ink-line` /
  `ink-line-strong` (theme-stable parchment lines for surfaces with
  hard-coded dark backgrounds), `border-strong`, the `ease-vici`
  curve, and the `inset-hi` / `inset-hi-strong` / `modal` shadows. For
  values Tailwind v4 doesn't generate utilities for natively (custom
  transition durations, composed multi-shadow values), the file also
  defines `@utility` wrappers: currently `duration-hover` /
  `duration-state` (bound to `--d-hover` / `--d-state`) and
  `shadow-mobilenav-active`. Use the generated utilities directly:
  `bg-card`, `text-yes`, `bg-no-wash`, `border-border-strong`,
  `border-ink-line`, `shadow-inset-hi`, `ease-vici`, `duration-hover`,
  `bg-laurel/20`.
- **`danger` (terracotta) vs `no` / `destructive` (red): do not
  conflate.** Destructive / irreversible-action UI (delete, sign-out,
  danger buttons / warnings) uses the `danger` ramp (`bg-danger`,
  `text-danger`, `hover:bg-danger-deep`, `bg-danger-wash`) so it reads
  as caution, not as a market outcome. The `no` signal (and the
  `destructive` alias that still maps to it) is reserved for the
  prediction **NO** outcome and financial-loss semantics: NO splits,
  probability bars, payouts, `out` wallet rows, order-book asks. When a
  red is a NO outcome / loss, keep it on `no` / `destructive`; when it's
  a destructive action, use `danger`.
- **No `[var(--…)]` arbitrary values for design tokens.** Tailwind v4
  generates `bg-foo` / `text-foo` / `border-foo` / `ring-foo` /
  `shadow-foo` / `ease-foo` utilities for every `--color-*`, `--shadow-*`
  and `--ease-*` token in `@theme`. If a token is missing from `@theme`,
  add it there in the same PR rather than reaching for
  `bg-[var(--my-token)]`. For values outside those Tailwind namespaces
  (custom transition durations, composed shadows), add an `@utility`
  wrapper instead of an arbitrary value with an embedded token. Same
  goes for `style="color: var(--foo)"` / `style="box-shadow: var(--foo)"`:
  use the utility.
- **No raw hex** (`bg-[#0f0]`).
- **Class order** is auto-sorted by `prettier-plugin-tailwindcss`. Don't
  bikeshed it.
- **Variants & responsive:** prefer Tailwind variants (`md:`, `dark:`,
  `data-[active=true]:`) over JS branches.
- The repo ships a "premium glassmorphic" design system. Match what the
  closest neighbour uses; don't introduce a competing aesthetic.

## Icons

- Default to `@lucide/svelte` (`import { ArrowRight } from '@lucide/svelte';`).
- Bespoke icons live under `#lib/components/icons/`. Re-use them before
  inlining a new SVG.
- Decorative icons → `aria-hidden="true"`.
- Icon-only buttons → must have `aria-label`.

## Routing

- SvelteKit **file-based routes** under
  [`src/routes/(app)/`](<../../../src/routes/(app)/>) (`/app`, `/flow`,
  `/markets/[id]`, …; `/` and the sign-in, invite and claim pages sit
  outside it). Add a new view by adding a new
  `(app)/<path>/+page.svelte` (or sub-route) and a matching `AppPath`
  entry; there is no central nav store.
- The mobile tab bar
  ([`src/lib/components/layout/MobileNav.svelte`](../../../src/lib/components/layout/MobileNav.svelte))
  compares `page.url.pathname` to `AppPath` from
  [`src/lib/constants/routes.constants.ts`](../../../src/lib/constants/routes.constants.ts).
  Visible nav items (icon, label, path) are configured in
  [`src/lib/constants/nav.constants.ts`](../../../src/lib/constants/nav.constants.ts).
- Navigate to an `AppPath` (or any pathname written with a leading `/`)
  through `resolveAppPath` from `#lib/utils/nav.utils.ts`. SvelteKit's
  `resolve` reads a leading `/` as a route ID, and app route IDs carry the
  `(app)` group (`/(app)/arena`), so `resolve(AppPath.Arena)` does not
  type-check. Top-level routes (`PublicPath.SignIn` → `/signin`) are their
  own route IDs and go through `resolve` directly.
- Page-level shells composed inside specific routes live in
  `#lib/components/pages/` (or the matching feature folder).

## Performance

- Wrap expensive work in `$derived.by` (cached) or in a `derived(...)`
  Svelte store, not in the render path.
- `{#each items as item (item.id)}` with a stable key.
- Load modules statically. Dynamic `import()` is not a per-component
  lazy-load tool: scattered deferred imports through stores and components
  are rejected. The one structural split is the per-locale catalog loader in
  [`i18n.utils.ts`](../../../src/lib/utils/i18n.utils.ts); see
  [Forbidden imports / patterns](./structure.md#forbidden-imports--patterns).

## Anti-patterns (do not do these)

- `export let foo` in new code.
- Inline type literal in `$props()` (`let { … }: { … } = $props()`).
- Reactive `$:` statements in new code.
- Module-scope IIFE (`const x = (() => { … })()`) whose body reads a
  `$props()` value or `$state` binding; captures the initial value
  only. Use `$derived` / `$derived.by` instead. See
  [Reactive reads: no hidden captures](#reactive-reads-no-hidden-captures).
- `$bindable` unless explicitly required by the API.
- Reaching into `document.querySelector` to mutate Svelte-managed DOM.
- Catching an error and silently swallowing it; surface via
  `#lib/stores/notification.store.ts` or propagate.
- Hard-coding strings, hex colours, magic numbers in components.
- "Just one more `any`"; there is no "just one more".
- Adding a wrapper component that only re-exports another component.
- `target="_blank"` without `rel="noopener noreferrer"`.
- `{@html …}` without sanitisation.
- `console.log` left in committed code.
- The word "bet" anywhere it could leak to a user (always "prediction").
- Time variables without a `_ms` / `_ns` suffix.
