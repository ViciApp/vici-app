// Minimal forward-only migration runner. Applies every .sql file in
// `migrations/` (lexical order) exactly once, tracked in `_migrations`.
// Run with `bun run migrate`; Fly runs it as the deploy release_command.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { env } from '../env';

const { Pool } = pg;

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Apply all pending migrations. A pool of its own, deliberately NOT the
 * app's: `client.ts` caps every statement at 15s so one slow request cannot
 * pin a worker, and a migration is precisely the statement that is allowed to
 * be slow (backfills, index builds, NOT NULL adds rewrite the table). Under
 * the app's pool those get cancelled at 15s, and because this runs as Fly's
 * release_command a cancelled statement aborts the whole deploy.
 * Serial by construction (max 1): one file at a time. */
export const runMigrations = async (): Promise<void> => {
	const pool = new Pool({
		connectionString: env.databaseUrl,
		connectionTimeoutMillis: 10_000,
		max: 1
	});

	// A pool emits 'error' when a client dies while IDLE, asynchronously and
	// outside any try/catch. Unhandled that is an uncaught exception, and the
	// cruel case is a socket dropped after the last migration committed: the
	// run crashes, the release command exits non-zero, and Fly aborts a deploy
	// whose migrations all succeeded. Log instead; an error on an in-flight
	// query still rejects it below.
	pool.on('error', (err) => {
		console.error('pg pool: idle client error (recovered, client discarded):', err);
	});

	try {
		await pool.query(
			`create table if not exists _migrations (
			   name text primary key,
			   applied_at timestamptz not null default now()
			 )`
		);

		const files = readdirSync(migrationsDir)
			.filter((f) => f.endsWith('.sql'))
			.sort();

		for (const file of files) {
			const done = await pool.query('select 1 from _migrations where name = $1', [file]);

			if ((done.rowCount ?? 0) > 0) {
				console.log(`skip   ${file}`);
			} else {
				const sql = readFileSync(join(migrationsDir, file), 'utf8');
				const client = await pool.connect();

				try {
					await client.query('begin');
					// Belt and braces: the pool above sets no timeout, but an
					// `alter role ... set statement_timeout` on the deploy user would
					// still apply. `set local` lifts it for this transaction only, and
					// unlike a libpq startup option it survives a connection pooler.
					await client.query('set local statement_timeout = 0');
					await client.query(sql);
					await client.query('insert into _migrations (name) values ($1)', [file]);
					await client.query('commit');
					console.log(`apply  ${file}`);
				} catch (err) {
					// The failed statement is the actionable error; if the rollback
					// itself also throws (e.g. the connection already died, which
					// aborts the transaction anyway) it must not mask it.
					try {
						await client.query('rollback');
					} catch (rollbackErr) {
						console.debug('rollback failed (original error rethrown):', rollbackErr);
					}

					throw err;
				} finally {
					client.release();
				}
			}
		}

		console.log('migrations complete');
	} finally {
		await pool.end();
	}
};

if (import.meta.main) {
	runMigrations().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
