// Deposit watcher ticks, called from the worker loop. Each tick asks every
// ENABLED adapter for newly observed deposits on the known custodial
// addresses and credits them on the internal double-entry ledger:
//
//   - `tx` events dedupe on the deposits table's unique (account, asset,
//     tx_ref) key, so replays are no-ops.
//   - `balance` events (ic) carry the full on-chain balance; the credit is
//     the positive difference over internal balance + in-flight withdrawals,
//     so an unchanged balance, or one mid-withdrawal, books nothing.
//
// The worker runs its jobs one after another, so a tick has to end for award
// reconciliation to run. `address` scope adapters are swept in pages across
// ticks under WatchLimits; `chain` scope adapters bound themselves and get
// every address. A read that fails is logged and skipped, and comes round again
// on the next sweep: balances and per-address cursors lose nothing by waiting.

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

export interface WatchLimits {
	/** Accounts one tick reads, per chain. At the default 250, 1,000 accounts
	 * take four ticks to sweep. */
	maxAccounts: number;
	/** Reads in flight at once. */
	concurrency: number;
	readTimeout_ms: number;
	/** Wall clock one tick may spend on a chain before starting no new reads.
	 * The chain's share of a tick ends within this plus readTimeout_ms. */
	budget_ms: number;
}

export const DEFAULT_WATCH_LIMITS: WatchLimits = {
	maxAccounts: 250,
	concurrency: 24,
	readTimeout_ms: 10_000,
	budget_ms: 30_000
};

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

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

const userAccountsAfter = ({
	chain,
	after,
	limit
}: {
	chain: Chain;
	after: string;
	limit: number;
}): Promise<WatchedAccount[]> =>
	query<WatchedAccount>(
		`select id, address from custody_accounts
		 where chain = $1 and kind = 'user' and id > $2
		 order by id
		 limit $3`,
		[chain, after, limit]
	);

const sweepCursorKey = (chain: Chain): string => `watch:${chain}`;

const readSweepCursor = async (chain: Chain): Promise<string> => {
	const rows = await query<{ cursor: string }>(
		`select cursor from chain_cursors where chain = $1`,
		[sweepCursorKey(chain)]
	);

	return rows[0]?.cursor ?? NIL_UUID;
};

const writeSweepCursor = async ({
	chain,
	cursor
}: {
	chain: Chain;
	cursor: string;
}): Promise<void> => {
	await query(
		`insert into chain_cursors (chain, cursor) values ($1, $2)
		 on conflict (chain) do update set cursor = excluded.cursor, updated_at = now()`,
		[sweepCursorKey(chain), cursor]
	);
};

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
		// One statement, so both come from one snapshot: a credit count fresher
		// than the balance would give a stale delta a key nobody else holds.
		const internalRows = await q<{ balance: string; credits: string }>(
			`select
				 (select coalesce(sum(delta), 0)::text from ledger_entries
					where account_id = $1 and asset_id = $2) as balance,
				 (select count(*)::text from deposits
					where account_id = $1 and asset_id = $2) as credits`,
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

		// Keyed by credit number, not balance: an account can return to an amount
		// it held before, and that key would drop the deposit on the conflict. The
		// delta above is what stops a replay; this key only makes two overlapping
		// credits collide.
		const txRef = `balance-credit:${event.asset.symbol}:${event.address}:${internalRows[0]?.credits}`;
		const inserted = await q<{ id: string }>(
			`insert into deposits (account_id, asset_id, amount, tx_ref, confirmations, state)
			 values ($1, $2, $3, $4, $5, 'confirmed')
			 on conflict (account_id, asset_id, tx_ref) do nothing
			 returning id`,
			[account.id, event.asset.id, delta.toString(), txRef, event.confirmations]
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

class WatchTimeoutError extends Error {}

const withTimeout = <T>({
	work,
	timeout_ms,
	label
}: {
	work: Promise<T>;
	timeout_ms: number;
	label: string;
}): Promise<T> => {
	let timer: ReturnType<typeof setTimeout> | undefined;

	return Promise.race([
		work.finally(() => clearTimeout(timer)),
		new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new WatchTimeoutError(`${label} timed out`)), timeout_ms);
		})
	]);
};

/** One watch pass and its credits. A failed credit is logged and does not stop
 * the rest, but it holds the commit back: the pass is read again on a later
 * tick and the events already booked dedupe. */
const watchAndCredit = async ({
	adapter,
	accounts,
	assets,
	externalId,
	timeout_ms
}: {
	adapter: ChainAdapter;
	accounts: WatchedAccount[];
	assets: Asset[];
	externalId: string;
	timeout_ms: number;
}): Promise<void> => {
	const { events, commit } = await withTimeout({
		work: adapter.watchDeposits({
			addresses: accounts.map((account) => account.address),
			assets
		}),
		timeout_ms,
		label: `${adapter.chain} watch pass`
	});

	// Keyed lowercase: the evm watcher normalizes addresses while the stored
	// form is EIP-55 checksummed.
	const byAddress = new Map(accounts.map((account) => [account.address.toLowerCase(), account]));
	let credited = true;

	for (const event of events) {
		const account = byAddress.get(event.address.toLowerCase());

		if (nonNullish(account)) {
			try {
				if (event.kind === 'tx') {
					await creditTxDeposit({ event, account, externalId });
				} else {
					await creditBalanceDeposit({ event, account, externalId });
				}
			} catch (err) {
				credited = false;
				logger.error(`deposit credit failed for ${event.txRef}:`, err);
			}
		}
	}

	if (credited) {
		await commit?.();
	}
};

