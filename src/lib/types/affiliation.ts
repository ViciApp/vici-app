/**
 * Worlds affiliations: a user's self-selected university and /
 * or country. Carries the signature 90-day lock: once you pick an
 * affiliation, you can't switch for 90 days. This
 * prevents users from chasing the Worlds leaderboard by hopping
 * between schools / nations mid-season.
 *
 * Distinct collection from `league_members` so the lock doesn't
 * leak into user-created leagues (those have free leave + kick).
 *
 * Doc key: `${memberPrincipal}/${kind}/${affiliationIdentifier}`
 * so a user can hold one university + one country row
 * simultaneously. A second write at the same `(member, kind)` after
 * the lock expires is a valid update (the user picks a new school);
 * during the lock window the delete-assert blocks the implicit
 * "leave-then-rejoin" path.
 *
 * Field naming note: `affiliationIdentifier` (not `affiliationId`).
 * Juno's `JsonData` derive macro auto-wraps `Option<NestedStruct>`
 * fields in a `#[serde(rename_all = "camelCase")]` mirror, but the
 * serde camelCase rename + something about the `Id` tail produced a
 * Candid type whose field name didn't round-trip back to the
 * snake_case wire: every `listMyAffiliations` call trapped with
 * `missing field 'affiliationId'`. Spelling it out as `*Identifier`
 * sidesteps the rename quirk.
 */

export type AffiliationKind = 'university' | 'country';

export interface AffiliationDoc {
	/** Member principal text. Matches the prefix in the doc key. */
	member: string;
	/** Which slot: university or country. Part of the doc key so a
	 *  user can hold one of each at once. */
	kind: AffiliationKind;
	/** External identifier: university slug (`mit`, `usp`) or
	 *  ISO-3166 alpha-2 country code. */
	affiliationIdentifier: string;
	/** Join timestamp (ms since epoch). Immutable. */
	joinedAtMs: number;
	/** Server-computed `joinedAtMs + AFFILIATION_LOCK_MS`. Defended
	 *  by `assertSetAffiliation`. Used by `assertDeleteAffiliation`
	 *  to reject early-leave attempts. */
	lockedUntilMs: number;
}

export const AFFILIATION_KINDS: ReadonlySet<AffiliationKind> = new Set<AffiliationKind>([
	'university',
	'country'
]);

/**
 * Lock window: 90 days.
 */
export const AFFILIATION_LOCK_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Canonical key builder: keep all `affiliations` writes in lockstep
 * with what the satellite assert expects.
 */
export const affiliationKey = ({
	memberPrincipal,
	kind,
	affiliationIdentifier
}: {
	memberPrincipal: string;
	kind: AffiliationKind;
	affiliationIdentifier: string;
}): string => `${memberPrincipal}/${kind}/${affiliationIdentifier}`;
