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

/** Where a reservation stands, as `POST /waitlist/status` answers it. */
export type WaitlistState = 'waiting';

/**
 * This browser's reservation: the handle and the private status token the
 * confirmation answered. A cache of a server result only: every load checks
 * it against the server, which clears it once the reservation is gone.
 */
export const WAITLIST_STATUS_STORAGE_KEY = 'vici.waitlist.status.v1';
