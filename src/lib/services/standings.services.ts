import type { ClearingDid } from '#declarations';
import { listLeaderboard } from '#lib/api/clearing.api.ts';
import { safeGetIdentityOnce } from '#lib/services/identity.services.ts';
import { setGlobalStandings } from '#lib/stores/standings.store.ts';
import type { StandingEntry, StandingsResult, StandingsWindow } from '#lib/types/standings.ts';
import { isWeb2Backend } from '#lib/web2/backend-mode.ts';
import { listEngineLeaderboard as listEngineLeaderboardWeb2 } from '#lib/web2/client.ts';
import { fromNullable, isNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import type { PrincipalText } from '@junobuild/schema';

/**
 * Per-window ranked standings, sourced from the clearing canister's
 * `list_leaderboard` query (ranked by net realized P&L over a fixed calendar
 * window). The query is `caller_is_not_anonymous`-guarded, so every read
 * needs a signed-in identity.
 *
 * The clearing layer owns settlement and ranking; the satellite owns league
 * membership, so the league filter is supplied by the caller as a principal
 * set (`members`). This service maps the wire aggregate onto the FE
 * {@link StandingEntry} view model (rank, prior-window rank, the ↑/↓ delta,
 * realized P&L, and a `win_count / settled_count` accuracy) — it never
 * fabricates a figure: an empty window simply yields no entries.
 */

/** Drain cap: one window's ranked list is bounded so a large global standings
 *  set can't fan out into an unbounded number of round-trips. At 500 entries
 *  per page this covers 5,000 ranked principals. */
const MAX_STANDINGS_PAGES = 10;
const STANDINGS_PAGE_LIMIT = 500n;

const toWindow = (window: StandingsWindow): ClearingDid.LeaderboardWindow => {
	switch (window) {
		case 'week':
			return { Week: null };
		case 'month':
			return { Month: null };
		case 'all':
			return { AllTime: null };
	}
};

const toEntry = (entry: ClearingDid.LeaderboardEntry): StandingEntry => {
	const rank = Number(entry.rank);
	const priorRankRaw = fromNullable(entry.prior_rank);
	const priorRank = isNullish(priorRankRaw) ? undefined : Number(priorRankRaw);

	// `priorRank - rank` so a smaller (better) current rank reads as a
	// positive climb; `undefined` when there is no comparable prior window.
	const rankDelta = isNullish(priorRank) ? undefined : priorRank - rank;

	const settledCount = Number(entry.settled_count);
	const winCount = Number(entry.win_count);
	const accuracy = settledCount === 0 ? 0 : Math.round((winCount / settledCount) * 100);

	return {
		owner: entry.principal.toText(),
		rank,
		priorRank,
		rankDelta,
		realizedPnl: entry.realized_pnl,
		settledCount,
		winCount,
		accuracy
	};
};

/**
 * Global ranked standings for one window. Only principals that settled at
 * least one position in the window appear; an empty / cold-start window
 * yields no entries.
 */
export const getStandings = async ({
	window
}: {
	window: StandingsWindow;
}): Promise<StandingsResult> => {
	// The global ranking is a public engine read on the HTTP bridge, so web2
	// needs no signed identity. `owner` on each entry stays the on-chain
	// principal from clearing (the ranking's native key) until the engine and
	// wallet swap maps engine identities onto accounts. The bridge drains the
	// ranking with its own page bound, which covers the same visible depth.
	if (isWeb2Backend()) {
		const { items, total } = await listEngineLeaderboardWeb2({
			window: toWindow(window),
			limit: STANDINGS_PAGE_LIMIT
		});

		return { window, entries: items.map(toEntry), total: Number(total) };
	}

	const identity = await safeGetIdentityOnce();

	const { items, total } = await listLeaderboard({
		identity,
		window: toWindow(window),
		pageLimit: STANDINGS_PAGE_LIMIT,
		maxPages: MAX_STANDINGS_PAGES,
		certified: false
	});

	return { window, entries: items.map(toEntry), total: Number(total) };
};

/**
 * Loads one window's global standings ranking and merges it into
 * {@link globalStandingsStore}. Ranking only — it deliberately does NOT
 * hydrate the profile cache.
 *
 * Profile hydration is the caller's job, because the two consumers have wildly
 * different needs from the SAME cached slice: the dashboard rank tile renders
 * only the viewer's own rank (no other handle/avatar), whereas the Leaderboard
 * renders every row. Folding a hydrate-everyone fan-out in here meant the dash
 * — hit on the first authenticated page of a session — fired one `getProfile`
 * per ranked principal (up to {@link MAX_STANDINGS_PAGES} × 500), a multi-
 * thousand request burst it threw away. The Leaderboard now hydrates only the
 * rows it actually paints (see `LeaderboardPage`).
 */
export const loadGlobalStandings = async ({
	window
}: {
	window: StandingsWindow;
}): Promise<void> => {
	setGlobalStandings(await getStandings({ window }));
};

/**
 * Ranked standings within a single league / affiliation, computed over the
 * supplied member set in isolation (inactive members are included with a
 * zeroed aggregate, so the slice covers the whole roster). Returns an empty
 * result when the roster is empty.
 *
 * Empty on the web2 backend for now: the HTTP bridge's leaderboard read has
 * no member filter, and with the leagues domain swapped the rosters carry
 * account ids while this clearing query scopes by on-chain principals, so a
 * member-filtered bridge read (with the identity mapping) has to exist before
 * this can swap. Until then every member-scoped slice renders as "no
 * standings yet", which each caller already handles.
 */
export const getLeagueStandings = async ({
	window,
	members
}: {
	window: StandingsWindow;
	members: PrincipalText[];
}): Promise<StandingsResult> => {
	if (members.length === 0 || isWeb2Backend()) {
		return { window, entries: [], total: 0 };
	}

	const identity = await safeGetIdentityOnce();

	const { items, total } = await listLeaderboard({
		identity,
		window: toWindow(window),
		members: members.map((m) => Principal.fromText(m)),
		pageLimit: STANDINGS_PAGE_LIMIT,
		maxPages: MAX_STANDINGS_PAGES,
		certified: false
	});

	return { window, entries: items.map(toEntry), total: Number(total) };
};

/**
 * The signed-in viewer's own standing within a window, or `undefined` when
 * they have not yet appeared (no settled position in the window). Convenience
 * over {@link getStandings} for the dashboard rank tiles.
 */
export const findOwnStanding = ({
	result,
	owner
}: {
	result: StandingsResult;
	owner: PrincipalText | undefined;
}): StandingEntry | undefined => {
	if (isNullish(owner)) {
		return;
	}

	return result.entries.find((entry) => entry.owner === owner);
};
