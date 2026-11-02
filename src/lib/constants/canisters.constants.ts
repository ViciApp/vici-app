import { Principal } from '@icp-sdk/core/principal';

export const CLEARING_CANISTER_ID = Principal.fromText('g2or7-caaaa-aaaaj-qqhoa-cai');

export const REGISTRY_CANISTER_ID = Principal.fromText('g5pxl-pyaaa-aaaaj-qqhoq-cai');

export const ICP_LEDGER_CANISTER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
export const ICP_INDEX_CANISTER_ID = 'qhbym-qaaaa-aaaaa-aaafq-cai';

export const CKUSDC_LEDGER_CANISTER_ID = 'xevnm-gaaaa-aaaar-qafnq-cai';
export const CKUSDC_INDEX_CANISTER_ID = 'xrs4b-hiaaa-aaaar-qafoa-cai';

export const CKBTC_LEDGER_CANISTER_ID = 'mxzaz-hqaaa-aaaar-qaada-cai';
export const CKETH_LEDGER_CANISTER_ID = 'ss2fx-dyaaa-aaaar-qacoq-cai';
export const CHAT_LEDGER_CANISTER_ID = '2ouvw-qaaaa-aaaag-qacaa-cai';
export const GHOST_LEDGER_CANISTER_ID = '4c4fd-caaaa-aaaaq-aaaqa-cai';

export const TESTICP_LEDGER_CANISTER_ID = 'xafvr-biaaa-aaaai-aql5q-cai';

export const TICRC1_LEDGER_CANISTER_ID = '3jkp5-oyaaa-aaaaj-azwqa-cai';

const viteEnvString = (key: string): string | undefined => {
	if (typeof import.meta === 'undefined') {
		return;
	}

	return (import.meta as ImportMeta & { env?: Record<string, string> }).env?.[key];
};

/**
 * VXP / VICI canister ids default to mainnet. For a local replica, override
 * via `VITE_VXP_LEDGER_CANISTER_ID`, `VITE_VXP_INDEX_CANISTER_ID`, and
 * `VITE_VICI_LEDGER_CANISTER_ID` — the VXP ledger override must also match
 * the satellite bundle (see the vxp-onboarding hook), and the VXP index
 * override must match `dfx.json` `vxp_index.specified_id`.
 */
export const VXP_LEDGER_CANISTER_ID_DEFAULT = 's7ux4-yyaaa-aaaam-qidha-cai';

export const VXP_INDEX_CANISTER_ID_DEFAULT = 'swx4a-oqaaa-aaaam-qidgq-cai';

export const VXP_LEDGER_CANISTER_ID =
	viteEnvString('VITE_VXP_LEDGER_CANISTER_ID') ?? VXP_LEDGER_CANISTER_ID_DEFAULT;

export const VXP_INDEX_CANISTER_ID =
	viteEnvString('VITE_VXP_INDEX_CANISTER_ID') ?? VXP_INDEX_CANISTER_ID_DEFAULT;

export const VICI_LEDGER_CANISTER_ID =
	viteEnvString('VITE_VICI_LEDGER_CANISTER_ID') ?? 'zpaik-yaaaa-aaaam-qiczq-cai';
