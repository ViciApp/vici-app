import type { ClearingDid } from '$declarations';
import { USD_DECIMALS } from '$lib/constants/app.constants';
import { formatToken } from '$lib/utils/format.utils';
import type { MessageKey } from '$lib/utils/i18n.utils';
import { Web2ApiError } from '$lib/web2/client';
import { assertNever, isNullish, nonNullish } from '@dfinity/utils';

/**
 * The discriminant of a Candid variant — its single top-level key (e.g.
 * `'InsufficientMargin'`). Safe to surface in logs/`Error.message`: it
 * names the failure without the variant's payload (principals, base-unit
 * bigints), which stays solely on `TradeExecutionError.tradeError`.
 */
const variantName = (variant: object): string => Object.keys(variant)[0] ?? 'Unknown';

/**
 * A clearing trade call (`submit_market_order` / `submit_limit_order` /
 * `cancel_limit_order`) rejected by the engine. Carries the structured
 * Candid `TradeError` variant so the UI can render a localized,
 * human-readable reason instead of the raw `JSON.stringify`d `Err` (which
 * leaked principals and base-unit bigints into the "Prediction failed"
 * toast). `Error.message` holds only the variant name — never the payload.
 */
export class TradeExecutionError extends Error {
	readonly tradeError: ClearingDid.TradeError;

	constructor(tradeError: ClearingDid.TradeError) {
		super(`Trade rejected: ${variantName(tradeError)}`);
		this.name = 'TradeExecutionError';
		this.tradeError = tradeError;
	}
}

/**
 * A prediction was attempted at or after the market's kickoff/expiry. Thrown
 * client-side by `placeOrder`: the clearing engine has no expiry gate (its
 * `TradeError` carries no `Expired` variant — it only rejects already-settled
 * series), so a stale Flow deck built before kickoff could otherwise submit
 * after it. Distinct from a settled-series rejection: the market is closed but
 * not yet resolved.
 */
export class MarketClosedError extends Error {
	constructor() {
		super('Market closed: predictions are no longer open');
		this.name = 'MarketClosedError';
	}
}

/**
 * An i18n message descriptor — a `MessageKey` plus its interpolation params —
 * resolved by the caller through `t({ locale, key, params })`.
 */
export interface TradeErrorMessage {
	key: MessageKey;
	params?: Record<string, string | number>;
}

const mapCommonError = (err: ClearingDid.CommonError): TradeErrorMessage => {
	if ('Internal' in err) {
		return { key: 'trade.error.common.internal' };
	}

	if ('InvalidInput' in err) {
		return { key: 'trade.error.common.invalid_input' };
	}

	if ('MathOverflow' in err) {
		return { key: 'trade.error.common.math_overflow' };
	}

	if ('Unauthorized' in err) {
		return { key: 'trade.error.common.unauthorized' };
	}

	if ('RegistryNotSet' in err) {
		return { key: 'trade.error.common.registry_not_set' };
	}

	assertNever(err, `Unhandled CommonError variant: ${variantName(err)}`);
};

/** `balance` (what's free) and `required` are clearing-margin base units
 * (`USD_DECIMALS`); render them as whole grouped amounts, no unit symbol (the
 * toast is domain-agnostic). */
const insufficientMarginMessage = ({
	balance,
	required
}: {
	balance: bigint;
	required: bigint;
}): TradeErrorMessage => ({
	key: 'trade.error.insufficient_margin',
	params: {
		available: formatToken({ value: balance, unitName: USD_DECIMALS, displayDecimals: 0 }),
		required: formatToken({ value: required, unitName: USD_DECIMALS, displayDecimals: 0 })
	}
});

/**
 * Maps a clearing `TradeError` to a user-facing i18n message descriptor. The
 * `assertNever` tail makes this exhaustive: if the generated bindings gain a
 * new variant, this stops compiling until it is handled here.
 */
export const mapTradeError = (err: ClearingDid.TradeError): TradeErrorMessage => {
	if ('SelfTradingNotAllowed' in err) {
		return { key: 'trade.error.self_trading_not_allowed' };
	}

	if ('OrderNotFound' in err) {
		return { key: 'trade.error.order_not_found' };
	}

	if ('ArbitrageLimitExceeded' in err) {
		return { key: 'trade.error.arbitrage_limit_exceeded' };
	}

	if ('RegistryError' in err) {
		return { key: 'trade.error.registry_error' };
	}

	if ('InsufficientMargin' in err) {
		// Picked apart so the `user` principal can never reach the toast.
		const { balance, required } = err.InsufficientMargin;

		return insufficientMarginMessage({ balance, required });
	}

	if ('NotOrderCreator' in err) {
		return { key: 'trade.error.not_order_creator' };
	}

	if ('SeriesNotFound' in err) {
		return { key: 'trade.error.series_not_found' };
	}

	if ('SeriesAlreadySettled' in err) {
		return { key: 'trade.error.series_already_settled' };
	}

	if ('SeriesNotStarted' in err) {
		return { key: 'trade.error.series_not_started' };
	}

	if ('SeriesExpired' in err) {
		return { key: 'trade.error.market_closed' };
	}

	if ('NotAuthorizedToTrade' in err) {
		return { key: 'trade.error.not_authorized_to_trade' };
	}

	if ('Common' in err) {
		return mapCommonError(err.Common);
	}

	assertNever(err, `Unhandled TradeError variant: ${variantName(err)}`);
};

/**
 * The HTTP API's order refusals, by the stable `code` of its error envelope.
 * Web2 mode never sees a `TradeError`: the API signs for the user and reduces
 * the variant to one of these. `backend/src/engine/order-rejections.ts` owns
 * the codes; the shared-drift suite pins the two lists together.
 */
const ORDER_REJECTION_KEYS: Record<string, MessageKey> = {
	arbitrage_limit_exceeded: 'trade.error.arbitrage_limit_exceeded',
	// Only reached without the amounts: `trade.error.insufficient_margin` cannot render bare.
	insufficient_balance: 'trade.error.generic',
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

/**
 * The message of an order the HTTP API refused, or nothing for any other error
 * (a 5xx, an unknown code, a web3 failure), so a surface can tell a refusal the
 * user can act on from a failure it should not explain.
 */
export const orderRejectionMessage = (error: unknown): TradeErrorMessage | undefined => {
	if (!(error instanceof Web2ApiError) || error.status < 400 || error.status >= 500) {
		return;
	}

	const { code, amounts } = error;

	if (code === 'insufficient_balance' && nonNullish(amounts)) {
		return insufficientMarginMessage({
			balance: BigInt(amounts.available),
			required: BigInt(amounts.required)
		});
	}

	const key = ORDER_REJECTION_KEYS[code];

	return isNullish(key) ? undefined : { key };
};

/**
 * Resolves any caught trade error to a message descriptor. Non-trade errors
 * (and — defensively — a variant the bindings don't yet know about) fall
 * through to a generic key so the toast never surfaces a raw payload.
 */
export const tradeErrorMessage = (error: unknown): TradeErrorMessage => {
	if (error instanceof MarketClosedError) {
		return { key: 'trade.error.market_closed' };
	}

	const rejection = orderRejectionMessage(error);

	if (nonNullish(rejection)) {
		return rejection;
	}

	if (!(error instanceof TradeExecutionError)) {
		return { key: 'trade.error.generic' };
	}

	try {
		return mapTradeError(error.tradeError);
	} catch {
		if (import.meta.env.DEV) {
			// Variant name only — never the payload (principals, base-unit bigints).
			console.warn('Unmapped trade error variant:', variantName(error.tradeError));
		}

		return { key: 'trade.error.generic' };
	}
};
