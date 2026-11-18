// Withdrawal execution, shared by the request route (first attempt, right
// after the hold) and the `withdrawal-recovery` worker job (rows a crash or an
// unanswered transfer left behind). A withdrawal is refunded only on a definite
// rejection: a transfer whose outcome is unknown may have landed, and refunding
// it pays the user twice. Such a row stays `processing` until a resend with the
// same dedup fields settles it, which only a `replaySafe` chain allows; on any
// other chain, or once the dedup window has passed, it waits for a human.

import { isNullish } from '@dfinity/utils';
import type { Asset } from '../custody/assets';
import {
	claimWithdrawal,
	getWithdrawal,
	transitionWithdrawal,
	type Withdrawal
} from '../custody/withdrawals';
import { query } from '../db/client';
import { ZERO } from '../lib/constants';
import { CHAINS, type Chain } from '../lib/keys';
import { logger } from '../lib/logger';
import { MINUTE_IN_MS, msToNs } from '../lib/time';
import { DEDUP_SAFE_WINDOW_MS } from './ic/icrc';
import { getAdapter } from './registry';
import {
	ChainDisabledError,
	TransferRejectedError,
	TransferUnverifiableError,
	type ChainAdapter
} from './types';
import { WatchTimeoutError, withTimeout } from './watchers';

/** Bounds both a request waiting on its transfer and one recovery send. An
 * unanswered send stays `processing`, so this only decides when to stop
 * waiting, never what happened. */
export const TRANSFER_TIMEOUT_MS = 30_000;

/** A `requested` row this old was abandoned between its request and its
 * claim: the route claims within milliseconds of the insert. */
export const REQUESTED_GRACE_MS = 2 * MINUTE_IN_MS;

/**
 * A `processing` row is resent only once every earlier send of it has
 * resolved: past the IC ingress expiry (5 minutes) an earlier call can no
 * longer execute, and past TRANSFER_TIMEOUT_MS the route no longer acts on its
 * answer. Otherwise a resend answered InsufficientFunds could refund a row
 * whose first send was still about to land.
 */
export const PROCESSING_GRACE_MS = 10 * MINUTE_IN_MS;

/** Rows per state one tick handles, least recently tried first so a backlog
 * rotates. Each one is a ledger update call, so the bound is what keeps the
 * worker's other jobs running during a backlog. */
const BATCH = 10;

type SendOutcome = 'submitted' | 'failed' | 'unknown' | 'timeout';

interface StuckRow extends Withdrawal {
	chain: Chain;
}

const nsAgo = (ms: number): string => msToNs(Date.now() - ms).toString();

const markTried = async (id: string): Promise<void> => {
	await query(`update withdrawals set updated_at = now() where id = $1 and state = 'processing'`, [
		id
	]);
};

/** Sends a claimed (`processing`) withdrawal and settles the row from the
 * answer: a reference moves it to `submitted`, a definite rejection to
 * `failed` with the hold refunded, anything else leaves it `processing`. */
const sendClaimed = async ({
	withdrawal,
	asset,
	adapter,
	replay,
	timeout_ms
}: {
	withdrawal: Withdrawal;
	asset: Asset;
	adapter: ChainAdapter;
	replay: boolean;
	timeout_ms: number;
}): Promise<SendOutcome> => {
	const { id, transfer_memo: memo, transfer_created_at_ns: createdAtNs } = withdrawal;

	if (isNullish(memo) || isNullish(createdAtNs)) {
		throw new Error(`withdrawal ${id} has no dedup fields to send with`);
	}

	const fee = BigInt(withdrawal.fee);

	try {
		const txRef = await withTimeout({
			work: adapter.transfer({
				fromUserId: withdrawal.user_id,
				to: withdrawal.destination,
				amount: BigInt(withdrawal.amount),
				asset,
				// The held fee, so a ledger whose fee moved since the request rejects
				// the send instead of charging more than the books hold. A row with
				// no held fee was first sent without one, and a resend must match it
				// field for field to be deduplicated.
				...(fee > ZERO ? { fee } : {}),
				dedup: { memo, created_at_ns: BigInt(createdAtNs), replay }
			}),
			timeout_ms,
			label: `${asset.chain} withdrawal transfer`
		});
		const moved = await transitionWithdrawal({ id, from: 'processing', to: 'submitted', txRef });

		if (isNullish(moved)) {
			logger.warn(`withdrawal ${id} left processing before it could be submitted as ${txRef}`);
		}

		return 'submitted';
	} catch (err: unknown) {
		if (err instanceof TransferRejectedError || err instanceof ChainDisabledError) {
			logger.warn(`withdrawal ${id} rejected, refunding the hold:`, err.message);

			await transitionWithdrawal({
				id,
				from: 'processing',
				to: 'failed',
				failureReason: err.message
			});

			return 'failed';
		}

		if (err instanceof TransferUnverifiableError) {
			logger.error(
				`withdrawal ${id} needs a manual look: whether its transfer landed cannot be checked by a resend any more, do not refund it without the ledger history:`,
				err.message
			);
		} else {
			logger.error(`withdrawal ${id} transfer outcome unknown, left processing:`, err);
		}

		await markTried(id);

		return err instanceof WatchTimeoutError ? 'timeout' : 'unknown';
	}
};

/** First attempt of a withdrawal still in `requested`: claim it, then send.
 * Resolves to the row as it stands afterwards; a row another runner claimed
 * first is returned untouched. */
