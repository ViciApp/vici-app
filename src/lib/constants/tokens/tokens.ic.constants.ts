import {
	CHAT_LEDGER_CANISTER_ID,
	CKBTC_LEDGER_CANISTER_ID,
	CKETH_LEDGER_CANISTER_ID,
	CKUSDC_LEDGER_CANISTER_ID,
	GHOST_LEDGER_CANISTER_ID,
	ICP_LEDGER_CANISTER_ID,
	TESTICP_LEDGER_CANISTER_ID,
	TICRC1_LEDGER_CANISTER_ID,
	VICI_LEDGER_CANISTER_ID,
	VXP_LEDGER_CANISTER_ID
} from '#lib/constants/canisters.constants.ts';
import { isDev } from '#lib/env/app.env.ts';
import type { Token } from '#lib/types/token.ts';
import { parseTokenId } from '#lib/validation/token.validation.ts';

export const ICP_TOKEN: Token = {
	id: parseTokenId('ICP'),
	symbol: 'ICP',
	decimals: 8,
	ledgerCanisterId: ICP_LEDGER_CANISTER_ID,
	isDevEnabled: true
};

export const TESTICP_TOKEN: Token = {
	id: parseTokenId('TESTICP'),
	symbol: 'TESTICP',
	decimals: 8,
	ledgerCanisterId: TESTICP_LEDGER_CANISTER_ID
};

export const TICRC1_TOKEN: Token = {
	id: parseTokenId('TICRC1'),
	symbol: 'TICRC1',
	decimals: 8,
	ledgerCanisterId: TICRC1_LEDGER_CANISTER_ID
};

export const VXP_TOKEN: Token = {
	id: parseTokenId('VXP'),
	symbol: 'VXP',
	decimals: 4,
	ledgerCanisterId: VXP_LEDGER_CANISTER_ID,
	isDevEnabled: true
};

export const VICI_TOKEN: Token = {
	id: parseTokenId('VICI'),
	symbol: 'VICI',
	decimals: 8,
	ledgerCanisterId: VICI_LEDGER_CANISTER_ID,
	isDevEnabled: true
};

export const CKUSDC_TOKEN: Token = {
	id: parseTokenId('ckUSDC'),
	symbol: 'ckUSDC',
	decimals: 6,
	ledgerCanisterId: CKUSDC_LEDGER_CANISTER_ID,
	isDevEnabled: true
};

export const CKBTC_TOKEN: Token = {
	id: parseTokenId('ckBTC'),
	symbol: 'ckBTC',
	decimals: 8,
	ledgerCanisterId: CKBTC_LEDGER_CANISTER_ID,
	disabled: true
};

export const CKETH_TOKEN: Token = {
	id: parseTokenId('ckETH'),
	symbol: 'ckETH',
	decimals: 18,
	ledgerCanisterId: CKETH_LEDGER_CANISTER_ID,
	disabled: true
};

export const CHAT_TOKEN: Token = {
	id: parseTokenId('CHAT'),
	symbol: 'CHAT',
	decimals: 8,
	ledgerCanisterId: CHAT_LEDGER_CANISTER_ID,
	disabled: true
};

export const GHOST_TOKEN: Token = {
	id: parseTokenId('GHOST'),
	symbol: 'GHOST',
	decimals: 8,
	ledgerCanisterId: GHOST_LEDGER_CANISTER_ID,
	disabled: true
};

export const SUPPORTED_TOKENS: Token[] = [
	ICP_TOKEN,
	TESTICP_TOKEN,
	TICRC1_TOKEN,
	VXP_TOKEN,
	VICI_TOKEN,
	CKUSDC_TOKEN,
	CKBTC_TOKEN,
	CKETH_TOKEN,
	CHAT_TOKEN,
	GHOST_TOKEN
].filter(({ disabled, isDevEnabled }) => !disabled && (!isDev() || (isDevEnabled ?? false)));
