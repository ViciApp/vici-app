import type { ClearingDid } from '$declarations';
import {
	getSettlementStatus,
	listSettledSeries,
	settleSeries as settleSeriesApi
} from '$lib/api/clearing.api';
import { PRICE_DECIMALS, VICI_ORACLE_V1, ZERO } from '$lib/constants/app.constants';
import { ActivityType } from '$lib/enums/social';
import { UserRole } from '$lib/enums/user';
import { logActivity } from '$lib/services/activity.services';
import { getIdentityOrAnonymous, safeGetIdentityOnce } from '$lib/services/identity.services';
import { getProfile } from '$lib/services/profile.services';
import type { Outcome } from '$lib/types/market';
import {
	binaryPayoffLabel,
	settlementInputOutcome,
	settlementInputTimestamp
} from '$lib/utils/payoff.utils';
import { isWeb2Backend } from '$lib/web2/backend-mode';
import {
	getEngineSettlementStatus as getEngineSettlementStatusWeb2,
	listEngineSettledSeries as listEngineSettledSeriesWeb2
} from '$lib/web2/client';
import { nonNullish, nowInBigIntNanoSeconds, toNullable } from '@dfinity/utils';
import type { Identity } from '@icp-sdk/core/agent';

/**
 * Fetches the authoritative set of settled (resolved) series ids from the
 * clearing canister — the single source of truth for resolution.
 *
 * Front ends subtract this from the registry's open/unexpired catalog to
 * derive the open set (open = unexpired − settled), replacing the older,
 * incomplete reconstruction that scanned the global ACTIVITIES log for
 * settlement events. Optionally scope to one `balance_domain` so a single
 * deck only pays for its relevant subset.
 *
 * Threads `identity` + `certified` so it composes with `queryAndUpdate`; the
 * fast query path is the right default for read-only discovery, while the
 * value-bearing mint path validates correctness separately via
 * `get_settlement_status`.
 */
export const getSettledSeriesIds = async ({
	identity,
	certified = false,
	balanceDomain
}: {
	identity?: Identity;
	certified?: boolean;
	balanceDomain?: ClearingDid.BalanceDomain;
} = {}): Promise<Set<string>> => {
	// web2 reads the settled set from the public HTTP bridge; no signing
	// identity exists in that mode, so the anonymous degrade below never
	// applies. The bridge read is unfiltered by domain, which is safe: series
	// ids are globally unique, so the extra ids can never match another
	// domain's markets in the caller's subtraction. A failed bridge read takes
	// the same empty-set degrade as the unreadable anonymous case: every
	// catalog load awaits this set, so throwing would blank every market list
	// instead of just skipping the settled filter.
	if (isWeb2Backend()) {
		try {
			return new Set(await listEngineSettledSeriesWeb2());
		} catch (err: unknown) {
			console.warn('Settled series read failed, skipping the settled filter', err);

			return new Set();
		}
	}

	const resolvedIdentity = identity ?? (await getIdentityOrAnonymous());

	// Clearing rejects anonymous callers on `list_settled_series` (IC0406), so a
	// signed-out / guest preview can't read the settled set. Degrade to an empty
	// set rather than throwing: the open list is already expiry-filtered, so the
	// guest deck simply skips the (resolved-but-unexpired) settled filter — an
	// acceptable preview trade-off, and the authoritative filter still applies
	// for every authenticated read.
	if (resolvedIdentity.getPrincipal().isAnonymous()) {
		return new Set();
	}

	const ids = await listSettledSeries({
		identity: resolvedIdentity,
		certified,
		params: {
			start_after: toNullable(),
			limit: toNullable(),
			balance_domain: toNullable(balanceDomain)
		}
	});

	return new Set(ids);
};

/**
 * Resolution label + settlement time for one series, read from clearing rather
 * than from the `SETTLEMENT` activity log.
 */
export interface SettlementDetails {
	outcome?: Outcome;
	/** Settlement timestamp in ms, when the on-chain input carries one. */
	resolvedAt?: bigint;
}

/**
 * How many `get_settlement_status` queries run concurrently in
 * {@link loadSettlementOutcomes}. Mirrors the order-book enrichment batch size:
 * the backfill runs in the background behind an already-painted list, so it
 * trades completion latency for not saturating the agent's request queue.
 */
const SETTLEMENT_STATUS_BATCH_SIZE = 8;

/**
 * Authoritative resolution labels for the given settled series, straight from
 * clearing's `get_settlement_status`.
 *
 * The bulk label source is the Juno `SETTLEMENT` activity log, which is only
 * *best-effort*: it holds a bounded page, and a row exists at all only when the
 * settlement went through this app's admin flow — a series settled by a script
 * or by a controller call has none. Both cases render as "settled, outcome
 * unknown". This reads the winning outcome from the same on-chain
 * `SettlementInput` the payouts were computed from, so the label can't drift
 * from the money.
 *
 * Per-series and unbatchable (clearing exposes no bulk status endpoint), so
 * callers should scope this to the series they actually need labels for and run
 * it off the critical path. Fails open per series: an unreadable status yields
 * no entry rather than failing the batch.
 */
