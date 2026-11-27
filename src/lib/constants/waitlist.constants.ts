/**
 * The landing entry points that open the claim capsule, sent with every
 * waitlist code request so the server can count where joiners come from:
 * the top-bar button, the markets list, the page footer, and the line the
 * page shows after a landing call. A closed vocabulary (mirrored by
 * `WAITLIST_SOURCES` in backend/src/waitlist/reservations.ts and its
 * `check` in the migration).
 */
export const WAITLIST_SOURCES = ['nav', 'markets', 'footer', 'call'] as const;

export type WaitlistSource = (typeof WAITLIST_SOURCES)[number];
