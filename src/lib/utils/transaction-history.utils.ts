import type { ClearingDid } from '#declarations';
import { USD_DECIMALS, ZERO } from '#lib/constants/app.constants.ts';
import type { MarketId } from '#lib/types/market.ts';
import type {
	TransactionHistoryBonusTag,
	TransactionHistoryRow
} from '#lib/types/transaction-history.ts';
import type { Transaction } from '#lib/types/wallet.ts';
import { nativeToClearingMarginUnits } from '#lib/utils/playground-display.utils.ts';
import { eventExecutionPrice } from '#lib/utils/resolved-position.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';

/**
 * A VXP ledger transaction enriched with the bits the unified `Transaction`
 * type doesn't carry: the decoded award memo (bonus labeling) and the
 * transfer fee (running-balance accounting).
 */
export interface TransactionHistoryLedgerEntry {
	transaction: Transaction;
	memoTag?: TransactionHistoryBonusTag;
	/** Transfer fee in native ledger units (`ZERO` when absent). */
	fee: bigint;
	/**
	 * A transfer to the user's own account: the only real spendable change
	 * is the fee, so it renders no row (the wallet's send + receive
	 * pseudo-row pair would read as two phantom movements here).
	 */
	selfTransfer?: boolean;
}

const KNOWN_BONUS_TAGS: ReadonlySet<string> = new Set([
	'achievement',
	'calibration',
	'comeback',
	'league_founder',
	'new-user',
	'referral',
	'streak',
	'tournament_prize',
	'worlds_podium'
]);

const VXP_MEMO_PREFIX = 'vxp:';

/**
 * Decode a ledger memo written by the satellite payout helper
 * (`vxp:<tag>:<key>`) into a bonus tag. Returns `undefined` for non-award
 * memos so callers can keep rendering them as plain transfers; an award
 * memo whose tag is not recognized (e.g. a type added after this build)
 * degrades to `'unknown'` instead of being dropped.
 */
export const decodeVxpAwardMemo = (
	memo: Uint8Array | number[] | undefined
): TransactionHistoryBonusTag | undefined => {
	if (isNullish(memo)) {
		return;
	}

	let text: string;

	try {
		text = new TextDecoder().decode(memo instanceof Uint8Array ? memo : Uint8Array.from(memo));
	} catch (_err: unknown) {
		return;
	}

	if (!text.startsWith(VXP_MEMO_PREFIX)) {
		return;
	}

	const [, tag] = text.split(':');

	return KNOWN_BONUS_TAGS.has(tag) ? (tag as TransactionHistoryBonusTag) : 'unknown';
};

/**
 * One merged feed item before the running-balance walk. `row` is absent for
 * events that move spendable VXP but are pure noise to the reader
 * (wallet ↔ clearing sweeps, approvals) — they stay in the stream so their
 * fee still feeds the balance math, but never render.
 */
interface HistoryEntry {
	row?: Omit<TransactionHistoryRow, 'balance'>;
	delta: bigint;
	timestampNs: bigint;
}

/**
 * Margin committed by an `Executed` fill, in clearing-margin base units
 * (`USD_DECIMALS`). Carried on the prediction row as `stake` for display
 * ("… in play") — it does **not** move the running balance: a fill only
 * reserves the user's own VXP, it doesn't change what they own (see
 * `clearingEntries`).
 *
 * An event's `qty` is a whole contract count (1 unit = 1.0 of the
 * underlying) and `price` a probability in [0, 1], so `qty × price` is the
 * notional in *whole* VXP; scaling by `10^USD_DECIMALS` lifts it into base
 * units. Without that scale a 5,000 VXP stake reads as `0.5` (`<1`).
 * Non-finite prices (malformed events) contribute `ZERO` rather than `NaN`.
 */
const executedCost = (event: ClearingDid.Event): bigint => {
	const marginUnits = Number(event.qty) * eventExecutionPrice(event) * 10 ** USD_DECIMALS;

	return Number.isFinite(marginUnits) ? BigInt(Math.round(marginUnits)) : ZERO;
};

/**
 * Total-VXP contributions of the clearing trade history.
 *
 * The running balance tracks **total holdings** — everything the user owns,
 * spendable plus everything reserved for open positions and resting orders —
 * so a trade moves the balance only when it changes what the user *owns*, not
 * when VXP merely shifts between "available" and "in play":
 *
 * - `Executed` (a fill) reserves margin but is wealth-neutral: the staked VXP
 *   is still the user's, just locked. Its delta is `0`; the committed margin
 *   rides on the row as `stake` for display.
 * - `Settled` / `Liquidated` realize the position. The signed `qty` is the
 *   realized cashflow (see `settledEventToResolvedPosition`) — a win adds the
 *   profit, a full loss subtracts the stake, a break-even nets zero — and
 *   that cashflow *is* the total delta. No margin-release term is needed,
 *   because the fill never debited total in the first place.
 *
 * `OrderPlaced` (a resting order) reserves margin too but, like a fill,
 * leaves total untouched — so it contributes no delta and renders no row.
 * This is what lets the total-anchored walk reconcile to a clean zero genesis
 * even with orders still resting: a spendable-anchored walk drifted the
 * oldest balances negative by exactly that reserved-but-unrepresented amount.
 */
