// The one interface every chain adapter implements. Routes and the deposit
// watcher talk ONLY to this surface, so a chain whose env is missing simply
// registers as disabled and every caller degrades to a clean 503 instead of
// crashing.

import type { Asset } from '../custody/assets';
import type { Chain } from '../lib/keys';

export interface DepositEvent {
	/** `tx` events carry one transaction's received amount, deduplicated by
	 * txRef. `balance` events carry the address's full on-chain balance; the
	 * crediting layer books only the positive difference over the internal
	 * balance plus in-flight withdrawals. */
	kind: 'tx' | 'balance';
	/** Chain-level transaction reference (tx hash / signature / txid), or a
	 * balance-state label for `balance` events, whose deposit row is keyed by
	 * the crediting layer. */
	txRef: string;
	/** The custodial address that received the funds. */
	address: string;
	/** Amount in the asset's base units. */
	amount: bigint;
	asset: Asset;
	confirmations: number;
}

export interface WatchResult {
	events: DepositEvent[];
	/** Moves the adapter's persisted cursor past this pass. The watcher calls
	 * it only once every event is credited: a cursor moved any earlier loses
	 * whatever a failed credit or a crash left unbooked, because nothing ever
	 * reads those events again. */
	commit?: () => Promise<void>;
}

/** Fields fixed once per withdrawal and resent unchanged on every attempt,
 * so a `replaySafe` chain recognizes a resend of a transfer that already
 * landed instead of executing it twice. */
export interface TransferDedup {
	memo: string;
	created_at_ns: bigint;
	/** An earlier send with these fields may exist. Decides which rejections
	 * still prove that nothing landed. */
	replay: boolean;
}

export interface TransferParams {
	/** The sending user; the adapter derives the signing key. Omitted for
	 * treasury-side sends. */
	fromUserId?: string;
	to: string;
	amount: bigint;
	asset: Asset;
	/** The network fee the sender agreed to pay on top of `amount`. A chain
	 * that takes it rejects the transfer when its current fee differs, rather
	 * than charging an amount the books did not hold. Omitted: the chain
	 * charges whatever its fee is. */
	fee?: bigint;
	dedup?: TransferDedup;
}

/** Where a broadcast transfer stands. `failed` only on a definite on-chain
 * failure: a transfer the chain does not know yet stays `pending`, since
 * refunding one that later lands would pay the user twice. */
export type TransferStatus = 'pending' | 'confirmed' | 'failed';

export interface ChainAdapter {
	chain: Chain;
	enabled: boolean;
	/** The user's custodial deposit address on this chain (pure derivation,
	 * no I/O). */
	deriveAddress(userId: string): string;
	/** Whether a withdrawal can be sent to `address` on this chain (pure, no
	 * I/O). Checked before the hold: an address the chain cannot parse fails
	 * the transfer with an unknown outcome and leaves the funds held. */
	isValidAddress(address: string): boolean;
	/** On-chain balance of an address in the asset's base units. */
	getBalance(params: { address: string; asset: Asset }): Promise<bigint>;
	/** The network fee a withdrawal of the asset costs the sender on top of the
	 * amount, in the asset's base units. Held from the user with the amount, so
	 * the internal balance drops exactly as the on-chain one will. */
	withdrawalFee(params: { asset: Asset }): Promise<bigint>;
	/** Sign and broadcast a transfer; resolves to the chain tx reference.
	 * Throws TransferRejectedError only when the chain proves the funds did not
	 * move, TransferUnverifiableError when a replay can no longer tell; any
	 * other error leaves the outcome unknown. */
	transfer(params: TransferParams): Promise<string>;
	/** Whether resending a transfer with the same `dedup` fields is safe: the
	 * chain answers a resend of a landed transfer with the original reference
	 * instead of moving the funds again. Only such a chain gets a withdrawal
	 * whose outcome is unknown sent again; any other needs a human. */
	replaySafe: boolean;
	/** Where the transfer `transfer` returned `txRef` for stands, judged
	 * against the chain's configured confirmation depth. */
	transferStatus(params: { txRef: string; asset: Asset }): Promise<TransferStatus>;
	/** What one watch pass must be handed. `address`: every read stands alone
	 * (live balance, or a per-address cursor), so any subset is safe and the
	 * watcher pages through accounts across ticks, one read per (address,
	 * asset) pair. `chain`: the pass walks a chain-wide position it never
	 * revisits, so it needs every address every time: one left out of a pass
	 * loses its deposits for good. */
	watchScope: 'address' | 'chain';
	/** One deposit-watch pass over the supplied custodial addresses; returns
	 * newly observed (sufficiently confirmed) deposits. Must be idempotent
	 * across ticks: re-reporting an already credited deposit is tolerated and
	 * deduplicated downstream, silently skipping one is not. Reads only: a
	 * pass past its deadline is abandoned mid-flight, so every persisted effect
	 * belongs in `commit`. */
	watchDeposits(params: { addresses: string[]; assets: Asset[] }): Promise<WatchResult>;
}

/** The chain did not execute this transfer, nor (for a replay) any earlier
 * send with the same dedup fields: refunding the withdrawal is safe. */
export class TransferRejectedError extends Error {}

/** A replay the chain can no longer deduplicate (its window passed), so an
 * earlier send may have landed. Never refund automatically: a human settles
 * it from the chain's history. */
export class TransferUnverifiableError extends Error {}

export class ChainDisabledError extends Error {
	constructor(chain: Chain) {
		super(`chain adapter ${chain} is not configured`);
	}
}
