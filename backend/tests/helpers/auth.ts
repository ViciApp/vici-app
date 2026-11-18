// Shared plumbing for the DB-backed auth suites: apply migrations once and
// mint unique fixture emails so suites cannot collide on shared tables.

import { isNullish } from '@dfinity/utils';
import { randomBytes } from 'node:crypto';
import { query } from '../../src/db/client';
import { runMigrations } from '../../src/db/migrate';

let migrated: Promise<void> | undefined;

/** Idempotent, memoized: every suite can await this from beforeAll without
 * racing a parallel run of the migration runner. */
export const ensureMigrated = (): Promise<void> => {
	migrated ??= runMigrations();

	return migrated;
};

/** A unique throwaway email so tests never contend on the same address. */
export const uniqueEmail = (): string => `u-${randomBytes(6).toString('hex')}@test.vici.invalid`;

/** A unique throwaway principal-like text id for legacy fixtures. */
export const uniquePrincipal = (): string => `principal-${randomBytes(8).toString('hex')}`;

/** A bare users row for session/guard fixtures; the new user id. */
export const createTestUser = async (role: 'user' | 'admin' = 'user'): Promise<string> => {
	const rows = await query<{ id: string }>(`insert into users (role) values ($1) returning id`, [
		role
	]);
	const id = rows[0]?.id;

	if (isNullish(id)) {
		throw new Error('user insert returned no row');
	}

	return id;
};
