import type { ClearingDid, RegistryDid } from '#declarations';
import { RESOLVED_RESULTS_RETENTION_MS, ZERO } from '#lib/constants/app.constants.ts';
import { CLEARING_CANISTER_ID, REGISTRY_CANISTER_ID } from '#lib/constants/canisters.constants.ts';
import { Collection } from '#lib/constants/collections.constants.ts';
import { ActivityType } from '#lib/enums/social.ts';
import type { Activity, ResolvedResult } from '#lib/types/social.ts';
import { controllerCaller, isAdmin } from '#satellite/services/authz.services.ts';
import { candidMethod } from '#satellite/utils/candid.utils.ts';
import { logError, logInfo } from '#satellite/utils/logger.utils.ts';
import { escapeRegex } from '#satellite/utils/regex.utils.ts';
import { timeMs } from '#satellite/utils/time.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import type { OnSetDocContext } from '@junobuild/functions';
import { call, msgCaller } from '@junobuild/functions/ic-cdk';
import {
	decodeDocData,
	deleteDocStore,
	encodeDocData,
	getDocStore,
	listDocsStore,
	setDocStore
} from '@junobuild/functions/sdk';

/**
 * A satellite controller principal, used as the `caller` for the controllers-scoped
 * `resolved_results` writes: the resolver is not a controller, so each row is written as an admin
 * (the `*DocStore` APIs enforce the collection rule against the caller they're given). Mirrors the
 * `activity_reaction_counts` rollup.
 */
const adminCaller = (): Uint8Array => controllerCaller('resolved-results write');

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);

/**
 * Whether a Candid `int` cashflow stays exact once narrowed to a JS `number`. Outside the
 * safe-integer range the `Number(...)` conversion silently loses precision, which would corrupt the
 * row's `netVxp`: such rows are dropped rather than written.
 */
const isSafeCashflow = (cashflowUsd: bigint): boolean =>
	cashflowUsd <= MAX_SAFE && cashflowUsd >= MIN_SAFE;

/** The doc key for a participant's row: `${owner}#${marketId}` (owner-prefix scannable). */
const resolvedResultKey = ({ owner, marketId }: { owner: string; marketId: string }): string =>
	`${owner}#${marketId}`;

/**
 * The side a participant held: the settlement outcome id when present, else `YES`/`NO` derived from
 * the sign of their net position (positive = long = `YES`). Mirrors how the FE labels a binary
 * resolved position from clearing.
 */
const sideForPosition = ({
	outcome_id,
	net_qty
}: Pick<ClearingDid.SettlementPosition, 'outcome_id' | 'net_qty'>): string => {
	const [explicit] = outcome_id;

	if (nonNullish(explicit) && explicit.length > 0) {
		return explicit;
	}

	return net_qty >= ZERO ? 'YES' : 'NO';
};

/**
 * The market title for a resolved series, read from the registry (`get_series`). Falls back to the
 * resolver-written activity title when the series is unknown or the read fails: the row stays
 * writable rather than aborting the whole fan-out on a transient registry hiccup.
 */
const marketTitle = async ({
	seriesId,
	fallback
}: {
	seriesId: string;
	fallback: string;
}): Promise<string> => {
	try {
		const { argTypes, result } = candidMethod({ canister: 'registry', method: 'get_series' });
		const series = await call<[] | [RegistryDid.Series]>({
			canisterId: REGISTRY_CANISTER_ID,
			method: 'get_series',
			args: [[argTypes[0], seriesId]],
			result
		});

		const title = series[0]?.title;

		return nonNullish(title) && title.length > 0 ? title : fallback;
	} catch (err: unknown) {
		logError({
			message: 'resolved_results_title_lookup_failed',
			detail: { seriesId, error: err instanceof Error ? err.message : `${err}` }
		});

		return fallback;
	}
};

/** Reads the clearing settlement plan's per-participant positions for a series. */
const settlementPositions = async (
	seriesId: string
): Promise<ClearingDid.SettlementPosition[] | undefined> => {
	const { argTypes, result } = candidMethod({
		canister: 'clearing',
		method: 'get_settlement_plan'
	});
	const plan = await call<[] | [ClearingDid.SettlementPlan]>({
		canisterId: CLEARING_CANISTER_ID,
		method: 'get_settlement_plan',
		args: [[argTypes[0], seriesId]],
		result
	});

	return plan[0]?.positions;
};

/**
 * Writes one `resolved_results` row for a participant, version-locked upsert as admin. A re-fire on
 * the same `(owner, market)` overwrites the existing row (idempotent: a settlement is replayed to
 * the same outcome), so a hook replay can't duplicate or double-count.
 */
const writeResolvedResult = ({
	admin,
	result
}: {
	admin: Uint8Array;
	result: ResolvedResult;
}): void => {
	const key = resolvedResultKey({ owner: result.owner, marketId: result.marketId });

	const existing = getDocStore({
		collection: Collection.RESOLVED_RESULTS,
		key,
		caller: admin
	});

	setDocStore({
		collection: Collection.RESOLVED_RESULTS,
		key,
		caller: admin,
		doc: {
			data: encodeDocData(result),
			version: existing?.version
		}
	});
};

/**
 * `onSetDoc` for `activities`: on a SETTLEMENT activity CREATE, fan out one `resolved_results` row
 * per market participant. The settlement activity is a client `setDoc` (so this hook genuinely
 * fires), and the per-participant outcome + signed net VXP are derived server-side from the clearing
 * settlement plan, never from the client, so a user cannot forge a result. Best-effort: any
 * failure is logged and swallowed so it never disrupts the resolver's settlement write. Settlements
 * are rare, so the O(participants) fan-out is a bounded, cold path.
 */
