# Spec: <title>

This spec follows the workflow defined in
`docs/ai/spec-driven-development/workflow.md`.

Status: Draft

## Goal

<!-- One paragraph: the user-visible outcome. -->

## Context

<!-- Real file paths, components, collections, endpoints involved. Existing patterns to reuse (check docs/ai/frontend/reusability.md first). -->

## Scope

<!-- What changes. -->

### Out of scope

<!-- Explicit non-goals, deferred items, adjacent issues left alone. -->

## Linked issues

<!-- Search open issues before finalizing (see workflow.md § Required content for every spec).
- Fully fixed → "Closes #N" here and in the implementation PR body (no em-dash after the number; the reference always links, but the issue auto-closes only when the PR merges into the default branch).
- Partially fixed → check whether completing the fix is trivial; fold it into scope if so, otherwise "Part of #N" and the remaining gap under Out of scope.
- No related issue → say so. -->

## Analytics

<!-- Required analysis for every spec — the default is to instrument (see workflow.md § Required content for every spec).
- Propose the events + dimensional props; reuse names from src/lib/types/analytics-event.ts where one fits.
- A new event name goes in BOTH the TS union (src/lib/types/analytics-event.ts) AND the Zod mirror (src/lib/schema/analytics-event.schema.ts); capture via track() in src/lib/services/analytics.services.ts.
- Behavioural data only — bounded prop vocabularies, no free-form text, no PII.
- If no analytics are warranted, keep this section and state why. -->

## Design artifacts (frontend — optional)

<!-- Relative links into ./<this-spec-filename>/ — wireframes, HTML mocks, screenshots. Kept after merge as part of the decision record; never delete them. Remove this section if unused.
Interactive HTML mocks must (see docs/ai/spec-driven-development/workflow.md § Required content by area):
- include a theme switcher (data-theme on the root, light + dark) when the change touches theme-varying layout / styles / colors / sizing / icons / animations;
- include a "copy instructions" button that copies the COMPLETE final instructions (every chosen variant and value) back to the agent chat. -->

## Technical requirements (satellite / backend — mandatory)

<!-- Required for any change touching src/satellite/**, collections, or icdc-core-facing paths. Remove this section only for pure-frontend specs.
- Performance: call frequency, instruction-budget impact.
- Memory & storage: collections / doc shapes, count, size, growth, cleanup.
- Scalability: behaviour at 10× / 100×; bulk reads over N+1.
- Upgrade & compatibility: schema, regenerated .did / bindings, breaking?
- Security: collection rules, caller permissions.
- Parameters: cite the canonical constants file, don't restate values. -->

## Implementation outline

<!-- Numbered steps grounded in real paths. -->

## Acceptance criteria

<!-- Verifiable, one checkbox per criterion. -->

- [ ] …

## Open questions

<!-- Facts not yet known — to research, look up, or ask someone who can answer (see workflow.md § Required content for every spec). Once answered, an item usually becomes a pending decision — move it across; only the decided outcome lands under Decisions. Remove this section when empty. -->

## Pending decisions

<!-- Facts are clear; a product or architecture call remains — needs an owner to decide, not more information. Don't disguise these as open questions. Resolve before flipping the status to In progress; record outcomes under Decisions. Remove this section when empty. -->

## Decisions

<!-- Options considered and why the chosen one won. Append here when the build reveals gaps (workflow step 4). -->
