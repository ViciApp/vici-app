import type { ClearingDid } from '#declarations';
import { MILLISECOND_IN_NANOSECONDS } from '#lib/constants/time.constants.ts';
import { candidMethod } from '#satellite/utils/candid.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import type {
	AssertDeleteDocContext,
	AssertSetDocContext,
	Doc,
	ListParams,
	ListResults,
	SetDoc
} from '@junobuild/functions';
import type { AccessKeys } from '@junobuild/functions/sdk';

/**
 * The one in-memory Juno satellite host for specs under Node, which has no
 * satellite host. The SDK's `getDocStore` / `listDocsStore` / `setDocStore`,
 * `decodeDocData` / `encodeDocData`, `msgCaller`, `time`,
 * `getAdminAccessKeys` and `call` are thin wrappers over host globals; this
 * defines those globals over a map of docs and a table of canister method
 * handlers. An assert spec builds its context with {@link setContext} /
 * {@link deleteContext}; a service spec drives the real service end to end.
 * Asserts and hooks do not run on a host write: seed only docs the real
 * asserts would accept.
 */

export const controller = Principal.fromUint8Array(new Uint8Array([1, 1, 1]));

export const docBytes = (doc: object): Uint8Array<ArrayBuffer> =>
	new TextEncoder().encode(JSON.stringify(doc));

interface StoredDoc {
	owner: Uint8Array;
	data: Uint8Array;
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

/** Docs to seed the datastore with, by collection then key, owned by {@link controller}. */
export type HostDocs = Record<string, Record<string, object>>;

/** The stored `created_at` of some of those docs, same shape; 1 ns otherwise. */
export type HostCreatedAtNs = Record<string, Record<string, bigint>>;

/** The host clock until a spec sets it, so a spec can place `created_at` stamps around it. */
export const hostNowMs = 1_800_000_000_000;

interface CanisterMethod {
	argTypes: IDL.Type[];
	result: IDL.Type;
	handler: (args: unknown[]) => unknown;
}

/** The installed host. */
export interface SatelliteHost {
	/** The principal `msgCaller()` returns ({@link controller} until set). */
	setCaller: (caller: Principal) => void;
	/** The IC time `time()` returns, in ms ({@link hostNowMs} until set). */
	setNowMs: (nowMs: number) => void;
	/** Store a doc as it would be after a write at `createdAtMs` (default: now). */
	putDoc: (doc: {
		collection: string;
		key: string;
		data: object;
		owner: Principal;
		createdAtMs?: number;
	}) => void;
	/** A stored doc's decoded data, or nothing. */
	readDoc: <T>({ collection, key }: { collection: string; key: string }) => T | undefined;
	/** The keys stored in a collection. */
	keys: (collection: string) => string[];
	/** Answer `method` on any canister: `handler` gets the decoded arguments and
	 * returns the value encoded with `result`. */
	onCall: ({ method, argTypes, result, handler }: CanisterMethod & { method: string }) => void;
	/** Every canister method called, in order. */
	calls: () => string[];
	/** Remove every global the host defined. */
	restore: () => void;
}

const encodeText = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);

const toDoc = (stored: StoredDoc): Doc => ({ ...stored });

/**
 * Defines the host globals the SDK calls. `docs` (with their `createdAtNs`)
 * seed the datastore that `getDocStore` / `listDocsStore` read and
 * `setDocStore` writes, versioned as Juno does.
 */
