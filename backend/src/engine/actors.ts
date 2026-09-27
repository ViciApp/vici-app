// Actor construction for the on-chain engine (clearing + registry). The one
// module that touches @icp-sdk actor plumbing; the typed wrappers in
// clearing.ts / registry.ts talk to the provider below, and tests swap the
// provider to mock at exactly this boundary.
//
// Three caller kinds:
//   - reader: public reads (list/get series, price history, ...), cached.
//     Signed by a dedicated service principal because clearing rejects the
//     anonymous caller even on its read-only queries.
//   - per-user: the caller's derived custodial identity signs the call, so
//     the engine sees the same principal that owns the user's positions.
//   - admin: the service identity for privileged methods (settlement, oracle
//     and role management). Writes go through the certified factories so
//     every update call gets a certified response.

import { Actor, type Identity } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import {
	idlFactoryCertifiedClearing,
	idlFactoryCertifiedRegistry,
	idlFactoryClearing,
	idlFactoryRegistry,
	type ClearingService,
	type RegistryService
} from '../declarations';
import { env } from '../env';
import { buildAgent } from '../lib/ic-agent';
import { adminIcIdentity, engineReaderIcIdentity, userIcIdentity } from '../lib/keys';

export interface EngineActorProvider {
	clearing(identity: Identity, certified: boolean): Promise<ClearingService>;
	registry(identity: Identity, certified: boolean): Promise<RegistryService>;
}

const defaultProvider: EngineActorProvider = {
	clearing: async (identity, certified) => {
		const agent = await buildAgent(identity);

		return Actor.createActor<ClearingService>(
			certified ? idlFactoryCertifiedClearing : idlFactoryClearing,
			{ agent, canisterId: Principal.fromText(env.ic.clearingCanisterId) }
		);
	},
	registry: async (identity, certified) => {
		const agent = await buildAgent(identity);

		return Actor.createActor<RegistryService>(
			certified ? idlFactoryCertifiedRegistry : idlFactoryRegistry,
			{ agent, canisterId: Principal.fromText(env.ic.registryCanisterId) }
		);
	}
};

let provider: EngineActorProvider = defaultProvider;

/** Swap the actor provider (tests only). Returns a restore function. */
export const setEngineActorProvider = (next: EngineActorProvider): (() => void) => {
	provider = next;

	return () => {
		provider = defaultProvider;
	};
};

export const readerClearing = (): Promise<ClearingService> =>
	provider.clearing(engineReaderIcIdentity(), false);

export const userClearing = (userId: string): Promise<ClearingService> =>
	provider.clearing(userIcIdentity(userId), true);

export const adminClearing = (): Promise<ClearingService> =>
	provider.clearing(adminIcIdentity(), true);

export const readerRegistry = (): Promise<RegistryService> =>
	provider.registry(engineReaderIcIdentity(), false);

export const userRegistry = (userId: string): Promise<RegistryService> =>
	provider.registry(userIcIdentity(userId), true);

export const adminRegistry = (): Promise<RegistryService> =>
	provider.registry(adminIcIdentity(), true);
