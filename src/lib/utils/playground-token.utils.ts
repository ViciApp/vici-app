import type { ClearingDid } from '#declarations';
import {
	CKUSDC_LEDGER_CANISTER_ID,
	ICP_LEDGER_CANISTER_ID,
	VICI_LEDGER_CANISTER_ID,
	VXP_LEDGER_CANISTER_ID
} from '#lib/constants/canisters.constants.ts';
import { CKUSDC_TOKEN, ICP_TOKEN, VXP_TOKEN } from '#lib/constants/tokens/tokens.ic.constants.ts';
import type { Token } from '#lib/types/token.ts';
import { icrcLedgerIdsEqual } from '#lib/utils/asset-ref.utils.ts';
import { isSettlement, isSocial, isViciXp } from '#lib/utils/balance-domain.utils.ts';
import { nonNullish } from '@dfinity/utils';

/**
 * Product rule: VICI ledger is not surfaced in wallet UI until wired end-to-end.
 */
const isViciToken = (t: Token): boolean => t.ledgerCanisterId === VICI_LEDGER_CANISTER_ID;

/**
 * Settlement collateral: ICP + ckUSDC ICRC ledgers only (order for display).
 */
const SETTLEMENT_LEDGER_ORDER = [ICP_LEDGER_CANISTER_ID, CKUSDC_LEDGER_CANISTER_ID] as const;

/**
 * After clearing has already filtered by `allowed_balance_domains`, restrict **which ICRC
 * ledger** the UI exposes per experience — by **ledger canister id**, not symbol:
 * - **ViciXp (playground):** VXP ledger only.
 * - **Settlement:** ICP + ckUSDC ledgers only.
 * - **Social:** VXP ledger (social challenges can coexist with VXP display).
 */
export const filterTokensForBalanceDomain = ({
	tokens,
	balanceDomain
}: {
	tokens: Token[];
	balanceDomain: ClearingDid.BalanceDomain;
}): Token[] => {
	const withoutVici = tokens.filter((t) => !isViciToken(t));

	if (isViciXp(balanceDomain) || isSocial(balanceDomain)) {
		return withoutVici.filter((t) =>
			icrcLedgerIdsEqual({
				first: t.ledgerCanisterId,
				second: VXP_LEDGER_CANISTER_ID
			})
		);
	}

	if (isSettlement(balanceDomain)) {
		return SETTLEMENT_LEDGER_ORDER.map((canonicalId) =>
			withoutVici.find((t) =>
				icrcLedgerIdsEqual({ first: t.ledgerCanisterId, second: canonicalId })
			)
		).filter(nonNullish);
	}

	return [];
};

/**
 * When `list_collateral_assets` has not loaded yet, show a minimal ledger list so wallet rows
 * still render. **Not** authorization — deposit/withdraw uses {@link supportedTokens} only.
 */
export const walletLedgerDisplayFallbackTokens = (
	balanceDomain: ClearingDid.BalanceDomain
): Token[] => {
	if (isViciXp(balanceDomain) || isSocial(balanceDomain)) {
		return [VXP_TOKEN];
	}

	if (isSettlement(balanceDomain)) {
		const byLedger = new Map([ICP_TOKEN, CKUSDC_TOKEN].map((t) => [t.ledgerCanisterId, t]));

		return SETTLEMENT_LEDGER_ORDER.map((id) => byLedger.get(id)).filter(nonNullish);
	}

	return [];
};
