// Custody wallet surface: balances, per-chain deposit addresses and
// withdrawals (including the self-custody exit). Session-gated throughout; a
// chain whose adapter is unconfigured answers a stable 503 body.

import { isNullish, nonNullish } from '@dfinity/utils';
import { Elysia, t } from 'elysia';
import { requireUser, unauthenticated } from '../auth/guard';
import { getAdapter, isChain } from '../chains/registry';
import { ChainDisabledError } from '../chains/types';
import { ensureUserAccount, listUserAccounts } from '../custody/accounts';
import { getAssetById, listEnabledAssets } from '../custody/assets';
import {
	InsufficientBalanceError,
	listUserWithdrawals,
	requestWithdrawal,
	transitionWithdrawal,
	type Withdrawal
} from '../custody/withdrawals';
import { query } from '../db/client';
import { ZERO } from '../lib/constants';
import { userIcPrincipalText } from '../lib/keys';
import { logger } from '../lib/logger';

interface BalanceRow {
	asset_id: string;
	symbol: string;
	chain: string;
	decimals: number;
	balance: string;
}

interface StatusContext {
	status?: number | string;
}

const chainUnavailable = (set: StatusContext): { error: string } => {
	set.status = 503;

	return { error: 'chain_unavailable' };
};

const badRequest = (set: StatusContext, error: string): { error: string } => {
	set.status = 400;

	return { error };
};

const shapeWithdrawal = (withdrawal: Withdrawal): Record<string, unknown> => ({
	id: withdrawal.id,
	assetId: withdrawal.asset_id,
	amount: withdrawal.amount,
	destination: withdrawal.destination,
	selfCustody: withdrawal.self_custody,
	state: withdrawal.state,
	txRef: withdrawal.tx_ref,
	failureReason: withdrawal.failure_reason
});

/** Best-effort immediate execution of a fresh withdrawal. Failures land the
 * row in `failed` with the hold refunded; the request itself never throws
 * past the state machine. */
const executeWithdrawal = async (withdrawal: Withdrawal): Promise<Withdrawal> => {
	const asset = await getAssetById(withdrawal.asset_id);

	if (isNullish(asset)) {
		return withdrawal;
	}

	const processing = await transitionWithdrawal({
		id: withdrawal.id,
		from: 'requested',
		to: 'processing'
	});

	if (isNullish(processing)) {
		return withdrawal;
	}

	try {
		const adapter = getAdapter(asset.chain);
		const txRef = await adapter.transfer({
			fromUserId: withdrawal.user_id,
			to: withdrawal.destination,
			amount: BigInt(withdrawal.amount),
			asset
		});

		return (
			(await transitionWithdrawal({
				id: withdrawal.id,
				from: 'processing',
				to: 'submitted',
				txRef
			})) ?? processing
		);
	} catch (err) {
		logger.error(`withdrawal ${withdrawal.id} execution failed:`, err);

		return (
			(await transitionWithdrawal({
				id: withdrawal.id,
				from: 'processing',
				to: 'failed',
				failureReason: err instanceof Error ? err.message : 'transfer failed'
			})) ?? processing
		);
	}
};

/** The ic balances straight from the ledgers: awards land there with no ledger
 * entry and sweeps into clearing post none, so the internal books can neither
 * see these funds nor see them leave. Uncached on purpose: the sweep sizes its
 * deposit from this read and re-reads right after one, so any TTL long enough
 * to spare its 10s poll would hand it a balance already spent. An unreadable
 * asset is left out rather than reported as an empty one. */
const liveIcBalances = async (address: string): Promise<BalanceRow[]> => {
	const adapter = getAdapter('ic');
	const assets = (await listEnabledAssets()).filter(({ chain }) => chain === 'ic');

	const reads = await Promise.all(
		assets.map(async (asset): Promise<BalanceRow | undefined> => {
			try {
				const balance = await adapter.getBalance({ address, asset });

				return {
					asset_id: asset.id,
					symbol: asset.symbol,
					chain: asset.chain,
					decimals: asset.decimals,
					balance: balance.toString()
				};
			} catch (err: unknown) {
				logger.error(`wallet balance read failed for ${asset.symbol} of ${address}:`, err);
			}
		})
	);

	return reads.filter(nonNullish);
};

