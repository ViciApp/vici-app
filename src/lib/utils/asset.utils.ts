import { USD_ASSET } from '#lib/constants/tokens/assets.fiat.constants.ts';
import { VXP_TOKEN } from '#lib/constants/tokens/tokens.ic.constants.ts';
import type { Token } from '#lib/types/token.ts';
import { findTokenByLedgerId } from '#lib/utils/tokens.utils.ts';
import type { RegistryDid } from '$declarations';
import { assertNever } from '@dfinity/utils';

export const assetToToken = (payoutUnit: RegistryDid.PayoutUnit): Token | undefined => {
	if ('Asset' in payoutUnit) {
		const crypto = payoutUnit.Asset;

		if ('Icrc' in crypto) {
			return findTokenByLedgerId(crypto.Icrc.toText());
		}

		throw new Error(`Unsupported crypto payout unit: ${crypto}`);
	}

	if ('Fiat' in payoutUnit) {
		const fiat = payoutUnit.Fiat;

		if ('Usd' in fiat) {
			return USD_ASSET;
		}

		throw new Error(`Unsupported fiat payout unit: ${fiat}`);
	}

	if ('NonMonetary' in payoutUnit) {
		const nonMonetary = payoutUnit.NonMonetary;

		if ('Points' in nonMonetary) {
			return VXP_TOKEN;
		}

		throw new Error(`Unsupported non-monetary payout unit: ${nonMonetary}`);
	}

	assertNever(payoutUnit, `Unknown payoutUnit type: ${payoutUnit}`);
};
