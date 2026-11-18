// Imports the exported JSONL files into the relational tables: one
// transaction per collection, in dependency order, through the per-collection
// transforms in transforms.ts. Idempotent end to end: every write upserts on
// the stable legacy identifier, so re-running (including over a fresh delta
// export) converges instead of duplicating. Unmatched principals get
// provisional claim_pending accounts; the summary reports how many.
//
// Usage: bun run scripts/etl/import-collections.ts [dir] [collection ...]
// Env: DATABASE_URL.

import { pool } from '../../src/db/client';
import { printTable, readJsonlAll } from './lib';
import { importDocs, IMPORTERS } from './transforms';

if (import.meta.main) {
	const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
	const dir = positional[0] ?? './etl-export';
	const requested = positional.slice(1);
	const importers =
		requested.length > 0
			? IMPORTERS.filter(({ collection }) => requested.includes(collection))
			: IMPORTERS;

	if (requested.length > 0 && importers.length !== requested.length) {
		const known = new Set(IMPORTERS.map(({ collection }) => collection));

		throw new Error(
			`Unknown collection(s): ${requested.filter((c) => !known.has(c as never)).join(', ')}`
		);
	}

	const rows: string[][] = [['collection', 'imported', 'skipped', 'new users', 'warnings']];
	const allWarnings: string[] = [];

	for (const { collection } of importers) {
		const docs = await readJsonlAll({ dir, collection });
		const stats = await importDocs({ collection, docs });

		rows.push([
			collection,
			stats.imported.toString(),
			stats.skipped.toString(),
			stats.createdUsers.toString(),
			stats.warnings.length.toString()
		]);
		allWarnings.push(...stats.warnings);
	}

	printTable(rows);

	if (allWarnings.length > 0) {
		console.log('\nwarnings:');

		for (const warning of allWarnings) {
			console.log(`  - ${warning}`);
		}
	}

	await pool.end();
}
