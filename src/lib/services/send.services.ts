import type { Token } from '#lib/types/token.ts';
import { findSendableAsset, type PendingSend } from '#lib/utils/send.utils.ts';
import {
	ApiError,
	listWalletAssets,
	requestWalletWithdrawal,
	type ApiWalletAsset
} from '#lib/web2/client.ts';
import { isNullish } from '@dfinity/utils';

/** Localizable send failure: the UI translates `messageKey` (with `params`)
 * instead of showing service-built English, appending `detail` when the API
 * reported a concrete reason. */
export class SendTokenError extends Error {
	readonly messageKey: 'wallet.send.unavailable' | 'wallet.send.failed';
	readonly params?: Record<string, string>;
	readonly detail?: string;

	constructor({
		messageKey,
		params,
		detail
	}: {
		messageKey: 'wallet.send.unavailable' | 'wallet.send.failed';
		params?: Record<string, string>;
		detail?: string;
	}) {
		super(messageKey);
		this.messageKey = messageKey;
		this.params = params;
		this.detail = detail;
	}
}

/**
 * The custody catalog that gates the Send tab, fed to `filterSendableTokens`.
 */
export const loadSendableWalletAssets = (): Promise<ApiWalletAsset[]> => listWalletAssets();

/**
 * The wallet send: a self-custody withdrawal of `amount` to `to`. The key names
 * the send, not the call: a retry of the same send passes the same key (see
 * `pendingSendFor`), so a request whose answer was lost files nothing new.
 */
export const sendCustodialToken = async ({
	token,
	to,
	amount,
	idempotencyKey
}: {
	token: Token;
	to: string;
	amount: bigint;
	idempotencyKey: string;
}): Promise<void> => {
	// The wallet routes key assets by the custody catalog's own id. A
	// non-withdrawable asset is refused here, before the API would reject
	// the withdrawal.
	const asset = findSendableAsset({ assets: await listWalletAssets(), token });

	if (isNullish(asset)) {
		throw new SendTokenError({
			messageKey: 'wallet.send.unavailable',
			params: { symbol: token.symbol }
		});
	}

	const withdrawal = await requestWalletWithdrawal({
		assetId: asset.id,
		amount,
		destination: to,
		selfCustody: true,
		idempotencyKey
	});

	// The API executes best-effort inline and reports the outcome on the
	// returned row (a failed execution refunds the hold), so a failure must
	// surface to the caller like a rejected transfer would.
	if (withdrawal.state === 'failed') {
		throw new SendTokenError({
			messageKey: 'wallet.send.failed',
			detail: withdrawal.failureReason ?? undefined
		});
	}
};

/**
 * The wallet send. The funds are custodial, so the send is a self-custody
 * withdrawal request: the API executes the transfer from the user's custodial
 * account to the destination the user typed.
 */
export const sendToken = (params: {
	token: Token;
	to: string;
	amount: bigint;
	idempotencyKey: string;
}): Promise<void> => sendCustodialToken(params);

/** A proxy gave up waiting while the API may still be running the request. */
const REQUEST_TIMEOUT_STATUS = 408;

/** An answer that settles the send: refused before any request, a `failed`
 * withdrawal with its hold refunded, or a 4xx the API answers without filing
 * anything. A network failure, a timeout or a 5xx leaves the outcome unknown. */
const isDefiniteSendError = (err: unknown): boolean => {
	if (err instanceof SendTokenError) {
		return true;
	}

	return (
		err instanceof ApiError &&
		err.status >= 400 &&
		err.status < 500 &&
		err.status !== REQUEST_TIMEOUT_STATUS
	);
};

/**
 * What is left of `pending` once its send threw `err`. An unknown outcome keeps
 * it, so the user's retry resends the same key and gets back the withdrawal the
 * API may already have filed. A definite answer drops it, so the next send is a
 * new one: a kept key would only replay the same `failed` row.
 */
export const pendingSendAfterError = ({
	pending,
	err
}: {
	pending: PendingSend;
	err: unknown;
}): PendingSend | undefined => (isDefiniteSendError(err) ? undefined : pending);
