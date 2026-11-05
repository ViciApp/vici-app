import { Collection } from '#lib/constants/collections.constants.ts';
import { isMacroId, MACRO_IDS, type MacroId } from '#lib/constants/market-taxonomy.constants.ts';
import { leagueMemberKey, type LeagueMemberDoc } from '#lib/types/league-member.ts';
import { leagueStatsKey, type LeagueStatsDoc } from '#lib/types/league-stats.ts';
import type { UserProfile } from '#lib/types/profile.ts';
import type { CategoryStatsBucket, UserStatsDoc } from '#lib/types/user-stats.ts';
import { isHibernated } from '#satellite/services/profile.services.ts';
import { escapeRegex } from '#satellite/utils/regex.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import type { AssertSetDocContext, OnSetDocContext } from '@junobuild/functions';
import { time } from '@junobuild/functions/ic-cdk';
import {
	decodeDocData,
	encodeDocData,
	getDocStore,
	listDocsStore,
	setDocStore
} from '@junobuild/functions/sdk';

/**
 * Pre-write guard for `league_stats`. Same shape rules as
 * `affiliation_stats` but simpler — lifetime counters only, no
 * monthly rollover (the tournament uses 7-day windows, not month
 * boundaries, so monthly snapshots aren't useful here).
 *
 *  1. **Collection scope.** No-op for any non-stats collection.
 *  2. **Key shape.** Doc key must equal the embedded `leagueId`.
 *  3. **Caller is a member.** The caller must have a row in
 *     `league_members` for the same leagueId. Binds the assert to
 *     legitimate hook writes — only a hook signing on behalf of an
 *     actual member can write, so an outsider can't inflate a rival
 *     league's numbers.
 *  4. **Counters move forward.** Lifetime counters cannot decrease
 *     across writes.
 *  5. **Wins ≤ totalCalls.** Sanity invariant.
 */
export const assertSetLeagueStats = ({
	caller,
	data: {
		collection,
		key,
		data: { current, proposed }
	}
}: AssertSetDocContext): void => {
	if (collection !== Collection.LEAGUE_STATS) {
		return;
	}

	const proposedDoc = decodeDocData<LeagueStatsDoc>(proposed.data);

	// 2. Key shape.
	const expectedKey = leagueStatsKey({ leagueId: proposedDoc.leagueId });

	if (key !== expectedKey) {
		throw new Error(
			`league_stats key mismatch: expected ${expectedKey}, got ${key} (leagueId must match the doc body).`
		);
	}

	// 3. Caller is a member of this league.
	const callerText = Principal.fromUint8Array(caller).toText();
	const membershipDoc = getDocStore({
		collection: Collection.LEAGUE_MEMBERS,
		key: leagueMemberKey({ leagueId: proposedDoc.leagueId, memberPrincipal: callerText }),
		caller
	});

	if (isNullish(membershipDoc)) {
		throw new Error(
			`league_stats writes require the caller to be a member of league "${proposedDoc.leagueId}".`
		);
	}

	// 5. Wins ≤ totalCalls — sanity invariant (aggregate + every bucket).
	if (proposedDoc.wins > proposedDoc.totalCalls) {
		throw new Error(
			`league_stats wins (${proposedDoc.wins}) cannot exceed totalCalls (${proposedDoc.totalCalls}).`
		);
	}

	if (proposedDoc.totalCalls < 0 || proposedDoc.wins < 0) {
		throw new Error('league_stats counters must be non-negative.');
	}

	const currentDoc = nonNullish(current) ? decodeDocData<LeagueStatsDoc>(current.data) : undefined;

	for (const [tag, bucket] of Object.entries(proposedDoc.categories ?? {})) {
		// Keys are bounded to the known macro categories — the collection is
		// member-writable, so an unconstrained key set would let any member
		// bloat the doc with arbitrary categories. Validate the key on every
		// entry, including nullish buckets, so a `null` value can't smuggle an
		// arbitrary key past the constraint. A legacy key already carried on the
		// current doc (a pre-taxonomy flat tag like `wc`) is grandfathered so an
		// existing row isn't bricked before its data migration rewrites the keys.
		if (!isMacroId(tag) && isNullish(currentDoc?.categories?.[tag])) {
			throw new Error(`league_stats category key "${tag}" is not a known market category.`);
		}

		if (nonNullish(bucket)) {
			if (bucket.wins > bucket.calls) {
				throw new Error(
					`league_stats category "${tag}" wins (${bucket.wins}) cannot exceed calls (${bucket.calls}).`
				);
			}

			if (bucket.calls < 0 || bucket.wins < 0) {
				throw new Error(`league_stats category "${tag}" counters must be non-negative.`);
			}
		}
	}

	// 4. Forward-only counters (aggregate + every bucket).
	if (nonNullish(currentDoc)) {
		if (proposedDoc.totalCalls < currentDoc.totalCalls) {
			throw new Error('league_stats totalCalls cannot decrease.');
		}

		if (proposedDoc.wins < currentDoc.wins) {
			throw new Error('league_stats wins cannot decrease.');
		}

		if (currentDoc.leagueId !== proposedDoc.leagueId) {
			throw new Error('league_stats leagueId is immutable.');
		}

		for (const [tag, currentBucket] of Object.entries(currentDoc.categories ?? {})) {
			if (nonNullish(currentBucket)) {
				const proposedBucket = proposedDoc.categories?.[tag];

				if (
					isNullish(proposedBucket) ||
					proposedBucket.calls < currentBucket.calls ||
					proposedBucket.wins < currentBucket.wins
				) {
					throw new Error(`league_stats category "${tag}" counters cannot decrease.`);
				}
			}
		}
	}
};