const clearingEntries = (events: ClearingDid.Event[]): HistoryEntry[] => {
	const entries: HistoryEntry[] = [];

	for (const event of events) {
		const [eventKey] = Object.keys(event.event_type) as Array<keyof ClearingDid.EventType>;
		const marketId = event.series_id as MarketId;
		const id = `clearing-${event.event_id.toString()}-${eventKey}`;

		if (eventKey === 'Executed') {
			entries.push({
				timestampNs: event.timestamp,
				delta: ZERO,
				row: {
					id,
					kind: 'prediction',
					marketId,
					timestampNs: event.timestamp,
					delta: ZERO,
					stake: executedCost(event)
				}
			});
		} else if (eventKey === 'Settled' || eventKey === 'Liquidated') {
			const cashflow = event.qty;

			const kind =
				eventKey === 'Liquidated'
					? 'liquidation'
					: cashflow > ZERO
						? 'won'
						: cashflow < ZERO
							? 'lost'
							: 'neutral';

			entries.push({
				timestampNs: event.timestamp,
				delta: cashflow,
				row: {
					id,
					kind,
					marketId,
					timestampNs: event.timestamp,
					delta: cashflow
				}
			});
		}
	}

	return entries;
};

/**
 * Spendable-VXP contributions of the VXP ledger trail. Sweeps between the
 * wallet and the clearing collateral account move VXP the user can still
 * spend, so they stay hidden — only their fee debits the balance.
 */
const ledgerEntry = ({
	transaction,
	memoTag,
	fee,
	selfTransfer
}: TransactionHistoryLedgerEntry): HistoryEntry => {
	const { token, type, timestamp, amount, id } = transaction;

	const amountMargin = nativeToClearingMarginUnits({
		nativeBalance: amount,
		nativeDecimals: token.decimals
	});
	const feeMargin = nativeToClearingMarginUnits({
		nativeBalance: fee,
		nativeDecimals: token.decimals
	});

	if (selfTransfer === true) {
		return { timestampNs: timestamp, delta: -feeMargin };
	}

	const base = { id: `ledger-${id}`, timestampNs: timestamp };

	if (type === 'Receive' || type === 'Mint') {
		const kind = nonNullish(memoTag) ? 'bonus' : type === 'Mint' ? 'minted' : 'received';

		return {
			timestampNs: timestamp,
			delta: amountMargin,
			row: { ...base, kind, bonusTag: memoTag, delta: amountMargin }
		};
	}

	switch (type) {
		case 'Send': {
			const delta = -(amountMargin + feeMargin);

			return { timestampNs: timestamp, delta, row: { ...base, kind: 'sent', delta } };
		}

		case 'Burn': {
			return {
				timestampNs: timestamp,
				delta: -amountMargin,
				row: { ...base, kind: 'burned', delta: -amountMargin }
			};
		}

		// Sweeps and approvals: spendable-neutral, fee-only, never rendered.
		default:
			return { timestampNs: timestamp, delta: -feeMargin };
	}
};

/**
 * Merge the clearing trade history and the VXP ledger trail into one
 * newest-first feed and stamp each visible row with the running **total**
 * balance after that event.
 *
 * The walk anchors on the *current* total-holdings figure — the same number
 * the Dash "Holdings" hero shows — and subtracts deltas going back in time,
 * so the top row always agrees with the hero. Because total moves only on
 * realized cashflow (bonuses, wins, losses, transfers) and never on margin
 * shifting in or out of play, the walk reconciles to a clean zero genesis no
 * matter how much is currently reserved for open positions or resting orders
 * — anchoring on *spendable* instead drifted the oldest balances negative by
 * exactly that reserved amount. Genuine gaps in very old data still shift old
 * balances, never today's.
 */
export const assembleTransactionHistory = ({
	events,
	ledgerEntries,
	totalAnchor,
	includeGenesis = false
}: {
	events: ClearingDid.Event[];
	ledgerEntries: TransactionHistoryLedgerEntry[];
	totalAnchor: bigint;
	/**
	 * Append the "joined Vici" genesis marker as the oldest row. Only pass
	 * `true` when the full history was loaded (the ledger walk reached the
	 * beginning, not the page cap) — otherwise there *is* older history and
	 * the marker would lie about where the trail starts.
	 */
	includeGenesis?: boolean;
}): TransactionHistoryRow[] => {
	const entries = [...clearingEntries(events), ...ledgerEntries.map(ledgerEntry)].sort((a, b) =>
		a.timestampNs === b.timestampNs ? 0 : a.timestampNs > b.timestampNs ? -1 : 1
	);

	const rows: TransactionHistoryRow[] = [];
	let running = totalAnchor;

	for (const entry of entries) {
		if (nonNullish(entry.row)) {
			rows.push({ ...entry.row, balance: running });
		}

		running -= entry.delta;
	}

	// The account's origin: zero VXP, before any bonus or prediction. Dated to
	// the oldest real event (the moment the user first showed up). The
	// total-anchored walk lands on `ZERO` here by construction; pinned
	// explicitly so a truncated tail can't print a stray non-zero genesis.
	if (includeGenesis && entries.length > 0) {
		rows.push({
			id: 'genesis',
			kind: 'joined',
			timestampNs: entries[entries.length - 1].timestampNs,
			delta: ZERO,
			balance: ZERO
		});
	}

	return rows;
};
