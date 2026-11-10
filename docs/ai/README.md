# AI agents documentation

The long-form pages behind [`AGENTS.md`](../../AGENTS.md). Do not read everything: read `AGENTS.md`, then the area README of the code you touch, then only the page your task needs. The rules every repository shares are in the universal standard, [Officina `standards/code.md`](https://github.com/AntonioVentilii/officina/blob/main/standards/code.md); these pages only add what is specific to Vici.

## Cross-cutting

| Page                                                                           | What it holds                                                                |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| [`governance.md`](./governance.md)                                             | Truth hierarchy, protected paths, what needs asking, the meta-update map     |
| [`pr-and-ci.md`](./pr-and-ci.md)                                               | PR title and body, scope, local gates, CI jobs, cross-repo changes, comments |
| [`PRODUCT.md`](./PRODUCT.md)                                                   | Shipped product behaviour; updated in the same PR as a behaviour change      |
| [`economy.md`](./economy.md)                                                   | VXP economy rules (they drive the code)                                      |
| [`officina.md`](./officina.md)                                                 | How the agent workshop runs work here (config: `.github/officina.yml`)       |
| [`spec-driven-development/workflow.md`](./spec-driven-development/workflow.md) | The opt-in spec-first workflow; `specs/` holds the decision records          |

## Areas

| Area                                  | README                                | Pages                                                                                                                                                                                               |
| ------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SvelteKit frontend                    | [`frontend/`](./frontend/README.md)   | `structure`, `stack-and-patterns`, `reusability`, `testing`, `i18n`, `i18n-coverage`, `a11y`, `design`, `brand`, `seo`, `web2-backend-mode`, `workflows/{new-component,new-service,refactor-split}` |
| Juno satellite                        | [`satellite/`](./satellite/README.md) | `structure`, `patterns`, `reusability`, `testing`, `economy`, `workflows/{new-hook,new-endpoint,engine-sync}`                                                                                       |
| Web2 API (`backend/`)                 | [`backend/`](./backend/README.md)     | `structure`, `patterns`, `reusability`, `testing`, `custody`, `workflows/{new-route,new-migration,new-worker-job}`                                                                                  |
| On-chain engine (icdc-core, external) | [`engine/`](./engine/README.md)       | pointer only: bindings, integration, what not to touch                                                                                                                                              |

## Elsewhere in the repo

- Operational runbooks (deployment, engine reset, engine operations): [`.agents/workflows/`](../../.agents/workflows/).
- Engine architecture and role mapping: [`docs/engine-integration.md`](../engine-integration.md).
- API operator facts (env vars, auth, custody, deploy): [`backend/README.md`](../../backend/README.md).

## Maintenance

These pages adapt with the code: a PR that adds a pattern, a shared piece, a naming convention, a policy or a workflow updates the matching page in the same PR ([meta-update rule](./governance.md#meta-update-rule)). If two pages disagree, the [truth hierarchy](./governance.md#truth-hierarchy) decides; surface the disagreement in a PR.
