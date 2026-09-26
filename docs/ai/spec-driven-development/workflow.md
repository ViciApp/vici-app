# Spec-Driven Development

Author a spec first, implement it second. Specs are version-controlled
markdown under [`specs/`](./specs/) — the handoff point between a
planning session (Cowork, plan mode, or a human) and the implementing
agent.

**When to use:** net-new features, behaviour improvements, and
non-trivial bugfixes — when the human opts in. If the user describes
such a change without naming this workflow, ask whether to use it.
Skip it for small changes (typo, one-liner): implement directly.

## Non-negotiables

- **Read the guidance first.** Before authoring or implementing any
  spec: [`AGENTS.md`](../../../AGENTS.md), then the area README
  ([frontend](../frontend/README.md) /
  [satellite](../satellite/README.md) /
  [backend](../backend/README.md)). A spec never overrides
  `docs/ai/**` — it sits below it in the
  [truth hierarchy](../governance.md#truth-hierarchy).
- **Ground specs in real code.** Reference actual file paths,
  component names, collection names, enum members. "the market list
  component" is a wish; `src/lib/components/markets/...` is
  actionable. Scan the codebase before finalizing a spec.
- **Every spec carries a status** (see [lifecycle](#spec-lifecycle)).
  An `Implemented` spec is a historical record, **not** current truth
  — for shipped behaviour, the code and [`PRODUCT.md`](../PRODUCT.md)
  win.
- **One spec, one PR.** A spec's implementation lands as a single PR —
  do **not** split it into a stack or a series of partial PRs. The
  spec is the unit of review: status flips, the `PRODUCT.md` update,
  and the divergence check all bind to exactly one PR, and a split
  breaks that binding (which PR flips the status? which one is "the"
  implementation?). Within spec-driven work this overrides the
  prefer-atomic-splits instinct from [`pr-and-ci.md`](../pr-and-ci.md)
  — the spec itself is the atomicity boundary. It applies **only**
  here: when the human opts out of the spec workflow and the change is
  implemented directly, the normal atomic-PR conventions stand
  unchanged. If spec'd work genuinely cannot fit one reviewable PR,
  the spec is too big — split the **spec** first, each part with its
  own status and PR.

## Files

| Path                                | What                                                                                                                                                             |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `specs/YYYY-MM-DD-<type>-<slug>.md` | one spec; `type` = `feat` / `impr` / `fix` / `chore`                                                                                                             |
| `specs/YYYY-MM-DD-<type>-<slug>/`   | optional assets (wireframes, mocks, screenshots) — deleted after merge                                                                                           |
| [`template.md`](./template.md)      | copy this to start a spec                                                                                                                                        |
| [`../officina.md`](../officina.md)  | the agent workshop: it follows this workflow, its specs are reviewed there as versioned documents, and the approved spec is committed with the implementation PR |
| [`../PRODUCT.md`](../PRODUCT.md)    | living product behaviour — updated in the **same PR** as the behaviour change                                                                                    |

## Spec lifecycle

Every spec header contains one greppable line: `Status: <value>`.

| Status                 | Meaning                                                                                     | Who flips it                                         |
| ---------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `Draft`                | authored, not yet building                                                                  | author                                               |
| `In progress (#PR)`    | implementation PR open — the spec is the source of truth **for this work**; keep it in sync | implementer, when opening the PR                     |
| `Implemented (#PR)`    | merged — frozen decision record; never read as current behaviour                            | implementer, in the implementation PR's final commit |
| `Superseded by <spec>` | replaced by a newer spec                                                                    | author of the new spec                               |
| `Abandoned`            | will not build — keep the why in the spec                                                   | whoever decides                                      |

This is what prevents a dual source of truth: a spec is authoritative
only while `In progress`, and only for its own PR. Everything else
defers to the code and `PRODUCT.md`.

## Required content for every spec

**Analytics.** Every spec analyzes whether the change should emit
product analytics and proposes which events. The default answer is
**yes** — instrument unless there is a stated reason not to; a new
surface or behaviour without events is invisible to product analysis.
The spec names the proposed events and their dimensional props,
reusing names from the existing taxonomy where one fits. A new event
name must land in **both** halves of the dual-source pair:
`src/lib/types/analytics-event.ts` (TS union) and
`src/lib/schema/analytics-event.schema.ts` (runtime Zod mirror) —
svelte-check only catches the union; an enum mismatch fails at
runtime. Capture goes through `track` in
`src/lib/services/analytics.services.ts`. Behavioural data only —
bounded prop vocabularies, no free-form text, no PII. If the spec
concludes no analytics are warranted, it says so explicitly and why;
silence reads as "not considered".

**Issue linkage.** Before finalizing a spec, search the repository's
open issues. If the change fixes one, record it in the spec and have
the implementation PR close it via a closing keyword — plain
`Closes #123` (no em-dash after the number, GitHub won't parse the
keyword; the reference always links, but the issue auto-closes only
when the PR merges into the default branch). If the spec only
**partially** fixes an issue, check whether closing the remaining gap
is trivial — if it is, fold it into the spec's scope so the issue
closes completely; if it isn't, do **not** use a closing keyword:
reference the issue as `Part of #123` and state what remains under
"Out of scope".

**Open questions vs. pending decisions.** Unresolved items live in two
distinct end-of-spec sections, split by whether the relevant facts are
known — never one mixed "open items" list:

- **Open questions** — facts to confirm: the answer is not yet known
  and must be found out or verified (confirm an SDK method's contract,
  check whether a field exists, verify current behaviour). These need
  research, a docs lookup, or a question to someone who knows, and may
  still reshape the spec.
- **Pending decisions** — facts are clear, a call remains: all the
  relevant information is understood and what's left is a product or
  architecture choice (two valid approaches, ship in v1 vs.
  fast-follow). These need an owner to decide, not more information.

The two kinds route differently: open questions go to whoever can
find the answer; pending decisions go to whoever owns the call — they
are the "deeper ambiguity" that step 4 says to stop for. The split
also keeps the spec honest: it's easy to disguise an undecided choice
as an "open question" and stall. When an open question gets answered
it usually becomes a pending decision — move it across rather than
leaving it ambiguous. Pending decisions gate step 3's status flip:
resolve them before moving the spec to `In progress (#PR)`; once
decided, record the outcome under "Decisions".

## Required content by area

**Frontend — artifacts welcome (optional).** Put HTML mocks,
wireframes, or screenshots in the spec's asset folder and link them
relatively from the spec. They exist to tweak against during the
build, not to live forever — post-merge cleanup deletes them; git
history retains them.

Interactive HTML mocks must additionally:

- **Show theme swaps.** When the change touches anything that varies
  by theme — layout, styles, colors, sizing, icons, animations — the
  mock includes a theme switcher and renders each variant the way the
  app does (`data-theme` on the root, light and dark at minimum). A
  single-theme mock leaves the other theme to the implementer's
  imagination, which is where regressions start.
- **Close the loop back to the agent.** The mock gives the reviewer an
  easy way to hand their decisions back to the chat — e.g. a "copy
  instructions" button that copies the **complete** final
  instructions: every chosen variant and tweaked value, restated in
  full, not just the deltas the reviewer happens to remember. The
  copied text alone must be enough for the agent to act on.

**Satellite / backend — technical requirements are mandatory.** Any
spec touching `src/satellite/**`, collections, or icdc-core-facing
paths must state, with numbers where possible:

- **Performance** — expected call frequency; instruction-budget impact
  of new hooks / endpoints (satellite code runs under IC instruction
  caps).
- **Memory & storage** — new collections or doc shapes, expected doc
  count and size, growth rate, retention / cleanup story.
- **Scalability** — behaviour at 10× / 100× current users / markets;
  bulk reads and pagination over N+1 fan-outs.
- **Upgrade & compatibility** — schema changes, regenerated `.did` /
  bindings, breaking or not (`!` title + `BREAKING CHANGE:` block per
  [`pr-and-ci.md`](../pr-and-ci.md#1-pr-title)).
- **Security** — collection rules and caller permissions touched.
- **Parameters** — cite the canonical constants file (e.g. the economy
  values under `src/lib/constants/`) instead of restating numbers; a
  copied value goes stale silently.

A backend spec without this section is a `Draft` that is not ready to
build.

## Steps

1. **Describe & clarify** — rough intent → scope, edge cases,
   constraints, acceptance criteria. Search existing code and issues.
2. **Spec** — copy [`template.md`](./template.md) into `specs/`, fill
   it in, status `Draft`.
3. **Build** — read `AGENTS.md` + area README + `PRODUCT.md`, then the
   spec. Resolve any remaining pending decisions (see
   [required content](#required-content-for-every-spec)), then flip
   status to `In progress (#PR)`. Update `PRODUCT.md` in
   the same PR as the behaviour change — the implementer writes it
   while the context is fresh, and `main` never carries code whose
   product description disagrees.
4. **Adjust** — small gap (wrong path, missing edge case): edit the
   spec directly while building. Deeper ambiguity (scope or product
   question): stop, resolve with the human / planning session, update
   the spec, then continue.
5. **Divergence check & close** — before review-ready, diff the
   implementation against the spec and flag gaps. Flip status to
   `Implemented (#PR)` in the final commit.
6. **Post-merge cleanup** — delete the spec's asset folder in a small
   follow-up PR. The spec `.md` stays as the decision record.
