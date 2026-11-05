import { MILLISECOND_IN_NANOSECONDS, ZERO } from '#lib/constants/app.constants.ts';
import type { Outcome } from '#lib/types/market.ts';
import type { ClearingDid } from '$declarations';
import { nonNullish } from '@dfinity/utils';

/**
 * Binary settlement price for the clearing canister: YES → 100, NO → 0; other outcomes → undefined.
 */
export const binaryPayoff = (outcome: Outcome): bigint | undefined =>
	outcome === 'YES' ? 100n : outcome === 'NO' ? ZERO : undefined;

/**
 * Strict inverse of {@link binaryPayoff}: recovers the `YES`/`NO` label from
 * a settlement price that was produced by `binaryPayoff`.
 *
 * Only the canonical values round-trip: `100n` ⇒ `YES`, `0n` ⇒ `NO`. Any
 * other value (e.g. a partial price like `50n`) returns `undefined` so we
 * don't silently mislabel a mid-market settlement as YES. The engine's
 * binary payoff rule is `price > 0 ⇒ YES`, but the UI has no way to render
 * "50% YES / 50% NO" as a winner; better to surface "settled, outcome
 * unknown" than to pick a side.
 */
export const binaryPayoffLabel = (price: bigint): Outcome | undefined =>
	price === 100n ? 'YES' : price === ZERO ? 'NO' : undefined;

/**
 * Winning-outcome label from clearing's on-chain `SettlementInput`:
 * categorical settlements carry the outcome id verbatim; price settlements
 * round-trip only the canonical binary payoffs (see {@link binaryPayoffLabel}).
 */
export const settlementInputOutcome = (
	settlement: ClearingDid.SettlementInput
): Outcome | undefined =>
	'Outcome' in settlement ? settlement.Outcome : binaryPayoffLabel(settlement.Price.decimal.value);

/**
 * Settlement time (ms) from clearing's on-chain `SettlementInput`.
 *
 * Only price settlements carry a timestamp, and even there it's optional — the
 * categorical `Outcome` variant has no time field at all. `undefined` therefore
 * means "settled, time unknown", never "unsettled"; callers ordering by
 * resolution recency must keep those rows rather than dropping them.
 */
export const settlementInputTimestamp = (
	settlement: ClearingDid.SettlementInput
): bigint | undefined => {
	if ('Outcome' in settlement) {
		return;
	}

	const timestampNs = settlement.Price.timestamp?.[0];

	return nonNullish(timestampNs) ? timestampNs / MILLISECOND_IN_NANOSECONDS : undefined;
};