export const installSatelliteHost = ({
	docs = {},
	createdAtNs = {}
}: {
	docs?: HostDocs;
	createdAtNs?: HostCreatedAtNs;
} = {}): SatelliteHost => {
	const collections = new Map<string, Map<string, StoredDoc>>();
	const methods = new Map<string, CanisterMethod>();
	const called: string[] = [];
	let caller = controller;
	let nowNs = BigInt(hostNowMs) * MILLISECOND_IN_NANOSECONDS;

	const collection = (name: string): Map<string, StoredDoc> => {
		const existing = collections.get(name);

		if (nonNullish(existing)) {
			return existing;
		}

		const created = new Map<string, StoredDoc>();
		collections.set(name, created);

		return created;
	};

	for (const [name, seeded] of Object.entries(docs)) {
		for (const [key, data] of Object.entries(seeded)) {
			collection(name).set(
				key,
				storedDoc({ data, owner: controller, createdAtNs: createdAtNs[name]?.[key] })
			);
		}
	}

	const globals: Record<string, unknown> = {
		__ic_cdk_caller: (): Uint8Array => caller.toUint8Array(),
		__ic_cdk_id: (): Uint8Array => controller.toUint8Array(),
		__ic_cdk_time: (): bigint => nowNs,
		__juno_satellite_get_admin_access_keys: (): AccessKeys => [
			[controller.toUint8Array(), { metadata: [], created_at: 1n, updated_at: 1n, scope: 'admin' }]
		],
		__juno_satellite_datastore_raw_data_to_text: (data: Uint8Array): string =>
			new TextDecoder().decode(data),
		__juno_satellite_datastore_raw_data_from_text: (text: string): Uint8Array => encodeText(text),
		// eslint-disable-next-line local-rules/prefer-object-params -- the SDK calls this host function positionally
		__juno_satellite_datastore_get_doc_store: (
			_caller: Uint8Array,
			name: string,
			key: string
		): Doc | undefined => {
			const stored = collection(name).get(key);

			return isNullish(stored) ? undefined : toDoc(stored);
		},
		// eslint-disable-next-line local-rules/prefer-object-params -- the SDK calls this host function positionally
		__juno_satellite_datastore_list_docs_store: (
			_caller: Uint8Array,
			name: string,
			params: ListParams
		): ListResults<Doc> => {
			const matcher = params.matcher?.key;
			const keyMatches = nonNullish(matcher) ? new RegExp(matcher) : undefined;
			const items: [string, Doc][] = [...collection(name)]
				.filter(([key]) => isNullish(keyMatches) || keyMatches.test(key))
				.map(([key, stored]) => [key, toDoc(stored)]);
			const length = BigInt(items.length);

			return { items, items_length: length, matches_length: length };
		},
		// eslint-disable-next-line local-rules/prefer-object-params -- the SDK calls this host function positionally
		__juno_satellite_datastore_set_doc_store: (
			setter: Uint8Array,
			name: string,
			key: string,
			value: SetDoc
		) => {
			const before = collection(name).get(key);

			if (nonNullish(before) && value.version !== before.version) {
				throw new Error(
					`${name}/${key}: version ${value.version} does not match ${before.version}.`
				);
			}

			const after: StoredDoc = {
				owner: before?.owner ?? setter,
				data: value.data,
				created_at: before?.created_at ?? nowNs,
				updated_at: nowNs,
				version: (before?.version ?? BigInt(0)) + BigInt(1)
			};

			collection(name).set(key, after);

			return {
				key,
				collection: name,
				data: { before: isNullish(before) ? undefined : toDoc(before), after: toDoc(after) }
			};
		},
		// eslint-disable-next-line local-rules/prefer-object-params -- the SDK calls this host function positionally
		__ic_cdk_call_raw: (
			_canisterId: Uint8Array,
			method: string,
			args: Uint8Array
		): Promise<Uint8Array> => {
			called.push(method);

			const entry = methods.get(method);

			if (isNullish(entry)) {
				return Promise.reject(new Error(`No handler for canister method "${method}".`));
			}

			const decoded = IDL.decode(entry.argTypes, args);

			return Promise.resolve(new Uint8Array(IDL.encode([entry.result], [entry.handler(decoded)])));
		}
	};

	for (const [name, value] of Object.entries(globals)) {
		Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
	}

	return {
		setCaller: (next) => {
			caller = next;
		},
		setNowMs: (nowMs) => {
			nowNs = BigInt(nowMs) * MILLISECOND_IN_NANOSECONDS;
		},
		putDoc: ({ collection: name, key, data, owner, createdAtMs }) => {
			const createdNs = nonNullish(createdAtMs)
				? BigInt(createdAtMs) * MILLISECOND_IN_NANOSECONDS
				: nowNs;

			collection(name).set(key, {
				owner: owner.toUint8Array(),
				data: docBytes(data),
				created_at: createdNs,
				updated_at: createdNs,
				version: BigInt(1)
			});
		},
		readDoc: <T>({ collection: name, key }: { collection: string; key: string }) => {
			const stored = collection(name).get(key);

			return isNullish(stored)
				? undefined
				: (JSON.parse(new TextDecoder().decode(stored.data)) as T);
		},
		keys: (name) => [...collection(name).keys()],
		onCall: ({ method, argTypes, result, handler }) => {
			methods.set(method, { argTypes, result, handler });
		},
		calls: () => [...called],
		restore: () => {
			for (const name of Object.keys(globals)) {
				Reflect.deleteProperty(globalThis, name);
			}
		}
	};
};

/** A settled-history record the clearing stand-in answers from. */
export interface MockSettlement {
	principal: Principal;
	atMs: number;
	calls: number;
	wins: number;
}

/**
 * Answer the clearing canister's `aggregate_settlement_accuracy` from
 * `settlements` (read at call time, so a spec may push more later) the way
 * clearing does: only the requested members, only inside the half-open
 * `[from_ts, to_ts)` window.
 */
export const answerSettlementAccuracy = ({
	host,
	settlements
}: {
	host: SatelliteHost;
	settlements: MockSettlement[];
}): void => {
	const { argTypes, result } = candidMethod({
		canister: 'clearing',
		method: 'aggregate_settlement_accuracy'
	});

	host.onCall({
		method: 'aggregate_settlement_accuracy',
		argTypes,
		result,
		handler: ([params]) => {
			const {
				members,
				from_ts: [fromNs],
				to_ts: [toNs]
			} = params as ClearingDid.AggregateSettlementAccuracyParams;
			const wanted = new Set(members.map((member) => member.toText()));
			const entries = new Map<string, ClearingDid.SettlementAccuracyEntry>();

			for (const { principal, atMs, calls, wins } of settlements) {
				const atNs = BigInt(atMs) * MILLISECOND_IN_NANOSECONDS;
				const inWindow = (isNullish(fromNs) || atNs >= fromNs) && (isNullish(toNs) || atNs < toNs);

				if (wanted.has(principal.toText()) && inWindow) {
					const previous = entries.get(principal.toText());

					entries.set(principal.toText(), {
						principal,
						realized_pnl: BigInt(0),
						settled_count: (previous?.settled_count ?? BigInt(0)) + BigInt(calls),
						win_count: (previous?.win_count ?? BigInt(0)) + BigInt(wins)
					});
				}
			}

			return [...entries.values()];
		}
	});
};
