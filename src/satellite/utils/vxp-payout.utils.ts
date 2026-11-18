import { jsonReplacer } from '@dfinity/utils';
import type { TransferError } from '@junobuild/functions/canisters/ledger/icrc';

/**
 * Human-readable summary of an ICRC `TransferError` for logs. Spells out
 * the two cases we routinely hit (`InsufficientFunds` / `BadFee`) and
 * falls back to a JSON dump for the rest. Shared so every VXP payout path
 * reports transfer failures identically.
 */
export const transferErrorText = (err: TransferError): string => {
	if ('InsufficientFunds' in err) {
		return `InsufficientFunds(balance=${err.InsufficientFunds.balance})`;
	}

	if ('BadFee' in err) {
		return `BadFee(expected_fee=${err.BadFee.expected_fee})`;
	}

	return JSON.stringify(err, jsonReplacer);
};
