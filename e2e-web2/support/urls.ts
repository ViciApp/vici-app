/**
 * Origins of the two local servers the web2 suite boots (see
 * `playwright.web2.config.ts`). `localhost` for both, not `127.0.0.1`: the
 * session cookie is host-only, and the SPA and the API must share a host for
 * the browser to send it on the API's credentialed requests.
 */
export const E2E_WEB2_APP_URL = 'http://localhost:4173';

export const E2E_WEB2_API_URL = 'http://localhost:8787';