/**
 * Subset of the user profile fields the hook reads.
 */
interface ProfileStatsSlice {
	totalTrades?: number;
	winRate?: number;
}

const winsFromProfile = (slice: ProfileStatsSlice): number => {
	const trades = slice.totalTrades ?? 0;
	const rate = slice.winRate ?? 0;

	// Profile stores `winRate` as a percentage (0..100). Round to the
	// nearest integer count of wins. Lossy at extreme tails; acceptable
	// for an aggregate accuracy display.
	return Math.round((trades * rate) / 100);
};

/**
 * Post-write hook on `profiles`. Fires after every profile update;
 * detects whether `totalTrades` advanced (a trade resolved) and fans
 * the win/loss delta out to the user's league stats docs.
 *
 *  - First-write path (`before` is null): no delta to attribute.
 *  - Idempotent: a duplicate hook fire with identical before/after
 *    produces `Δtrades = 0` and writes nothing.
 *  - User can be a member of N leagues; the per-call cost is bounded
 *    by their league count.
 */
export const onProfileSetForLeagueStats = (ctx: OnSetDocContext): void => {
	const {
		caller,
		data: { collection, data }
	} = ctx;

	if (collection !== Collection.PROFILES) {
		return;
	}

	const { before, after } = data;

	if (isNullish(before)) {
		return;
	}

	let beforeProfile: ProfileStatsSlice;
	let afterProfile: UserProfile;

	try {
		beforeProfile = decodeDocData<UserProfile>(before.data);
		afterProfile = decodeDocData<UserProfile>(after.data);
	} catch {
		return;
	}

	// Stats freeze (Delete account v2). A hibernated account must not move
	// shared stats. In practice a hibernated user is inactive (no trades →
	// no profile writes); this is a defensive guard against a stray write
	// while hibernated fanning out a delta. Can't suppress the legitimate
	// `resumeMyAccount` write: clearing `hibernatedAtMs` leaves
	// `totalTrades` unchanged (delta 0) and the AFTER profile is no longer
	// hibernated, so it passes this guard anyway.
	if (isHibernated(afterProfile)) {
		return;
	}

	const beforeTrades = beforeProfile.totalTrades ?? 0;
	const afterTrades = afterProfile.totalTrades ?? 0;
	const deltaTrades = afterTrades - beforeTrades;

	if (deltaTrades <= 0) {
		return;
	}

	const beforeWins = winsFromProfile(beforeProfile);
	const afterWins = winsFromProfile(afterProfile);
	const deltaWins = Math.max(0, Math.min(deltaTrades, afterWins - beforeWins));

	const callerText = Principal.fromUint8Array(caller).toText();
	const nowMs = Number(time() / 1_000_000n);

	// Scan the caller's memberships only. Key shape
	// `${leagueId}/${memberPrincipal}`, so a key matcher anchored to the
	// caller suffix bounds the read to their rows instead of scanning every
	// membership in the collection.
	const { items } = listDocsStore({
		collection: Collection.LEAGUE_MEMBERS,
		caller,
		params: { matcher: { key: `/${escapeRegex(callerText)}$` } }
	});

	for (const [, item] of items) {
		let memberDoc: LeagueMemberDoc | undefined;

		try {
			memberDoc = decodeDocData<LeagueMemberDoc>(item.data);
		} catch {
			memberDoc = undefined;
		}

		if (nonNullish(memberDoc) && memberDoc.member === callerText) {
			incrementLeagueStats({
				caller,
				leagueId: memberDoc.leagueId,
				deltaTrades,
				deltaWins,
				nowMs
			});
		}
	}
};

