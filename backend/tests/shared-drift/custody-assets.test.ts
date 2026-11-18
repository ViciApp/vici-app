import { isNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { VXP_DECIMALS } from '../../src/vxp/constants';
import {
	extractStringConst,
	readRepoFile,
	readRepoSource,
	REPO_ROOT
} from '../helpers/repo-source';

const MIGRATIONS_DIR = 'backend/src/db/migrations';

// The IC asset seeds hardcode mainnet ledger canister ids that the app declares
// in canisters.constants.ts. Applied migrations are immutable, so a seed is
// corrected by a later update: what a database ends up with is the insert in
// 0003_custody.sql overlaid with those updates in file order, and that is what
// gets compared here. The SQL is parsed with narrow regexes; the app constants
// module value-imports an IC SDK, so its ids are pinned by static extraction.
describe('shared drift: custody asset seeds', () => {
	const migrations = readdirSync(join(REPO_ROOT, MIGRATIONS_DIR))
		.filter((file) => file.endsWith('.sql'))
		.sort()
		.map((file) => readRepoFile(`${MIGRATIONS_DIR}/${file}`).toString('utf8'));

	const seeds = new Map(
		migrations
			.flatMap((sql) => [...sql.matchAll(/\('ic',\s*'([^']+)',\s*(\d+),\s*'([^']+)',/g)])
			.map((match) => [match[1], { decimals: Number(match[2]), ledgerRef: match[3] }])
	);

	for (const sql of migrations) {
		const corrections = sql.matchAll(
			/update assets\s+set ledger_ref = '([^']+)'\s+where chain = 'ic' and symbol = '([^']+)'/g
		);

		for (const [, ledgerRef, symbol] of corrections) {
			const seed = seeds.get(symbol ?? '');

			if (isNullish(seed)) {
				throw new Error(`migration corrects an unseeded ic asset: ${symbol}`);
			}

			seed.ledgerRef = ledgerRef;
		}
	}

	const canisters = readRepoSource('src/lib/constants/canisters.constants.ts');

	const APP_LEDGER_CONSTS: Record<string, string> = {
		VXP: 'VXP_LEDGER_CANISTER_ID_DEFAULT',
		ICP: 'ICP_LEDGER_CANISTER_ID',
		ckUSDC: 'CKUSDC_LEDGER_CANISTER_ID',
		ckBTC: 'CKBTC_LEDGER_CANISTER_ID',
		ckETH: 'CKETH_LEDGER_CANISTER_ID'
	};

	test('every seeded IC asset carries the ledger id the app declares', () => {
		expect([...seeds.keys()].sort()).toEqual(Object.keys(APP_LEDGER_CONSTS).sort());

		for (const [symbol, constName] of Object.entries(APP_LEDGER_CONSTS)) {
			expect(seeds.get(symbol)?.ledgerRef).toBe(
				extractStringConst({ source: canisters, constName })
			);
		}
	});

	// Agreement alone proves nothing: the two sides can match on the same typo.
	test('every seeded IC ledger id is a valid principal', () => {
		for (const { ledgerRef } of seeds.values()) {
			expect(Principal.fromText(ledgerRef ?? '').toText()).toBe(ledgerRef ?? '');
		}
	});

	test('the seeded VXP decimals match VXP_DECIMALS', () => {
		expect(seeds.get('VXP')?.decimals).toBe(VXP_DECIMALS);
	});
});
