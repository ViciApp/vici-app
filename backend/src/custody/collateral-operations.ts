// Per-id claims on the clearing collateral calls. A claim serializes the same
// id across API machines without holding a database connection through the
// on-chain round trips, and a finished id answers a replay with no ledger work,
// so a retry never pays a second approval fee.

import { nonNullish } from '@dfinity/utils';
import { query } from '../db/client';

export type CollateralOperationKind = 'deposit' | 'withdraw';

/**
 * - `fresh`: first attempt, the caller runs the whole operation.
 * - `resumed`: an earlier attempt ended with an unknown outcome and its lease
 *   elapsed, so nothing of it can still be executing.
 * - `done`: already finished, nothing to do.
 * - `in_flight`: another attempt holds the id.
 */
export type CollateralClaim = 'fresh' | 'resumed' | 'done' | 'in_flight';

/** An update whose outcome is unknown can sit in the ingress queue for 5
 * minutes and then wait 5 more on clearing's bounded ledger call. The lease
 * outlives both, so a retry never overlaps the call it is retrying. */
const CLAIM_LEASE_MINUTES = 15;

interface OperationKey {
	userId: string;
	kind: CollateralOperationKind;
	operationId: string;
}

export const claimCollateralOperation = async ({
	userId,
	kind,
	operationId
}: OperationKey): Promise<CollateralClaim> => {
	const claimed = await query<{ fresh: boolean }>(
		`insert into collateral_operations (user_id, kind, operation_id)
		 values ($1, $2, $3)
		 on conflict (user_id, kind, operation_id) do update
		 set claimed_at = now()
		 where collateral_operations.state = 'pending'
			 and collateral_operations.claimed_at < now() - make_interval(mins => $4)
		 returning (xmax = 0) as fresh`,
		[userId, kind, operationId, CLAIM_LEASE_MINUTES]
	);
	const [claim] = claimed;

	if (nonNullish(claim)) {
		return claim.fresh ? 'fresh' : 'resumed';
	}

	const held = await query<{ state: string }>(
		`select state from collateral_operations
		 where user_id = $1 and kind = $2 and operation_id = $3`,
		[userId, kind, operationId]
	);

	return held[0]?.state === 'done' ? 'done' : 'in_flight';
};

export const completeCollateralOperation = async ({
	userId,
	kind,
	operationId
}: OperationKey): Promise<void> => {
	await query(
		`update collateral_operations set state = 'done'
		 where user_id = $1 and kind = $2 and operation_id = $3`,
		[userId, kind, operationId]
	);
};

/** Drops the claim after a definitive refusal, so a retry runs from scratch. */
export const releaseCollateralOperation = async ({
	userId,
	kind,
	operationId
}: OperationKey): Promise<void> => {
	await query(
		`delete from collateral_operations
		 where user_id = $1 and kind = $2 and operation_id = $3`,
		[userId, kind, operationId]
	);
};
