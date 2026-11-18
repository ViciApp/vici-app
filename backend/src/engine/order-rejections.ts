// Which engine refusals of an order the user can act on, and the stable code
// each one answers with. Anything else is a fault and stays a 5xx.

import { isNullish } from '@dfinity/utils';
import type { ClearingDid } from '../declarations';

type VariantName<Variant> = Variant extends Variant ? keyof Variant : never;

type OrderErrorVariant =
	Exclude<VariantName<ClearingDid.TradeError>, 'Common'> | VariantName<ClearingDid.CommonError>;

export interface OrderRejection {
	code: string;
	status: number;
}

/** Every variant is named so a bindings bump cannot add one unclassified: the
 * typecheck stops until it is decided here. `undefined` marks a fault.
 * `InvalidInput` on the order paths only ever means a non-positive quantity or
 * price; `Unauthorized` cannot be the user's, since we sign with their identity. */
export const ORDER_REJECTIONS: Record<OrderErrorVariant, OrderRejection | undefined> = {
	ArbitrageLimitExceeded: { code: 'arbitrage_limit_exceeded', status: 409 },
	InsufficientMargin: { code: 'insufficient_balance', status: 400 },
	Internal: undefined,
	InvalidInput: { code: 'invalid_order', status: 400 },
	MathOverflow: undefined,
	NotAuthorizedToTrade: { code: 'market_restricted', status: 403 },
	NotOrderCreator: { code: 'not_order_creator', status: 403 },
	OrderNotFound: { code: 'order_not_found', status: 404 },
	RegistryError: undefined,
	RegistryNotSet: undefined,
	SelfTradingNotAllowed: { code: 'self_trade', status: 409 },
	SeriesAlreadySettled: { code: 'market_settled', status: 409 },
	SeriesExpired: { code: 'market_closed', status: 409 },
	SeriesNotFound: { code: 'market_not_found', status: 404 },
	SeriesNotStarted: { code: 'market_not_started', status: 409 },
	Unauthorized: undefined
};

const variantName = (err: ClearingDid.TradeError): OrderErrorVariant =>
	Object.keys('Common' in err ? err.Common : err)[0] as OrderErrorVariant;

/** A refused order. `message` names the variant only: the payloads carry the
 * user's principal and balances, and this text reaches the logs. */
export class OrderRejectedError extends Error {
	readonly code: string;
	readonly status: number;
	/** Extra body fields of the refusal, decimal strings like every wire bigint. */
	readonly details: Record<string, string>;

	constructor({
		rejection: { code, status },
		message,
		details
	}: {
		rejection: OrderRejection;
		message: string;
		details: Record<string, string>;
	}) {
		super(message);
		this.code = code;
		this.status = status;
		this.details = details;
	}
}

/** The error for a refusal the user can act on; nothing for a fault or for a
 * variant the table does not know. */
export const orderRejectedError = ({
	err,
	label
}: {
	err: ClearingDid.TradeError;
	label: string;
}): OrderRejectedError | undefined => {
	const variant = variantName(err);
	const rejection = ORDER_REJECTIONS[variant];

	if (isNullish(rejection)) {
		return;
	}

	return new OrderRejectedError({
		rejection,
		message: `${label} failed: ${variant}`,
		details:
			'InsufficientMargin' in err
				? {
						available: err.InsufficientMargin.balance.toString(),
						required: err.InsufficientMargin.required.toString()
					}
				: {}
	});
};
