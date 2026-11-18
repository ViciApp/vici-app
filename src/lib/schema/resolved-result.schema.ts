import { j, PrincipalTextSchema } from '@junobuild/schema';

/**
 * Wire shape of a single `resolved_results` row; the friend-readable
 * per-participant resolution outcome. Shared between the satellite read endpoint
 * (`listFriendResolvedResults`) and the FE consumer so the two can't drift.
 *
 * `netVxp` is the realized net cashflow in `USD_DECIMALS` base units, signed
 * (negative for a loss); `outcome` mirrors its sign. `side` is the held outcome
 * (a settlement outcome id, or `YES`/`NO` for a binary net position).
 */
export const ResolvedResultSchema = j.strictObject({
	owner: PrincipalTextSchema,
	marketId: j.string(),
	title: j.string(),
	side: j.string(),
	outcome: j.enum(['win', 'loss']),
	netVxp: j.number(),
	resolvedAtMs: j.number()
});

/**
 * Args for the friend-scoped bulk read: the set of friend principals whose
 * resolved-result rows to return over the active retention window. The handler
 * runs a single bounded owner-prefix scan over the collection, never one call
 * per friend.
 */
export const ListFriendResolvedResultsArgsSchema = j.strictObject({
	friends: j.array(PrincipalTextSchema)
});
