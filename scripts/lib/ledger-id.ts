/**
 * Prints the ledger id the app pins for a token, so shell scripts read it from
 * the one place it is written.
 *
 * Usage: npx tsx scripts/lib/ledger-id.ts <icp|vxp>
 */
import {
	ICP_LEDGER_CANISTER_ID,
	VXP_LEDGER_CANISTER_ID
} from '#lib/constants/canisters.constants.ts';
import { nonNullish } from '@dfinity/utils';

const LEDGERS = {
	icp: ICP_LEDGER_CANISTER_ID,
	vxp: VXP_LEDGER_CANISTER_ID
} as const;

type Token = keyof typeof LEDGERS;

const isToken = (value: string | undefined): value is Token =>
	nonNullish(value) && Object.hasOwn(LEDGERS, value);

const [token] = process.argv.slice(2);

if (!isToken(token)) {
	console.error(`Usage: npx tsx scripts/lib/ledger-id.ts <${Object.keys(LEDGERS).join('|')}>`);
	process.exit(1);
}

console.log(LEDGERS[token]);
