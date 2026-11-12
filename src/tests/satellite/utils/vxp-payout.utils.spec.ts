import { transferErrorText } from '#satellite/utils/vxp-payout.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('vxp-payout.utils', () => {
	describe('transferErrorText', () => {
		it('spells out InsufficientFunds with the balance', () => {
			assert.equal(
				transferErrorText({ InsufficientFunds: { balance: 42n } }),
				'InsufficientFunds(balance=42)'
			);
		});

		it('spells out BadFee with the expected fee', () => {
			assert.equal(
				transferErrorText({ BadFee: { expected_fee: 10_000n } }),
				'BadFee(expected_fee=10000)'
			);
		});

		it('falls back to a JSON dump that keeps bigints readable', () => {
			assert.equal(
				transferErrorText({ GenericError: { error_code: 7n, message: 'boom' } }),
				'{"GenericError":{"error_code":{"__bigint__":"7"},"message":"boom"}}'
			);
		});

		it('dumps variants without a payload', () => {
			assert.equal(
				transferErrorText({ TemporarilyUnavailable: null }),
				'{"TemporarilyUnavailable":null}'
			);
		});
	});
});
