import type { HandleFormatIssue } from '#lib/utils/handle.utils.ts';

/** The landing's two views, switched from the top bar. */
export type LandingView = 'cards' | 'markets';

/** The field the claim capsule shows: one at a time, then the claimed handle. */
export type LandingClaimStep = 'handle' | 'email' | 'code' | 'done';

/** Where the live availability probe of the typed handle stands. */
export type LandingClaimCheck =
	| { kind: 'idle' }
	| { kind: 'checking' }
	| { kind: 'free' }
	| { kind: 'taken' }
	| { kind: 'failed' }
	| { kind: 'format'; issue: HandleFormatIssue };

/** A refusal the capsule has its own words for; anything else reads as `failed`. */
export type LandingClaimRefusal =
	'handle_taken' | 'invalid_code' | 'expired_code' | 'rate_limited' | 'email_invalid' | 'failed';

/** What the capsule last tried and could not do, or is doing; replaces the step's own line. */
export type LandingClaimNotice =
	{ kind: 'none' } | { kind: 'busy' } | { kind: 'refused'; refusal: LandingClaimRefusal };

/** A failed waitlist call: the API's stable error code. */
export interface LandingClaimError {
	error: string;
}

/**
 * The waitlist calls the capsule makes once the handle is chosen, injected by
 * the page. `requestCode` sends a six-digit code to `email` for `handle`;
 * `confirm` checks it and answers the handle now held for that email. Both
 * resolve an `{ error }` with the API's code instead of throwing for an
 * expected refusal (`handle_taken`, `invalid_code`, `expired_code`,
 * `rate_limited`, `email_invalid`); a throw reads as a generic failure.
 */
export interface LandingClaimSubmit {
	requestCode: (params: {
		handle: string;
		email: string;
	}) => Promise<{ ok: true } | LandingClaimError>;
	confirm: (params: {
		email: string;
		code: string;
	}) => Promise<{ handle: string } | LandingClaimError>;
}
