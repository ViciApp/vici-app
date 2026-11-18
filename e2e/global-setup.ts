/**
 * Playwright global setup: runs once before any spec.
 *
 * Confirms the two HTTP endpoints every test depends on are actually
 * reachable before the suite starts:
 *
 * 1. **Vite dev server** (`http://localhost:5173/`): booted by the
 *    `webServer` block in `playwright.config.ts`.
 * 2. **Juno emulator** (`http://127.0.0.1:5987/`): booted by the CI
 *    workflow's "Start Juno emulator" step. The emulator is the PocketIC
 *    instance every dev-mode sign-in and every canister query talks to.
 *
 * Without this guard, a missing emulator manifests as 13 identical
 * `Timeout 30000ms exceeded` failures deep inside `home.page.ts`
 * (`getByTestId('user-menu')` never resolves because the satellite
 * round-trip never completes). The error you actually want to see is
 * "the emulator isn't responding". That's what this gives you.
 *
 * Deliberately fast: a couple of HEAD-equivalent fetches with a tight
 * timeout. Adds ~1–2s to a healthy run, fails in ≤6s when something is
 * wrong. Does NOT address the separate "proxy degrades mid-run" flake
 * that lives in the Vite-↔-PocketIC connection pool and needs a
 * different remedy (see docs/ai/frontend/testing.md).
 */

const DEV_SERVER_URL = 'http://localhost:5173/';
const EMULATOR_URL = 'http://127.0.0.1:5987/';

const ATTEMPTS = 3;
const ATTEMPT_TIMEOUT_MS = 1_500;
const RETRY_BACKOFF_MS = 1_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isReachable = async (url: string): Promise<boolean> => {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);

	try {
		// Any non-network-error response means the server is listening.
		// 404 / 405 are fine: we're proving TCP + HTTP, not asserting a route.
		const res = await fetch(url, { method: 'GET', signal: controller.signal });

		return res.status > 0;
	} catch {
		return false;
	} finally {
		clearTimeout(timeoutId);
	}
};

const waitForReachable = async ({ url, label }: { url: string; label: string }): Promise<void> => {
	for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
		if (await isReachable(url)) {
			return;
		}

		if (attempt < ATTEMPTS) {
			await sleep(RETRY_BACKOFF_MS);
		}
	}

	throw new Error(
		`E2E global-setup: ${label} (${url}) was not reachable after ${ATTEMPTS} attempts. ` +
			`Each test would otherwise hang on the next satellite round-trip and time out ` +
			`with a misleading "user-menu not visible" error. Check that the dev server / ` +
			`Juno emulator is running before re-running the suite.`
	);
};

const globalSetup = async (): Promise<void> => {
	await waitForReachable({ url: DEV_SERVER_URL, label: 'Vite dev server' });
	await waitForReachable({ url: EMULATOR_URL, label: 'Juno emulator' });
};

export default globalSetup;