/**
 * Apply a (deltaTrades, deltaWins) increment to a single league's
 * rolling stats doc. Creates the doc on first write; reads
 * + bumps + writes otherwise.
 */
const incrementLeagueStats = ({
	caller,
	leagueId,
	deltaTrades,
	deltaWins,
	nowMs
}: {
	caller: Uint8Array;
	leagueId: string;
	deltaTrades: number;
	deltaWins: number;
	nowMs: number;
}): void => {
	const docKey = leagueStatsKey({ leagueId });
	const existing = getDocStore({
		collection: Collection.LEAGUE_STATS,
		key: docKey,
		caller
	});

	const baseDoc: LeagueStatsDoc = isNullish(existing)
		? {
				leagueId,
				totalCalls: 0,
				wins: 0,
				updatedAtMs: nowMs
			}
		: decodeDocData<LeagueStatsDoc>(existing.data);

	const next: LeagueStatsDoc = {
		...baseDoc,
		totalCalls: baseDoc.totalCalls + deltaTrades,
		wins: baseDoc.wins + deltaWins,
		updatedAtMs: nowMs
	};

	setDocStore({
		collection: Collection.LEAGUE_STATS,
		key: docKey,
		caller,
		doc: {
			data: encodeDocData(next),
			version: existing?.version
		}
	});
};

/**
 * Post-write hook on `USER_STATS`. Maintains the per-category buckets
 * on each of the writer's `league_stats` docs, sourced exactly from the
 * user's `categoryStats` deltas. The aggregate counters
 * (`totalCalls` / `wins`) stay owned by `onProfileSetForLeagueStats`;
 * this hook only touches `categories`, so the two hooks never contend
 * for the same field even though both write the same doc.
 *
 *  - First-write path (`before` null): the full `categoryStats` seeds
 *    the buckets.
 *  - Idempotent: identical before/after → zero deltas → no write.
 *  - Hibernation: skip when the writer's profile is hibernated (parity
 *    with the aggregate hook's stats freeze).
 */
