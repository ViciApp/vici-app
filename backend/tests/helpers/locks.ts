// Race tests on two connections: a transaction left open on its own
// connection holds a row lock while the code under test runs into it, and
// commits only once that code is blocked by it, so the interleaving a test
// asserts on is the one that ran, not a scheduling accident.

import { isNullish } from '@dfinity/utils';
import { pool, query, type TxQuery } from '../../src/db/client';

const LOCK_WAIT_POLL_MS = 10;
const LOCK_WAIT_TIMEOUT_MS = 5_000;

export interface OpenTransaction {
	q: TxQuery;
	/** The backend the transaction runs on, to tell who it blocks. */
	pid: number;
	commit: () => Promise<void>;
	/** Rolls back and frees the connection; a no-op once the transaction
	 * has ended, so a test can always call it from `finally`. */
	rollback: () => Promise<void>;
}

/** A transaction on its own pooled connection, open until it ends. */
export const openTransaction = async (): Promise<OpenTransaction> => {
	const client = await pool.connect();
	let ended = false;

	const end = async (statement: 'commit' | 'rollback') => {
		if (ended) {
			return;
		}

		ended = true;

		try {
			await client.query(statement);
		} finally {
			client.release();
		}
	};

	try {
		await client.query('begin');

		const [backend] = (await client.query<{ pid: number }>('select pg_backend_pid() as pid')).rows;

		if (isNullish(backend)) {
			throw new Error('pg_backend_pid returned no row');
		}

		return {
			q: async <R>(text: string, params: unknown[] = []) =>
				(await client.query(text, params)).rows as R[],
			pid: backend.pid,
			commit: () => end('commit'),
			rollback: () => end('rollback')
		};
	} catch (err) {
		await end('rollback');

		throw err;
	}
};

/** Resolves once another backend is blocked by `holder`: the code under
 * test has reached a row the open transaction holds. */
export const waitForLockWait = async (holder: OpenTransaction): Promise<void> => {
	const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;

	while (Date.now() < deadline) {
		const [row] = await query<{ blocked: boolean }>(
			`select exists (
			   select 1 from pg_stat_activity where $1 = any (pg_blocking_pids(pid))
			 ) as blocked`,
			[holder.pid]
		);

		if (row?.blocked === true) {
			return;
		}

		await Bun.sleep(LOCK_WAIT_POLL_MS);
	}

	throw new Error(`no backend started waiting on a lock held by backend ${holder.pid}`);
};
