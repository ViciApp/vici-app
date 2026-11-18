// Postgres access. `query` for one-off statements; `tx` for atomic multi-step
// work. Bounded timeouts + keepalive so a DB failover surfaces as a fast
// retryable error instead of a hung socket.

import pg from 'pg';
import { env } from '../env';

const { Pool } = pg;

export const pool = new Pool({
	connectionString: env.databaseUrl,
	connectionTimeoutMillis: 5_000,
	query_timeout: 15_000,
	statement_timeout: 15_000,
	keepAlive: true,
	idleTimeoutMillis: 30_000,
	max: 10
});

// An idle client killed by a network partition / DB failover emits 'error' on
// the pool. Unhandled, that event crashes the whole process. Log and carry on;
// the pool replaces broken clients on the next checkout.
pool.on('error', (err) => {
	console.error('pg pool: idle client error (recovered, client discarded):', err);
});

/** Non-`08` error codes that mean "the database is momentarily unavailable":
 * a connect failed, a socket dropped, or Postgres is mid-failover/restart,
 * NOT a bad query. */
const UNAVAILABLE_CODES = new Set([
	'ECONNREFUSED',
	'ECONNRESET',
	'ETIMEDOUT',
	'EPIPE',
	'ENOTFOUND',
	'EHOSTUNREACH',
	'EAI_AGAIN',
	'57P01',
	'57P02',
	'57P03',
	'53300'
]);

/** Whether a thrown error is a transient dependency-availability blip (vs a
 * real query fault). The API layer maps these to 503 (retryable) instead of 500. */
export const isDbUnavailable = (error: unknown): boolean => {
	if (!(error instanceof Error)) {
		return false;
	}

	const { code } = error as { code?: unknown };

	// SQLSTATE class 08 is entirely "connection exception": match the whole
	// class by its 2-char prefix (node error codes are alphabetic, no collision).
	if (typeof code === 'string' && (code.startsWith('08') || UNAVAILABLE_CODES.has(code))) {
		return true;
	}

	return /timeout exceeded when trying to connect|connection terminated|terminating connection|the database system is (starting up|shutting down|not yet accepting)/i.test(
		error.message
	);
};

/** A parameterized query helper bound to the pool. */
export const query = async <T>(text: string, params: unknown[] = []): Promise<T[]> => {
	const res = await pool.query(text, params);

	return res.rows as T[];
};

/** A query function scoped to a single transaction client. */
export type TxQuery = <T>(text: string, params?: unknown[]) => Promise<T[]>;

/** Run `fn` inside a transaction; commit on success, roll back on throw. */
export const tx = async <T>(fn: (q: TxQuery) => Promise<T>): Promise<T> => {
	const client = await pool.connect();

	try {
		await client.query('begin');

		const q: TxQuery = async <R>(text: string, params: unknown[] = []) => {
			const res = await client.query(text, params);

			return res.rows as R[];
		};

		const result = await fn(q);

		await client.query('commit');

		return result;
	} catch (err) {
		// The failed statement is the actionable error; if the rollback itself
		// also throws (e.g. the connection already died, which aborts the
		// transaction anyway) it must not mask it.
		try {
			await client.query('rollback');
		} catch (rollbackErr) {
			console.debug('rollback failed (original error rethrown):', rollbackErr);
		}

		throw err;
	} finally {
		client.release();
	}
};