export const onUserStatsSetForLeagueStats = (ctx: OnSetDocContext): void => {
	const {
		caller,
		data: { collection, data }
	} = ctx;

	if (collection !== Collection.USER_STATS) {
		return;
	}

	const { before, after } = data;

	let afterStats: UserStatsDoc;
	let beforeStats: UserStatsDoc | undefined;

	try {
		afterStats = decodeDocData<UserStatsDoc>(after.data);
		beforeStats = nonNullish(before) ? decodeDocData<UserStatsDoc>(before.data) : undefined;
	} catch {
		return;
	}

	const callerText = Principal.fromUint8Array(caller).toText();

	// Stats freeze — a hibernated account must not move shared stats.
	const profile = getDocStore({
		collection: Collection.PROFILES,
		key: callerText,
		caller
	});

	if (nonNullish(profile)) {
		try {
			if (isHibernated(decodeDocData<UserProfile>(profile.data))) {
				return;
			}
		} catch {
			// Unreadable profile — fall through and let the deltas apply.
		}
	}

	// Per-category deltas, clamped ≥ 0. A re-aggregation only grows in
	// practice; the clamp defends the forward-only assert regardless. Buckets
	// are keyed by macro category — the closed {@link MACRO_IDS} set — so a
	// legacy flat-tag key in `categoryStats` (e.g. `wc`) is simply not read.
	const deltas: Partial<Record<MacroId, CategoryStatsBucket>> = {};
	let hasDelta = false;

	for (const tag of MACRO_IDS) {
		const afterBucket = afterStats.categoryStats[tag];

		if (nonNullish(afterBucket)) {
			const beforeBucket = beforeStats?.categoryStats[tag];
			const deltaCalls = Math.max(0, afterBucket.calls - (beforeBucket?.calls ?? 0));
			// Clamp wins to calls: a re-aggregation can shift bucket composition
			// so raw `Δwins > Δcalls`, which the forward-only assert (wins ≤
			// calls) would reject and fail the whole hook write.
			const deltaWins = Math.min(
				deltaCalls,
				Math.max(0, afterBucket.wins - (beforeBucket?.wins ?? 0))
			);

			if (deltaCalls > 0 || deltaWins > 0) {
				deltas[tag] = { calls: deltaCalls, wins: deltaWins };
				hasDelta = true;
			}
		}
	}

	if (!hasDelta) {
		return;
	}

	const nowMs = Number(time() / 1_000_000n);

	// Scan the caller's memberships only. Key shape
	// `${leagueId}/${memberPrincipal}`, so a key matcher anchored to the
	// caller suffix bounds the read to their rows instead of scanning every
	// membership in the collection.
	const { items } = listDocsStore({
		collection: Collection.LEAGUE_MEMBERS,
		caller,
		params: { matcher: { key: `/${escapeRegex(callerText)}$` } }
	});

	for (const [, item] of items) {
		let memberDoc: LeagueMemberDoc | undefined;

		try {
			memberDoc = decodeDocData<LeagueMemberDoc>(item.data);
		} catch {
			memberDoc = undefined;
		}

		if (nonNullish(memberDoc) && memberDoc.member === callerText) {
			incrementLeagueStatsCategories({ caller, leagueId: memberDoc.leagueId, deltas, nowMs });
		}
	}
};

/**
 * Apply per-category increments to a single league's stats doc, leaving
 * the `'all'` aggregate untouched. Creates the doc on first write.
 */
const incrementLeagueStatsCategories = ({
	caller,
	leagueId,
	deltas,
	nowMs
}: {
	caller: Uint8Array;
	leagueId: string;
	deltas: Partial<Record<MacroId, CategoryStatsBucket>>;
	nowMs: number;
}): void => {
	const docKey = leagueStatsKey({ leagueId });
	const existing = getDocStore({
		collection: Collection.LEAGUE_STATS,
		key: docKey,
		caller
	});

	const baseDoc: LeagueStatsDoc = isNullish(existing)
		? {
				leagueId,
				totalCalls: 0,
				wins: 0,
				updatedAtMs: nowMs
			}
		: decodeDocData<LeagueStatsDoc>(existing.data);

	// Preserve any legacy (non-macro) keys already on the doc — they're carried
	// untouched so an existing row isn't rewritten under the forward-only assert;
	// only the macro-keyed deltas below mutate.
	const categories: Partial<Record<string, CategoryStatsBucket>> = { ...baseDoc.categories };

	for (const [tag, delta] of Object.entries(deltas)) {
		if (nonNullish(delta)) {
			const current = categories[tag] ?? { calls: 0, wins: 0 };
			categories[tag] = {
				calls: current.calls + delta.calls,
				wins: current.wins + delta.wins
			};
		}
	}

	const next: LeagueStatsDoc = {
		...baseDoc,
		categories,
		updatedAtMs: nowMs
	};

	setDocStore({
		collection: Collection.LEAGUE_STATS,
		key: docKey,
		caller,
		doc: {
			data: encodeDocData(next),
			version: existing?.version
		}
	});
};

/**
 * Read a single league's current stats. Returns `undefined` when no
 * doc exists yet (a brand-new league with no resolved trades).
 */
export const getLeagueStatsFn = ({
	leagueId,
	caller
}: {
	leagueId: string;
	caller: Uint8Array;
}): LeagueStatsDoc | undefined => {
	const doc = getDocStore({
		collection: Collection.LEAGUE_STATS,
		key: leagueStatsKey({ leagueId }),
		caller
	});

	if (isNullish(doc)) {
		return;
	}

	try {
		return decodeDocData<LeagueStatsDoc>(doc.data);
	} catch {
		// Malformed payload — fall through to undefined.
	}
};
