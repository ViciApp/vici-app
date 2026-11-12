<!--
Style (applies to the whole body):
- Do NOT hard-wrap lines. One line per paragraph / bullet; GitHub wraps. Manual ~80-col wrapping breaks lists, quotes, and tables.
- Concise but complete: a reviewer should get what changed and why without opening the diff. Cut anything that doesn't change what the reviewer does next.
- No filler ("This PR…", "In this change…") and no diff narration: the diff is attached; write what it can't say (why, trade-offs, what was deliberately NOT done).
- Keep the exact three headings below: tooling greps them.
Full rules: docs/ai/pr-and-ci.md §2.
-->

# Motivation

<!-- Why this change exists: the problem, bug, or product need. 1–3 sentences. Link the issue / spec / upstream PR if one exists. -->

# Changes

<!-- One bullet per logical change, outcome first. Call out: docs/ai updates (meta-update rule), protected paths touched, BREAKING CHANGE block if the satellite .did / collections changed. If you need "and also", the PR probably isn't atomic: split. -->

# Tests

<!-- How it was verified, concretely: commands run + their outcome (npm run quality / check / test, new unit tests), manual steps, screenshots for visual changes. "Tests pass" alone is not enough: say which. -->
