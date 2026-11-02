// IC adapter. The custodial deposit address IS the user's derived principal:
// ICRC ledgers hold the balances, so there is no cursor-based scan. The
// watcher reconciles each custodial principal's on-chain balance against the
// internal ledger and credits the positive difference, so re-observing the
// same state is a no-op.

import { isNullish } from '@dfinity/utils';
import { IcrcLedgerCanister } from '@icp-sdk/canisters/ledger/icrc';
import { Principal } from '@icp-sdk/core/principal';
import type { Asset } from '../../custody/assets';
import { readerLedger } from '../../engine/actors';
import { ZERO } from '../../lib/constants';
import { buildAgent } from '../../lib/ic-agent';
import { treasuryIcIdentity, userIcIdentity, userIcPrincipalText } from '../../lib/keys';
import type { ChainAdapter, DepositEvent, TransferParams, WatchResult } from '../types';

const ledgerRef = (asset: Asset): string => {
	if (isNullish(asset.ledger_ref)) {
		throw new Error(`ic asset ${asset.symbol} has no ledger canister id`);
	}

	return asset.ledger_ref;
};

const deriveAddress = (userId: string): string => userIcPrincipalText(userId);

const getBalance = async ({
	address,
	asset
}: {
	address: string;
	asset: Asset;
}): Promise<bigint> => {
	const ledger = await readerLedger(ledgerRef(asset));

	return await ledger.balance({ owner: Principal.fromText(address), certified: false });
};

const transfer = async ({ fromUserId, to, amount, asset }: TransferParams): Promise<string> => {
	const identity = isNullish(fromUserId) ? treasuryIcIdentity() : userIcIdentity(fromUserId);
	const ledger = IcrcLedgerCanister.create({
		agent: await buildAgent(identity),
		canisterId: Principal.fromText(ledgerRef(asset))
	});

	const blockIndex = await ledger.transfer({
		to: { owner: Principal.fromText(to), subaccount: [] },
		amount
	});

	return blockIndex.toString();
};

const watchDeposits = async ({
	addresses,
	assets
}: {
	addresses: string[];
	assets: Asset[];
}): Promise<WatchResult> => {
	const events: DepositEvent[] = [];

	for (const asset of assets) {
		for (const address of addresses) {
			const balance = await getBalance({ address, asset });

			if (balance > ZERO) {
				// The downstream crediting diffs this against the internal balance
				// and books only the delta, which is what keeps replays idempotent.
				events.push({
					kind: 'balance',
					txRef: `balance:${asset.symbol}:${address}:${balance}`,
					address,
					amount: balance,
					asset,
					confirmations: 1
				});
			}
		}
	}

	return { events };
};

// The IC adapter is enabled by default: IC_HOST carries a mainnet default, so
// no extra env is required for the chain the product launches with.
export const icAdapter: ChainAdapter = {
	chain: 'ic',
	enabled: true,
	watchScope: 'address',
	deriveAddress,
	getBalance,
	transfer,
	watchDeposits
};
