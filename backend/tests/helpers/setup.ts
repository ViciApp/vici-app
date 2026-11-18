// Preloaded by bunfig.toml before any test file is imported.
//
// src/env.ts reads process.env once, at module scope, and the pool in
// src/db/client.ts is built from it on first import. Whichever test file pulls
// that in first would otherwise decide the database for the whole run, a race
// between files that resolves differently locally than in CI. Setting the
// variables from a preload takes the ordering out of it.

import pg from 'pg';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://vici:vici@localhost:5432/vici';

process.env.DATABASE_URL = url;

// The key-derivation suites assert known outputs for a FIXED root secret, so
// pin it before src/env.ts is first imported.
process.env.ROOT_SECRET = 'test-root-secret';

/** Whether the DB-backed suites can run: probed once with a short timeout so
 * a missing local Postgres degrades to skipped suites instead of a hang. */
export const dbAvailable = await (async () => {
	const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 1_500 });

	try {
		await client.connect();

		return true;
	} catch {
		return false;
	} finally {
		await client.end().catch(() => undefined);
	}
})();

// CI sets this: no database there means the DB-backed suites silently covered
// nothing, which is worse than a red build.
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === '1') {
	throw new Error(`REQUIRE_DB_TESTS=1 but no Postgres is reachable at ${url}`);
}
