// Deposit watcher ticks, called from the worker loop. Each tick asks every
// ENABLED adapter for newly observed deposits on the known custodial
// addresses and credits them on the internal double-entry ledger:
//
//   - `tx` events dedupe on the deposits table's unique (account, asset,
//     tx_ref) key, so replays are no-ops.
//   - `balance` events (ic) carry the full on-chain balance; the credit is
//     the positive difference over internal balance + in-flight withdrawals,
//     so an unchanged balance, or one mid-withdrawal, books nothing.

import { isNullish, nonNullish } from '@dfinity/utils';
import { ensureInternalAccount } from '../custody/accounts';
import { listEnabledAssets, type Asset } from '../custody/assets';
import { postLedgerEvent } from '../custody/ledger';
import { query, tx } from '../db/client';
import { ZERO } from '../lib/constants';
import type { Chain } from '../lib/keys';
import { logger } from '../lib/logger';
import { enabledAdapters } from './registry';
import type { ChainAdapter, DepositEvent } from './types';

interface WatchedAccount {
	id: string;
	address: string;
}

/** VXP balances are read live from the ledger and VXP stays non-withdrawable,
 * so it must not be booked on the internal ledger: that balance is what gates
 * `POST /wallet/withdrawals`, and crediting it would open VXP withdrawals. */
const isVxp = ({ chain, symbol }: Asset): boolean => chain === 'ic' && symbol === 'VXP';

const userAccountsOn = (chain: Chain): Promise<WatchedAccount[]> =>
	query<WatchedAccount>(
		`select id, address from custody_accounts where chain = $1 and kind = 'user'`,
		[chain]
	);

const creditTxDeposit = async ({
	event,
	account,
	externalId
}: {
	event: DepositEvent;
	account: WatchedAccount;
	externalId: string;
}): Promise<void> => {
	await tx(async (q) => {
		const inserted = await q<{ id: string }>(
			`insert into deposits (account_id, asset_id, amount, tx_ref, confirmations, state)
			 values ($1, $2, $3, $4, $5, 'confirmed')
			 on conflict (account_id, asset_id, tx_ref) do nothing
			 returning id`,
			[account.id, event.asset.id, event.amount.toString(), event.txRef, event.confirmations]
		);
		const depositId = inserted[0]?.id;

		if (isNullish(depositId)) {
			return;
		}

		await postLedgerEvent(
			{
				eventKey: `deposit:${depositId}`,
				kind: 'deposit',
				legs: [
					{ accountId: account.id, assetId: event.asset.id, delta: event.amount.toString() },
					{ accountId: externalId, assetId: event.asset.id, delta: (-event.amount).toString() }
				]
			},
			q
		);

		await q(`update deposits set state = 'credited', updated_at = now() where id = $1`, [
			depositId
		]);
	});
};

const creditBalanceDeposit = async ({
	event,
	account,
	externalId
}: {
	event: DepositEvent;
	account: WatchedAccount;
	externalId: string;
}): Promise<void> => {
	await tx(async (q) => {
		const internalRows = await q<{ balance: string }>(
			`select coalesce(sum(delta), 0)::text as balance
			 from ledger_entries where account_id = $1 and asset_id = $2`,
			[account.id, event.asset.id]
		);
		// In-flight withdrawals already debited internally but still visible in
		// the on-chain balance; excluding them prevents re-crediting held funds.
		const pendingRows = await q<{ pending: string }>(
			`select coalesce(sum(w.amount), 0)::text as pending
			 from withdrawals w
			 join custody_accounts a on a.user_id = w.user_id
			 where a.id = $1 and w.asset_id = $2
				 and w.state in ('requested', 'processing', 'submitted')`,
			[account.id, event.asset.id]
		);

		const internal = BigInt(internalRows[0]?.balance ?? '0');
		const pending = BigInt(pendingRows[0]?.pending ?? '0');
		const delta = event.amount - internal - pending;

		if (delta <= ZERO) {
			return;
		}

		const inserted = await q<{ id: string }>(
			`insert into deposits (account_id, asset_id, amount, tx_ref, confirmations, state)
			 values ($1, $2, $3, $4, $5, 'confirmed')
			 on conflict (account_id, asset_id, tx_ref) do nothing
			 returning id`,
			[account.id, event.asset.id, delta.toString(), event.txRef, event.confirmations]
		);
		const depositId = inserted[0]?.id;

		if (isNullish(depositId)) {
			return;
		}

		await postLedgerEvent(
			{
				eventKey: `deposit:${depositId}`,
				kind: 'deposit',
				legs: [
					{ accountId: account.id, assetId: event.asset.id, delta: delta.toString() },
					{ accountId: externalId, assetId: event.asset.id, delta: (-delta).toString() }
				]
			},
			q
		);

		await q(`update deposits set state = 'credited', updated_at = now() where id = $1`, [
			depositId
		]);
	});
};

const tickChain = async ({
	adapter,
	chainAssets
}: {
	adapter: ChainAdapter;
	chainAssets: Asset[];
}): Promise<void> => {
	const accounts = await userAccountsOn(adapter.chain);

	if (accounts.length === 0) {
		return;
	}

	// Keyed lowercase: the evm watcher normalizes addresses while the stored
	// form is EIP-55 checksummed.
	const byAddress = new Map(accounts.map((account) => [account.address.toLowerCase(), account]));
	const events = await adapter.watchDeposits({
		addresses: accounts.map((account) => account.address),
		assets: chainAssets
	});

	if (events.length === 0) {
		return;
	}

	const external = await ensureInternalAccount({
		kind: 'external',
		chain: adapter.chain,
		address: 'external'
	});

	for (const event of events) {
		const account = byAddress.get(event.address.toLowerCase());

		if (nonNullish(account)) {
			if (event.kind === 'tx') {
				await creditTxDeposit({ event, account, externalId: external.id });
			} else {
				await creditBalanceDeposit({ event, account, externalId: external.id });
			}
		}
	}
};

/** One watcher pass over every enabled adapter. Failures are isolated per
 * chain so one flaky RPC cannot stall the others. */
export const tickDepositWatchers = async (): Promise<void> => {
	const assets = await listEnabledAssets();

	for (const adapter of enabledAdapters()) {
		const chainAssets: Asset[] = assets.filter(
			(asset) => asset.chain === adapter.chain && !isVxp(asset)
		);

		if (chainAssets.length > 0) {
			try {
				await tickChain({ adapter, chainAssets });
			} catch (err) {
				logger.error(`deposit watcher for ${adapter.chain} failed:`, err);
			}
		}
	}
};

export const hasEnabledWatchers = (): boolean => nonNullish(enabledAdapters()[0]);
