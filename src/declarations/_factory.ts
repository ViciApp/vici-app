import { idlFactory as idlFactoryClearing } from '#declarations/clearing/clearing.idl.js';
import { idlFactory as idlFactoryRegistry } from '#declarations/registry/registry.idl.js';

import { idlFactory as idlFactoryCertifiedClearing } from '#declarations/clearing/clearing.certified.idl.js';
import { idlFactory as idlFactoryCertifiedRegistry } from '#declarations/registry/registry.certified.idl.js';

import type { _SERVICE as ClearingService } from '#declarations/clearing/clearing.d.ts';
import type { _SERVICE as RegistryService } from '#declarations/registry/registry.d.ts';

export {
	idlFactoryCertifiedClearing,
	idlFactoryCertifiedRegistry,
	idlFactoryClearing,
	idlFactoryRegistry,
	type ClearingService,
	type RegistryService
};
