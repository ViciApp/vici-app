// Asset catalog access + the env-driven enabled allowlist. The migration
// seeds the rows; env decides at boot which are live, so enabling an asset in
// production is a config change, not a schema change.

import { isNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import { query } from '../db/client';
import { env } from '../env';
import type { Chain } from '../lib/keys';
import { logger } from '../lib/logger';

export interface Asset {
	id: string;
	chain: Chain;
	symbol: string;
	decimals: number;
	ledger_ref: string | null;
	enabled: boolean;
}

/** Re-apply the CUSTODY_ENABLED_ASSETS allowlist to the assets table.
 * Entries are `symbol` or `chain:symbol` (case-insensitive); an unset env
 * keeps the default of every ic asset enabled and the other chains disabled. */
export const applyAssetAllowlist = async (): Promise<void> => {
	const allowlist = env.custodyEnabledAssets;

	if (isNullish(allowlist)) {
		await query(`update assets set enabled = (chain = 'ic')`);

		return;
	}

	const symbols: string[] = [];
	const chainSymbols: string[] = [];

	for (const entry of allowlist) {
		const separator = entry.indexOf(':');

		if (separator === -1) {
			symbols.push(entry.toLowerCase());
		} else {
			chainSymbols.push(entry.toLowerCase());
		}
	}

	await query(
		`update assets
		 set enabled = (lower(symbol) = any($1::text[]) or lower(chain || ':' || symbol) = any($2::text[]))`,
		[symbols, chainSymbols]
	);
};

const reportedInvalidLedgers = new Set<string>();

/** An ic ledger id that does not parse can never be read. Left in, the row
 * fails each wallet balance request and aborts each watcher pass for the whole
 * chain. Dropping it here contains that to the one asset, and reporting once
 * per process keeps a real fault visible without the log scaling with traffic. */
const hasValidLedgerRef = (asset: Asset): boolean => {
	if (asset.chain !== 'ic') {
		return true;
	}

	try {
		Principal.fromText(asset.ledger_ref ?? '');

		return true;
	} catch (err: unknown) {
		if (!reportedInvalidLedgers.has(asset.id)) {
			reportedInvalidLedgers.add(asset.id);
			logger.error(`ic asset ${asset.symbol} left out of the catalog: invalid ledger id`, err);
		}

		return false;
	}
};

export const listEnabledAssets = async (): Promise<Asset[]> => {
	const assets = await query<Asset>(
		`select id, chain, symbol, decimals, ledger_ref, enabled
		 from assets where enabled order by chain, symbol`
	);

	return assets.filter(hasValidLedgerRef);
};

export const getAssetById = async (id: string): Promise<Asset | null> => {
	const rows = await query<Asset>(
		`select id, chain, symbol, decimals, ledger_ref, enabled from assets where id = $1`,
		[id]
	);

	return rows[0] ?? null;
};

export const getAssetBySymbol = async ({
	chain,
	symbol
}: {
	chain: Chain;
	symbol: string;
}): Promise<Asset | null> => {
	const rows = await query<Asset>(
		`select id, chain, symbol, decimals, ledger_ref, enabled
		 from assets where chain = $1 and lower(symbol) = lower($2)`,
		[chain, symbol]
	);

	return rows[0] ?? null;
};
