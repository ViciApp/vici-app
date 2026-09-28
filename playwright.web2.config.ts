import { defineConfig, devices } from '@playwright/test';
import { E2E_WEB2_API_URL, E2E_WEB2_APP_URL } from './e2e-web2/support/urls';

/**
 * End-to-end suite for the web2 build: the production bundle built with
 * `VITE_BACKEND=web2`, served by `vite preview`, talking to the real API
 * (`backend/`) on a disposable local Postgres. The API runs through its E2E
 * entrypoint (`backend/e2e/server.ts`), which swaps the on-chain engine and
 * the VXP ledger for deterministic fakes and keeps email in an in-memory
 * outbox, so the suite needs no mainnet access and no secrets. See
 * docs/ai/frontend/testing.md, "E2E against the web2 backend".
 *
 * Postgres is the one external prerequisite: `E2E_DATABASE_URL` (default:
 * the backend docker-compose database) must reach a loopback instance, which
 * the server's boot guard enforces.
 */

const isCI = process.env.CI === 'true';

const DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgres://vici:vici@127.0.0.1:5432/vici';

const API_PORT = new URL(E2E_WEB2_API_URL).port;
const APP_PORT = new URL(E2E_WEB2_APP_URL).port;

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export default defineConfig({
	testDir: 'e2e-web2',
	testMatch: ['**/*.spec.ts'],
	outputDir: 'test-results-web2',
	timeout: 2 * 60 * 1000,
	expect: {
		timeout: 20_000
	},
	fullyParallel: false,
	forbidOnly: isCI,
	// One retry at most: the stack is local and deterministic, so a failure
	// that survives a retry is a real regression, and a second retry would
	// only hide flakes that should be fixed at the source.
	retries: isCI ? 1 : 0,
	workers: 1,
	reporter: isCI ? [['html', { outputFolder: 'playwright-report-web2' }], ['list']] : 'list',
	use: {
		baseURL: E2E_WEB2_APP_URL,
		testIdAttribute: 'data-tid',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		actionTimeout: 20_000,
		navigationTimeout: 30_000
	},
	projects: [
		{
			name: 'chromium',
			use: devices['Desktop Chrome']
		}
	],
	webServer: [
		{
			// Schema, fixture seed, then the API with its test-only fakes. Each
			// step is idempotent, so a local re-run against the same database
			// converges.
			command: 'bun run migrate && bun run e2e:seed && bun run e2e:server',
			cwd: 'backend',
			url: `${E2E_WEB2_API_URL}/health`,
			reuseExistingServer: !isCI,
			timeout: FIVE_MINUTES_MS,
			stdout: 'pipe',
			stderr: 'pipe',
			env: {
				NODE_ENV: 'test',
				VICI_E2E: '1',
				DATABASE_URL,
				PORT: API_PORT,
				PUBLIC_APP_URL: E2E_WEB2_APP_URL,
				API_BASE_URL: E2E_WEB2_API_URL,
				// Record-only VXP economy: awards are recorded, never paid.
				VXP_TREASURY_DISABLED: '1',
				// Unroutable on purpose: every engine and ledger call is faked, so
				// any IC path the fakes do not cover fails fast here instead of
				// reaching mainnet.
				IC_HOST: 'http://127.0.0.1:9',
				LOG_LEVEL: 'warn'
			}
		},
		{
			// The production bundle, not the dev server: the suite asserts what
			// ships. VITE_* are build-time, hence the build inside the command.
			command: `npx vite build && npx vite preview --port ${APP_PORT} --strictPort`,
			url: E2E_WEB2_APP_URL,
			reuseExistingServer: !isCI,
			timeout: FIVE_MINUTES_MS,
			stdout: 'ignore',
			stderr: 'pipe',
			env: {
				VITE_BACKEND: 'web2',
				VITE_WEB2_API_URL: E2E_WEB2_API_URL
			}
		}
	]
});
