import { defineConfig, devices } from '@playwright/test';
import { E2E_OPEN_SIGNUPS_STORAGE_KEY } from './src/lib/constants/e2e.constants';

const isCI = process.env.CI === 'true';

const BASE_URL = 'http://localhost:5173';

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export default defineConfig({
	testDir: 'e2e',
	testMatch: ['**/*.spec.ts'],
	timeout: FIVE_MINUTES_MS,
	snapshotDir: 'e2e/snapshots',
	// Fail fast (and with a useful message) if the Vite dev server or the
	// Juno emulator isn't reachable at suite start, instead of letting every
	// spec time out 30s deep in `home.page.ts` on a missing `user-menu`.
	// See e2e/global-setup.ts.
	globalSetup: './e2e/global-setup.ts',
	expect: {
		timeout: 30_000,
		toHaveScreenshot: {
			// Tolerate sub-pixel rendering / font-hinting differences; the diff
			// still shows up clearly enough for review while not red-ing CI on
			// a 1-pixel anti-aliasing change.
			threshold: 0.3,
			// Disable CSS animations so spinner / skeleton frames don't drift.
			animations: 'disabled',
			// Hide caret to keep input snapshots stable.
			caret: 'hide'
		}
	},
	fullyParallel: false,
	forbidOnly: isCI,
	retries: isCI ? 2 : 0,
	workers: 1,
	reporter: isCI ? [['html'], ['list']] : 'list',
	use: {
		baseURL: BASE_URL,
		// Keep the legacy build's sign-up flow open: every spec signs in through
		// `/signup` with a shared dev principal that may have no profile yet,
		// which the build otherwise turns away to the new app. Dev builds only
		// honour the flag; `moved-to-new-app.spec.ts` clears it to assert the
		// moved screen.
		storageState: {
			cookies: [],
			origins: [
				{
					origin: BASE_URL,
					localStorage: [{ name: E2E_OPEN_SIGNUPS_STORAGE_KEY, value: '1' }]
				}
			]
		},
		testIdAttribute: 'data-tid',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		actionTimeout: 30_000,
		navigationTimeout: 60_000
	},
	projects: [
		{
			name: 'chromium',
			use: devices['Desktop Chrome']
		},
		{
			name: 'Galaxy S9+',
			use: {
				...devices['Galaxy S9+'],
				screen: { width: 320, height: 658 },
				viewport: { width: 320, height: 658 }
			}
		},
		{
			name: 'Galaxy A55',
			use: {
				...devices['Galaxy A55'],
				screen: { width: 480, height: 1040 },
				viewport: { width: 480, height: 1040 }
			}
		}
	],
	webServer: {
		command: 'npm run dev',
		url: BASE_URL,
		reuseExistingServer: !isCI,
		timeout: FIVE_MINUTES_MS,
		stdout: 'pipe',
		stderr: 'pipe',
		env: {
			// Point juno.config.ts at the emulator satellite (see juno.config.ts).
			JUNO_EMULATOR: 'true'
		}
	}
});
