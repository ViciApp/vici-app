/**
 * Account-claim surfaces. The legacy on-chain app links out to the claim
 * portal on the new stack; the portal route verifies the handoff blob with
 * the HTTP API and links the proven principal to the web2 account.
 */

/** Claim portal on the new stack; overridable for staging builds. */
export const CLAIM_PORTAL_URL: string =
	(import.meta.env.VITE_WEB2_CLAIM_URL as string | undefined) ?? 'https://vici.app/claim';

/** The legacy app, where people with an existing account keep playing until
 * their account moves to the new stack; the web2 sign-in links here when it
 * holds such an account back. */
export const LEGACY_APP_URL = 'https://vici.market';

/** Session stash for the blob across the sign-in roundtrip on the portal:
 * OAuth redirects drop URL fragments, so the portal parks the blob here
 * before handing control to a provider. */
export const CLAIM_BLOB_STORAGE_KEY = 'vici:web2-claim-blob';

/** Local dismissal flag for the migration banner on the legacy app. */
export const CLAIM_BANNER_DISMISSED_KEY = 'vici:web2-claim-banner-dismissed';