export const loadSettlementOutcomes = async ({
	seriesIds,
	identity,
	certified = false
}: {
	seriesIds: string[];
	identity?: Identity;
	certified?: boolean;
}): Promise<Map<string, SettlementDetails>> => {
	const details = new Map<string, SettlementDetails>();
	let fetchStatus: (seriesId: string) => Promise<ClearingDid.SettlementStatusView | undefined>;

	// The per-series status is a public engine read: web2 routes it through
	// the HTTP bridge (no signing identity exists in that mode); the default
	// path keeps the on-chain read with its anonymous-caller constraint.
	if (isWeb2Backend()) {
		fetchStatus = getEngineSettlementStatusWeb2;
	} else {
		const resolvedIdentity = identity ?? (await getIdentityOrAnonymous());

		// Same anonymous-caller constraint as `getSettledSeriesIds`: clearing rejects
		// anonymous reads, so a signed-out preview keeps the activity-derived labels.
		if (resolvedIdentity.getPrincipal().isAnonymous()) {
			return details;
		}

		fetchStatus = (seriesId: string) =>
			getSettlementStatus({
				identity: resolvedIdentity,
				certified,
				seriesId
			});
	}

	for (let start = 0; start < seriesIds.length; start += SETTLEMENT_STATUS_BATCH_SIZE) {
		const batch = seriesIds.slice(start, start + SETTLEMENT_STATUS_BATCH_SIZE);

		const statuses = await Promise.all(
			batch.map(async (seriesId) => {
				try {
					return await fetchStatus(seriesId);
				} catch (err: unknown) {
					// One unreadable series must not cost the batch its other labels:
					// fall through with no entry, leaving that market's existing
					// (activity-derived or absent) label untouched.
					console.error('Failed to read settlement status', seriesId, err);
				}
			})
		);

		for (const status of statuses.filter(nonNullish)) {
			details.set(status.series_id, {
				outcome: settlementInputOutcome(status.settlement),
				resolvedAt: settlementInputTimestamp(status.settlement)
			});
		}
	}

	return details;
};

/**
 * Admin/resolver-only: settles a series on clearing by outcome id or numeric price and logs activity.
 *
 * **`settlementPrice` contract:** must be a bigint already scaled to
 * {@link PRICE_DECIMALS}. E.g. $1.00 ⇒ `100n`, $0.00 ⇒ `0n`. Callers that
 * start from a human-entered string should use `parseToken({ value, unitName:
 * PRICE_DECIMALS })`. Passing a value scaled to a different unit (such as the
 * collateral ledger's `token.decimals`) will silently settle at the wrong
 * price; binary YES/NO happens to work because clearing treats any `price > 0`
 * as YES, but any non-binary case would be off by a factor of 10.
 *
 * The activity `details` field is stringified JSON so downstream market loaders
 * (`fetchMarkets` / `fetchMarket`) can deserialize it into `{ outcome, price }`
 * and surface the winning outcome on resolved markets. Writing plain strings here
 * caused the detail page to show "Resolved" without a winner.
 */
export const settleMarket = async ({
	seriesId,
	settlementPrice,
	outcomeId
}: {
	seriesId: string;
	/**
	 * Settlement price as a bigint in {@link PRICE_DECIMALS} base units (e.g.
	 * `100n` for `$1.00` when `PRICE_DECIMALS === 2`).
	 */
	settlementPrice?: bigint;
	outcomeId?: string;
}): Promise<void> => {
	const identity = await safeGetIdentityOnce();

	const profileDoc = await getProfile(identity.getPrincipal().toText());

	if (profileDoc.data.role !== UserRole.ADMIN && profileDoc.data.role !== UserRole.SOLVER) {
		throw new Error('Unauthorized: only admins or solvers can settle markets');
	}

	const priceValue = settlementPrice ?? ZERO;

	const params: ClearingDid.SettleSeriesParams = {
		series_id: seriesId,
		settlement: outcomeId
			? { Outcome: outcomeId }
			: {
					Price: {
						decimal: {
							value: priceValue,
							decimals: PRICE_DECIMALS
						},
						timestamp: toNullable(nowInBigIntNanoSeconds()),
						oracle_id: toNullable(VICI_ORACLE_V1)
					}
				}
	};

	await settleSeriesApi({
		identity,
		params
	});

	const outcome: Outcome | undefined = outcomeId ?? binaryPayoffLabel(priceValue);

	await logActivity({
		type: ActivityType.SETTLEMENT,
		user: identity.getPrincipal().toText(),
		marketId: seriesId,
		title: `Market Resolved: ${outcome ?? 'settled'}`,
		details: JSON.stringify({
			outcome,
			price: priceValue.toString()
		})
	});
};
