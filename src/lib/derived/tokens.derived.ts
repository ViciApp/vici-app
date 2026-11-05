import { SUPPORTED_TOKENS } from '#lib/constants/tokens/tokens.ic.constants.ts';
import { balanceDomain } from '#lib/derived/balance-domain.derived.ts';
import { collateralsStore } from '#lib/stores/collaterals.store.ts';
import type { Token } from '#lib/types/token.ts';
import { findCollateralInfoByIcrcLedger } from '#lib/utils/asset-ref.utils.ts';
import { compareBalanceDomains } from '#lib/utils/balance-domain.utils.ts';
import {
	filterTokensForBalanceDomain,
	walletLedgerDisplayFallbackTokens
} from '#lib/utils/playground-token.utils.ts';
import { isNullish } from '@dfinity/utils';
import { derived, type Readable } from 'svelte/store';

export const supportedTokens: Readable<Token[]> = derived(
	[balanceDomain, collateralsStore],
	([$balanceDomain, $collateralsStore]) => {
		if (isNullish($collateralsStore)) {
			return [];
		}

		const { assetsConfig } = $collateralsStore;

		const filteredByClearing = SUPPORTED_TOKENS.filter((token) => {
			const assetInfo = findCollateralInfoByIcrcLedger({
				assetsConfig,
				ledgerCanisterId: token.ledgerCanisterId
			});

			if (isNullish(assetInfo)) {
				return false;
			}

			const { is_enabled, allowed_balance_domains } = assetInfo.config;

			if (!is_enabled) {
				return false;
			}

			return allowed_balance_domains.some((d) => compareBalanceDomains(d, $balanceDomain));
		});

		return filterTokensForBalanceDomain({
			tokens: filteredByClearing,
			balanceDomain: $balanceDomain
		});
	}
);

/**
 * Tokens shown in wallet UI (asset rows, send, history filter). Uses
 * {@link supportedTokens} (clearing `list_collateral_assets` + `allowed_balance_domains`).
 * If clearing has not loaded yet, a **display-only** minimal fallback keeps rows from going blank;
 * it does not grant extra collateral actions.
 */
export const walletUiTokens: Readable<Token[]> = derived(
	[supportedTokens, balanceDomain],
	([$supportedTokens, $balanceDomain]) => {
		if ($supportedTokens.length > 0) {
			return $supportedTokens;
		}

		return walletLedgerDisplayFallbackTokens($balanceDomain);
	}
);
