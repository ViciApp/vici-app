/**
 * Prints the ledger id the app pins for a token, so shell scripts read it from
 * the one place it is written.
 *
 * Usage: npx tsx scripts/lib/ledger-id.ts <icp|vxp> [vite-mode]
 *
 * The VXP ledger can be overridden at build time, and `import.meta.env` does
 * not exist under tsx, so the id is resolved from the env Vite loads for
 * `vite-mode` (default `production`, the mode of `npm run build`): the
 * `VITE_*` variables of the shell and of the project's `.env` files.
 */
import {
	ICP_LEDGER_CANISTER_ID,
	vxpLedgerCanisterIdFor
} from '#lib/constants/canisters.constants.ts';
import { nonNullish } from '@dfinity/utils';
import { loadEnv } from 'vite';

const LEDGERS = {
	icp: () => ICP_LEDGER_CANISTER_ID,
	vxp: (mode: string) => vxpLedgerCanisterIdFor(loadEnv(mode, process.cwd(), 'VITE_'))
} as const;

type Token = keyof typeof LEDGERS;

const isToken = (value: string | undefined): value is Token =>
	nonNullish(value) && Object.hasOwn(LEDGERS, value);

const [token, mode = 'production'] = process.argv.slice(2);

if (!isToken(token)) {
	console.error(
		`Usage: npx tsx scripts/lib/ledger-id.ts <${Object.keys(LEDGERS).join('|')}> [vite-mode]`
	);
	process.exit(1);
}

console.log(LEDGERS[token](mode));