export const executeWithdrawal = async ({
	withdrawal,
	asset,
	adapter = getAdapter(asset.chain),
	timeout_ms = TRANSFER_TIMEOUT_MS
}: {
	withdrawal: Withdrawal;
	asset: Asset;
	adapter?: ChainAdapter;
	timeout_ms?: number;
}): Promise<Withdrawal> => {
	const claimed = await claimWithdrawal(withdrawal.id);

	if (isNullish(claimed)) {
		return (await getWithdrawal(withdrawal.id)) ?? withdrawal;
	}

	await sendClaimed({ withdrawal: claimed, asset, adapter, replay: false, timeout_ms });

	return (await getWithdrawal(withdrawal.id)) ?? claimed;
};

const STUCK_SELECT = `select w.id, w.user_id, w.asset_id, w.amount::text as amount,
	w.fee::text as fee, w.destination,
	w.self_custody, w.state, w.tx_ref, w.failure_reason, w.transfer_memo,
	w.transfer_created_at_ns::text as transfer_created_at_ns, a.chain
	from withdrawals w
	join assets a on a.id = w.asset_id`;

const assetsById = async (ids: string[]): Promise<Map<string, Asset>> => {
	const rows = await query<Asset>(
		`select id, chain, symbol, decimals, ledger_ref, enabled from assets where id = any($1::uuid[])`,
		[ids]
	);

	return new Map(rows.map((asset) => [asset.id, asset]));
};

/** Rows left `processing` that no resend may settle: a chain that cannot
 * deduplicate, a row sent before the dedup fields existed, or a stamp past
 * the window. Reported every pass, never touched. */
const reportUnrecoverable = async ({
	replayable,
	cutoffNs
}: {
	replayable: Chain[];
	cutoffNs: string;
}): Promise<void> => {
	const rows = await query<StuckRow>(
		`${STUCK_SELECT}
		 where w.state = 'processing'
			 and w.updated_at < now() - make_interval(secs => $1::double precision / 1000)
			 and not (a.chain = any($2::text[])
				 and w.transfer_memo is not null
				 and w.transfer_created_at_ns > $3)
		 order by w.updated_at
		 limit $4`,
		[PROCESSING_GRACE_MS, replayable, cutoffNs, BATCH * 5]
	);

	if (rows.length === 0) {
		return;
	}

	const lines = rows.map(({ id, chain, transfer_memo: memo }) => {
		const reason = !replayable.includes(chain)
			? `no enabled replay-safe ${chain} adapter`
			: isNullish(memo)
				? 'sent without dedup fields'
				: 'past the ledger dedup window';

		return `${id} (${reason})`;
	});

	logger.error(
		`withdrawals stuck in processing need a manual look; check the chain before refunding or resending any of them: ${lines.join(', ')}`
	);
};

/**
 * One recovery pass, called from the worker loop:
 * - `requested` rows past REQUESTED_GRACE_MS were never claimed (the request
 *   died before execution): claimed and sent as a first attempt.
 * - `processing` rows past PROCESSING_GRACE_MS on a replay-safe chain, with a
 *   stamp inside the dedup window, are resent with their fixed dedup fields: a
 *   transfer that landed answers with its original reference.
 * - every other stale `processing` row is only reported.
 * A chain whose send times out gets no more sends this pass.
 */
export const tickWithdrawalRecovery = async ({
	adapterFor = getAdapter,
	timeout_ms = TRANSFER_TIMEOUT_MS
}: {
	adapterFor?: (chain: Chain) => ChainAdapter;
	timeout_ms?: number;
} = {}): Promise<void> => {
	const enabled = CHAINS.filter((chain) => adapterFor(chain).enabled);
	const replayable = enabled.filter((chain) => adapterFor(chain).replaySafe);
	const cutoffNs = nsAgo(DEDUP_SAFE_WINDOW_MS);
	const stalled = new Set<Chain>();

	const requested = await query<StuckRow>(
		`${STUCK_SELECT}
		 where w.state = 'requested'
			 and w.updated_at < now() - make_interval(secs => $1::double precision / 1000)
			 and a.chain = any($2::text[])
		 order by w.updated_at
		 limit $3`,
		[REQUESTED_GRACE_MS, enabled, BATCH]
	);
	const processing = await query<StuckRow>(
		`${STUCK_SELECT}
		 where w.state = 'processing'
			 and w.updated_at < now() - make_interval(secs => $1::double precision / 1000)
			 and a.chain = any($2::text[])
			 and w.transfer_memo is not null
			 and w.transfer_created_at_ns > $3
		 order by w.updated_at
		 limit $4`,
		[PROCESSING_GRACE_MS, replayable, cutoffNs, BATCH]
	);
	const assets = await assetsById([...requested, ...processing].map(({ asset_id }) => asset_id));

	const attempt = async ({ row, replay }: { row: StuckRow; replay: boolean }): Promise<void> => {
		const asset = assets.get(row.asset_id);

		if (isNullish(asset) || stalled.has(row.chain)) {
			return;
		}

		try {
			// A replay resends a row that is already processing; a first attempt
			// must win the claim, which the route may have taken meanwhile.
			const withdrawal = replay ? row : await claimWithdrawal(row.id);

			if (isNullish(withdrawal)) {
				return;
			}

			const outcome = await sendClaimed({
				withdrawal,
				asset,
				adapter: adapterFor(row.chain),
				replay,
				timeout_ms
			});

			if (outcome === 'timeout') {
				stalled.add(row.chain);
			}
		} catch (err: unknown) {
			logger.error(`withdrawal ${row.id} recovery failed:`, err);
		}
	};

	for (const row of requested) {
		await attempt({ row, replay: false });
	}

	for (const row of processing) {
		await attempt({ row, replay: true });
	}

	await reportUnrecoverable({ replayable, cutoffNs });
};
