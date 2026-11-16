// Shared plumbing for the ETL scripts: the satellite admin identity and
// connection config, the resumable cursor stores (DB-backed for the drains,
// file-backed for the raw export), JSONL IO and the run report printer.

import { isNullish, nonNullish } from '@dfinity/utils';
import type { SignIdentity } from '@icp-sdk/core/agent';
import { Ed25519KeyIdentity } from '@icp-sdk/core/identity';
import { Secp256k1KeyIdentity } from '@icp-sdk/core/identity/secp256k1';
import {
	appendFileSync,
	createReadStream,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync
} from 'node:fs';
import { createInterface } from 'node:readline';
import { query, type TxQuery } from '../../src/db/client';

// ---------------------------------------------------------------------------
// Collections

/**
 * Every datastore collection the legacy satellite configures, mirroring the
 * app's collection constants (a test cross-checks this list against
 * juno.collections.json so drift fails loudly). The export drains all of
 * them; the importer maps each one explicitly (including documented skips).
 */
export const SATELLITE_COLLECTIONS = [
	'roles',
	'profiles',
	'profile_private',
	'relations',
	'chats',
	'comments',
	'market_metadata',
	'market_tag_index',
	'market_translations',
	'activities',
	'activity_reactions',
	'activity_reaction_counts',
	'resolved_results',
	'vxp_onboarding',
	'vxp_awards',
	'calibration_attempts',
	'referral_codes',
	'referrals',
	'leagues',
	'league_members',
	'battles',
	'affiliations',
	'affiliation_stats',
	'exit_signals',
	'tournaments',
	'tournament_matches',
	'league_stats',
	'user_stats',
	'user_monthly_stats',
	'school_submissions',
	'schools',
	'app_config',
	'events',
	'event_rollups'
] as const;

export type SatelliteCollection = (typeof SATELLITE_COLLECTIONS)[number];

// ---------------------------------------------------------------------------
// Identity + satellite config

const PEM_BODY = (pem: string): Uint8Array => {
	const body = pem
		.replace(/-----BEGIN [^-]+-----/g, '')
		.replace(/-----END [^-]+-----/g, '')
		.replace(/\s+/g, '');

	return Uint8Array.from(Buffer.from(body, 'base64'));
};

/** DER-encoded OID 1.3.101.112 (Ed25519), the discriminator between the two
 * supported key kinds inside a PKCS#8 PEM. */
const ED25519_OID = [0x06, 0x03, 0x2b, 0x65, 0x70];

const matchesAt = (haystack: Uint8Array, needle: number[], offset: number): boolean =>
	needle.every((byte, j) => haystack[offset + j] === byte);

const indexOfBytes = (haystack: Uint8Array, needle: number[]): number => {
	for (let i = 0; i + needle.length <= haystack.length; i++) {
		if (matchesAt(haystack, needle, i)) {
			return i;
		}
	}

	return -1;
};

/**
 * Load a signing identity from a PEM file: PKCS#8 Ed25519 (the 32-byte seed
 * sits inside the nested OCTET STRING) or secp256k1 (SEC1 or PKCS#8, parsed
 * by the identity class itself).
 */
export const identityFromPemFile = (path: string): SignIdentity => {
	const pem = readFileSync(path, 'utf8');
	const der = PEM_BODY(pem);

	if (indexOfBytes(der, ED25519_OID) >= 0) {
		// PKCS#8 v1 Ed25519 layout nests the seed as 04 22 04 20 <32 bytes>.
		const marker = indexOfBytes(der, [0x04, 0x22, 0x04, 0x20]);

		if (marker < 0 || marker + 4 + 32 > der.length) {
			throw new Error(`Unsupported Ed25519 PEM layout in ${path}`);
		}

		return Ed25519KeyIdentity.fromSecretKey(der.slice(marker + 4, marker + 4 + 32));
	}

	return Secp256k1KeyIdentity.fromPem(pem);
};

export interface EtlSatelliteConfig {
	identity: SignIdentity;
	satelliteId: string;
	/** Local emulator URL when set; unset targets the production satellite. */
	container?: string;
}

const requireEnv = (name: string): string => {
	const value = process.env[name] ?? '';

	if (value === '') {
		throw new Error(`Missing required env var: ${name}`);
	}

	return value;
};

/** The admin identity + satellite target every satellite-facing script uses:
 * ETL_SATELLITE_PEM (path to the key file), ETL_SATELLITE_ID, and the
 * optional ETL_SATELLITE_CONTAINER emulator URL. */
export const loadSatelliteConfig = (): EtlSatelliteConfig => {
	const container = process.env.ETL_SATELLITE_CONTAINER ?? '';

	return {
		identity: identityFromPemFile(requireEnv('ETL_SATELLITE_PEM')),
		satelliteId: requireEnv('ETL_SATELLITE_ID'),
		...(container !== '' && { container })
	};
};

// ---------------------------------------------------------------------------
// DB-backed cursors (drain scripts)

export const getCursor = async ({
	id,
	q = query
}: {
	id: string;
	q?: TxQuery;
}): Promise<string | undefined> => {
	const rows = await q<{ cursor: string }>(`select cursor from etl_cursors where id = $1`, [id]);

	return rows[0]?.cursor;
};

