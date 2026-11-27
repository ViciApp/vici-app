// Vendored candid bindings for the on-chain engine (clearing + registry). The
// clearing/** and registry/** files are verbatim copies of the app's generated
// bindings, re-copied by `npm run did`: never hand-edit them here.
//
//   idlFactory*          : plain factories (query calls execute as queries).
//   idlFactoryCertified* : query/composite_query stripped, so every method is
//                          issued as a signed update call with a certified
//                          response. Used for the write paths.

import { idlFactory as idlFactoryCertifiedClearing } from './clearing/clearing.certified.idl.js';
import { idlFactory as idlFactoryClearing } from './clearing/clearing.idl.js';
import { idlFactory as idlFactoryCertifiedRegistry } from './registry/registry.certified.idl.js';
import { idlFactory as idlFactoryRegistry } from './registry/registry.idl.js';

import type * as ClearingDid from './clearing/clearing';
import type { _SERVICE as ClearingService } from './clearing/clearing';
import type * as RegistryDid from './registry/registry';
import type { _SERVICE as RegistryService } from './registry/registry';

export {
	idlFactoryCertifiedClearing,
	idlFactoryCertifiedRegistry,
	idlFactoryClearing,
	idlFactoryRegistry,
	type ClearingDid,
	type ClearingService,
	type RegistryDid,
	type RegistryService
};
