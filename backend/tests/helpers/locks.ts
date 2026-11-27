// Race tests on two connections: a transaction left open on its own
// connection holds a row lock while the code under test runs into it, and
// commits only once that code is waiting, so the interleaving a test asserts
// on is the one that ran, not a scheduling accident.

import { pool, query, type TxQuery } from '../../src/db/client';

const LOCK_WAIT_POLL_MS = 10;
const LOCK_WAIT_TIMEOUT_MS = 5_000;

export interface OpenTransaction {
	q: TxQuery;
	commit: () => Promise<void>;
}

/** A transaction on its own pooled connection, open until `commit`. */
export const openTransaction = async (): Promise<OpenTransaction> => {
	const client = await pool.connect();

	await client.query('begin');

	return {
		q: async <R>(text: string, params: unknown[] = []) =>
			(await client.query(text, params)).rows as R[],
		commit: async () => {
			try {
				await client.query('commit');
			} finally {
				client.release();
			}
		}
	};
};

/** Resolves once a backend of the test database waits on a lock: the code
 * under test has reached a row an open transaction holds. */
export const waitForLockWait = async (): Promise<void> => {
	const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;

	while (Date.now() < deadline) {
		const [row] = await query<{ waiting: boolean }>(
			`select exists (
			   select 1 from pg_stat_activity
			   where datname = current_database() and wait_event_type = 'Lock'
			 ) as waiting`
		);

		if (row?.waiting === true) {
			return;
		}

		await Bun.sleep(LOCK_WAIT_POLL_MS);
	}

	throw new Error('no backend started waiting on a lock');
};
