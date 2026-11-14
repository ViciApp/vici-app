/**
 * Social cohorts: league membership.
 *
 * One doc per `(league, member)` pair. The doc key is
 * `${leagueId}/${memberPrincipal}` so:
 *
 *   - listing a league's members is a prefix scan on `leagueId/`
 *   - the upper bound on memberships per league is the collection
 *     scan cost, not a fan-out array embedded in `LeagueDoc`
 *   - duplicate joins by the same principal collide naturally
 *
 * Role transitions (`member ↔ admin`, owner transfer) are gated by
 * the satellite assert: only the league owner can promote.
 */

export type LeagueMemberRole = 'owner' | 'admin' | 'member';

export interface LeagueMemberDoc {
	/** Parent league id (matches the prefix in the doc key). */
	leagueId: string;
	/** Member principal (text form). Matches the suffix in the doc key. */
	member: string;
	/** Join timestamp in ms since epoch. Immutable after creation. */
	joinedAtMs: number;
	/** Role inside this league. Owner is set at league creation;
	 *  admin/member is the day-2 split. */
	role: LeagueMemberRole;
}

/**
 * Canonical key builder: keep all `league_members` writes in
 * lockstep with what the satellite assert expects. `${leagueId}/`
 * is intentionally chosen as the separator so the prefix scan for
 * "members of league X" is a single juno listDocs filter.
 */
export const leagueMemberKey = ({
	leagueId,
	memberPrincipal
}: {
	leagueId: string;
	memberPrincipal: string;
}): string => `${leagueId}/${memberPrincipal}`;

/**
 * Roles known to the surface. Defensive validation in the
 * assert uses this set; future role additions land here first.
 */
export const LEAGUE_MEMBER_ROLES: ReadonlySet<LeagueMemberRole> = new Set<LeagueMemberRole>([
	'owner',
	'admin',
	'member'
]);
