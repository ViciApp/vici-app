import type { Token } from '#lib/types/token.ts';
import { parseTokenId } from '#lib/validation/token.validation.ts';

export const USD_ASSET: Token = {
	id: parseTokenId('USD'),
	symbol: 'USD',
	decimals: 2,
	ledgerCanisterId: ''
};
