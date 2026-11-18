// Parity report for the migration: per collection, the live satellite doc
// count, the exported JSONL line count and the mapped Postgres row count,
// plus configurable random spot checks (sampled exported docs probed for
// their target row). Count semantics follow the mapping, not raw rows: e.g.
// market_tag_index compares distinct tags (one satellite doc per tag fans
// out to one row per series here) and vxp_onboarding compares users with
// synthesized onboarding awards. Skipped collections report their reason.
//
// Usage: bun run scripts/etl/verify-parity.ts [dir] [--sample N] [--offline] [collection ...]
// Env: DATABASE_URL; plus ETL_SATELLITE_PEM / ETL_SATELLITE_ID unless --offline.

import { isNullish, nonNullish } from '@dfinity/utils';
import { countDocs } from '@junobuild/core';
import { pool, query } from '../../src/db/client';
import {
	loadSatelliteConfig,
	printTable,
	readJsonl,
	type EtlSatelliteConfig,
	type ExportedDoc
} from './lib';
import { importerFor, IMPORTERS, PrincipalMapper } from './transforms';

/** Reservoir-sample N docs while streaming the JSONL, counting every line. */
const sampleJsonl = async ({
	dir,
	collection,
	sampleSize
}: {
	dir: string;
	collection: string;
	sampleSize: number;
}): Promise<{ count: number; sample: ExportedDoc[] }> => {
	const sample: ExportedDoc[] = [];
	let count = 0;

	for await (const doc of readJsonl({ dir, collection })) {
		count += 1;

		if (sample.length < sampleSize) {
			sample.push(doc);
		} else {
			const slot = Math.floor(Math.random() * count);

			if (slot < sampleSize) {
				sample[slot] = doc;
			}
		}
	}

	return { count, sample };
};

if (import.meta.main) {
	const args = process.argv.slice(2);
	const offline = args.includes('--offline');
	const sampleFlagIndex = args.indexOf('--sample');
	const sampleSize = sampleFlagIndex >= 0 ? Number(args[sampleFlagIndex + 1] ?? '5') : 5;
	const positional = args.filter(
		(arg, i) => !arg.startsWith('--') && (sampleFlagIndex < 0 || i !== sampleFlagIndex + 1)
	);
	const dir = positional[0] ?? './etl-export';
	const requested = positional.slice(1);
	const importers =
		requested.length > 0
			? IMPORTERS.filter(({ collection }) => requested.includes(collection))
			: IMPORTERS;

	if (requested.length > 0 && importers.length !== requested.length) {
		throw new Error(
			`Unknown collection(s): ${requested.filter((c) => isNullish(importerFor(c))).join(', ')}`
		);
	}

	let satellite: EtlSatelliteConfig | undefined;

	if (!offline) {
		satellite = loadSatelliteConfig();
	}

	const mapper = new PrincipalMapper(query);

	await mapper.load();

	const rows: string[][] = [
		['collection', 'satellite', 'jsonl', 'postgres', 'spot checks', 'note']
	];

	for (const importer of importers) {
		const { collection } = importer;
		const satCount = nonNullish(satellite)
			? (await countDocs({ collection, satellite })).toString()
			: '-';
		const { count: jsonlCount, sample } = await sampleJsonl({
			dir,
			collection,
			sampleSize: importer.mode === 'import' && nonNullish(importer.exists) ? sampleSize : 0
		});

		if (importer.mode === 'skip') {
			rows.push([
				collection,
				satCount,
				jsonlCount.toString(),
				'-',
				'-',
				`skipped: ${importer.skipReason ?? ''}`
			]);
		} else {
			const pgCount = nonNullish(importer.pgCount)
				? (await importer.pgCount(query)).toString()
				: '-';

			let spot = '-';

			if (nonNullish(importer.exists) && sample.length > 0) {
				let passed = 0;

				for (const doc of sample) {
					if (await importer.exists(doc, { q: query, mapper })) {
						passed += 1;
					}
				}

				spot = `${passed}/${sample.length}`;
			}

			rows.push([collection, satCount, jsonlCount.toString(), pgCount, spot, '']);
		}
	}

	printTable(rows);

	await pool.end();
}
