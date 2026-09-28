# Spec: Replace wager wording in battle copy

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Implemented (#1330)

## Goal

The battle screens currently label the optional VXP amount as a "Wager" / "Wager (optional)" and
show "No stake" when the slider sits at zero. That is betting vocabulary, which breaks the product
rule "prediction, never bet" (`AGENTS.md` § 2.5). After this change every locale shows
prediction-and-VXP wording for the same three strings, on the battle detail page, the battles inbox
and the create-a-battle modal. Nothing else about battles changes: the same amount is stored,
validated and displayed as before.

## Context

**The three strings, and where they render**

| Key                          | Surface                                                                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `battle.detail.wager_label`  | `src/lib/components/pages/BattleDetailPage.svelte:588` — the eyebrow of the meta row, rendered only when `battle.wager > 0`      |
| `battles.create.label_wager` | `src/lib/components/leagues/CreateBoutModal.svelte:453` (step-4 slider label, `.allcaps`) and `:467` (the slider's `aria-label`) |
| `battles.create.wager_none`  | `src/lib/components/leagues/CreateBoutModal.svelte:457` — the slider read-out when `wager === BATTLE_WAGER_MIN` (zero)           |

The companion value keys `battle.detail.wager_value` and `battles.create.wager_value` are both
`'{amount} VXP'` in every catalog — no wording, so they stay as they are.
`battle.detail.wager_value` is also reused by `src/lib/components/pages/BattlesInboxPage.svelte:132`
to build the challenge fact line, which is why no other key is involved on that screen.

**Catalogs that carry these keys** (`src/lib/constants/messages/`): `en`, `es`, `de`, `fr`, `it`,
`pt` (all `tier: 'live'` in `LOCALE_REGISTRY`), `pt-BR` and `zh-Hans`. The partial `soon` catalogs
`es-419`, `es-MX`, `es-AR` and `ja` only carry `welcome.*` landing keys and resolve these three
through their fallback chain — they are not touched. Key alignment is checked by
`scripts/check-locale-catalogs.mjs` (`npm run check:i18n`, run by `npm run lint`); because this
change only edits values, no alignment risk exists.

**Product truth.** `docs/ai/PRODUCT.md` (battles section) records that the optional VXP amount is a
**displayed** figure — it is not moved between leagues on resolution. The replacement wording must
therefore not promise a payout or an escrow.

**Existing voice to reuse.** `en.ts` already frames battles as a face-off played for pride —
`'leagues.battle.…'` / `'battles.intro.body'` and `'Bragging rights to the next battle.'`
(`en.ts:2352`). VXP amounts elsewhere read as "in play" (`flow.xp_toast.in_play`,
`transactions.in_play`).

**The legal footer stays byte-identical.** `footer.disclosure` (`en.ts:1116` and the equivalent line
in `es`, `de`, `fr`, `it`, `pt`, `pt-BR`, `zh-Hans`) contains "cannot be wagered" / "no se pueden
apostar" / "non possono essere scommessi" / "não podem ser apostados" / "不可用于下注" and the
German and French equivalents. It is deliberate legal wording and must not be edited.

## Scope

Edit exactly three values per catalog, in eight files. Nothing else.

| File                                    | Key                          | Now (line)                    | After                      |
| --------------------------------------- | ---------------------------- | ----------------------------- | -------------------------- |
| `src/lib/constants/messages/en.ts`      | `battle.detail.wager_label`  | `'Wager'` (72)                | `'On the line'`            |
|                                         | `battles.create.label_wager` | `'Wager (optional)'` (97)     | `'On the line (optional)'` |
|                                         | `battles.create.wager_none`  | `'No stake'` (110)            | `'Pride only'`             |
| `src/lib/constants/messages/it.ts`      | `battle.detail.wager_label`  | `'Posta'` (77)                | `'In gioco'`               |
|                                         | `battles.create.label_wager` | `'Posta (facoltativa)'` (102) | `'In gioco (facoltativo)'` |
|                                         | `battles.create.wager_none`  | `'Nessuna posta'` (115)       | `'Solo per l’onore'`       |
| `src/lib/constants/messages/es.ts`      | `battle.detail.wager_label`  | `'Apuesta'` (79)              | `'En juego'`               |
|                                         | `battles.create.label_wager` | `'Apuesta (opcional)'` (104)  | `'En juego (opcional)'`    |
|                                         | `battles.create.wager_none`  | `'Sin apuesta'` (117)         | `'Solo por el honor'`      |
| `src/lib/constants/messages/de.ts`      | `battle.detail.wager_label`  | `'Einsatz'` (84)              | `'Im Spiel'`               |
|                                         | `battles.create.label_wager` | `'Einsatz (optional)'` (109)  | `'Im Spiel (optional)'`    |
|                                         | `battles.create.wager_none`  | `'Kein Einsatz'` (122)        | `'Nur um die Ehre'`        |
| `src/lib/constants/messages/fr.ts`      | `battle.detail.wager_label`  | `'Mise'` (77)                 | `'En jeu'`                 |
|                                         | `battles.create.label_wager` | `'Mise (facultative)'` (102)  | `'En jeu (facultatif)'`    |
|                                         | `battles.create.wager_none`  | `'Sans mise'` (115)           | `'Pour l’honneur'`         |
| `src/lib/constants/messages/pt.ts`      | `battle.detail.wager_label`  | `'Aposta'` (80)               | `'Em jogo'`                |
|                                         | `battles.create.label_wager` | `'Aposta (opcional)'` (105)   | `'Em jogo (opcional)'`     |
|                                         | `battles.create.wager_none`  | `'Sem aposta'` (118)          | `'Só pela honra'`          |
| `src/lib/constants/messages/pt-BR.ts`   | `battle.detail.wager_label`  | `'Aposta'` (70)               | `'Em jogo'`                |
|                                         | `battles.create.label_wager` | `'Aposta (opcional)'` (95)    | `'Em jogo (opcional)'`     |
|                                         | `battles.create.wager_none`  | `'Sem aposta'` (108)          | `'Só pela honra'`          |
| `src/lib/constants/messages/zh-Hans.ts` | `battle.detail.wager_label`  | `'赌注'` (71)                 | `'投入'`                   |
|                                         | `battles.create.label_wager` | `'赌注（可选）'` (95)         | `'投入（可选）'`           |
|                                         | `battles.create.wager_none`  | `'无赌注'` (108)              | `'只为荣誉'`               |

Line numbers are where the keys sit on `main` today; match on the key, not the line. Keep the
catalogs' existing typographic apostrophe (`’`) and full-width CJK parentheses conventions.

### Out of scope

- **The legal footer.** `footer.disclosure` keeps "cannot be wagered" and its per-locale equivalents
  unchanged in all eight catalogs.
- **Key names.** `battle.detail.wager_label`, `battles.create.label_wager`,
  `battles.create.wager_none`, `*.wager_value` keep their names — keys are not user-facing, and
  renaming them would drag three components and eight catalogs into a copy-only change.
- **Code, data and comments.** The `wager` field on `BattleDoc` (`src/lib/types/battle.ts`), the
  `BATTLE_WAGER_*` constants, `proposeBattle` in `src/lib/services/leagues.services.ts`, the
  satellite assert in `src/satellite/services/battle.services.ts` (a red path), and the step-4 code
  comment in `CreateBoutModal.svelte` all stay as they are.
- **The `{amount} VXP` value strings** — no wording to change.
- **"Stake" elsewhere in the product.** `dash.build.sheet_inplay_sub_*` ("At stake on …"),
  `wallet.row.trade` ("Staked"), `flow.stake.warning.*`, the rules copy and the German
  `calibration.beat.deployed.title` are not battle copy and are left alone. If the team wants a
  product-wide lexicon pass, that is a separate request.
- **`docs/ai/PRODUCT.md`.** Product behaviour does not change; PRODUCT's "wager" reference names the
  stored field, which this change does not touch. Leave the file unedited.
- **The `soon` catalogs** `es-419`, `es-MX`, `es-AR`, `ja` — they do not carry these keys and fall
  back to `en` / `es`.

## Linked issues

No related issue. GitHub issue search was not available from the authoring sandbox (no network, no
`gh`), and the request references none; if a reviewer knows of a matching issue, link it in the PR
body.

## Analytics

No analytics. This is a pure label change on surfaces that already exist: no new screen, no new
interaction, no new funnel step, and the battle-creation flow's behaviour is untouched, so no event
in `src/lib/types/analytics-event.ts` gains or loses meaning. Instrumenting a rename would produce
no answerable product question.

## Implementation outline

1. Edit the three values in `src/lib/constants/messages/en.ts` per the table in Scope. English is
   the source of truth — do it first.
2. Apply the matching values in `it.ts`, `es.ts`, `de.ts`, `fr.ts`, `pt.ts`, `pt-BR.ts` and
   `zh-Hans.ts`. Do not paste English into a non-English catalog.
3. Confirm nothing else moved: `footer.disclosure` untouched in all eight catalogs, key order and
   key names unchanged, `*.wager_value` unchanged, no `.svelte` or `.ts` source file edited.
4. Run the gates from the repo root: `npm run quality` (prettier + eslint + `check:i18n`) and
   `npm run check`.

## Acceptance criteria

- [ ] `battle.detail.wager_label`, `battles.create.label_wager` and `battles.create.wager_none` hold
      the values from the Scope table in all eight catalogs (`en`, `it`, `es`, `de`, `fr`, `pt`,
      `pt-BR`, `zh-Hans`).
- [ ] No `battle.*` or `battles.*` value in any catalog still contains `Wager` / `wager` /
      `Apuesta` / `Aposta` / `Mise` / `Posta` / `Einsatz` / `赌注`, and `en.ts` no longer contains
      `'No stake'`.
- [ ] `footer.disclosure` is byte-identical to `main` in every catalog that has it (`en`, `es`,
      `de`, `fr`, `it`, `pt`, `pt-BR`, `zh-Hans`) — "cannot be wagered" and its translations survive.
- [ ] The diff touches only `src/lib/constants/messages/*.ts` plus this spec file: no component, no
      type, no constant, no satellite file, no `PRODUCT.md`.
- [ ] No key is added, removed or renamed; `npm run check:i18n` passes.
- [ ] `npm run quality` and `npm run check` pass.
- [ ] Manual check: the create-battle modal (step 4) shows the new label and reads "Pride only" with
      the slider at zero, the slider's `aria-label` reads the new label, and the battle detail page's
      meta row shows the new eyebrow above `{amount} VXP`.

## Decisions

- **"On the line" for the label.** It is face-off language rather than betting language, works as an
  `.allcaps` eyebrow above the `{amount} VXP` value on both surfaces, and is short enough for the
  create-modal's single-line flex row (`.create-bout-wager-head`) on a narrow phone — "VXP on the
  line" would repeat the VXP already in the value and risks overflowing that row.
- **"Pride only" for zero.** The amount is displayed, not escrowed (PRODUCT.md, battles section), so
  the zero state is best said in the product's own battle voice — "Bragging rights to the next
  battle" (`en.ts:2352`) — while staying short enough for the right-hand read-out. Each locale gets
  the idiomatic equivalent (`Solo per l’onore`, `Pour l’honneur`, `Nur um die Ehre`,
  `Solo por el honor`, `Só pela honra`, `只为荣誉`) rather than a literal translation of "pride".
- **"Stake" avoided in these three strings**, even though it appears in other surfaces, because the
  request named "No stake" as part of the problem. The other surfaces stay untouched (see Out of
  scope) so this stays a one-screen copy fix rather than a lexicon migration.
- **"In play" rejected** for the label: `flow.xp_toast.in_play` / `transactions.in_play` mean VXP
  actually committed to open predictions, and a battle amount is never moved — reusing that phrase
  would assert an escrow the product does not have.
- **Keys keep the `wager` name** so the copy stays greppable against the `wager` field that the
  satellite validates; only the rendered strings are user-facing, and the request limits the change
  to user-facing copy.
