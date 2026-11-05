import { initCertifiedStore } from '#lib/stores/certified.store.ts';
import type { ClearingDid } from '$declarations';

export const orderBookStore = initCertifiedStore<ClearingDid.LimitOrder[], string>();