export const onActivitySetForResolvedResults = async (ctx: OnSetDocContext): Promise<void> => {
	const {
		data: {
			collection,
			data: { before, after }
		}
	} = ctx;

	if (collection !== Collection.ACTIVITIES || nonNullish(before)) {
		return;
	}

	let activity: Activity;

	try {
		activity = decodeDocData<Activity>(after.data);
	} catch {
		return;
	}

	if (activity.type !== ActivityType.SETTLEMENT || isNullish(activity.marketId)) {
		return;
	}

	const seriesId = activity.marketId;

	try {
		const positions = await settlementPositions(seriesId);

		if (isNullish(positions) || positions.length === 0) {
			return;
		}

		const title = await marketTitle({ seriesId, fallback: activity.title });
		const resolvedAtMs = timeMs();
		const admin = adminCaller();

		// `cashflow_usd` is a Candid `int` (`bigint`); `netVxp` is a JS `number`.
		// Past the safe-integer range the conversion silently loses precision, so
		// drop such a row (logged) rather than record a corrupted `netVxp`.
		const writable = positions.filter((position) => {
			const safe = isSafeCashflow(position.cashflow_usd);

			if (!safe) {
				logError({
					message: 'resolved_results_cashflow_unsafe',
					detail: {
						seriesId,
						owner: position.user.toText(),
						cashflowUsd: position.cashflow_usd.toString()
					}
				});
			}

			return safe;
		});

		for (const position of writable) {
			const netVxp = Number(position.cashflow_usd);

			writeResolvedResult({
				admin,
				result: {
					owner: position.user.toText(),
					marketId: seriesId,
					title,
					side: sideForPosition(position),
					outcome: netVxp >= 0 ? 'win' : 'loss',
					netVxp,
					resolvedAtMs
				}
			});
		}

		logInfo({
			message: 'resolved_results_written',
			detail: { seriesId, rows: writable.length }
		});
	} catch (err: unknown) {
		logError({
			message: 'resolved_results_write_failed',
			detail: { seriesId, error: err instanceof Error ? err.message : `${err}` }
		});
	}
};

/**
 * Friend-scoped bulk read for the results digest. Given a set of friend principals, returns their
 * resolved-result rows over the active retention window in ONE bounded `listDocsStore` filtered to
 * the friend owner-prefixes, never one call per friend. Keys are `${owner}#${marketId}`, so a row
 * belongs to a friend when its key prefix (before the first `#`) is in the set; the key matcher
 * anchors the scan to those prefixes server-side.
 */
export const listFriendResolvedResultsFn = ({
	friends
}: {
	friends: string[];
}): ResolvedResult[] => {
	const friendSet = new Set(friends);

	if (friendSet.size === 0) {
		return [];
	}

	const cutoffMs = timeMs() - RESOLVED_RESULTS_RETENTION_MS;

	// One bounded scan anchored to the friend owner-prefixes (`(^a#|^b#|…)`),
	// not a per-friend round-trip. The decoded-`owner` re-check below is the
	// authoritative filter; the matcher just keeps the read off unrelated rows.
	const keyMatcher = `^(${[...friendSet].map((owner) => `${escapeRegex(owner)}#`).join('|')})`;

	// Read as the actual caller (not as a controller) so the `resolved_results`
	// datastore `read` rule stays the source of truth. The collection is public
	// read, so the caller can read friends' rows over the owner-prefix scan.
	const { items } = listDocsStore({
		collection: Collection.RESOLVED_RESULTS,
		caller: msgCaller(),
		params: { matcher: { key: keyMatcher } }
	});

	const results: ResolvedResult[] = [];

	for (const [, item] of items) {
		let row: ResolvedResult | undefined;

		try {
			row = decodeDocData<ResolvedResult>(item.data);
		} catch {
			// A malformed row can't serve a read: skip it rather than abort the scan.
			row = undefined;
		}

		if (nonNullish(row) && friendSet.has(row.owner) && row.resolvedAtMs >= cutoffMs) {
			results.push(row);
		}
	}

	return results;
};

/**
 * Controllers-only retention cleanup. Prunes every `resolved_results` row whose `resolvedAtMs` is
 * older than {@link RESOLVED_RESULTS_RETENTION_MS}: Juno has no scheduler, so this is admin/cron
 * triggered (mirrors `sweepExpiredDeletions`). Returns the number of rows pruned.
 */
export const pruneResolvedResultsFn = (): { pruned: number } => {
	const caller = msgCaller();

	if (!isAdmin({ caller })) {
		throw new Error('Only an admin can prune resolved results.');
	}

	const admin = adminCaller();
	const cutoffMs = timeMs() - RESOLVED_RESULTS_RETENTION_MS;

	const { items } = listDocsStore({
		collection: Collection.RESOLVED_RESULTS,
		caller: admin,
		params: {}
	});

	let pruned = 0;

	for (const [key, item] of items) {
		let row: ResolvedResult | undefined;

		try {
			row = decodeDocData<ResolvedResult>(item.data);
		} catch {
			row = undefined;
		}

		// Prune stale rows and any undecodable row (it can never serve a read).
		if (isNullish(row) || row.resolvedAtMs < cutoffMs) {
			deleteDocStore({
				collection: Collection.RESOLVED_RESULTS,
				key,
				caller: admin,
				doc: { version: item.version }
			});
			pruned += 1;
		}
	}

	return { pruned };
};
