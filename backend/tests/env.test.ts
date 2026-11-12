import { describe, expect, test } from 'bun:test';
import { loadEnv } from '../src/env';

describe('loadEnv', () => {
	test('dev mode fills every var with a local default', () => {
		const env = loadEnv({});

		expect(env.isProd).toBe(false);
		expect(env.port).toBe(8787);
		expect(env.databaseUrl).toBe('postgres://vici:vici@localhost:5432/vici');
		expect(env.publicAppUrl).toBe('http://localhost:5173');
		expect(env.apiBaseUrl).toBe('http://localhost:8787');
		expect(env.sessionSecret).not.toBe('');
		expect(env.workerPollIntervalMs).toBe(60_000);
	});

	test('production fails fast without DATABASE_URL', () => {
		expect(() => loadEnv({ NODE_ENV: 'production', SESSION_SECRET: 's3cret' })).toThrow(
			'DATABASE_URL'
		);
	});

	test('production fails fast without SESSION_SECRET', () => {
		expect(() => loadEnv({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x/y' })).toThrow(
			'SESSION_SECRET'
		);
	});

	test('production fails fast without RESEND_API_KEY', () => {
		expect(() =>
			loadEnv({
				NODE_ENV: 'production',
				DATABASE_URL: 'postgres://x/y',
				SESSION_SECRET: 's3cret',
				ROOT_SECRET: 'r00t'
			})
		).toThrow('RESEND_API_KEY');
	});

	test('production fails fast without ROOT_SECRET', () => {
		expect(() =>
			loadEnv({
				NODE_ENV: 'production',
				DATABASE_URL: 'postgres://x/y',
				SESSION_SECRET: 's3cret',
				RESEND_API_KEY: 're_test'
			})
		).toThrow('ROOT_SECRET');
	});

	test('production boots with the required set and passes values through', () => {
		const env = loadEnv({
			NODE_ENV: 'production',
			DATABASE_URL: 'postgres://prod-host/vici',
			SESSION_SECRET: 's3cret',
			ROOT_SECRET: 'r00t',
			RESEND_API_KEY: 're_test',
			PUBLIC_APP_URL: 'https://vici.app',
			PORT: '9000'
		});

		expect(env.isProd).toBe(true);
		expect(env.port).toBe(9000);
		expect(env.databaseUrl).toBe('postgres://prod-host/vici');
		expect(env.publicAppUrl).toBe('https://vici.app');
		expect(env.apiBaseUrl).toBe('http://localhost:9000');
	});

	test('an empty string counts as unset, not as a value', () => {
		expect(() =>
			loadEnv({ NODE_ENV: 'production', DATABASE_URL: '', SESSION_SECRET: 's3cret' })
		).toThrow('DATABASE_URL');
	});

	test('non-numeric PORT is rejected', () => {
		expect(() => loadEnv({ PORT: 'not-a-port' })).toThrow('PORT');
	});

	test('non-positive WORKER_POLL_INTERVAL_MS is rejected', () => {
		expect(() => loadEnv({ WORKER_POLL_INTERVAL_MS: '0' })).toThrow('WORKER_POLL_INTERVAL_MS');
	});
});
