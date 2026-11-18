import type { Token } from '#lib/types/token.ts';
import type { Web2WalletAsset } from '#lib/web2/client.ts';
import { isNullish, nonNullish } from '@dfinity/utils';

/**
 * The custody asset a web2 send withdraws for `token`, or `undefined` when the
 * catalog cannot send it. The catalog mirrors the supported IC tokens, so the
 * match is by symbol on the IC chain; an asset whose chain is off or that the
 * API refuses to withdraw (VXP stays in custody) is not sendable.
 */
export const findSendableAsset = ({
	assets,
	token
}: {
	assets: Web2WalletAsset[];
	token: Pick<Token, 'symbol'>;
}): Web2WalletAsset | undefined =>
	assets.find(
		({ chain, symbol, chainEnabled, withdrawable }) =>
			chain === 'ic' && symbol === token.symbol && chainEnabled && withdrawable
	);

/**
 * The wallet tokens the Send tab may offer. `assets` is the custody catalog in
 * web2 mode; `undefined` means no custody gate applies (the default backend,
 * where every wallet token is a user-signed ICRC transfer).
 */
export const filterSendableTokens = ({
	tokens,
	assets
}: {
	tokens: Token[];
	assets: Web2WalletAsset[] | undefined;
}): Token[] => {
	if (isNullish(assets)) {
		return tokens;
	}

	return tokens.filter((token) => nonNullish(findSendableAsset({ assets, token })));
};

/** What one send asks for: the token (by ledger), the amount and the
 * destination. Any change to one of them is another send. */
export interface SendIntent {
	ledgerCanisterId: string;
	to: string;
	amount: bigint;
}

/** A confirmed send whose outcome is not known yet, with the idempotency key
 * every retry of it resends. */
export interface PendingSend {
	intent: SendIntent;
	idempotencyKey: string;
}

const isSameSendIntent = ({ a, b }: { a: SendIntent; b: SendIntent }): boolean =>
	a.ledgerCanisterId === b.ledgerCanisterId && a.to === b.to && a.amount === b.amount;

/**
 * The pending send to submit for `intent`. A retry of the send still `pending`
 * keeps its key, so the API answers with the withdrawal it may already have
 * filed instead of filing a second one; any other intent gets a fresh key.
 */
export const pendingSendFor = ({
	pending,
	intent
}: {
	pending: PendingSend | undefined;
	intent: SendIntent;
}): PendingSend =>
	nonNullish(pending) && isSameSendIntent({ a: pending.intent, b: intent })
		? pending
		: { intent, idempotencyKey: crypto.randomUUID() };
