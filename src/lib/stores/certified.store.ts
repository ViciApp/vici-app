import type { MarketId } from '#lib/types/market.ts';
import { nonNullish } from '@dfinity/utils';
import { writable, type Readable, type Writable } from 'svelte/store';

export type WritableUpdateStore<T, Id extends string = MarketId> = Pick<
	Writable<CertifiedStoreData<T, Id>>,
	'update'
>;

export type CertifiedStoreData<T, Id extends string = MarketId> = Record<Id, T | null> | undefined;

export interface CertifiedStore<T, Id extends string = MarketId> extends Readable<
	CertifiedStoreData<T, Id>
> {
	reset: (id: Id) => void;
	reinitialize: () => void;
}

export const initCertifiedStore = <T, Id extends string = MarketId>(): CertifiedStore<T, Id> &
	WritableUpdateStore<T, Id> => {
	const { update, subscribe, set } = writable<CertifiedStoreData<T, Id>>(undefined);

	return {
		update,
		subscribe,
		reset: (id: Id) =>
			update(
				(state) =>
					({
						...(nonNullish(state) && state),
						[id]: null
					}) as CertifiedStoreData<T, Id>
			),
		reinitialize: () => set(undefined)
	};
};
