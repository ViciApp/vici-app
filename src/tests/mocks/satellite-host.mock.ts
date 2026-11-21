import type { ClearingDid } from '#declarations';
import { MILLISECOND_IN_NANOSECONDS } from '#lib/constants/time.constants.ts';
import junoConfig from '#root/juno.config.ts';
import { candidMethod } from '#satellite/utils/candid.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import type {
	AssertDeleteAssetContext,
	AssertDeleteDocContext,
	AssertSetDocContext,
	AssertUploadAssetContext,
	Asset,
	DelDoc,
	Doc,
	ListParams,
	ListResults,
	SetDoc
} from '@junobuild/functions';
import type { AccessKeys } from '@junobuild/functions/sdk';

/**
 * The one in-memory Juno satellite host for specs under Node, which has no
 * satellite host. The SDK's `getDocStore` / `listDocsStore` / `countDocsStore`
 * / `setDocStore` / `deleteDocStore`,
 * `decodeDocData` / `encodeDocData`, `msgCaller`, `time`, Juno's `Math.random`,
 * `getAdminAccessKeys` and `call` are thin wrappers over host globals; this
 * defines those globals over a map of docs and a table of canister method
 * handlers. An assert spec builds its context with {@link setContext} /
 * {@link deleteContext}; a service spec drives the real service end to end.
 * Hooks never run on a host write, and asserts only when the spec installs
 * them: seed only docs the real asserts would accept. Each collection's
 * `controllers` rule in `juno.config.ts` holds as Juno applies it to the
 * caller a service passes: anyone else reads nothing of a `read:
 * 'controllers'` collection and is refused a write to a `write:
 * 'controllers'` one.
 */

export const controller = Principal.fromUint8Array(new Uint8Array([1, 1, 1]));

export const docBytes = (doc: object): Uint8Array<ArrayBuffer> =>
	new TextEncoder().encode(JSON.stringify(doc));

