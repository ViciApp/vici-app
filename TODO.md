# Project Status & TODO List

Current state of the **Vici Social Markets** application.

## ✅ Completed (Implemented)

### Core Systems & Infrastructure

- [x] **Framework Setup**: SvelteKit project with Svelte 5 (Runes), Tailwind CSS, and Juno.
- [x] **Authentication**: Internet Identity integration via Juno.
- [x] **Real Canister Integration**: Primary trading logic migrated from mocks to `clearing` and `registry` canisters.
- [x] **RBAC (Role Based Access Control)**: Permissioned market creation and resolution (Admin/Creator roles).

### Trading & Markets

- [x] **Market Discovery**: Dynamic listings with categories and status filters.
- [x] **On-Chain Trading**: Fully functional "Matched Trade" system using the Clearing canister.
- [x] **Position Tracking**: Real-time "Your Position" card in the market sidebar.
- [x] **Collateral Management**: Deposit/Withdraw ICP/USDC into the clearing margin account.
- [x] **Market Resolution**: Admin settlement dashboard with "Urgent" markers for expired markets.

### UI/UX

- [x] **Modern Aesthetics**: Premium glassmorphic design, vibrant gradients, and smooth transitions.
- [x] **Enhanced Market View**: Tabbed interface for Description, Activity, and Analytics.
- [x] **Responsive Sidebar**: Integrated trading interface and user position feedback.
- [x] **Rush Mode**: Swipe-based rapid trading UI for mobile-first users.
- [x] **Global Order Book (UI)**: Advanced Limit/Market order interface with `OrderBook` visualization.
- [x] **Market Depth Visualization**: Real-time bid/ask depth bars and liquidity visualization.

### Social & Community

- [x] **Market Discussion**: Threaded comments per market (Juno-based).
- [x] **Profiles & Social Graph**: User profiles with trading history, follow system, and stats.
- [x] **Activity Feed**: Global and friend-specific activity logging.
- [x] **Leaderboards**: P&L based rankings.

---

## 🚀 Future Roadmap

### 🔧 Core Enhancements

- [ ] **Real-time Price Feeds**: Integration with decentralized oracles for automated settlements.
- [ ] **Multi-Asset Support**: Collateral support for ckBTC, ckETH, and other ICRC-1 tokens.
- [ ] **Private Markets**: Invite-only binary outcome markets (Planned in `SPECS_V0`).

### 📈 Analytics & Depth

- [ ] **Historical Charts**: Price and volume history charts (Integration with `old_app` analytics logic).
- [ ] **Trading View Integration**: Professional analytics dashboard for advanced traders.

### 💰 Wallet & Transfers

- [ ] **Standard IC Transfers**: Full implementation of `sendICP` and `sendCkUSDC` services.
- [ ] **Transaction History**: Comprehensive ledger-based history for all wallet actions.
- [ ] **QR Code System**: Functional QR generator for wallet addresses and market sharing.

### 🎮 Gamification & Retention

- [ ] **Achievements & Badges**: Unlockable NFT or on-chain badges for trading milestones.
- [ ] **Referral System**: Incentive program for inviting new traders.
- [ ] **Daily Quests**: Minor rewards for community participation and market discovery.

### 📱 Mobile & Polish

- [ ] **PWA Support**: Installable progressive web app with push notifications.
- [ ] **Svelte 5 Polish**: Final optimization of all runes and derived states for performance.

---

## 📝 Technical Debt

- [ ] **Canister Error Handling**: More granular error messaging for clearing canister rejections.
- [ ] **Testing**: Implement E2E browser tests for the trade/settlement flow.
- [ ] **Documentation**: Keep `docs/ai/` in step with the code; the code wins on a conflict (truth hierarchy in [`docs/ai/governance.md`](./docs/ai/governance.md#truth-hierarchy)).
- [ ] **Correct Asset For Series**: The asset is linked to the series. Use `assetToToken` to determine which token to use.
- [ ] **Use `Token` Type**: Do not hardcode the decimals or the symbol. Use the `Token` type to determine how to display the asset.