export const walletRoutes = new Elysia({ prefix: '/api/v1/wallet' })
	.get('/assets', async () => {
		const assets = await listEnabledAssets();

		return {
			assets: assets.map((asset) => ({
				id: asset.id,
				chain: asset.chain,
				symbol: asset.symbol,
				decimals: asset.decimals,
				chainEnabled: getAdapter(asset.chain).enabled
			}))
		};
	})
	.get('/balances', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		const address = userIcPrincipalText(user.id);

		await ensureUserAccount({ userId: user.id, chain: 'ic', address });

		const [accounts, internalBalances, icBalances] = await Promise.all([
			listUserAccounts(user.id),
			query<BalanceRow>(
				`select b.asset_id, a.symbol, a.chain, a.decimals, b.balance::text as balance
				 from custody_balances b
				 join assets a on a.id = b.asset_id
				 join custody_accounts c on c.id = b.account_id
				 where c.user_id = $1 and a.chain <> 'ic'
				 order by a.chain, a.symbol`,
				[user.id]
			),
			liveIcBalances(address)
		]);

		return {
			accounts: accounts.map((account) => ({ chain: account.chain, address: account.address })),
			balances: [...internalBalances, ...icBalances].map((row) => ({
				assetId: row.asset_id,
				symbol: row.symbol,
				chain: row.chain,
				decimals: row.decimals,
				balance: row.balance
			}))
		};
	})
	.get('/deposit-address/:chain', async ({ request, set, params }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		if (!isChain(params.chain)) {
			return badRequest(set, 'unknown_chain');
		}

		const adapter = getAdapter(params.chain);

		if (!adapter.enabled) {
			return chainUnavailable(set);
		}

		const account = await ensureUserAccount({
			userId: user.id,
			chain: params.chain,
			address: adapter.deriveAddress(user.id)
		});

		return { chain: account.chain, address: account.address };
	})
	.get('/withdrawals', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		const withdrawals = await listUserWithdrawals(user.id);

		return { withdrawals: withdrawals.map(shapeWithdrawal) };
	})
	.post(
		'/withdrawals',
		async ({ request, set, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			const asset = await getAssetById(body.assetId);

			if (isNullish(asset) || !asset.enabled) {
				return badRequest(set, 'unknown_asset');
			}

			const adapter = getAdapter(asset.chain);

			if (!adapter.enabled) {
				return chainUnavailable(set);
			}

			if (!/^\d+$/.test(body.amount)) {
				return badRequest(set, 'invalid_amount');
			}

			const amount = BigInt(body.amount);

			if (amount <= ZERO) {
				return badRequest(set, 'invalid_amount');
			}

			try {
				const withdrawal = await requestWithdrawal({
					userId: user.id,
					asset,
					amount,
					destination: body.destination,
					selfCustody: body.selfCustody ?? false,
					userAddress: adapter.deriveAddress(user.id)
				});
				const executed = await executeWithdrawal(withdrawal);

				set.status = 201;

				return { withdrawal: shapeWithdrawal(executed) };
			} catch (err) {
				if (err instanceof InsufficientBalanceError) {
					return badRequest(set, 'insufficient_balance');
				}

				if (err instanceof ChainDisabledError) {
					return chainUnavailable(set);
				}

				throw err;
			}
		},
		{
			body: t.Object({
				assetId: t.String(),
				/** Base-unit amount as a decimal string. */
				amount: t.String(),
				destination: t.String({ minLength: 1, maxLength: 256 }),
				selfCustody: t.Optional(t.Boolean())
			})
		}
	);
