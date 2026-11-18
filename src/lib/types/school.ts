/**
 * School registry + app runtime config: backend item B.1.
 *
 * Two server-owned shapes that back email-verified university membership:
 *
 *  - {@link SchoolDoc}: one row per verified school in the `schools`
 *    collection, keyed by `schoolId`. Holds the running
 *    `verifiedMemberCount` and the public/pending gate. Written ONLY by
 *    the satellite's `verifySchoolCode` (controllers-scoped write); read
 *    is public so picker surfaces can eventually list public schools.
 *  - {@link AppConfigDoc}: the `app_config` collection (controllers
 *    read+write) holding non-repo runtime config. The
 *    {@link APP_CONFIG_SCHOOL_RELAY_KEY} doc carries the `vici-courier`
 *    base URL + bearer token, set by a controller after deploy so no
 *    secret ever lands in git. (Node operators can read canister state,
 *    so this is a deliberately low-value, instantly-rotatable token whose
 *    blast radius is bounded by the courier's scoping + rate limits.)
 */

/** A school goes public once this many members have email-verified. */
export const SCHOOL_VERIFIED_PUBLIC_THRESHOLD = 3;

/** Visibility of a school in the directory. */
export type SchoolStatus = 'pending' | 'public';

export interface SchoolDoc {
	/** Canonical id: directory `WorldsAffiliationOption.id` or name slug. */
	schoolId: string;
	/** Display name. */
	name: string;
	/** ISO-3166 alpha-2 home country, if known. */
	country: string | null;
	/** Verified email domains this school is reachable at. */
	domains: string[];
	/** Distinct members who have email-verified membership. */
	verifiedMemberCount: number;
	/** `public` once `verifiedMemberCount >= SCHOOL_VERIFIED_PUBLIC_THRESHOLD`. */
	status: SchoolStatus;
	/** First-verification time (ms). */
	createdAtMs: number;
	/** Last-write time (ms). */
	updatedAtMs: number;
}

/** Canonical key for a `schools` row. */
export const schoolKey = (schoolId: string): string => schoolId;

/** The single `app_config` doc holding the courier relay endpoint. */
export const APP_CONFIG_SCHOOL_RELAY_KEY = 'school_relay';

export interface SchoolRelayConfig {
	/** Base URL of the `vici-courier` service (no trailing slash). */
	url: string;
	/** Bearer token the satellite presents to the courier `POST /send`. */
	token: string;
	/**
	 * Server-side kill switch. The whole verification feature is OFF until a
	 * controller writes this doc, and stays callable only while this is not
	 * `false`, so the live `defineUpdate` endpoints can't trigger outbound
	 * email even if the FE `SCHOOL_PASS2_ENABLED` flag is flipped early or
	 * an agent calls them directly. Omit (or `true`) to enable.
	 */
	enabled?: boolean;
}
