// Custody account provisioning. Addresses are derived, never stored secrets:
// the row only pins the (user, chain) -> address mapping the watchers and the
// ledger reference.

import { isNullish, nonNullish } from '@dfinity/utils';
import { query } from '../db/client';
import type { Chain } from '../lib/keys';

/** `external` is the off-platform side of every deposit and withdrawal;
 * `network_fee` collects the chain fees withdrawals pay, kept apart so they
 * stay visible on the books. */
export type InternalAccountKind = 'treasury' | 'external' | 'network_fee';

export interface CustodyAccount {
	id: string;
	user_id: string | null;
	chain: Chain;
	address: string;
	kind: 'user' | InternalAccountKind;
}

const SELECT = `select id, user_id, chain, address, kind from custody_accounts`;

/** The user's custody account on a chain, creating it (with the supplied
 * derived address) on first use. */
export const ensureUserAccount = async ({
	userId,
	chain,
	address
}: {
	userId: string;
	chain: Chain;
	address: string;
}): Promise<CustodyAccount> => {
	const existing = await query<CustodyAccount>(`${SELECT} where user_id = $1 and chain = $2`, [
		userId,
		chain
	]);

	if (nonNullish(existing[0])) {
		return existing[0];
	}

	const inserted = await query<CustodyAccount>(
		`insert into custody_accounts (user_id, chain, address, kind)
		 values ($1, $2, $3, 'user')
		 on conflict (user_id, chain) where user_id is not null do nothing
		 returning id, user_id, chain, address, kind`,
		[userId, chain, address]
	);

	if (nonNullish(inserted[0])) {
		return inserted[0];
	}

	// Lost a concurrent-provision race: the row now exists, read it back.
	const raced = await query<CustodyAccount>(`${SELECT} where user_id = $1 and chain = $2`, [
		userId,
		chain
	]);

	if (isNullish(raced[0])) {
		throw new Error('custody account provisioning raced and lost the row');
	}

	return raced[0];
};

/** An internal account on a chain, creating on first use. The external
 * account absorbs the off-platform side of every deposit and withdrawal so the
 * books stay balanced. */
export const ensureInternalAccount = async ({
	kind,
	chain,
	address
}: {
	kind: InternalAccountKind;
	chain: Chain;
	address: string;
}): Promise<CustodyAccount> => {
	const existing = await query<CustodyAccount>(
		`${SELECT} where user_id is null and kind = $1 and chain = $2`,
		[kind, chain]
	);

	if (nonNullish(existing[0])) {
		return existing[0];
	}

	const inserted = await query<CustodyAccount>(
		`insert into custody_accounts (user_id, chain, address, kind)
		 values (null, $1, $2, $3)
		 on conflict (kind, chain) where user_id is null do nothing
		 returning id, user_id, chain, address, kind`,
		[chain, address, kind]
	);

	if (nonNullish(inserted[0])) {
		return inserted[0];
	}

	const raced = await query<CustodyAccount>(
		`${SELECT} where user_id is null and kind = $1 and chain = $2`,
		[kind, chain]
	);

	if (isNullish(raced[0])) {
		throw new Error('internal custody account provisioning raced and lost the row');
	}

	return raced[0];
};

export const listUserAccounts = (userId: string): Promise<CustodyAccount[]> =>
	query<CustodyAccount>(`${SELECT} where user_id = $1 order by chain`, [userId]);
