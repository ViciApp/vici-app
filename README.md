# Vici Social Markets

Vici Social Markets is a modern prediction platform built on the **Internet Computer**. It allows users to trade on binary outcome markets (YES/NO) with integrated social features, IC wallet management, and a streamlined mobile-first "Rush Mode" trading interface.

## 🚀 Key Features

- **Binary Outcome Markets**: Trade on YES/NO outcomes across various categories.
- **Social Integration**: Market-specific discussions, user profiles, following system, and activity feeds.
- **Rush Mode**: A swipe-based rapid trading interface designed for mobile-first engagement.
- **On-Chain Settlement**: Fully functional trading and settlement using the `clearing` and `registry` canisters.
- **Wallet & Portfolio**: Integrated collateral management for ICP and ckUSDC with real-time position tracking.
- **Leaders**: Track top performers based on P&L and trading volume.

## ⚙️ Backend Canisters (ICDC-Core)

The core trading logic and market registry are powered by high-performance Rust-based canisters from the **[icdc-core](https://github.com/AntonioVentilii/icdc-core)** project:

- **Clearing Canister**: Handles margin accounts, collateral management, and on-chain trade matching.
- **Registry Canister**: Manages the prediction market lifecycle, including creation, discovery, and settlement.

### Engine integration

Vici is registered as an **Engine** on the `icdc-core` registry so it can create markets and
manage oracles without its users being explicit controllers of the registry canister. Roles
assigned in the Juno `roles` collection (e.g. `ADMIN`, `CREATOR`, `SOLVER`) are automatically
synced to the Vici engine via a satellite `onSetDoc(ROLES)` / `onDeleteDoc(ROLES)` hook. See
[docs/engine-integration.md](./docs/engine-integration.md) for architecture, setup, and
operational runbooks.

## 🛠️ Technology Stack

- **Frontend**: [SvelteKit](https://kit.svelte.dev/) with **Svelte 5 (Runes)**.
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) with a premium glassmorphic design system.
- **Backend/Storage**: [Juno](https://juno.build/) and Rust-based canisters on the Internet Computer.
- **Blockchain**: [Internet Computer (IC)](https://internetcomputer.org/).
- **Authentication**: [Internet Identity](https://identity.ic0.app/).

## 📖 Project Guidelines & AI Agent Docs

This project follows strict development patterns and terminology. AI agents
(Claude Code, Cursor, Copilot, Codex, …) and humans should start at the
canonical entry point:

- **[AGENTS.md](./AGENTS.md)** — universal entry for every AI agent.
- **[CLAUDE.md](./CLAUDE.md)** — Claude-specific runtime layer (defers to
  AGENTS.md).
- **[docs/ai/](./docs/ai/)** — long-form documentation:
  - [`docs/ai/governance.md`](./docs/ai/governance.md) — truth hierarchy,
    boundaries, capabilities, meta-update rule.
  - [`docs/ai/pr-and-ci.md`](./docs/ai/pr-and-ci.md) — PR conventions, CI
    gates, local quality gates.
  - [`docs/ai/frontend/`](./docs/ai/frontend/) — SvelteKit + Svelte 5 +
    Tailwind v4 conventions, structure, reusability catalog, a11y, testing.
  - [`docs/ai/satellite/`](./docs/ai/satellite/) — Juno satellite (TS hooks,
    asserts, typed query / update endpoints) conventions and workflows.
  - [`docs/ai/backend/`](./docs/ai/backend/README.md): the web2 API in
    `backend/` (structure, patterns, catalog, tests, custody rules).
  - [`docs/ai/engine/`](./docs/ai/engine/README.md): pointer to
    [`../icdc-core/`](https://github.com/AntonioVentilii/icdc-core), where
    the on-chain Rust risk engine lives.
- **[.agents/workflows/](./.agents/workflows/)** — operational runbooks
  (deployment, engine reset, engine ops).
- **[.claude/rules/](./.claude/rules/)** — Claude-only quick-reference
  cards that defer to `docs/ai/`.
- **Terminology:** always use **"prediction"** instead of "bet".
- **Naming conventions:** suffix time-based variables with `_ms`
  (milliseconds) or `_ns` (nanoseconds).

## 📦 Project Structure

- `src/lib/api/`: Canister and Juno collection API definitions.
- `src/lib/components/`: Modular Svelte components (Market, Wallet, Social, etc.).
- `src/lib/services/`: Business logic and orchestration between UI and APIs.
- `src/lib/stores/`: Application state management using Svelte Runes.
- `src/lib/types/`: Shared TypeScript definitions.
- `scripts/`: Deploy/restart entrypoints, `lib/` (shared bash + `download-immutable`), `build/` (dfx `build` hooks), `init/` (post-deploy), `data/` (registry seed JSON).

## 🏁 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (current version in `.node-version`)
- [dfx](https://internetcomputer.org/docs/current/developer-docs/setup/install) (Internet Computer SDK)
- [Juno CLI](https://juno.build/docs/miscellaneous/cli)

### Installation

1. Clone the repository:

   ```bash
   git clone <repository-url>
   cd vici-app
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Local Deployment (Juno Emulator)

To deploy locally, we use the Juno emulator as the primary replica.

1. **Start the Juno emulator**:

   ```bash
   juno emulator start
   ```

2. **Deploy custom canisters** (in a new terminal):

   ```bash
   npm run deploy
   ```

3. **Initialize the registry + Vici engine**:

   ```bash
   npm run init:icdc
   ```

   Registers the Vici engine, seeds the oracle, and adds sample markets. Re-run after any
   registry reinstall.

4. **Start the development server**:
   ```bash
   npm run dev
   ```

For deeper workflows (staging reset, engine operations, debugging role sync) see the
step-by-step runbooks in [`.agents/workflows/`](./.agents/workflows/) and the architecture
reference in [`docs/engine-integration.md`](./docs/engine-integration.md).

> [!IMPORTANT]
> Do **NOT** run `dfx start`. The Juno emulator acts as the only local replica and avoids CORS/404 errors with custom canisters.
