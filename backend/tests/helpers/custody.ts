// Balance reads for the custody suites: a user's internal balance on a chain,
// read inside the caller's transaction so a test can assert it next to the
// writes it just made.

import { isNullish } from '@dfinity/utils';
import type { Asset } from '../../src/custody/assets';
import { accountBalance } from '../../src/custody/ledger';
import type { TxQuery } from '../../src/db/client';
import { ZERO } from '../../src/lib/constants';

export const userChainBalance = async ({
	q,
	userId,
	asset
}: {
	q: TxQuery;
	userId: string;
	asset: Asset;
}): Promise<bigint> => {
	const rows = await q<{ id: string }>(
		`select id from custody_accounts where user_id = $1 and chain = $2`,
		[userId, asset.chain]
	);
	const accountId = rows[0]?.id;

	if (isNullish(accountId)) {
		return ZERO;
	}

	return accountBalance({ q, accountId, assetId: asset.id });
};
