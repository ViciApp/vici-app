// Drains every satellite datastore collection into per-collection JSONL
// files under a target directory, via the datastore list API signed with the
// admin identity. Keyset-paged on doc keys and resumable: each collection
// keeps a sidecar cursor file holding the last exported key ('done' once the
// walk completed), so a crashed run appends from where it stopped and a
// finished collection is not re-walked. --fresh wipes the selected
// collections' files first, which is how the cutover delta pass re-exports
// (the importer upserts, so re-importing a full fresh export converges).
//
// Usage: bun run scripts/etl/export-collections.ts [dir] [--fresh] [collection ...]
// Env: ETL_SATELLITE_PEM, ETL_SATELLITE_ID, optional ETL_SATELLITE_CONTAINER.

import { isNullish, nonNullish } from '@dfinity/utils';
import { listDocs } from '@junobuild/core';
import { existsSync, rmSync } from 'node:fs';
import {
	appendJsonlLines,
	CURSOR_DONE,
	cursorFilePath,
	jsonlFilePath,
	loadSatelliteConfig,
	printTable,
	readCursorFile,
	SATELLITE_COLLECTIONS,
	toExportedDoc,
	writeCursorFile,
	type EtlSatelliteConfig
} from './lib';

const PAGE_SIZE = 200;

export interface ExportResult {
	exported: number;
	alreadyDone: boolean;
}

export const exportCollection = async ({
	collection,
	dir,
	satellite,
	pageSize = PAGE_SIZE
}: {
	collection: string;
	dir: string;
	satellite: EtlSatelliteConfig;
	pageSize?: number;
}): Promise<ExportResult> => {
	const cursor = readCursorFile({ dir, collection });

	if (cursor === CURSOR_DONE) {
		return { exported: 0, alreadyDone: true };
	}

	let startAfter = cursor;
	let exported = 0;

	for (;;) {
		const { items } = await listDocs<unknown>({
			collection,
			filter: {
				order: { desc: false, field: 'keys' },
				paginate: {
					...(nonNullish(startAfter) && { startAfter }),
					limit: pageSize
				}
			},
			satellite
		});

		if (items.length === 0) {
			break;
		}

		appendJsonlLines({ dir, collection, docs: items.map(toExportedDoc) });

		const lastKey = items[items.length - 1]?.key;

		if (isNullish(lastKey)) {
			break;
		}

		startAfter = lastKey;
		// The cursor lands only after the page's lines flushed, so a crash
		// between pages re-appends at most one page; the importer's upserts
		// absorb the duplicate lines.
		writeCursorFile({ dir, collection, cursor: lastKey });
		exported += items.length;

		if (items.length < pageSize) {
			break;
		}
	}

	writeCursorFile({ dir, collection, cursor: CURSOR_DONE });

	return { exported, alreadyDone: false };
};

if (import.meta.main) {
	const args = process.argv.slice(2);
	const fresh = args.includes('--fresh');
	const positional = args.filter((arg) => !arg.startsWith('--'));
	const dir = positional[0] ?? './etl-export';
	const requested = positional.slice(1);
	const collections =
		requested.length > 0
			? SATELLITE_COLLECTIONS.filter((c) => requested.includes(c))
			: [...SATELLITE_COLLECTIONS];

	if (requested.length > 0 && collections.length !== requested.length) {
		const known = new Set<string>(SATELLITE_COLLECTIONS);

		throw new Error(`Unknown collection(s): ${requested.filter((c) => !known.has(c)).join(', ')}`);
	}

	const satellite = loadSatelliteConfig();
	const rows: string[][] = [['collection', 'exported', 'note']];

	for (const collection of collections) {
		if (fresh) {
			for (const path of [
				jsonlFilePath({ dir, collection }),
				cursorFilePath({ dir, collection })
			]) {
				if (existsSync(path)) {
					rmSync(path);
				}
			}
		}

		const { exported, alreadyDone } = await exportCollection({ collection, dir, satellite });

		rows.push([
			collection,
			exported.toString(),
			alreadyDone ? 'already done (use --fresh to re-export)' : ''
		]);
	}

	printTable(rows);
}