const watchWholeChain = async ({
	adapter,
	chainAssets,
	limits
}: {
	adapter: ChainAdapter;
	chainAssets: Asset[];
	limits: WatchLimits;
}): Promise<void> => {
	const accounts = await userAccountsOn(adapter.chain);

	if (accounts.length === 0) {
		return;
	}

	const external = await ensureInternalAccount({
		kind: 'external',
		chain: adapter.chain,
		address: 'external'
	});

	await watchAndCredit({
		adapter,
		accounts,
		assets: chainAssets,
		externalId: external.id,
		timeout_ms: limits.budget_ms
	});
};

/** One page of the sweep, read one (account, asset) pair at a time so a slow or
 * broken ledger costs only its own reads. */
const sweepAccounts = async ({
	adapter,
	chainAssets,
	limits
}: {
	adapter: ChainAdapter;
	chainAssets: Asset[];
	limits: WatchLimits;
}): Promise<void> => {
	const { chain } = adapter;
	const after = await readSweepCursor(chain);
	const page = await userAccountsAfter({ chain, after, limit: limits.maxAccounts });
	// Past the last account: this tick starts the next sweep. Accounts created
	// behind the cursor are picked up there too.
	const accounts =
		page.length === 0 && after !== NIL_UUID
			? await userAccountsAfter({ chain, after: NIL_UUID, limit: limits.maxAccounts })
			: page;

	if (accounts.length === 0) {
		return;
	}

	const external = await ensureInternalAccount({ kind: 'external', chain, address: 'external' });
	const reads = accounts.flatMap((account) => chainAssets.map((asset) => ({ account, asset })));
	const deadline_ms = Date.now() + limits.budget_ms;
	const failures = new Map<string, { count: number; first: unknown }>();
	// A timeout stops waiting, not the call, which a canister query cannot cancel.
	// An asset that stopped answering gets no more reads this tick, or the calls
	// left running would climb past `concurrency`. Its balances wait for the next
	// sweep, and the other assets carry on.
	const stalled = new Set<string>();
	let started = 0;

	const runRead = async ({ account, asset }: (typeof reads)[number]): Promise<void> => {
		try {
			await watchAndCredit({
				adapter,
				accounts: [account],
				assets: [asset],
				externalId: external.id,
				timeout_ms: limits.readTimeout_ms
			});
		} catch (err) {
			if (err instanceof WatchTimeoutError) {
				stalled.add(asset.symbol);
			}

			const seen = failures.get(asset.symbol);

			failures.set(asset.symbol, {
				count: (seen?.count ?? 0) + 1,
				first: seen?.first ?? err
			});
		}
	};

	const runReads = async (): Promise<void> => {
		while (Date.now() < deadline_ms) {
			const read = reads[started];

			if (isNullish(read)) {
				return;
			}

			started += 1;

			if (!stalled.has(read.asset.symbol)) {
				await runRead(read);
			}
		}
	};

	await Promise.all(Array.from({ length: limits.concurrency }, runReads));

	// Summarised per asset: a ledger that is down fails every read of a page.
	for (const [symbol, { count, first }] of failures) {
		logger.error(`deposit watcher for ${chain}: ${count} ${symbol} read(s) failed:`, first);
	}

	if (started < reads.length) {
		logger.warn(`deposit watcher for ${chain} hit its budget at ${started}/${reads.length} reads`);
	}

	// Only accounts with every read started count as done, so a tick cut short
	// resumes without skipping one.
	const done = accounts[Math.floor(started / chainAssets.length) - 1];

	if (nonNullish(done)) {
		await writeSweepCursor({ chain, cursor: done.id });
	}
};

/** One watcher pass over every enabled adapter. Failures are isolated per
 * chain so one flaky RPC cannot stall the others. */
export const tickDepositWatchers = async ({
	adapters = enabledAdapters(),
	limits = DEFAULT_WATCH_LIMITS
}: { adapters?: ChainAdapter[]; limits?: WatchLimits } = {}): Promise<void> => {
	const assets = await listEnabledAssets();

	for (const adapter of adapters) {
		const chainAssets: Asset[] = assets.filter(
			(asset) => asset.chain === adapter.chain && !isVxp(asset)
		);

		if (chainAssets.length > 0) {
			try {
				const watch = adapter.watchScope === 'chain' ? watchWholeChain : sweepAccounts;

				await watch({ adapter, chainAssets, limits });
			} catch (err) {
				logger.error(`deposit watcher for ${adapter.chain} failed:`, err);
			}
		}
	}
};

export const hasEnabledWatchers = (): boolean => nonNullish(enabledAdapters()[0]);
