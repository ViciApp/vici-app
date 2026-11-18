// Re-hosts imported league cover images: leagues whose image_url still points
// at the legacy storage host get the bytes downloaded, re-encoded through the
// standard 256px cover path (S3 when configured, local disk in dev), and the
// row rewritten to this API's serving URL. Idempotent: a rewritten row no
// longer matches the legacy-URL predicate, so re-runs only pick up rows added
// by a later import pass or rows whose download previously failed.
//
// Usage: bun run scripts/etl/migrate-league-images.ts [--dry-run]
// Env: DATABASE_URL, plus S3_* when the bucket backend should be used.

import { pool, query } from '../../src/db/client';
import { env } from '../../src/env';
import { storeLeagueCoverBytes } from '../../src/leagues/images';
import { printTable } from './lib';

export interface ImageMigrationResult {
	migrated: number;
	failed: number;
	failures: string[];
}

export const migrateLeagueImages = async ({
	dryRun = false
}: {
	dryRun?: boolean;
} = {}): Promise<ImageMigrationResult> => {
	// A cover already on this API serves from local storage; anything else is
	// a legacy URL that still needs the bytes moved.
	const rows = await query<{ id: string; image_url: string }>(
		`select id, image_url from leagues
		 where image_url is not null and image_url not like $1
		 order by id`,
		[`${env.apiBaseUrl}/%`]
	);

	const result: ImageMigrationResult = { migrated: 0, failed: 0, failures: [] };

	for (const { id, image_url } of rows) {
		if (dryRun) {
			console.log(`would migrate ${id}: ${image_url}`);
			result.migrated += 1;
		} else {
			try {
				const response = await fetch(image_url);

				if (!response.ok) {
					throw new Error(`download failed with ${response.status}`);
				}

				const bytes = new Uint8Array(await response.arrayBuffer());
				const newUrl = await storeLeagueCoverBytes({ leagueId: id, bytes });

				await query(`update leagues set image_url = $2, updated_at = now() where id = $1`, [
					id,
					newUrl
				]);
				result.migrated += 1;
			} catch (err) {
				result.failed += 1;
				result.failures.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
	}

	return result;
};

if (import.meta.main) {
	const dryRun = process.argv.includes('--dry-run');
	const { migrated, failed, failures } = await migrateLeagueImages({ dryRun });

	printTable([
		['migrated', 'failed'],
		[migrated.toString(), failed.toString()]
	]);

	for (const failure of failures) {
		console.log(`  - ${failure}`);
	}

	await pool.end();
}
