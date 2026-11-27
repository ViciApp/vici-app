import type { ClearingDid } from '#declarations';
import type { MarketId } from '#lib/types/market.ts';
import type { Token, TokenId } from '#lib/types/token.ts';
import type { PrincipalText } from '@dfinity/zod-schemas';

/**
 * Every VXP-relevant movement a user can see.
 *
 * - ICRC ledger primitives: `Send`, `Receive`, `Mint`, `Burn`, `Approve`.
 * - Wallet ↔ clearing-canister flows: `CollateralDeposit`, `CollateralWithdraw`
 *   (derived from ICRC transfers whose counterparty is the clearing canister).
 * - Clearing book activity: `OrderPlaced`, `OrderCancelled`, `Trade`,
 *   `Settlement`, `Liquidation` (derived from clearing `Event`s).
 * - Satellite-side payouts: `Reward` (currently sourced via the ICRC ledger;
 *   reserved here so satellite-driven payouts can be relabelled later).
 */
export type TransactionType =
	| 'Send'
	| 'Receive'
	| 'Burn'
	| 'Mint'
	| 'Approve'
	| 'CollateralDeposit'
	| 'CollateralWithdraw'
	| 'OrderPlaced'
	| 'OrderCancelled'
	| 'Trade'
	| 'Settlement'
	| 'Liquidation'
	| 'Reward';

/**
 * Where the row originates from. Lets the UI distinguish "money moved in your
 * wallet" (`ledger`) from "money moved inside the clearing book" (`clearing`).
 */
type TransactionSource = 'ledger' | 'clearing';

/**
 * Which balance bucket the row affects. `wallet` = ICRC ledger balance,
 * `collateral` = locked / cash balance inside the clearing canister.
 */
type TransactionDomain = 'wallet' | 'collateral';

export interface WalletBalance {
	balances: Record<TokenId, bigint>;
	collateral: Record<TokenId, bigint>;
	accountState?: ClearingDid.AccountStateResponse;
}

type TransactionId = string;

export interface Transaction {
	id: TransactionId;
	user: PrincipalText;
	timestamp: bigint;
	type: TransactionType;
	source: TransactionSource;
	domain: TransactionDomain;
	marketId?: MarketId;
	amount: bigint;
	token: Token;
	counterparty?: PrincipalText;
	approveSpender?: PrincipalText;
	// Clearing-only fields, populated for `Trade` / `Settlement` / `Liquidation`.
	priceE6?: bigint;
	qty?: bigint;
}

/**
 * Ledger balances keyed by token id, with the account they were read for
 * (the principal on the default backend, the user id in web2 mode). `owner`
 * is absent when nobody is signed in.
 */
export interface LedgerBalancesRead {
	owner?: string;
	balances: Record<TokenId, bigint>;
}
