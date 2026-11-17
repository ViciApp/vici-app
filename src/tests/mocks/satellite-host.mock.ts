import { Principal } from '@icp-sdk/core/principal';
import type { AssertDeleteDocContext, AssertSetDocContext } from '@junobuild/functions';
import type { AccessKeys } from '@junobuild/functions/sdk';

/**
 * Host stand-ins for satellite asserts under Node, which has no satellite
 * host: the IC clock behind `time()`, the access-key list behind
 * `getAdminAccessKeys()`, the codec behind `decodeDocData` / `encodeDocData`,
 * and an in-memory datastore behind `getDocStore` / `setDocStore`.
 */

export const controller = Principal.fromUint8Array(new Uint8Array([1, 1, 1]));

export const docBytes = (doc: object): Uint8Array<ArrayBuffer> =>
	new TextEncoder().encode(JSON.stringify(doc));

interface StoredDoc {
	owner: Uint8Array;
	data: Uint8Array<ArrayBuffer>;
	created_at: bigint;
	updated_at: bigint;
	version: bigint;
}

export const storedDoc = ({
	data,
	owner,
	createdAtNs = 1n
}: {
	data: object;
	owner: Principal;
	createdAtNs?: bigint;
}): StoredDoc => ({
	owner: owner.toUint8Array(),
	data: docBytes(data),
	created_at: createdAtNs,
	updated_at: createdAtNs,
	version: 1n
});

export const setContext = ({
	caller,
	collection,
	key,
	proposed,
	current,
	currentOwner = caller
}: {
	caller: Principal;
	collection: string;
	key: string;
	proposed: object;
	current?: object;
	currentOwner?: Principal;
}): AssertSetDocContext => ({
	caller: caller.toUint8Array(),
	data: {
		collection,
		key,
		data: {
			current: current && storedDoc({ data: current, owner: currentOwner }),
			proposed: { data: docBytes(proposed), version: current && 1n }
		}
	}
});

export const deleteContext = ({
	caller,
	collection,
	key,
	current,
	currentOwner = caller
}: {
	caller: Principal;
	collection: string;
	key: string;
	current: object;
	currentOwner?: Principal;
}): AssertDeleteDocContext => ({
	caller: caller.toUint8Array(),
	data: {
		collection,
		key,
		data: {
			current: storedDoc({ data: current, owner: currentOwner }),
			proposed: { version: 1n }
		}
	}
});

/** Docs readable through `getDocStore`, by collection then key. */
export type HostDocs = Record<string, Record<string, object>>;

/** The stored `created_at` of some of those docs, same shape; 1 ns otherwise. */
export type HostCreatedAtNs = Record<string, Record<string, bigint>>;

/** The host clock, fixed so a spec can place `created_at` stamps around it. */
export const hostNowMs = 1_800_000_000_000;

/** The installed host. */
export interface SatelliteHost {
	/** A stored doc's decoded data, or nothing. */
	readDoc: <T>({ collection, key }: { collection: string; key: string }) => T | undefined;
	/** Remove every global the host defined. */
	restore: () => void;
}

/**
 * Defines the host globals the SDK calls. `docs` seeds the datastore
 * `getDocStore` reads, and `setDocStore` writes into it.
 */
export const installSatelliteHost = ({
	docs = {},
	createdAtNs = {}
}: {
	docs?: HostDocs;
	createdAtNs?: HostCreatedAtNs;
} = {}): SatelliteHost => {
	const globals = {
		__ic_cdk_time: (): bigint => BigInt(hostNowMs) * 1_000_000n,
		__juno_satellite_get_admin_access_keys: (): AccessKeys => [
			[controller.toUint8Array(), { metadata: [], created_at: 1n, updated_at: 1n, scope: 'admin' }]
		],
		__juno_satellite_datastore_raw_data_to_text: (data: Uint8Array): string =>
			new TextDecoder().decode(data),
		// eslint-disable-next-line local-rules/prefer-object-params -- the SDK calls this host function positionally
		__juno_satellite_datastore_get_doc_store: (
			_caller: unknown,
			collection: string,
			key: string
		): StoredDoc | undefined => {
			const data = docs[collection]?.[key];

			return (
				data && storedDoc({ data, owner: controller, createdAtNs: createdAtNs[collection]?.[key] })
			);
		},
		__juno_satellite_datastore_raw_data_from_text: (text: string): Uint8Array =>
			new TextEncoder().encode(text),
		// eslint-disable-next-line local-rules/prefer-object-params -- the SDK calls this host function positionally
		__juno_satellite_datastore_set_doc_store: (
			_caller: unknown,
			collection: string,
			key: string,
			{ data }: { data: Uint8Array }
		): void => {
			docs[collection] = {
				...docs[collection],
				[key]: JSON.parse(new TextDecoder().decode(data)) as object
			};
		}
	};

	for (const [name, value] of Object.entries(globals)) {
		Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
	}

	return {
		readDoc: <T>({ collection, key }: { collection: string; key: string }) =>
			docs[collection]?.[key] as T | undefined,
		restore: () => {
			for (const name of Object.keys(globals)) {
				Reflect.deleteProperty(globalThis, name);
			}
		}
	};
};
