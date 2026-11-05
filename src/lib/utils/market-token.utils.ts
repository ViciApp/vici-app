import type { ClearingDid, RegistryDid } from '#declarations';
import { VXP_TOKEN } from '#lib/constants/tokens/tokens.ic.constants.ts';
import type { Token } from '#lib/types/token.ts';
import { assetToToken } from '#lib/utils/asset.utils.ts';
import { isViciXp } from '#lib/utils/balance-domain.utils.ts';

export const resolveMarketDisplayToken = ({
	balanceDomain,
	payoutUnit
}: {
	balanceDomain: ClearingDid.BalanceDomain;
	payoutUnit: RegistryDid.PayoutUnit;
}): Token | undefined => {
	if (isViciXp(balanceDomain)) {
		return VXP_TOKEN;
	}

	return assetToToken(payoutUnit);
};
