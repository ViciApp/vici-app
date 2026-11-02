// The asset catalog as the migrations really leave it, and the repair migration
// replayed over the rows production holds. The ids are pinned as literals on
// purpose: a value that merely parses is not enough, since the bad ckETH id's
// bytes are a real canister, the ckETH minter.

import { Principal } from '@icp-sdk/core/principal';
import { beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { query } from '../src/db/client';
import { ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

const CKBTC_LEDGER = 'mxzaz-hqaaa-aaaar-qaada-cai';
const CKETH_LEDGER = 'ss2fx-dyaaa-aaaar-qacoq-cai';
const BAD_CKBTC_LEDGER = 'mxz4u-wiaaa-aaaar-qaada-cai';
const BAD_CKETH_LEDGER = 'ss2fx-dyaaa-aaaar-qacoa-cai';

const REPAIR_SQL = readFileSync(
	join(import.meta.dir, '../src/db/migrations/0014_fix_ck_ledger_refs.sql'),
	'utf8'
);

const setLedgerRef = async ({
	symbol,
	ledgerRef
}: {
	symbol: string;
	ledgerRef: string;
}): Promise<void> => {
	await query(`update assets set ledger_ref = $1 where chain = 'ic' and symbol = $2`, [
		ledgerRef,
		symbol
	]);
};

const ledgerRefOf = async (symbol: string): Promise<string | null | undefined> => {
	const rows = await query<{ ledger_ref: string | null }>(
		`select ledger_ref from assets where chain = 'ic' and symbol = $1`,
		[symbol]
	);

	return rows[0]?.ledger_ref;
};

const restoreCorrectIds = async (): Promise<void> => {
	await setLedgerRef({ symbol: 'ckBTC', ledgerRef: CKBTC_LEDGER });
	await setLedgerRef({ symbol: 'ckETH', ledgerRef: CKETH_LEDGER });
};

describe.if(dbAvailable)('custody asset catalog', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('every migrated ic asset carries a valid principal', async () => {
		const rows = await query<{ symbol: string; ledger_ref: string }>(
			`select symbol, ledger_ref from assets where chain = 'ic'`
		);

		expect(rows.map(({ symbol }) => symbol).sort()).toEqual(
			['ICP', 'VXP', 'ckBTC', 'ckETH', 'ckUSDC'].sort()
		);

		for (const { ledger_ref: ledgerRef } of rows) {
			expect(Principal.fromText(ledgerRef).toText()).toBe(ledgerRef);
		}
	});

	test('ckBTC and ckETH point at their mainnet ledgers', async () => {
		expect(await ledgerRefOf('ckBTC')).toBe(CKBTC_LEDGER);
		expect(await ledgerRefOf('ckETH')).toBe(CKETH_LEDGER);
	});

	test('the repair rewrites the bad rows and is a no-op on replay', async () => {
		try {
			await setLedgerRef({ symbol: 'ckBTC', ledgerRef: BAD_CKBTC_LEDGER });
			await setLedgerRef({ symbol: 'ckETH', ledgerRef: BAD_CKETH_LEDGER });

			await query(REPAIR_SQL);
			await query(REPAIR_SQL);

			expect(await ledgerRefOf('ckBTC')).toBe(CKBTC_LEDGER);
			expect(await ledgerRefOf('ckETH')).toBe(CKETH_LEDGER);
		} finally {
			await restoreCorrectIds();
		}
	});

	test('the repair leaves a row alone unless it holds the bad value', async () => {
		const correctedByHand = 'aaaaa-aa';

		try {
			await setLedgerRef({ symbol: 'ckBTC', ledgerRef: correctedByHand });
			await setLedgerRef({ symbol: 'ckETH', ledgerRef: correctedByHand });

			await query(REPAIR_SQL);

			expect(await ledgerRefOf('ckBTC')).toBe(correctedByHand);
			expect(await ledgerRefOf('ckETH')).toBe(correctedByHand);
		} finally {
			await restoreCorrectIds();
		}
	});
});
