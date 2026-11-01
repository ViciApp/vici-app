import type { ClearingDid } from '$declarations';
import {
	mapTradeError,
	orderRejectionMessage,
	tradeErrorMessage,
	TradeExecutionError
} from '$lib/canisters/clearing.errors';
import { Web2ApiError, type Web2ApiErrorAmounts } from '$lib/web2/client';
import { Principal } from '@icp-sdk/core/principal';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const refusal = ({
	code,
	amounts
}: {
	code: string;
	amounts?: Web2ApiErrorAmounts;
}): Web2ApiError => new Web2ApiError({ status: 409, code, amounts });

describe('tradeErrorMessage over the HTTP API', () => {
	const KEYS = {
		arbitrage_limit_exceeded: 'trade.error.arbitrage_limit_exceeded',
		invalid_order: 'trade.error.common.invalid_input',
		market_closed: 'trade.error.market_closed',
		market_not_found: 'trade.error.series_not_found',
		market_not_started: 'trade.error.series_not_started',
		market_restricted: 'trade.error.not_authorized_to_trade',
		market_settled: 'trade.error.series_already_settled',
		not_order_creator: 'trade.error.not_order_creator',
		order_not_found: 'trade.error.order_not_found',
		self_trade: 'trade.error.self_trading_not_allowed'
	};

	for (const [code, key] of Object.entries(KEYS)) {
		it(`shows ${code} as ${key}`, () => {
			assert.deepEqual(tradeErrorMessage(refusal({ code })), { key });
		});
	}

	it('renders insufficient_balance exactly like the on-chain variant', () => {
		const [balance, required] = [BigInt(1_500_000_000), BigInt(2_000_000_000)];
		const onChain: ClearingDid.TradeError = {
			InsufficientMargin: { balance, required, user: Principal.anonymous() }
		};

		assert.deepEqual(
			tradeErrorMessage(
				refusal({
					code: 'insufficient_balance',
					amounts: { available: balance.toString(), required: required.toString() }
				})
			),
			mapTradeError(onChain)
		);
	});

	it('never renders the amounts message without its amounts', () => {
		assert.deepEqual(tradeErrorMessage(refusal({ code: 'insufficient_balance' })), {
			key: 'trade.error.generic'
		});
	});

	it('falls back to the generic message for an unmapped code or a fault', () => {
		for (const error of [
			refusal({ code: 'a_future_code' }),
			new Web2ApiError({ status: 500, code: 'internal' }),
			new Web2ApiError({ status: 502, code: 'unknown_error' })
		]) {
			assert.deepEqual(tradeErrorMessage(error), { key: 'trade.error.generic' });
		}
	});
});

describe('orderRejectionMessage', () => {
	it('answers nothing for anything but a known refusal', () => {
		for (const error of [
			refusal({ code: 'a_future_code' }),
			new Web2ApiError({ status: 500, code: 'internal' }),
			new Web2ApiError({ status: 500, code: 'order_not_found' }),
			new Web2ApiError({
				status: 503,
				code: 'insufficient_balance',
				amounts: { available: '1', required: '2' }
			}),
			new Error('order_not_found'),
			new TradeExecutionError({ NotOrderCreator: null })
		]) {
			assert.equal(orderRejectionMessage(error), undefined);
		}
	});
});

describe('tradeErrorMessage on the on-chain path', () => {
	it('still resolves the structured variant', () => {
		assert.deepEqual(tradeErrorMessage(new TradeExecutionError({ SelfTradingNotAllowed: null })), {
			key: 'trade.error.self_trading_not_allowed'
		});
	});
});
