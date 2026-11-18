import { describe, expect, test } from 'bun:test';
import { isDbUnavailable, query } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { dbAvailable } from './helpers/setup';

describe('isDbUnavailable', () => {
	const withCode = (code: string): Error => Object.assign(new Error('boom'), { code });

	test('classifies connect/socket errors as unavailable', () => {
		expect(isDbUnavailable(withCode('ECONNREFUSED'))).toBe(true);
		expect(isDbUnavailable(withCode('ECONNRESET'))).toBe(true);
		expect(isDbUnavailable(withCode('08006'))).toBe(true);
		expect(isDbUnavailable(withCode('57P01'))).toBe(true);
		expect(isDbUnavailable(new Error('Connection terminated unexpectedly'))).toBe(true);
		expect(isDbUnavailable(new Error('timeout exceeded when trying to connect'))).toBe(true);
	});

	test('does not classify query faults or non-errors as unavailable', () => {
		expect(isDbUnavailable(withCode('23505'))).toBe(false);
		expect(isDbUnavailable(new Error('syntax error at or near "selct"'))).toBe(false);
		expect(isDbUnavailable('nope')).toBe(false);
		expect(isDbUnavailable(undefined)).toBe(false);
	});
});

describe.if(dbAvailable)('runMigrations', () => {
	test('applies 0001_core and is idempotent on a second run', async () => {
		await runMigrations();
		await runMigrations();

		const applied = await query<{ name: string }>('select name from _migrations order by name');

		expect(applied.map((row) => row.name)).toContain('0001_core.sql');

		const meta = await query<{ count: string }>('select count(*)::text as count from app_meta');

		expect(meta).toHaveLength(1);

		const extension = await query<{ extname: string }>(
			"select extname from pg_extension where extname = 'pgcrypto'"
		);

		expect(extension).toHaveLength(1);
	});
});
