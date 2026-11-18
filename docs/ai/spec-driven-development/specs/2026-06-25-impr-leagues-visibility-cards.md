# Spec: Leagues privacy as radio visibility cards (3-tier)

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#984)

## Goal

Replace the cramped privacy picker in the league create + edit sheets
with radio **visibility cards** that name each visibility tier and
explain it inline. Today the create sheet renders three tight
segmented buttons (`Private` / `Invite-only` / `Open`) with no
explanation, so the owner has to already know what each means; the edit
sheet already shows a label + description per row but as a plain list.
This spec introduces visibility cards (radio dot, title, inline
description) on the create sheet and aligns the edit sheet to the same
card visual, **keeping the app's three visibility tiers**. Pure
frontend; no data-shape, satellite, or copy-meaning change.

## Context

The app keeps a **three-tier** visibility model: Open / Invite-only /
Private, resolved through one source of truth in
[`src/lib/types/league.ts`](../../../../src/lib/types/league.ts):
`leaguePrivacy`, `isLeaguePubliclyListed` (Open only), and
`isLeagueRecommendableToFriends` (Open + Invite, not Private). The
middle tier is load-bearing, not cosmetic:

- **Battles gate to Open.**
  [`src/satellite/services/battle.services.ts`](../../../../src/satellite/services/battle.services.ts)
  `isLeagueOpen` restricts battle eligibility to Open leagues; Invite
  and Private are deliberately distinct from Open here.
- **Invite feeds friend recommendations.**
  [`src/satellite/services/cohort.services.ts`](../../../../src/satellite/services/cohort.services.ts)
  `FriendRecommendedLeague` surfaces Open **and** Invite leagues to a
  member's friends; only Private is excluded.

Collapsing to two tiers would erase the Invite tier that both of these
paths rely on. See **Decisions**.

The enum is
[`src/lib/enums/league.ts`](../../../../src/lib/enums/league.ts)
`LeaguePrivacy` (`PRIVATE` / `INVITE` / `OPEN`).

**Surfaces in scope** (both frontend):

- [`src/lib/components/leagues/CreateLeagueModal.svelte`](../../../../src/lib/components/leagues/CreateLeagueModal.svelte):
  the create sheet. The privacy picker is the `.league-privacy-row`
  fieldset: a flex row of three `.league-privacy-btn` segmented buttons
  rendering only `privacyLabel(option)`, no description. `PRIVACIES` is
  ordered `[PRIVATE, INVITE, OPEN]`; `privacy` defaults to
  `LeaguePrivacy.INVITE`.
- [`src/lib/components/leagues/LeaguePrivacyModal.svelte`](../../../../src/lib/components/leagues/LeaguePrivacyModal.svelte):
  the owner edit-privacy sheet. Already renders a `role="radiogroup"`
  list of `.league-privacy-row` buttons with `optionLabel` +
  `optionDesc` and the loosen-to-Open confirm step. Same three options,
  same order.

**i18n.** All required keys already exist in
[`src/lib/constants/messages/en.ts`](../../../../src/lib/constants/messages/en.ts)
and the sibling catalogs, under the app's `leagues.*` namespace; no
new keys needed:

- Titles: `leagues.create.privacy_open` / `privacy_invite` /
  `privacy_private`.
- Descriptions: `leagues.privacy.desc_open` / `desc_invite` /
  `desc_private`: already written for the edit sheet, now reused by the
  create sheet too.
- `leagues.create.label_privacy` for the fieldset legend.

The create sheet's current title-only render (`privacyLabel`) gains the
description via the existing `desc_*` keys.

**Reuse first** (per
[`reusability.md`](../../frontend/reusability.md)): the edit sheet
(`LeaguePrivacyModal.svelte`) already has the title-+-description radio
markup and the `optionLabel` / `optionDesc` helpers this spec wants on
the create sheet; the create sheet adopts the **same** pattern rather
than inventing a parallel one, so the two privacy pickers read
identically. No shared sub-component is introduced (see Pending
decisions); if one is later warranted it lands under
`src/lib/components/leagues/`.

## Scope

- **Create sheet privacy cards.** In `CreateLeagueModal.svelte`,
  replace the `.league-privacy-row` segmented buttons with a
  `role="radiogroup"` list of visibility cards mirroring the edit
  sheet: each option a `role="radio"` button carrying its title
  (`privacyLabel`) and inline description (a new local helper reading
  `leagues.privacy.desc_${value}`), plus a radio-dot affordance. Keep
  `PRIVACIES` order (`PRIVATE` / `INVITE` / `OPEN`), the `privacy`
  `$state`, and the click-to-select binding unchanged.
