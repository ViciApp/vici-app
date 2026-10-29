// Vendored candid bindings for the on-chain engine (clearing + registry) and
// the legacy satellite (used only by the ETL drain tooling). The clearing/**,
// registry/** and satellite/** files are verbatim copies of the app's
// generated bindings: never hand-edit them here. `npm run did` re-copies
// clearing/** and registry/**; satellite/** is re-copied by hand after
// `npm run juno:functions:build`.
//
//   idlFactory*          : plain factories (query calls execute as queries).
//   idlFactoryCertified* : query/composite_query stripped, so every method is
//                          issued as a signed update call with a certified
//                          response. Used for the write paths.

import { idlFactory as idlFactoryCertifiedClearing } from './clearing/clearing.certified.idl.js';
import { idlFactory as idlFactoryClearing } from './clearing/clearing.idl.js';
import { idlFactory as idlFactoryCertifiedRegistry } from './registry/registry.certified.idl.js';
import { idlFactory as idlFactoryRegistry } from './registry/registry.idl.js';
import { idlFactory as idlFactorySatellite } from './satellite/satellite.factory.did.js';

import type * as ClearingDid from './clearing/clearing';
import type { _SERVICE as ClearingService } from './clearing/clearing';
import type * as RegistryDid from './registry/registry';
import type { _SERVICE as RegistryService } from './registry/registry';
import type * as SatelliteDid from './satellite/satellite.did';
import type { _SERVICE as SatelliteService } from './satellite/satellite.did';

export {
	idlFactoryCertifiedClearing,
	idlFactoryCertifiedRegistry,
	idlFactoryClearing,
	idlFactoryRegistry,
	idlFactorySatellite,
	type ClearingDid,
	type ClearingService,
	type RegistryDid,
	type RegistryService,
	type SatelliteDid,
	type SatelliteService
};
