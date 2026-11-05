import type { ClearingDid } from '#declarations';
import { initCertifiedStore } from '#lib/stores/certified.store.ts';

export const orderBookStore = initCertifiedStore<ClearingDid.LimitOrder[], string>();
