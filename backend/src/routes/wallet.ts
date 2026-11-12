// Custody wallet surface: balances, per-chain deposit addresses and
// withdrawals (including the self-custody exit). Session-gated throughout; a
// chain whose adapter is unconfigured answers a stable 503 body.

import { isNullish, nonNullish } from '@dfinity/utils';
import { Elysia, t } from 'elysia';
import { requireUser, unauthenticated } from '../auth/guard';
import { getAdapter, isChain } from '../chains/registry';
import { ChainDisabledError } from '../chains/types';
import { executeWithdrawal } from '../chains/withdrawal-execution';
import { ensureUserAccount, listUserAccounts } from '../custody/accounts';
import { getAssetById, isWithdrawable, listEnabledAssets, type Asset } from '../custody/assets';
import { listUserBookBalances, type AssetBalanceRow } from '../custody/ledger';
import {
	AssetNotWithdrawableError,
	InsufficientBalanceError,
	listUserWithdrawals,
	requestWithdrawal,
	type Withdrawal
} from '../custody/withdrawals';
import { cached } from '../engine/cache';
import { ZERO } from '../lib/constants';
import { badRequest, serviceUnavailable, type StatusContext } from '../lib/http';
import { userIcPrincipalText } from '../lib/keys';
import { logger } from '../lib/logger';

const chainUnavailable = (set: StatusContext): { error: string } =>
	serviceUnavailable(set, 'chain_unavailable');

const shapeWithdrawal = (withdrawal: Withdrawal): Record<string, unknown> => ({
	id: withdrawal.id,
	assetId: withdrawal.asset_id,
	amount: withdrawal.amount,
	fee: withdrawal.fee,
	destination: withdrawal.destination,
	selfCustody: withdrawal.self_custody,
	state: withdrawal.state,
	txRef: withdrawal.tx_ref,
	failureReason: withdrawal.failure_reason
});

/** The ic balances straight from the ledgers: awards land there with no ledger
 * entry and sweeps into clearing post none, so the internal books can neither
 * see these funds nor see them leave. Uncached on purpose: the sweep sizes its
 * deposit from this read and re-reads right after one, so any TTL long enough
 * to spare its 10s poll would hand it a balance already spent. An unreadable
 * asset is left out rather than reported as an empty one. */
const liveIcBalances = async (address: string): Promise<AssetBalanceRow[]> => {
	const adapter = getAdapter('ic');
	const assets = (await listEnabledAssets()).filter(({ chain }) => chain === 'ic');

	const reads = await Promise.all(
		assets.map(async (asset): Promise<AssetBalanceRow | undefined> => {
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

/** For display only: a withdrawal reads its own fee when it is requested.
 * Cached because the catalog is a public read. Null for an asset that cannot
 * be withdrawn now, or whose fee could not be read. */
const displayedWithdrawalFee = async (asset: Asset): Promise<string | null> => {
	const adapter = getAdapter(asset.chain);

	if (!adapter.enabled || !isWithdrawable(asset)) {
		return null;
	}

	try {
		const fee = await cached({
			key: `withdrawal-fee:${asset.id}`,
			ttlMs: 60_000,
			load: () => adapter.withdrawalFee({ asset })
		});

		return fee.toString();
	} catch (err: unknown) {
		logger.error(`withdrawal fee read failed for ${asset.chain}:${asset.symbol}:`, err);

		return null;
	}
};

export const walletRoutes = new Elysia({ prefix: '/api/v1/wallet' })
	.get('/assets', async () => {
		const assets = await listEnabledAssets();

		return {
			assets: await Promise.all(
				assets.map(async (asset) => ({
					id: asset.id,
					chain: asset.chain,
					symbol: asset.symbol,
					decimals: asset.decimals,
					chainEnabled: getAdapter(asset.chain).enabled,
					withdrawable: isWithdrawable(asset),
					withdrawalFee: await displayedWithdrawalFee(asset)
				}))
			)
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
			listUserBookBalances(user.id),
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

			// Refused before the fee read: an asset that never leaves the platform
			// has no fee worth asking its chain for.
			if (!isWithdrawable(asset)) {
				return badRequest(set, 'asset_not_withdrawable');
			}

			let fee: bigint;

			try {
				// Read fresh, not from the catalog's cache: this is the fee the hold
				// covers and every send of the withdrawal carries.
				fee = await adapter.withdrawalFee({ asset });
			} catch (err: unknown) {
				logger.error(`withdrawal fee read failed for ${asset.chain}:${asset.symbol}:`, err);

				return chainUnavailable(set);
			}

			try {
				const withdrawal = await requestWithdrawal({
					userId: user.id,
					asset,
					amount,
					fee,
					destination: body.destination,
					selfCustody: body.selfCustody ?? false,
					userAddress: adapter.deriveAddress(user.id)
				});
				// Best-effort first attempt: whatever it leaves unsettled, the
				// withdrawal-recovery job picks up. The hold is already committed, so
				// a throw here must still answer with the row: a 500 invites the
				// client to file a second withdrawal.
				const executed = await executeWithdrawal({ withdrawal, asset, adapter }).catch(
					(err: unknown) => {
						logger.error(`withdrawal ${withdrawal.id} first attempt failed:`, err);

						return withdrawal;
					}
				);

				set.status = 201;

				return { withdrawal: shapeWithdrawal(executed) };
			} catch (err) {
				if (err instanceof AssetNotWithdrawableError) {
					return badRequest(set, 'asset_not_withdrawable');
				}

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
