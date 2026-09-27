/**
 * localStorage flag the Playwright suite seeds (`playwright.config.ts`) to keep
 * the legacy build's sign-up flow open on the dev server. Honoured only by dev
 * builds; see `isE2eOpenSignups` in `$lib/dev/e2e-signups`. Kept import-free so
 * the Playwright config can read it outside the SvelteKit module graph.
 */
export const E2E_OPEN_SIGNUPS_STORAGE_KEY = 'vici.e2e.open-signups';