- **Visual alignment of the edit sheet.** Bring
  `LeaguePrivacyModal.svelte`'s existing `.league-privacy-row` list to
  the same card visual (radio dot, accent active border/title) so
  create and edit are one consistent control. Behaviour (the
  loosen-to-Open confirm step, `canSubmit`, re-seed `$effect`) is
  untouched.
- **Accessibility.** Both pickers expose a single `radiogroup` with
  `role="radio"` + `aria-checked` per card (the edit sheet already
  does; the create sheet currently uses `aria-pressed` toggles and
  switches to the radio idiom). Each card is keyboard-focusable and the
  description is part of the accessible label or `aria-describedby`.

The change is presentation only: the persisted `privacy` field, the
three `LeaguePrivacy` values, `createLeague` / `updateLeague`, and
every downstream visibility/recommendation/battle decision are
unchanged.

### Out of scope

- **Collapsing to a 2-tier model.** Explicitly rejected; see
  Decisions. The Invite tier stays.
- **Changing visibility semantics** (`isLeaguePubliclyListed`,
  `isLeagueRecommendableToFriends`, battle `isLeagueOpen`) or the copy
  _meaning_ of any tier. Only the picker's presentation changes.
- **Satellite / collection / `.did` changes.** None: no field, assert,
  or endpoint is touched.
- **The league preview card, emblem/colour pickers, invite-code
  affordance** in the create sheet: untouched.
- **New i18n keys.** The needed titles and descriptions already exist
  under `leagues.*`; this spec reuses them.

## Linked issues

Searched the repo's open issues
(`ViciApp/vici-app`) for league / privacy / visibility / create
terms: **no related open issue**. (Search terms used: `league
privacy visibility`, `league create`, `league`.)

## Analytics

`league_created` already exists in the taxonomy: in the TS union
([`src/lib/types/analytics-event.ts`](../../../../src/lib/types/analytics-event.ts)),
the Zod mirror
([`src/lib/schema/analytics-event.schema.ts`](../../../../src/lib/schema/analytics-event.schema.ts)),
and the generated `satellite_extension.did`, but a code
search shows it is **never fired** from app code (only present in
declarations). This spec is a presentation refactor and does not by
itself require new instrumentation; however, since the create flow is
where this card UI lives and the event is already defined, the low-cost
high-value step is to **start emitting the existing `league_created`**
on a successful create, carrying the chosen tier so product can see the
visibility distribution the new cards drive.

- Fire **`league_created`** in `CreateLeagueModal.handleSubmit` after
  `createLeague` resolves, via `track` in
  [`src/lib/services/analytics.services.ts`](../../../../src/lib/services/analytics.services.ts).
  Props: `leagueId` (the created league's id, bounded id data) and
  `label` = the chosen privacy tier (bounded vocabulary:
  `open` / `invite` / `private`, the `LeaguePrivacy` values).
- **No new event name and no new prop**: `league_created`, `leagueId`,
  and `label` all already exist in both halves of the taxonomy, so no
  union/schema/`.did` change is needed. Behavioural only; no PII, no
  free-form text.
- If product prefers to keep this spec strictly presentation-only and
  defer instrumentation, the alternative is to fire nothing, stated as
  a pending decision below. Either way no new taxonomy entry is added.

## Design artifacts (frontend, optional)

None. The card visual is fully specified by the app's existing
`.league-privacy-row` description markup in `LeaguePrivacyModal.svelte`;
the implementer builds against that rather than a fresh mock. The cards
use existing theme tokens (`--color-accent`, `--border-base`,
`--bg-surface`, `--text-muted`), so they theme-swap with the rest of
the app for free.

## Implementation outline

1. **Create sheet markup** (`CreateLeagueModal.svelte`): replace the
   `.league-privacy-row` fieldset body with a `role="radiogroup"` list
   of cards. Add a local `privacyDesc(value)` helper alongside the
   existing `privacyLabel`, reading `leagues.privacy.desc_${value}`.
   Each card: `role="radio"`, `aria-checked={privacy === option}`,
   `onclick={() => (privacy = option)}`, a radio-dot span, and the title
   - description spans. Keep `PRIVACIES` and the `privacy` state as-is.
2. **Card styles**: add the card rules (a `.league-vis-card` with a
   radio-dot span, title, and sub-description) to the component
   `<style>`, using the app's tokens (`--color-accent` for active
   border/dot/title, `--border-base`, `--bg-surface`, `--text-muted`).
   Remove the now-dead `.league-privacy-row` / `.league-privacy-btn`
   rules.