interface StoredDoc {
	owner: Uint8Array;
	data: Uint8Array;
	description?: string;
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

const storedAsset = ({
	collection,
	fullPath,
	owner,
	headers
}: {
	collection: string;
	fullPath: string;
	owner: Principal;
	headers: [string, string][];
}): Asset => ({
	key: {
		name: fullPath.split('/').pop() ?? fullPath,
		full_path: fullPath,
		collection,
		owner: owner.toUint8Array()
	},
	headers,
	encodings: [],
	created_at: 1n,
	updated_at: 1n,
	version: 1n
});

/**
 * An `assertUploadAsset` context: `caller` commits `fullPath` in `collection`
 * with `contentType`, over an existing asset when `currentOwner` is given.
 */
export const uploadAssetContext = ({
	caller,
	collection,
	fullPath,
	contentType,
	currentOwner
}: {
	caller: Principal;
	collection: string;
	fullPath: string;
	contentType: string;
	currentOwner?: Principal;
}): AssertUploadAssetContext => {
	const headers: [string, string][] = [['Content-Type', contentType]];
	const { key } = storedAsset({ collection, fullPath, owner: caller, headers });

	return {
		caller: caller.toUint8Array(),
		data: {
			current: nonNullish(currentOwner)
				? storedAsset({ collection, fullPath, owner: currentOwner, headers })
				: undefined,
			batch: { key, expires_at: 1n },
			commit_batch: { batch_id: 1n, headers, chunk_ids: [1n] }
		}
	};
};

/** An `assertDeleteAsset` context: `caller` deletes `fullPath`, uploaded by `owner`. */
export const deleteAssetContext = ({
	caller,
	collection,
	fullPath,
	owner = caller
}: {
	caller: Principal;
	collection: string;
	fullPath: string;
	owner?: Principal;
}): AssertDeleteAssetContext => ({
	caller: caller.toUint8Array(),
	data: storedAsset({ collection, fullPath, owner, headers: [] })
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

const controllersRuled = (rule: 'read' | 'write'): ReadonlySet<string> =>
	new Set(
		(junoConfig({ mode: 'production' }).satellite.collections?.datastore ?? [])
			.filter((collection) => collection[rule] === 'controllers')
			.map(({ collection }) => collection)
	);

const controllersRead = controllersRuled('read');
const controllersWrite = controllersRuled('write');

const isController = (caller: Uint8Array): boolean =>
	Principal.fromUint8Array(caller).compareTo(controller) === 'eq';

const readable = ({ caller, name }: { caller: Uint8Array; name: string }): boolean =>
	!controllersRead.has(name) || isController(caller);

const assertWritable = ({ caller, name }: { caller: Uint8Array; name: string }): void => {
	if (controllersWrite.has(name) && !isController(caller)) {
		throw new Error(`${name}: caller not allowed to write.`);
	}
};

const toDoc = (stored: StoredDoc): Doc => ({ ...stored });

/** The satellite's own set / delete asserts, run on host writes as Juno runs them. */
export interface HostAsserts {
	set?: (context: AssertSetDocContext) => void;
	remove?: (context: AssertDeleteDocContext) => void;
}

/**
 * Defines the host globals the SDK calls. `docs` (with their `createdAtNs`)
 * seed the datastore that `getDocStore` / `listDocsStore` read and
 * `setDocStore` writes, versioned as Juno does. With `asserts`, every
 * `setDocStore` / `deleteDocStore` first runs them with the caller it was
 * given, as Juno does for a serverless write.
 */
export const installSatelliteHost = ({
	docs = {},
	createdAtNs = {},
	asserts = {}
}: {
	docs?: HostDocs;
	createdAtNs?: HostCreatedAtNs;
	asserts?: HostAsserts;
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

	/** The docs `listDocsStore` and `countDocsStore` answer: the key and description matchers and the owner filter. */
	const listed = ({ name, params }: { name: string; params: ListParams }): [string, Doc][] => {
		const matcher = params.matcher?.key;
		const keyMatches = nonNullish(matcher) ? new RegExp(matcher) : undefined;
		const descriptionMatcher = params.matcher?.description;
		const descriptionMatches = nonNullish(descriptionMatcher)
			? new RegExp(descriptionMatcher)
			: undefined;
		const owner = nonNullish(params.owner) ? Principal.fromUint8Array(params.owner) : undefined;

		return [...collection(name)]
			.filter(([key]) => isNullish(keyMatches) || keyMatches.test(key))
			.filter(
				([, { description }]) =>
					isNullish(descriptionMatches) || descriptionMatches.test(description ?? '')
			)
			.filter(
				([, stored]) =>
					isNullish(owner) || Principal.fromUint8Array(stored.owner).compareTo(owner) === 'eq'
			)
			.map(([key, stored]) => [key, toDoc(stored)]);
	};

	/**
	 * Juno's page of the listed docs: key order (its datastore is a B-tree on the key), the docs
	 * after `start_after`, at most `limit` of them. A `start_after` naming no listed key answers an
	 * empty page with no `items_page`, as Juno does.
	 */
	const paginated = ({
		matches,
		params
	}: {
		matches: [string, Doc][];
		params: ListParams;
	}): ListResults<Doc> => {
		const matchesLength = BigInt(matches.length);
		const { paginate } = params;

		if (isNullish(paginate)) {
			return { items: matches, items_length: matchesLength, matches_length: matchesLength };
		}

		const ordered = [...matches].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		const startAfter = paginate.start_after;
		const afterIndex = isNullish(startAfter)
			? -1
			: ordered.findIndex(([key]) => key === startAfter);

		if (nonNullish(startAfter) && afterIndex < 0) {
			return { items: [], items_length: BigInt(0), matches_length: matchesLength };
		}

		const start = afterIndex + 1;
		const limit = isNullish(paginate.limit) ? undefined : Number(paginate.limit);
		const items = ordered.slice(start, isNullish(limit) ? undefined : start + limit);

		return {
			items,
			items_length: BigInt(items.length),
			items_page: isNullish(limit) || limit === 0 ? undefined : BigInt(Math.floor(start / limit)),
			matches_length: matchesLength
		};
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
		// The satellite's console polyfill prints through this; specs stay quiet.
		__ic_cdk_print: (): void => undefined,
		__juno_satellite_random: (): number => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0,
		__juno_satellite_get_admin_access_keys: (): AccessKeys => [
			[controller.toUint8Array(), { metadata: [], created_at: 1n, updated_at: 1n, scope: 'admin' }]
		],
		__juno_satellite_datastore_raw_data_to_text: (data: Uint8Array): string =>
			new TextDecoder().decode(data),
		__juno_satellite_datastore_raw_data_from_text: (text: string): Uint8Array => encodeText(text),
		// eslint-disable-next-line local-rules/prefer-object-params -- the SDK calls this host function positionally
		__juno_satellite_datastore_get_doc_store: (
			reader: Uint8Array,
			name: string,
			key: string
		): Doc | undefined => {
			const stored = readable({ caller: reader, name }) ? collection(name).get(key) : undefined;

			return isNullish(stored) ? undefined : toDoc(stored);
		},
		// eslint-disable-next-line local-rules/prefer-object-params -- the SDK calls this host function positionally
		__juno_satellite_datastore_list_docs_store: (
			reader: Uint8Array,
			name: string,
			params: ListParams
		): ListResults<Doc> => {
			const matches = readable({ caller: reader, name }) ? listed({ name, params }) : [];

			return paginated({ matches, params });
		},
		// eslint-disable-next-line local-rules/prefer-object-params -- the SDK calls this host function positionally
		__juno_satellite_datastore_count_docs_store: (
			reader: Uint8Array,
			name: string,
			params: ListParams
		): bigint =>
			readable({ caller: reader, name }) ? BigInt(listed({ name, params }).length) : BigInt(0),
		// eslint-disable-next-line local-rules/prefer-object-params -- the SDK calls this host function positionally
		__juno_satellite_datastore_set_doc_store: (
			setter: Uint8Array,
			name: string,
			key: string,
			value: SetDoc
		) => {
			assertWritable({ caller: setter, name });

			const before = collection(name).get(key);

			asserts.set?.({
				caller: setter,
				data: {
					collection: name,
					key,
					data: {
						current: isNullish(before) ? undefined : toDoc(before),
						proposed: { data: value.data, version: value.version }
					}
				}
			});

			if (nonNullish(before) && value.version !== before.version) {
				throw new Error(
					`${name}/${key}: version ${value.version} does not match ${before.version}.`
				);
			}

			const after: StoredDoc = {
				owner: before?.owner ?? setter,
				data: value.data,
				description: value.description,
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
		__juno_satellite_datastore_delete_doc_store: (
			remover: Uint8Array,
			name: string,
			key: string,
			value: DelDoc
		): Doc | undefined => {
			assertWritable({ caller: remover, name });

			const before = collection(name).get(key);

			if (nonNullish(before)) {
				asserts.remove?.({
					caller: remover,
					data: {
						collection: name,
						key,
						data: { current: toDoc(before), proposed: { version: value.version } }
					}
				});
			}

			if (nonNullish(before) && value.version !== before.version) {
				throw new Error(
					`${name}/${key}: version ${value.version} does not match ${before.version}.`
				);
			}

			collection(name).delete(key);

			return isNullish(before) ? undefined : toDoc(before);
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
