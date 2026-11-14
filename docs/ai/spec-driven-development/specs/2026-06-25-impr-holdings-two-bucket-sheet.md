# Spec: Holdings sheet rework: two-bucket split bar

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#987)

## Goal

The holdings breakdown sheet on `/dash` (opened by tapping the holdings
card) is decluttered to a single honest idea: every VXP the user holds
is either **Available** ("Ready to spend on calls") or **In play** ("At
stake on N open calls"). The sheet leads with a "Your VXP" hero equal to
total holdings, then a two-segment split bar whose widths are
proportional to the two buckets, then two colour-keyed bucket rows that
visibly sum back to the hero. The old three-row breakdown (_Lifetime
earned_, _Currently in play_, _From referrals_) is removed; those are
history/provenance, not current holdings, and sitting a 142,910 lifetime
figure next to a 39,760 balance was the main "which number is mine?"
confusion. The existing "Transaction history" row and the invite CTA
stay, in that order (data → review → grow). This is a **visual rework of
the sheet only**: no data-model change.

## Context

The app's holdings data model is **already** total = available + in
play: `src/lib/derived/vxp-holdings.derived.ts` exposes `vxpSpendable`
(available), `vxpBacked` (in play), and `vxpHoldingsTotal` (their sum)
as bigint base units (4-decimal, `USD_DECIMALS == VXP_TOKEN.decimals`).
The Dash card and the Transactions header already render this model. The
only surface still on the old layout is the **sheet**.

### Files this spec touches

- `src/lib/components/dash/DashStackSheet.svelte`: the bottom sheet,
  the **only** component this spec rewrites. Currently renders the hero
  - three `.db-hd-row` rows (`dash.build.sheet_lifetime` /
    `dash.build.sheet_in_play` / `dash.build.sheet_referrals`) + invite
    CTA + the (already-shipped) transaction-history link row. Built on the
    shared `BottomSheet` (`src/lib/components/ui/BottomSheet.svelte`,
    reusability catalog "BottomSheet").
- `src/lib/components/pages/DashPage.svelte`: the host that wires the
  sheet (invocation at lines ~472–481). Already derives `holdingsDisplay`
  (`vxpHoldingsTotal`), `inPlayDisplay` (`vxpBacked`), and has
  `liveCallCount` (`activePositionsAll.length + openOrdersAll.length`,
  line ~167) for the "N open calls" plural. Must also pass an
  `availableDisplay` (currently only the Transactions page derives it
  from `vxpSpendable`) and drop the now-unused `lifetimeDisplay` /
  `referralVxpDisplay` / `referralCount` / `referralsLoading` wiring
  **from the sheet** (they remain used elsewhere on the page: verify
  before deleting; see Open questions).
- `src/lib/constants/messages/*.ts`: flat dotted-key catalogs (one file
  per locale: `en`, `it`, `es`, `es-419`, `es-AR`, `es-MX`, `de`, `fr`,
  `ja`, `pt`, `pt-BR`, `zh-Hans`). Existing relevant keys:
  `dash.holdings.eyebrow` ("Holdings"), `dash.holdings.available`
  ("Available"), `dash.build.in_play` ("In play"),
  `dash.build.sheet_history` / `dash.build.sheet_history_sub`,
  `dash.build.sheet_invite_cta`. Keys to **add** (see Scope §3); keys to
  **retire** (see Out of scope).

### Intended design

- The sheet renders the hero (total) above a split bar and two bucket
  rows; the card is unchanged here (see Decisions). The split bar's two
  segments use `flex-grow: available` / `flex-grow: inPlay` so the bar
  widths are proportional to the two figures.
- The split-bar and bucket styles (`.db-split` / `.db-split-seg` /
  `.db-bucket` / `.db-bucket-dot`) live in the component's scoped
  `<style>`. Available = `var(--accent)`; In play = the muted
  `--fg-faint` token.

### Existing pattern to reuse / not reuse

- Reuse `BottomSheet` (already the sheet's shell) and the
  `formatVxpBalance({ value, decimals: USD_DECIMALS })` formatter (the
  Dash card and Transactions page both use it).
- The reusability catalog lists `ProbBar`: a YES/NO split bar. It is
  **not** reusable here: it is a single-fill percentage track tied to
  market YES/NO semantics, not an available/in-play two-segment bar with
  bucket legend. The split bar in this spec is a small, sheet-local
  flex strip (≈8 lines of markup), not a candidate for a shared
  primitive yet (see Pending decisions on whether to extract one).

## Scope

1. **Rewrite `DashStackSheet.svelte`.** Keep the hero header (label →
   `dash.build.sheet_your_vxp` "Your VXP", value `holdingsDisplay`).
   Replace the three `.db-hd-row` rows with:
   - a `.db-split` bar holding up to two `.db-split-seg` segments
     (`avail` then `inplay`), each with `style:flex-grow={…}` set from
     the **numeric** available / in-play magnitudes (a new
     `availableValue` / `inPlayValue` number prop, or pass the bigint
     base units and let the component compare, see Pending decisions on
     prop shape). Render a segment only when its value `> 0`; render the
     whole bar only when `available + inPlay > 0`. `aria-hidden="true"`
     on the bar: it is decorative, the buckets below carry the data.
   - two `.db-bucket` rows: Available (dot `avail`, label
     `dash.holdings.available`, sub `dash.build.sheet_avail_sub`, value
     `availableDisplay`) and In play (dot `inplay`, label
     `dash.build.in_play`, sub the pluralised "At stake on N open calls"
     / "No open calls", value `inPlayDisplay`).
   - keep the transaction-history link row and the invite CTA unchanged
     (order: buckets → history → invite), modulo the invite-CTA rework
     (see Out of scope).
2. **Update `DashPage.svelte` wiring.** Add an `availableDisplay`
   derived from `vxpSpendable` (mirror the Transactions page's
   `availableDisplay` at `DashTransactionsPage.svelte:154`), pass it +
   `liveCallCount` (as `openCallCount`) into the sheet; remove the
   `lifetimeDisplay` / `referralVxpDisplay` / `referralCount` /
   `referralsLoading` props **from the `<DashStackSheet>` call** and the
   sheet's `Props`. Leave any of those deriveds in place if still read
   by other parts of the page (verify: Open questions).
3. **i18n.** Add to **every** catalog under
   `src/lib/constants/messages/`:
   - `dash.build.sheet_your_vxp`: "Your VXP" (sheet hero label).
   - `dash.build.sheet_avail_sub`: "Ready to spend on calls".
   - `dash.build.sheet_inplay_sub_one`: "At stake on {count} open call".
   - `dash.build.sheet_inplay_sub_many`: "At stake on {count} open
     calls".
   - `dash.build.sheet_inplay_sub_none`: "No open calls" (the
     zero-state sub-label, shown when `openCallCount === 0`).
     Reuse the existing `dash.holdings.available` and `dash.build.in_play`
     for the bucket **labels** (do not add new label keys). All copy
     English-authored; non-EN locales fall through the existing resolution
     chain where a catalog lacks a key, per repo convention.
4. **PRODUCT.md.** Update the holdings/Dash section to describe the
   two-bucket sheet (implementer, same PR).

### Out of scope

- **Data model / deriveds.** No change to
  `vxp-holdings.derived.ts`; the three figures already exist.
- **The Dash holdings card** (`DashStackCard.svelte`). The card keeps
  its "Available + Today" right-hand stats: the full total/in-play
  split is one tap away in the sheet, and the session "Today" delta is
  more actionable on the card. Swapping the card to Available + In play
  is **not** adopted.
- **Invite CTA → `navigator.share()`.** Replace the current
  `goto(Arena)` CTA with a native share sheet + clipboard fallback + a
  "copied" state. **Folds into this PR**: it is the same ~15-line CTA
  handler the spec already rewrites the surrounding markup of, and
  shipping the reworked sheet with the old "routes to Arena" CTA would
  knowingly leave the documented bug in place. (If the reviewer prefers
  it separate, it cleanly lifts out, see Pending decisions.) The
  canonical referral link + copy already live in the Arena invite
  surface; reuse that helper rather than re-deriving the URL.
- **Bucket sub-copy + `_one/_many` plural i18n.** **Folds into this
  PR**: the sub-labels and their plural variants are the literal text
  content of the new bucket rows; there is no meaningful "split-bar
  layout without its copy" intermediate, so this has no independent
  surface area once the rework lands.
- **Transactions page header parity.** The Transactions header still
  shows Total/Available + an "in play" chip rather than the same
  split-bar bucket block. Whether to do that here is an **Open question**
  below; default is to leave `DashTransactionsPage.svelte`'s header
  as-is and track parity as a fast-follow, to keep this PR a single
  reviewable sheet rework.
- **Day-0/1 `DashBuildZero.svelte`.** Keeps its "Starter balance"
  framing: a one-call new user has no total/in-play ambiguity. Out of
  scope.
- Retired keys: once the sheet stops reading `dash.build.sheet_lifetime`,
  `dash.build.sheet_in_play` ("Currently in play"),
  `dash.build.sheet_referrals`, `dash.build.sheet_referrals_one`,
  `dash.build.sheet_referrals_many`, those keys become dead. Removing
  them is in scope **only if** no other component reads them (the i18n
  lint / `npm run check:i18n` flags orphans): verify first (Open
  questions); otherwise leave them and note the orphan.

## Linked issues

Searched the repo's open issues (`ViciApp/vici-app`) for
"holdings sheet", "dash holdings", "in play / available": **no related
open issue**. This is product-driven design work, not a tracked bug.

## Analytics

The sheet has no analytics event today, and the holdings card's tap is
not currently instrumented. This rework does not add a new navigable
surface: it restyles an existing sheet, so the default-yes bar is met
by a single lightweight open event rather than per-bucket tracking:

- **`holdings_sheet_opened`**: fired when the sheet opens from the Dash
  card. Props: none required; optionally `has_in_play` (`boolean`,
  whether `vxpBacked > 0`) as a bounded dimension to learn how often the
  split bar is non-degenerate. No amounts, no counts beyond the boolean:
  economic values stay out of analytics.

If added, the name lands in **both** halves of the dual-source pair:
`src/lib/types/analytics-event.ts` (TS union) **and**
`src/lib/schema/analytics-event.schema.ts` (Zod mirror); capture via
`track` in `src/lib/services/analytics.services.ts`. The existing
`transactions_viewed` event (fired on the history page with
`source: 'dash_sheet'`) already captures the most valuable downstream
action, so instrumenting the sheet open is **optional**, see Pending
decisions. If we decline it, this section's rationale is the explicit
"considered, deferred" record.

## Implementation outline

1. Add the five `dash.build.sheet_*` keys (§3) to every catalog under
   `src/lib/constants/messages/`.
2. Rewrite `DashStackSheet.svelte`:
   - New `Props`: `holdingsDisplay`, `availableDisplay`, `inPlayDisplay`
     (formatted strings), the two numeric magnitudes for the bar widths
     (shape per Pending decisions), `openCallCount: number`, plus the
     existing `isOpen` / `onClose`. Drop `lifetimeDisplay`,
     `inPlayDisplay`'s old sibling rows, `referralVxpDisplay`,
     `referralCount`, `referralsLoading`.
   - Hero header unchanged structurally (label key → `sheet_your_vxp`).
   - Render the `.db-split` bar (segments gated on `> 0`,
     `aria-hidden`) and the two `.db-bucket` rows; the in-play sub picks
     `sheet_inplay_sub_one` / `_many` / `_none` off `openCallCount`.
   - Keep the history link row; rework the invite CTA (native share +
     clipboard fallback + copied state), reusing the canonical
     referral-link helper.
   - Port `.db-split*` / `.db-bucket*` styles into the scoped
     `<style lang="postcss">`, using app theme tokens (`--accent`,
     `--fg-faint`, `--border`): no hardcoded colours, works in all
     themes.
3. Update `DashPage.svelte`: add `availableDisplay` (from
   `vxpSpendable`), pass it + `openCallCount={liveCallCount}` to the
   sheet, remove the dropped props from the invocation; verify and clean
   up any now-orphaned page deriveds.
4. Remove the orphaned `dash.build.sheet_lifetime` /
   `sheet_in_play` / `sheet_referrals*` keys **iff** unused elsewhere
   (`npm run check:i18n`).
5. Update `docs/ai/PRODUCT.md` (holdings section).
6. Wire `holdings_sheet_opened` into the TS union + Zod mirror + `track`
   **iff** the analytics decision lands "yes".
7. Run `npm run quality` (format + lint + i18n) and `npm run check`.

## Acceptance criteria

- [ ] Opening the holdings sheet on `/dash` shows a "Your VXP" hero
      equal to total holdings, a two-segment split bar, and two bucket
      rows (Available, In play) whose figures sum to the hero.
- [ ] The split-bar segment widths are proportional to the
      available / in-play magnitudes; a segment with value 0 is omitted,
      and the whole bar is hidden when both are 0.
- [ ] The Available bucket sub-label reads "Ready to spend on calls";
      the In play sub-label reads "At stake on {count} open call(s)" with
      correct `_one` / `_many` plural, and "No open calls" when there are
      none.
- [ ] The old _Lifetime earned_ / _Currently in play_ / _From referrals_
      rows are gone; no referral count / lifetime figure renders in the
      sheet.
- [ ] The transaction-history link row and the invite CTA remain, in
      order buckets → history → invite.
- [ ] The split-bar Available segment and Available dot use `--accent`;
      the In play segment/dot use the muted `--fg-faint` token; verified
      in all themes (dark / light / peach), no hardcoded colours.
- [ ] Bucket dots are decorative (`aria-hidden`); the bar is
      `aria-hidden`; bucket labels/values are real text.
- [ ] All user-visible strings go through `t(...)` with keys present in
      every locale catalog (`npm run check:i18n` clean); no orphaned
      `sheet_lifetime` / `sheet_referrals*` keys left flagged.
- [ ] The invite CTA fires `navigator.share()` with a clipboard-copy +
      "copied" fallback, reusing the canonical referral link; it no
      longer routes to Arena.
- [ ] `PRODUCT.md` describes the two-bucket sheet.
- [ ] `npm run quality` and `npm run check` pass.

## Open questions

- **Orphaned-key cleanup is safe?** Confirm `dash.build.sheet_lifetime`,
  `dash.build.sheet_in_play`, `dash.build.sheet_referrals`,
  `dash.build.sheet_referrals_one`, `dash.build.sheet_referrals_many`
  are read **only** by the current sheet before deleting them. Grep the
  tree; if any survives, leave the key and note the orphan rather than
  break another surface.
- **Page deriveds still needed?** Confirm whether `lifetimeDisplay`,
  `referralVxpDisplay`, `referralCount`, `referralsLoaded` in
  `DashPage.svelte` are consumed anywhere besides the sheet invocation
  before removing them (the referral count may feed another zone).
- **Transactions header parity.** The Transactions page header
  (`DashTransactionsPage.svelte`, currently Total/Available + "in play"
  chip) could share the same split-bar bucket block. Should this PR also
  convert that header for parity, or is it a fast-follow? Default:
  fast-follow, to keep this a single-surface sheet rework. (Needs the
  product owner's call once the fact that the header is a separate,
  already-shipped block is acknowledged; could move to Pending
  decisions.)

## Pending decisions

- **Bar-width prop shape.** Pass the two magnitudes to the sheet as
  plain `number`s (whole VXP), or as the raw `bigint` base units and let
  the component compute `flex-grow` ratios? `flex-grow` only needs the
  ratio, so either works; bigint avoids a lossy whole-VXP round at the
  call site but needs `Number()` for the style. Lean: pass the bigints
  the page already holds (`$vxpSpendable` / `$vxpBacked`) and
  `Number(…)` them for `flex-grow` only. Owner to confirm.
- **Extract a shared split-bar primitive?** The bar is ~8 lines and has
  exactly one consumer today (two if the Transactions-header parity
  question lands "yes"). Default: keep it sheet-local; only extract a
  `ui/` primitive if the parity work proceeds in the same or an adjacent
  PR (meta-update rule would then apply). Owner to confirm if/when the
  parity question resolves.
- **Share-CTA fold-in vs. separate PR.** Default is to fold the
  native-share CTA into this PR; it is the same CTA the rework already
  rewrites, and the one-spec-one-PR rule prefers the cohesive whole. If
  the reviewer wants it isolated, it lifts out as a standalone
  CTA-handler change; the rest of the spec stands without it.
- **Ship `holdings_sheet_opened`?** Add the lightweight open event, or
  rely on the existing `transactions_viewed { source: 'dash_sheet' }`
  downstream signal and instrument nothing new? Lean: add it (default-yes
  bias), bounded `has_in_play` prop only. Owner to confirm.

## Decisions

- **Keep the app's `dash.*` i18n namespace**: the new sub-copy lands
  as `dash.build.sheet_*` keys. Bucket labels reuse the existing
  `dash.holdings.available` / `dash.build.in_play`.
- **Keep the Dash holdings card as-is (Available + Today).** Only the
  **sheet** changes. The card's session "Today" delta is more actionable
  than the in-play figure, and the full split is one tap away. Swapping
  the card to a total/in-play split is not adopted.
- **No emoji.** The bucket dots are colour-keyed CSS dots (lucide-app
  convention). Icons stay lucide (`History` for the history row, the
  share/check pair for the CTA).
- **"At stake", never "returns on settlement."** The in-play sub-copy
  states the stake is _at stake_ on open calls; a stake only returns on
  a win, so "returns on settlement" wording is not used. Terminology
  stays "prediction"/"call"; no gambling vocabulary.
- **Pure-frontend, one PR.** The data model already splits total into
  available + in play, so this is a presentation rework; it fits one
  reviewable PR (sheet rewrite + page wiring + i18n + the share-CTA and
  sub-copy fold-ins), consistent with one-spec-one-PR.
