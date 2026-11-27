import {
	idlFactoryCertifiedClearing,
	idlFactoryClearing,
	type ClearingDid,
	type ClearingService
} from '#declarations';
import type { CreateCanisterOptions } from '#lib/types/canister.ts';
import { Canister, createServices, type QueryParams } from '@dfinity/utils';

/**
 * The client's one direct clearing read: the public order book. Every other
 * engine read and write rides the HTTP API.
 */
export class ClearingCanister extends Canister<ClearingService> {
	static create(options: CreateCanisterOptions<ClearingService>) {
		const { service, certifiedService, canisterId } = createServices<ClearingService>({
			options,
			idlFactory: idlFactoryClearing,
			certifiedIdlFactory: idlFactoryCertifiedClearing
		});

		return new ClearingCanister(canisterId, service, certifiedService);
	}

	listOrders = async ({
		params,
		...queryParams
	}: {
		params: ClearingDid.ListOrdersParams;
	} & QueryParams): Promise<ClearingDid.LimitOrder[]> => {
		const { list_orders } = this.caller(queryParams);

		return await list_orders(params);
	};
}