3. **Edit sheet alignment** (`LeaguePrivacyModal.svelte`): update the
   existing `.league-privacy-row` list to the same card visual (radio
   dot + accent active state) so the two pickers match. Keep markup
   semantics (`radiogroup` / `radio` /
   `aria-checked`) and **all** behaviour (the confirm step, `$effect`
   re-seed, `canSubmit`) unchanged.
4. **Analytics** (pending decision permitting): in
   `CreateLeagueModal.handleSubmit`, after `createLeague` resolves and
   before `onCreated`, call `track({ name: 'league_created', leagueId:
league.id, label: privacy })`. No taxonomy change.
5. **Quality**: `npm run quality` + `npm run check`. Update
   [`PRODUCT.md`](../../PRODUCT.md) only if it describes the privacy
   picker's presentation; the tier _semantics_ it documents are
   unchanged, so likely a no-op; confirm during the build.

## Acceptance criteria

- [ ] The create sheet renders **three** radio visibility cards (Open,
      Invite-only, Private), each showing its title and the existing
      `leagues.privacy.desc_*` description inline, with a radio-dot
      affordance.
- [ ] The create and edit sheets present the same card visual (radio
      dot, accent active border, accent active title) so the two
      privacy pickers read as one control.
- [ ] Selecting a card sets the league's `privacy` exactly as the old
      segmented buttons did; the persisted three-tier value and every
      downstream visibility / recommendation / battle decision are
      unchanged.
- [ ] Each picker is a single `radiogroup` of `role="radio"` cards with
      correct `aria-checked`, keyboard-focusable, with the description
      reachable to assistive tech.
- [ ] No new i18n keys; the cards render from the existing
      `leagues.create.privacy_*` titles and `leagues.privacy.desc_*`
      descriptions across every locale.
- [ ] The edit sheet's loosen-to-Open confirm step and re-seed
      behaviour still work.
- [ ] (If analytics included) `league_created` fires once on a
      successful create with `leagueId` and `label` = the chosen tier,
      validating against the existing Zod mirror; no taxonomy /
      schema / `.did` change.
- [ ] `npm run quality` + `npm run check` pass.

## Open questions

- Does [`PRODUCT.md`](../../PRODUCT.md) describe the privacy picker's
  _presentation_ (vs. only the tier semantics)? If it only documents
  semantics, no `PRODUCT.md` change is needed; confirm during the
  build (workflow step 3 requires the update only when behaviour/copy
  changes).

## Pending decisions

- **Instrument `league_created` now, or stay presentation-only?** The
  event and props already exist and are unfired, so adding it is
  low-cost and high-value (visibility distribution). Default
  recommendation: **include it**. If the owner wants a strictly
  presentation-only PR, defer and fire nothing. No taxonomy change
  either way.
- **Extract a shared `LeagueVisibilityCards` sub-component, or
  duplicate the card markup in both sheets?** The create and edit
  sheets will render the same card. A shared component removes the
  duplication but adds a prop surface (selected value, onSelect,
  options); duplicating keeps each sheet self-contained. Given only two
  call sites and slightly different surrounding chrome (the create sheet
  has no confirm step), this can ship either way. Recommendation: ship
  with **duplicated markup** for this PR and extract later only if a
  third caller appears (avoids premature abstraction); decide at build
  time.

## Decisions

- **Default tier on the create sheet = Open** (owner decision,
  2026-06-25). Overrides the spec's initial recommendation to keep
  Invite. New leagues are publicly listed and battle-eligible from
  creation; owners can tighten to Invite/Private in two taps.
  Implementation: set the `privacy` `$state` init and `reset()` in
  `CreateLeagueModal.svelte` to `LeaguePrivacy.OPEN` (the `league.ts`
  JSDoc note about an Invite default is now stale; update it in the
  same PR).
- **Keep the three-tier visibility model: do NOT collapse to two
  tiers.** Handed down at spec creation (2026-06-25). A two-tier model
  would simplify Open / Invite / Private down to Open / Private on the
  grounds that Invite and Private are "nearly identical". In **this
  app** they are not: Invite has a real, wired purpose distinct from
  both Open and Private:
  - battles gate to **Open only** (`battle.services.ts` `isLeagueOpen`),
    so Invite ≠ Open; and
  - Invite leagues **are** recommended to a member's friends
    (`cohort.services.ts` `FriendRecommendedLeague`,
    `isLeagueRecommendableToFriends`), so Invite ≠ Private.
    Collapsing would either leak Invite leagues into public battle pools
    (if merged into Open) or kill their friend-recommendation reach (if
    merged into Private). We therefore change **only the card UI** and
    keep all three tiers and their existing `leagues.*` copy.