export const setCursor = async ({
	id,
	cursor,
	q = query
}: {
	id: string;
	cursor: string;
	q?: TxQuery;
}): Promise<void> => {
	await q(
		`insert into etl_cursors (id, cursor) values ($1, $2)
		 on conflict (id) do update set cursor = excluded.cursor, updated_at = now()`,
		[id, cursor]
	);
};

export const clearCursor = async ({
	id,
	q = query
}: {
	id: string;
	q?: TxQuery;
}): Promise<void> => {
	await q(`delete from etl_cursors where id = $1`, [id]);
};

// ---------------------------------------------------------------------------
// File-backed cursors (raw export)

/** Sentinel stored in a cursor file once a collection's walk completed. */
export const CURSOR_DONE = 'done';

export const cursorFilePath = ({ dir, collection }: { dir: string; collection: string }): string =>
	`${dir}/${collection}.cursor`;

export const readCursorFile = ({
	dir,
	collection
}: {
	dir: string;
	collection: string;
}): string | undefined => {
	const path = cursorFilePath({ dir, collection });

	if (!existsSync(path)) {
		return;
	}

	const value = readFileSync(path, 'utf8').trim();

	if (value === '') {
		return;
	}

	return value;
};

export const writeCursorFile = ({
	dir,
	collection,
	cursor
}: {
	dir: string;
	collection: string;
	cursor: string;
}): void => {
	mkdirSync(dir, { recursive: true });
	writeFileSync(cursorFilePath({ dir, collection }), `${cursor}\n`);
};

// ---------------------------------------------------------------------------
// JSONL IO

/** One exported datastore doc, as serialized to JSONL: system bigints become
 * decimal strings, the payload stays the raw doc data. */
export interface ExportedDoc {
	key: string;
	description?: string;
	owner?: string;
	createdAtNs?: string;
	updatedAtNs?: string;
	version?: string;
	data: unknown;
}

const bigintsToStrings = (value: unknown): unknown =>
	JSON.parse(JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)));

export const toExportedDoc = ({
	key,
	description,
	owner,
	created_at,
	updated_at,
	version,
	data
}: {
	key: string;
	description?: string;
	owner?: string;
	created_at?: bigint;
	updated_at?: bigint;
	version?: bigint;
	data: unknown;
}): ExportedDoc => ({
	key,
	...(nonNullish(description) && { description }),
	...(nonNullish(owner) && { owner }),
	...(nonNullish(created_at) && { createdAtNs: created_at.toString() }),
	...(nonNullish(updated_at) && { updatedAtNs: updated_at.toString() }),
	...(nonNullish(version) && { version: version.toString() }),
	data: bigintsToStrings(data)
});

export const jsonlFilePath = ({ dir, collection }: { dir: string; collection: string }): string =>
	`${dir}/${collection}.jsonl`;

export const appendJsonlLines = ({
	dir,
	collection,
	docs
}: {
	dir: string;
	collection: string;
	docs: ExportedDoc[];
}): void => {
	mkdirSync(dir, { recursive: true });
	appendFileSync(
		jsonlFilePath({ dir, collection }),
		docs.map((doc) => `${JSON.stringify(doc)}\n`).join('')
	);
};

export const readJsonl = async function* ({
	dir,
	collection
}: {
	dir: string;
	collection: string;
}): AsyncGenerator<ExportedDoc> {
	const path = jsonlFilePath({ dir, collection });

	if (!existsSync(path)) {
		return;
	}

	const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });

	for await (const line of lines) {
		const trimmed = line.trim();

		if (trimmed !== '') {
			yield JSON.parse(trimmed) as ExportedDoc;
		}
	}
};

export const readJsonlAll = async ({
	dir,
	collection
}: {
	dir: string;
	collection: string;
}): Promise<ExportedDoc[]> => {
	const docs: ExportedDoc[] = [];

	for await (const doc of readJsonl({ dir, collection })) {
		docs.push(doc);
	}

	return docs;
};

export const countJsonlLines = async ({
	dir,
	collection
}: {
	dir: string;
	collection: string;
}): Promise<number> => {
	let count = 0;

	for await (const _doc of readJsonl({ dir, collection })) {
		void _doc;
		count += 1;
	}

	return count;
};

// ---------------------------------------------------------------------------
// Timestamps

/** Datastore system timestamps are ns; the tables store ms. */
export const msFromNs = (ns: string | undefined): number | undefined =>
	isNullish(ns) ? undefined : Number(BigInt(ns) / 1_000_000n);

// ---------------------------------------------------------------------------
// Reporting

/** Minimal fixed-width table printer for the script summaries. */
export const printTable = (rows: string[][]): void => {
	const widths = rows.reduce<number[]>((acc, row) => {
		row.forEach((cell, i) => {
			acc[i] = Math.max(acc[i] ?? 0, cell.length);
		});

		return acc;
	}, []);

	for (const row of rows) {
		console.log(row.map((cell, i) => cell.padEnd(widths[i] ?? cell.length)).join('  '));
	}
};
