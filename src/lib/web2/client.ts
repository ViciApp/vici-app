import type { ClearingDid, RegistryDid } from '$declarations';
import type { AppLocale } from '$lib/constants/locale.constants';
import type { LeaguePrivacy } from '$lib/enums/league';
import type { ProfileVisibility } from '$lib/enums/profile';
import type { UserRole } from '$lib/enums/user';
import type { AffiliationDoc, AffiliationKind } from '$lib/types/affiliation';
import type {
	AffiliationChampionship,
	AffiliationMemberCount,
	AffiliationStatsDoc
} from '$lib/types/affiliation-stats';
import type { TrackEventInput } from '$lib/types/analytics-event';
import { isBattleScope, type BattleDoc, type BattleWinner } from '$lib/types/battle';
import type { ExitSignalReason } from '$lib/types/exit-signal';
import type { LeagueDoc } from '$lib/types/league';
import type { LeagueMemberDoc, LeagueMemberRole } from '$lib/types/league-member';
import type { CallSide } from '$lib/types/market';
import type { MarketMetadata, MarketMetadataInput } from '$lib/types/market-metadata';
import type { MarketTranslation, MarketTranslationInput } from '$lib/types/market-translation';
import type { UserProfile } from '$lib/types/profile';
import type { FriendRequestOutcome, Relation } from '$lib/types/relation';
import type {
	Activity,
	ActivityReaction,
	ActivityReactionCount,
	ResolvedResult
} from '$lib/types/social';
import type { TournamentDoc, TournamentMatchDoc } from '$lib/types/tournament';
import type { UserStatsDoc } from '$lib/types/user-stats';
import { web2ApiBaseUrl } from '$lib/web2/backend-mode';
import {
	intervalToWire,
	leaderboardWindowToWire,
	mapAccountStateResponse,
	mapCollateralAssetInfo,
	mapEvent,
	mapLeaderboardEntry,
	mapLimitOrder,
	mapPosition,
	mapPriceCandle,
	mapSeries,
	mapSeriesTradePage,
	mapSeriesTradedVolume,
	mapSettlementStatus,
	type Web2AccountStateResponseWire,
	type Web2CollateralAssetInfoWire,
	type Web2EventWire,
	type Web2LeaderboardEntryWire,
	type Web2LimitOrderWire,
	type Web2PositionWire,
	type Web2PriceCandleWire,
	type Web2SeriesTradePageWire,
	type Web2SeriesTradedVolumeWire,
	type Web2SeriesWire,
	type Web2SettlementStatusWire
} from '$lib/web2/engine-wire';
import { isNullish, nonNullish } from '@dfinity/utils';

/**
 * Thin typed fetch client for the HTTP API (`/api/v1/...`).
 *
 * Sessions ride an HttpOnly cookie, so every request opts in to
 * credentials; the client itself holds no auth state. Error responses use
 * a stable `{ error: string }` envelope, surfaced as {@link Web2ApiError}
 * so callers can branch on `status` / `code` without parsing bodies.
 *
 * Add a typed wrapper here per endpoint a dual-mode service needs; keep
 * the wrappers thin (shape mapping only, no orchestration).
 */

export class Web2ApiError extends Error {
	readonly status: number;
	/** Stable machine-readable code from the `{ error }` envelope. */
	readonly code: string;

	constructor({ status, code }: { status: number; code: string }) {
		super(`Web2 API error (${status}): ${code}`);

		this.status = status;
		this.code = code;
	}
}

const errorCode = async (response: Response): Promise<string> => {
	try {
		const payload: unknown = await response.json();

		if (
			!isNullish(payload) &&
			typeof payload === 'object' &&
			'error' in payload &&
			typeof payload.error === 'string'
		) {
			return payload.error;
		}
	} catch {
		// Non-JSON error body (proxy error page, empty 502); the generic code below applies.
	}

	return 'unknown_error';
};

const request = async <T>({
	path,
	method,
	body
}: {
	path: string;
	method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
	body?: Record<string, unknown>;
}): Promise<T> => {
	const response = await fetch(`${web2ApiBaseUrl()}${path}`, {
		method,
		credentials: 'include',
		...(isNullish(body)
			? {}
			: {
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body)
				})
	});

	if (!response.ok) {
		throw new Web2ApiError({ status: response.status, code: await errorCode(response) });
	}

	return (await response.json()) as T;
};

export type Web2ProviderStatus = 'available' | 'coming_soon';

export interface Web2Providers {
	email: Web2ProviderStatus;
	google: Web2ProviderStatus;
	apple: Web2ProviderStatus;
}

export interface Web2Identity {
	provider: string;
	email: string | null;
}

export interface Web2LegacyPrincipal {
	principal: string;
	matchedVia: string;
}

export interface Web2Me {
	id: string;
	role: string;
	displayName: string | null;
	avatarUrl: string | null;
	createdAt: string;
	identities: Web2Identity[];
	legacyPrincipals: Web2LegacyPrincipal[];
}

export const getProviders = async (): Promise<Web2Providers> => {
	const { providers } = await request<{ providers: Web2Providers }>({
		path: '/api/v1/auth/providers',
		method: 'GET'
	});

	return providers;
};

export const getMe = async (): Promise<Web2Me> => {
	const { user } = await request<{ user: Web2Me }>({ path: '/api/v1/me', method: 'GET' });

	return user;
};

/**
 * Ask the API to email a one-time code to `email`. Resolves on a queued
 * send; a 4xx (unknown/invalid address, rate limit) surfaces as
 * {@link Web2ApiError} so the caller can message the user.
 */
export const requestOtp = async ({ email }: { email: string }): Promise<void> => {
	await request<{ ok: boolean }>({
		path: '/api/v1/auth/otp/request',
		method: 'POST',
		body: { email }
	});
};

/**
 * Exchange an emailed code for a session. The API sets the HttpOnly session
 * cookie on the response and echoes the `/me` body, so the returned user can
 * seed the session store without a second round-trip. A wrong or expired
 * code throws {@link Web2ApiError} (`status` 401), a locked address 429.
 */
export const verifyOtp = async ({
	email,
	code
}: {
	email: string;
	code: string;
}): Promise<Web2Me> => {
	const { user } = await request<{ user: Web2Me }>({
		path: '/api/v1/auth/otp/verify',
		method: 'POST',
		body: { email, code }
	});

	return user;
};

/**
 * Absolute URL of the Google sign-in entry. It is a full-page redirect
 * target (the API sets a signed state cookie and 302s on to Google), not a
 * fetch, so callers navigate to it. `returnTo` is the in-app path the API
 * redirects to after its callback; it must be a same-app absolute path
 * (`/flow?x=1`, never a full URL) — the API embeds it in the signed OAuth
 * state and clamps anything else to `/` to rule out open redirects.
 */
export const googleSignInUrl = ({ returnTo }: { returnTo?: string } = {}): string => {
	const url = `${web2ApiBaseUrl()}/api/v1/auth/google`;

	if (isNullish(returnTo) || returnTo === '') {
		return url;
	}

	return `${url}?returnTo=${encodeURIComponent(returnTo)}`;
};

export const postEvents = async ({
	events
}: {
	events: TrackEventInput[];
}): Promise<{ accepted: number }> =>
	await request<{ accepted: number }>({
		path: '/api/v1/events',
		method: 'POST',
		body: { events }
	});

export const logout = async (): Promise<void> => {
	await request<{ ok: boolean }>({ path: '/api/v1/auth/logout', method: 'POST' });
};

export interface Web2ClaimResult {
	principal: string;
	/** True when the principal was already linked to the calling account. */
	alreadyLinked: boolean;
}

/** Submit a signed principal-handoff blob; links the proven principal to the
 * session account. Foreign links throw a 409 `principal_already_linked`. */
export const postClaim = async ({ blob }: { blob: string }): Promise<Web2ClaimResult> => {
	const { principal, alreadyLinked } = await request<{
		principal: string;
		alreadyLinked: boolean;
	}>({
		path: '/api/v1/claim',
		method: 'POST',
		body: { blob }
	});

	return { principal, alreadyLinked };
};

// ─── Profiles + social + leaderboard ─────────────────────────────────────
//
// The HTTP API keys a user by an opaque `userId` (uuid) where the on-chain
// stack keys by a principal. The app's domain shape (`UserProfile`, `Relation`,
// `ResolvedResult`) uses the single `owner` string for that identity, so the
// wrappers below carry the wire→app rename (`userId` → `owner`) and re-narrow
// the loose wire string unions back to the app enums, keeping the return shapes
// byte-identical to the satellite services. A dual-mode service calls one of
// these behind `isWeb2Backend()`; the default on-chain path is untouched.

const encodeQuery = (params: Record<string, string>): string =>
	Object.entries(params)
		.map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
		.join('&');

/** Wire profile: the app profile with `owner` carried as `userId`. The API can
 * also carry an `email` column on this row; it is dropped in {@link mapProfile}
 * so it never rides a public profile object (leaderboard / search) on the
 * client, mirroring the on-chain split that keeps the address off the public
 * doc. */
type Web2ProfileWire = Omit<UserProfile, 'owner' | 'visibility' | 'role'> & {
	userId: string;
	visibility: string;
	role?: string;
	email?: string;
};

const mapProfile = (wire: Web2ProfileWire): UserProfile => {
	const { userId, visibility, role, email: _email, ...rest } = wire;

	return {
		...rest,
		owner: userId,
		visibility: visibility as ProfileVisibility,
		...(nonNullish(role) ? { role: role as UserRole } : {})
	};
};

/** Wire relation: `{ key, category, state, participants }`. The app `Relation`
 * drops the key (callers rebuild it from the participants when they need it). */
interface Web2RelationWire {
	key: string;
	category: Relation['category'];
	state: Relation['state'];
	participants: [string, string];
}

const mapRelation = (wire: Web2RelationWire): Relation => ({
	category: wire.category,
	state: wire.state,
	participants: wire.participants
});

interface Web2UserStatsWire {
	userId: string;
	categoryStats: UserStatsDoc['categoryStats'];
	recentSettlements: UserStatsDoc['recentSettlements'];
	computedAtMs: number;
}

interface Web2ResolvedResultWire {
	userId: string;
	marketId: string;
	title: string;
	side: string;
	outcome: 'win' | 'loss';
	netVxp: number;
	resolvedAtMs: number;
}

/** The caller's own profile, or `undefined` before the first profile write. */
export const getMyProfile = async (): Promise<UserProfile | undefined> => {
	const { profile } = await request<{ profile: Web2ProfileWire | null }>({
		path: '/api/v1/profiles/me',
		method: 'GET'
	});

	return isNullish(profile) ? undefined : mapProfile(profile);
};

/** The caller's own on-file email off the owner profile row, `''` when no
 * profile (or no address) is stored. A separate read from {@link getMyProfile}
 * because {@link mapProfile} deliberately drops `email` from every profile
 * object the app handles. */
export const getMyProfileEmail = async (): Promise<string> => {
	const { profile } = await request<{ profile: Web2ProfileWire | null }>({
		path: '/api/v1/profiles/me',
		method: 'GET'
	});

	return profile?.email?.trim() ?? '';
};

/** A public profile by id, or `undefined` when absent / hidden to the caller. */
export const getProfileById = async (userId: string): Promise<UserProfile | undefined> => {
	const { profile } = await request<{ profile: Web2ProfileWire | null }>({
		path: `/api/v1/profiles/${encodeURIComponent(userId)}`,
		method: 'GET'
	});

	return isNullish(profile) ? undefined : mapProfile(profile);
};

/** Full-doc write of the caller's own profile; returns the stored result. */
export const upsertMyProfile = async (data: Record<string, unknown>): Promise<UserProfile> => {
	const { profile } = await request<{ profile: Web2ProfileWire }>({
		path: '/api/v1/profiles/me',
		method: 'PUT',
		body: data
	});

	return mapProfile(profile);
};

/** Server-side nickname validity + uniqueness probe. The caller's own current
 * nickname never counts as a conflict (the session identifies the caller). */
export const checkNicknameAvailability = async (
	nickname: string
): Promise<
	| { available: true }
	| { available: false; reason: 'required' | 'too_short' | 'too_long' | 'invalid' | 'taken' }
> =>
	await request({
		path: `/api/v1/profiles/nickname-availability?${encodeQuery({ nickname })}`,
		method: 'GET'
	});

/** Case-insensitive search over nickname, id, and linked legacy principal. */
export const searchProfiles = async (queryStr: string): Promise<UserProfile[]> => {
	const { items } = await request<{ items: Web2ProfileWire[] }>({
		path: `/api/v1/profiles/search?${encodeQuery({ q: queryStr })}`,
		method: 'GET'
	});

	return items.map(mapProfile);
};

/** Whether two users hold an active friendship. */
export const checkFriendship = async ({
	userA,
	userB
}: {
	userA: string;
	userB: string;
}): Promise<boolean> => {
	const { isFriend } = await request<{ isFriend: boolean }>({
		path: `/api/v1/social/friendship?${encodeQuery({ userA, userB })}`,
		method: 'GET'
	});

	return isFriend;
};

/** The caller's dashboard stat cache, or `undefined` before the first sync. */
export const getUserStats = async (): Promise<UserStatsDoc | undefined> => {
	const { stats } = await request<{ stats: Web2UserStatsWire | null }>({
		path: '/api/v1/profiles/me/stats',
		method: 'GET'
	});

	if (isNullish(stats)) {
		return;
	}

	const { userId, ...rest } = stats;

	return { owner: userId, ...rest };
};

/** Record one committed Flow swipe against the server-authoritative daily
 * counter; the server owns the count and the cap. */
export const recordFlowSwipe = async ({
	dayKey
}: {
	dayKey: string;
}): Promise<{ dailyGoalDone: number; dailyGoalDate: string; capReached: boolean }> =>
	await request({
		path: '/api/v1/profiles/flow-swipe',
		method: 'POST',
		body: { dayKey }
	});

/** Top profiles by points, ranked server-side. */
export const listLeaderboard = async (): Promise<UserProfile[]> => {
	const { items } = await request<{ items: Web2ProfileWire[] }>({
		path: '/api/v1/leaderboard/',
		method: 'GET'
	});

	return items.map(mapProfile);
};

/** The caller's rival across the full ranking, or `undefined` when unranked /
 * the lone ranked profile. `rivalIsTrailing` frames the gap as a lead. */
export const getMyRival = async (): Promise<
	{ profile: UserProfile; isTrailing: boolean } | undefined
> => {
	const { rival, rivalIsTrailing } = await request<{
		rival: Web2ProfileWire | null;
		rivalIsTrailing: boolean;
	}>({ path: '/api/v1/leaderboard/rival', method: 'GET' });

	return isNullish(rival) ? undefined : { profile: mapProfile(rival), isTrailing: rivalIsTrailing };
};

const listRelations = async (path: string): Promise<Relation[]> => {
	const { items } = await request<{ items: Web2RelationWire[] }>({ path, method: 'GET' });

	return items.map(mapRelation);
};

export const listFriends = (): Promise<Relation[]> => listRelations('/api/v1/social/friends');

export const listFollowers = (): Promise<Relation[]> => listRelations('/api/v1/social/followers');

export const listFollowing = (): Promise<Relation[]> => listRelations('/api/v1/social/following');

export const listFriendRequests = (): Promise<Relation[]> =>
	listRelations('/api/v1/social/friend-requests');

export const listSentFriendRequests = (): Promise<Relation[]> =>
	listRelations('/api/v1/social/friend-requests/sent');

export const sendFriendRequest = async (target: string): Promise<FriendRequestOutcome> =>
	await request({ path: '/api/v1/social/friend-requests', method: 'POST', body: { target } });

export const acceptFriendRequest = async (relationId: string): Promise<void> => {
	await request<{ ok: boolean }>({
		path: `/api/v1/social/friend-requests/${encodeURIComponent(relationId)}/accept`,
		method: 'POST'
	});
};

export const rejectFriendRequest = async (relationId: string): Promise<void> => {
	await request<{ ok: boolean }>({
		path: `/api/v1/social/friend-requests/${encodeURIComponent(relationId)}/reject`,
		method: 'POST'
	});
};

export const cancelFriendRequest = async (relationId: string): Promise<void> => {
	await request<{ ok: boolean }>({
		path: `/api/v1/social/friend-requests/${encodeURIComponent(relationId)}`,
		method: 'DELETE'
	});
};

export const unfriendUser = async (userId: string): Promise<void> => {
	await request<{ ok: boolean }>({
		path: `/api/v1/social/friends/${encodeURIComponent(userId)}`,
		method: 'DELETE'
	});
};

export const followUser = async (target: string): Promise<void> => {
	await request<{ ok: boolean }>({
		path: '/api/v1/social/follow',
		method: 'POST',
		body: { target }
	});
};

export const unfollowUser = async (userId: string): Promise<void> => {
	await request<{ ok: boolean }>({
		path: `/api/v1/social/follow/${encodeURIComponent(userId)}`,
		method: 'DELETE'
	});
};

/** Friend-scoped resolved-result rows for the Arena results digest. */
export const listFriendResolvedResults = async (friends: string[]): Promise<ResolvedResult[]> => {
	if (friends.length === 0) {
		return [];
	}

	const { items } = await request<{ items: Web2ResolvedResultWire[] }>({
		path: `/api/v1/social/resolved-results?${encodeQuery({ friends: friends.join(',') })}`,
		method: 'GET'
	});

	return items.map(({ userId, ...rest }) => ({ owner: userId, ...rest }));
};

// ─── Markets (metadata + translations) ───────────────────────────────────
//
// The HTTP API stores market metadata and translations in the same camelCase
// shape the app types already use, so these wrappers are plain envelope
// unwraps. Writes go through the same curator gate server-side (admin or
// series creator, resolved via the caller's session).

/** Editorial metadata for one series, or `undefined` when none is stored. */
export const getMarketMetadata = async (seriesId: string): Promise<MarketMetadata | undefined> => {
	const { metadata } = await request<{ metadata: MarketMetadata | null }>({
		path: `/api/v1/markets/${encodeURIComponent(seriesId)}/metadata`,
		method: 'GET'
	});

	return metadata ?? undefined;
};

export const upsertMarketMetadata = async ({
	seriesId,
	data
}: {
	seriesId: string;
	data: MarketMetadataInput;
}): Promise<MarketMetadata> => {
	const { metadata } = await request<{ metadata: MarketMetadata }>({
		path: `/api/v1/markets/${encodeURIComponent(seriesId)}/metadata`,
		method: 'PUT',
		body: data
	});

	return metadata;
};

/** One stored translation overlay, or `undefined` when the locale has none. */
export const getMarketTranslation = async ({
	seriesId,
	locale
}: {
	seriesId: string;
	locale: AppLocale;
}): Promise<MarketTranslation | undefined> => {
	const { translation } = await request<{ translation: MarketTranslation | null }>({
		path: `/api/v1/markets/${encodeURIComponent(seriesId)}/translations/${encodeURIComponent(locale)}`,
		method: 'GET'
	});

	return translation ?? undefined;
};

export const listMarketTranslations = async (seriesId: string): Promise<MarketTranslation[]> => {
	const { items } = await request<{ items: MarketTranslation[] }>({
		path: `/api/v1/markets/${encodeURIComponent(seriesId)}/translations`,
		method: 'GET'
	});

	return items;
};

/** Bulk overlay read across the visible series ids x the reader's candidate
 * locales; the caller resolves best-per-series client-side. */
export const listMarketTranslationsForLocales = async ({
	seriesIds,
	locales
}: {
	seriesIds: string[];
	locales: AppLocale[];
}): Promise<MarketTranslation[]> => {
	const { items } = await request<{ items: MarketTranslation[] }>({
		path: '/api/v1/markets/translations/query',
		method: 'POST',
		body: { seriesIds, locales }
	});

	return items;
};

export const upsertMarketTranslation = async ({
	seriesId,
	locale,
	data
}: {
	seriesId: string;
	locale: AppLocale;
	data: MarketTranslationInput;
}): Promise<MarketTranslation> => {
	const { translation } = await request<{ translation: MarketTranslation }>({
		path: `/api/v1/markets/${encodeURIComponent(seriesId)}/translations/${encodeURIComponent(locale)}`,
		method: 'PUT',
		body: data
	});

	return translation;
};

// ─── Public engine reads ─────────────────────────────────────────────────
//
// The API proxies the same anonymous registry / clearing queries the app runs
// on-chain today, serialized to JSON (bigints as strings, principals as
// text). The `engine-wire` mappers convert each payload back into the exact
// `$declarations` candid types, so services hand downstream utils and stores
// the same shapes on both transports. Only public market-wide reads live
// here: every user-signed engine call (orders, collateral moves, positions)
// stays on-chain until the engine / wallet swap.

/**
 * The series catalog. `tradeableNow` maps to the registry's tradeable-now
 * filter; for this app's series (which never carry a future start gate) it is
 * exactly the unexpired set the on-chain path requests via `only_unexpired`.
 */
export const listEngineSeries = async ({
	tradeableNow = false
}: { tradeableNow?: boolean } = {}): Promise<RegistryDid.Series[]> => {
	const { series } = await request<{ series: Web2SeriesWire[] }>({
		path: `/api/v1/engine/series${tradeableNow ? '?tradeable_now=true' : ''}`,
		method: 'GET'
	});

	return series.map(mapSeries);
};

/** One series by id, or `undefined` when the registry does not know it. */
export const getEngineSeries = async (
	seriesId: string
): Promise<RegistryDid.Series | undefined> => {
	try {
		const { series } = await request<{ series: Web2SeriesWire }>({
			path: `/api/v1/engine/series/${encodeURIComponent(seriesId)}`,
			method: 'GET'
		});

		return mapSeries(series);
	} catch (err: unknown) {
		// The route encodes "unknown series" as a 404; the app expects the same
		// `undefined` the candid optional decodes to.
		if (err instanceof Web2ApiError && err.status === 404) {
			return;
		}

		throw err;
	}
};

/** Clearing's settlement view for one series, `undefined` while unresolved. */
export const getEngineSettlementStatus = async (
	seriesId: string
): Promise<ClearingDid.SettlementStatusView | undefined> => {
	const { settlement } = await request<{ settlement: Web2SettlementStatusWire | null }>({
		path: `/api/v1/engine/series/${encodeURIComponent(seriesId)}/settlement`,
		method: 'GET'
	});

	return isNullish(settlement) ? undefined : mapSettlementStatus(settlement);
};

/** Market-wide OHLC candles for one series and interval. */
export const getEnginePriceHistory = async ({
	seriesId,
	interval,
	startTimeNs,
	endTimeNs
}: {
	seriesId: string;
	interval: ClearingDid.PriceHistoryInterval;
	startTimeNs?: bigint;
	endTimeNs?: bigint;
}): Promise<ClearingDid.SeriesPriceCandle[]> => {
	const { candles } = await request<{ candles: Web2PriceCandleWire[] }>({
		path: `/api/v1/engine/series/${encodeURIComponent(seriesId)}/price-history?${encodeQuery({
			interval: intervalToWire(interval),
			...(isNullish(startTimeNs) ? {} : { start_ns: startTimeNs.toString() }),
			...(isNullish(endTimeNs) ? {} : { end_ns: endTimeNs.toString() })
		})}`,
		method: 'GET'
	});

	return candles.map(mapPriceCandle);
};

/** One page of a series' market-wide executed-trade tape. */
export const listEngineSeriesTrades = async ({
	seriesId,
	startAfter,
	limit
}: {
	seriesId: string;
	startAfter?: bigint;
	limit?: bigint;
}): Promise<ClearingDid.SeriesTradeHistoryPage> => {
	const { page } = await request<{ page: Web2SeriesTradePageWire }>({
		path: `/api/v1/engine/series/${encodeURIComponent(seriesId)}/trades?${encodeQuery({
			...(isNullish(startAfter) ? {} : { start_after: startAfter.toString() }),
			...(isNullish(limit) ? {} : { limit: limit.toString() })
		})}`,
		method: 'GET'
	});

	return mapSeriesTradePage(page);
};

/** The route caps one volumes request at this many series ids. */
const ENGINE_VOLUMES_CHUNK_SIZE = 100;

/** Market-wide traded volumes for a series set, chunked to the route's cap so
 * a catalog-wide read never trips the request validator. */
export const listEngineSeriesVolumes = async (
	seriesIds: string[]
): Promise<ClearingDid.SeriesTradedVolume[]> => {
	const results: ClearingDid.SeriesTradedVolume[] = [];

	for (let start = 0; start < seriesIds.length; start += ENGINE_VOLUMES_CHUNK_SIZE) {
		const { volumes } = await request<{ volumes: Web2SeriesTradedVolumeWire[] }>({
			path: '/api/v1/engine/series/volumes',
			method: 'POST',
			body: { seriesIds: seriesIds.slice(start, start + ENGINE_VOLUMES_CHUNK_SIZE) }
		});

		results.push(...volumes.map(mapSeriesTradedVolume));
	}

	return results;
};

/** The authoritative settled (resolved) series ids from clearing. */
export const listEngineSettledSeries = async (): Promise<string[]> => {
	const { settled } = await request<{ settled: string[] }>({
		path: '/api/v1/engine/settled-series',
		method: 'GET'
	});

	return settled;
};

export const listEngineCollateralAssets = async (): Promise<ClearingDid.CollateralAssetInfo[]> => {
	const { assets } = await request<{ assets: Web2CollateralAssetInfoWire[] }>({
		path: '/api/v1/engine/collateral-assets',
		method: 'GET'
	});

	return assets.map(mapCollateralAssetInfo);
};

// ─── Session-gated engine account surface ────────────────────────────────
//
// The API signs these clearing calls with the caller's derived custodial IC
// identity, so the engine sees the same principal that owns the account's
// positions; the browser authenticates with the session cookie only. Returns
// are mapped back into the `$declarations` candid types like the public reads
// above, so stores and utils stay backend-agnostic.

/**
 * Clearing's account view for the session user. It rides the engine's
 * read-only query (`get_account_state_query`), the same source the on-chain
 * uncertified pass reads: the refreshed update read is not bridged.
 */
export const getEngineAccountState = async (): Promise<ClearingDid.AccountStateResponse> => {
	const { account } = await request<{ account: Web2AccountStateResponseWire }>({
		path: '/api/v1/engine/account',
		method: 'GET'
	});

	return mapAccountStateResponse(account);
};

/** The session user's open positions across all series and domains. */
export const listEnginePositions = async (): Promise<ClearingDid.Position[]> => {
	const { positions } = await request<{ positions: Web2PositionWire[] }>({
		path: '/api/v1/engine/positions',
		method: 'GET'
	});

	return positions.map(mapPosition);
};

/** The session user's open limit orders across all series and domains. */
export const listEngineOrders = async (): Promise<ClearingDid.LimitOrder[]> => {
	const { orders } = await request<{ orders: Web2LimitOrderWire[] }>({
		path: '/api/v1/engine/orders',
		method: 'GET'
	});

	return orders.map(mapLimitOrder);
};

/** The session user's own trade / settlement event history. */
export const listEngineTradeHistory = async (): Promise<ClearingDid.Event[]> => {
	const { events } = await request<{ events: Web2EventWire[] }>({
		path: '/api/v1/engine/trade-history',
		method: 'GET'
	});

	return events.map(mapEvent);
};

/** Submit a resting limit order. Returns whether any of it filled on entry. */
export const submitEngineLimitOrder = async ({
	orderId,
	seriesId,
	outcomeId,
	side,
	qty,
	priceValue,
	priceDecimals
}: {
	orderId: string;
	seriesId: string;
	outcomeId?: string;
	side: 'buy' | 'sell';
	qty: bigint;
	/** Fixed-point price mantissa, matching the engine's DecimalValue encoding. */
	priceValue: bigint;
	priceDecimals: number;
}): Promise<boolean> => {
	const { filled } = await request<{ filled: boolean }>({
		path: '/api/v1/engine/orders/limit',
		method: 'POST',
		body: {
			orderId,
			seriesId,
			...(isNullish(outcomeId) ? {} : { outcomeId }),
			side,
			qty: qty.toString(),
			priceValue: priceValue.toString(),
			priceDecimals
		}
	});

	return filled;
};

/** Execute against one resting order (`qty` caps the take at that level). */
export const submitEngineMarketOrder = async ({
	tradeId,
	matchingOrderId,
	qty
}: {
	tradeId: string;
	matchingOrderId: string;
	qty?: bigint;
}): Promise<boolean> => {
	const { filled } = await request<{ filled: boolean }>({
		path: '/api/v1/engine/orders/market',
		method: 'POST',
		body: {
			tradeId,
			matchingOrderId,
			...(isNullish(qty) ? {} : { qty: qty.toString() })
		}
	});

	return filled;
};

export const cancelEngineOrder = async ({ orderId }: { orderId: string }): Promise<boolean> => {
	const { cancelled } = await request<{ cancelled: boolean }>({
		path: '/api/v1/engine/orders/cancel',
		method: 'POST',
		body: { orderId }
	});

	return cancelled;
};

/** Move custodial funds into clearing collateral. The route resolves the
 * balance domain server-side from the asset's allowed domains. */
export const depositEngineCollateral = async ({
	depositId,
	assetId,
	amount
}: {
	depositId: string;
	assetId: string;
	amount: bigint;
}): Promise<void> => {
	await request<{ ok: boolean }>({
		path: '/api/v1/engine/collateral/deposit',
		method: 'POST',
		body: { depositId, assetId, amount: amount.toString() }
	});
};

/** Release clearing collateral back to the custodial account. */
export const withdrawEngineCollateral = async ({
	withdrawalId,
	assetId,
	amount
}: {
	withdrawalId: string;
	assetId: string;
	amount: bigint;
}): Promise<void> => {
	await request<{ ok: boolean }>({
		path: '/api/v1/engine/collateral/withdraw',
		method: 'POST',
		body: { withdrawalId, assetId, amount: amount.toString() }
	});
};

// ─── Custodial wallet ────────────────────────────────────────────────────
//
// Balances, deposit addresses and withdrawals live on the API's custody
// ledger; `assetId` here is the custody asset id from `/wallet/assets`, a
// separate namespace from the engine's collateral `asset_id`.

export interface Web2WalletAsset {
	id: string;
	chain: string;
	symbol: string;
	decimals: number;
	chainEnabled: boolean;
}

export interface Web2WalletBalance {
	assetId: string;
	symbol: string;
	chain: string;
	decimals: number;
	balance: bigint;
}

export interface Web2WalletWithdrawal {
	id: string;
	assetId: string;
	amount: string;
	destination: string;
	selfCustody: boolean;
	state: string;
	txRef: string | null;
	failureReason: string | null;
}

/** The withdrawable asset catalog (public read). */
export const listWalletAssets = async (): Promise<Web2WalletAsset[]> => {
	const { assets } = await request<{ assets: Web2WalletAsset[] }>({
		path: '/api/v1/wallet/assets',
		method: 'GET'
	});

	return assets;
};

/** The session user's custodial accounts and per-asset balances. */
export const getWalletBalances = async (): Promise<{
	accounts: { chain: string; address: string }[];
	balances: Web2WalletBalance[];
}> => {
	const { accounts, balances } = await request<{
		accounts: { chain: string; address: string }[];
		balances: (Omit<Web2WalletBalance, 'balance'> & { balance: string })[];
	}>({ path: '/api/v1/wallet/balances', method: 'GET' });

	return {
		accounts,
		balances: balances.map((row) => ({ ...row, balance: BigInt(row.balance) }))
	};
};

/** The session user's deposit address on one chain (`ic` = the custodial
 * principal). A disabled chain surfaces as a 503 {@link Web2ApiError}. */
export const getWalletDepositAddress = async (
	chain: string
): Promise<{ chain: string; address: string }> =>
	await request({
		path: `/api/v1/wallet/deposit-address/${encodeURIComponent(chain)}`,
		method: 'GET'
	});

export const listWalletWithdrawals = async (): Promise<Web2WalletWithdrawal[]> => {
	const { withdrawals } = await request<{ withdrawals: Web2WalletWithdrawal[] }>({
		path: '/api/v1/wallet/withdrawals',
		method: 'GET'
	});

	return withdrawals;
};

/**
 * Request a custodial withdrawal (the self-custody exit when `selfCustody`).
 * The API executes best-effort inline, so the returned row already carries the
 * outcome state (`submitted`, or `failed` with the hold refunded).
 */
export const requestWalletWithdrawal = async ({
	assetId,
	amount,
	destination,
	selfCustody
}: {
	assetId: string;
	amount: bigint;
	destination: string;
	selfCustody?: boolean;
}): Promise<Web2WalletWithdrawal> => {
	const { withdrawal } = await request<{ withdrawal: Web2WalletWithdrawal }>({
		path: '/api/v1/wallet/withdrawals',
		method: 'POST',
		body: {
			assetId,
			amount: amount.toString(),
			destination,
			...(isNullish(selfCustody) ? {} : { selfCustody })
		}
	});

	return withdrawal;
};

/** Per-window ranked standings from clearing's leaderboard. The server drains
 * the ranking cursor with its own page bound. */
export const listEngineLeaderboard = async ({
	window,
	limit
}: {
	window: ClearingDid.LeaderboardWindow;
	limit?: bigint;
}): Promise<{ items: ClearingDid.LeaderboardEntry[]; total: bigint }> => {
	const { items, total } = await request<{ items: Web2LeaderboardEntryWire[]; total: string }>({
		path: `/api/v1/engine/leaderboard?${encodeQuery({
			window: leaderboardWindowToWire(window),
			...(isNullish(limit) ? {} : { limit: limit.toString() })
		})}`,
		method: 'GET'
	});

	return { items: items.map(mapLeaderboardEntry), total: BigInt(total) };
};

// ─── Leagues + battles ───────────────────────────────────────────────────
//
// The HTTP API keys league owners, members and battle proposers by the
// account id (uuid) where the on-chain stack uses principals. The app's
// domain shapes carry that identity in single string fields
// (`LeagueDoc.owner`, `LeagueMemberDoc.member`, `BattleDoc.proposer`,
// duel `sideA` / `sideB`), so the wrappers below carry the wire renames
// (`ownerUserId` → `owner`, `memberUserId` → `member`,
// `proposerUserId` → `proposer`) and re-narrow loose wire strings back to
// the app unions, keeping the return shapes byte-identical to the
// satellite services.

type Web2LeagueWire = Omit<LeagueDoc, 'owner' | 'privacy'> & {
	ownerUserId: string;
	privacy: string;
};

const mapLeague = (wire: Web2LeagueWire): LeagueDoc => {
	const { ownerUserId, privacy, ...rest } = wire;

	return { ...rest, owner: ownerUserId, privacy: privacy as LeaguePrivacy };
};

type Web2LeagueMemberWire = Omit<LeagueMemberDoc, 'member'> & { memberUserId: string };

const mapLeagueMember = (wire: Web2LeagueMemberWire): LeagueMemberDoc => {
	const { memberUserId, ...rest } = wire;

	return { ...rest, member: memberUserId };
};

type Web2BattleWire = Omit<BattleDoc, 'proposer' | 'scope'> & {
	proposerUserId: string;
	scope?: string;
};

const mapBattle = (wire: Web2BattleWire): BattleDoc => {
	const { proposerUserId, scope, ...rest } = wire;

	return {
		...rest,
		proposer: proposerUserId,
		// Drop anything outside the closed scope set, like the satellite
		// projection does for legacy / unknown values.
		...(nonNullish(scope) && isBattleScope(scope) ? { scope } : {})
	};
};

/** Every league the session user belongs to, with role and member tally. */
export const listMyLeagues = async (): Promise<
	{ league: LeagueDoc; role: LeagueMemberRole; joinedAtMs: number; memberCount: number }[]
> => {
	const { items } = await request<{
		items: {
			league: Web2LeagueWire;
			role: LeagueMemberRole;
			joinedAtMs: number;
			memberCount: number;
		}[];
	}>({ path: '/api/v1/leagues/mine', method: 'GET' });

	return items.map(({ league, ...rest }) => ({ league: mapLeague(league), ...rest }));
};

/** The opponent pool for the create-battle picker. */
export const listChallengeableLeagues = async (): Promise<LeagueDoc[]> => {
	const { items } = await request<{ items: Web2LeagueWire[] }>({
		path: '/api/v1/leagues/challengeable',
		method: 'GET'
	});

	return items.map(mapLeague);
};

/** Open leagues the caller's friends are in but the caller is not. */
export const listFriendRecommendedLeagues = async (): Promise<
	{ league: LeagueDoc; memberCount: number; friendMembers: string[] }[]
> => {
	const { items } = await request<{
		items: { league: Web2LeagueWire; memberCount: number; friendMemberUserIds: string[] }[];
	}>({ path: '/api/v1/leagues/friend-recommended', method: 'GET' });

	return items.map(({ league, memberCount, friendMemberUserIds }) => ({
		league: mapLeague(league),
		memberCount,
		friendMembers: friendMemberUserIds
	}));
};

/** Resolve an invite code to its league; `undefined` = invalid code (UX). */
export const lookupLeagueByInvite = async (inviteCode: string): Promise<LeagueDoc | undefined> => {
	const { league } = await request<{ league?: Web2LeagueWire | null }>({
		path: `/api/v1/leagues/invite/${encodeURIComponent(inviteCode)}`,
		method: 'GET'
	});

	return isNullish(league) ? undefined : mapLeague(league);
};

/**
 * Create a league. The invite code is minted server-side (any client-picked
 * code is not part of the wire contract), so callers read the definitive
 * code off the returned league.
 */
export const createLeague = async ({
	id,
	name,
	description,
	accentColor,
	emblem,
	privacy
}: {
	id: string;
	name: string;
	description?: string;
	accentColor?: string;
	emblem?: string;
	privacy?: LeaguePrivacy;
}): Promise<LeagueDoc> => {
	const { league } = await request<{ league: Web2LeagueWire }>({
		path: '/api/v1/leagues/',
		method: 'POST',
		body: {
			id,
			name,
			...(isNullish(description) ? {} : { description }),
			...(isNullish(accentColor) ? {} : { accentColor }),
			...(isNullish(emblem) ? {} : { emblem }),
			...(isNullish(privacy) ? {} : { privacy })
		}
	});

	return mapLeague(league);
};

/** Owner-only edit of the mutable league fields; omitted fields keep their
 * stored value, so an empty patch doubles as a fresh read of the row. */
export const updateLeague = async ({
	leagueId,
	name,
	privacy
}: {
	leagueId: string;
	name?: string;
	privacy?: LeaguePrivacy;
}): Promise<LeagueDoc> => {
	const { league } = await request<{ league: Web2LeagueWire }>({
		path: `/api/v1/leagues/${encodeURIComponent(leagueId)}`,
		method: 'PATCH',
		body: {
			...(isNullish(name) ? {} : { name }),
			...(isNullish(privacy) ? {} : { privacy })
		}
	});

	return mapLeague(league);
};

export interface Web2TransferLeagueOwnershipResult {
	ok: boolean;
	reason?: 'not_owner' | 'league_not_found' | 'new_owner_not_member' | 'new_owner_is_caller';
}

export const transferLeagueOwnership = async ({
	leagueId,
	newOwnerUserId
}: {
	leagueId: string;
	newOwnerUserId: string;
}): Promise<Web2TransferLeagueOwnershipResult> =>
	await request({
		path: `/api/v1/leagues/${encodeURIComponent(leagueId)}/transfer-ownership`,
		method: 'POST',
		body: { newOwnerUserId }
	});

/** Full roster of a league, earliest joiner first. */
export const listLeagueMembers = async (leagueId: string): Promise<LeagueMemberDoc[]> => {
	const { items } = await request<{ items: Web2LeagueMemberWire[] }>({
		path: `/api/v1/leagues/${encodeURIComponent(leagueId)}/members`,
		method: 'GET'
	});

	return items.map(mapLeagueMember);
};

/** Self-join by invite code. Idempotent server-side: re-joining returns the
 * existing membership row unchanged. */
export const joinLeagueByInvite = async ({
	inviteCode
}: {
	inviteCode: string;
}): Promise<LeagueMemberDoc> => {
	const { member } = await request<{ member: Web2LeagueMemberWire }>({
		path: '/api/v1/leagues/join',
		method: 'POST',
		body: { inviteCode }
	});

	return mapLeagueMember(member);
};

/** Owner-gated role write on an existing membership row. */
export const setLeagueMemberRole = async ({
	leagueId,
	memberUserId,
	role
}: {
	leagueId: string;
	memberUserId: string;
	role: LeagueMemberRole;
}): Promise<LeagueMemberDoc> => {
	const { member } = await request<{ member: Web2LeagueMemberWire }>({
		path: `/api/v1/leagues/${encodeURIComponent(leagueId)}/members/${encodeURIComponent(memberUserId)}`,
		method: 'PUT',
		body: { role }
	});

	return mapLeagueMember(member);
};

/** Leave / kick: remove one membership row (never the owner's). */
export const removeLeagueMember = async ({
	leagueId,
	memberUserId
}: {
	leagueId: string;
	memberUserId: string;
}): Promise<void> => {
	await request<{ ok: boolean }>({
		path: `/api/v1/leagues/${encodeURIComponent(leagueId)}/members/${encodeURIComponent(memberUserId)}`,
		method: 'DELETE'
	});
};

/** Retroactive founder-award self-heal over the caller's owned leagues. */
export const settleFounderAwards = async (): Promise<{ settled: number }> =>
	await request({ path: '/api/v1/leagues/founder-awards/settle', method: 'POST' });

/**
 * Owner-only cover upload. Multipart rather than JSON (the one non-JSON
 * write on this client): the route wants the raw bytes as a file field.
 * The server re-encodes to the canonical square cover and persists the
 * serving URL on the league row, so the returned league already carries
 * the final `imageUrl`.
 */
export const uploadLeagueImage = async ({
	leagueId,
	image
}: {
	leagueId: string;
	image: Blob;
}): Promise<LeagueDoc> => {
	const body = new FormData();

	// A filename is required for the multipart part to parse as a file.
	body.append('image', image, 'cover.jpg');

	const response = await fetch(
		`${web2ApiBaseUrl()}/api/v1/leagues/${encodeURIComponent(leagueId)}/image`,
		{ method: 'POST', credentials: 'include', body }
	);

	if (!response.ok) {
		throw new Web2ApiError({ status: response.status, code: await errorCode(response) });
	}

	const { league } = (await response.json()) as { league: Web2LeagueWire };

	return mapLeague(league);
};

/** Owner-only cover removal: clears the row's URL and drops the stored
 * asset; the league falls back to its emblem glyph. */
export const deleteLeagueImage = async (leagueId: string): Promise<LeagueDoc> => {
	const { league } = await request<{ league: Web2LeagueWire }>({
		path: `/api/v1/leagues/${encodeURIComponent(leagueId)}/image`,
		method: 'DELETE'
	});

	return mapLeague(league);
};

/** Every battle involving the caller (duels by id, league bouts by owned
 * leagues), kickoff ascending. */
export const listMyBattles = async (): Promise<BattleDoc[]> => {
	const { items } = await request<{ items: Web2BattleWire[] }>({
		path: '/api/v1/battles/mine',
		method: 'GET'
	});

	return items.map(mapBattle);
};

/** Battles referencing a league on either side, kickoff ascending. */
export const listLeagueBattles = async (leagueId: string): Promise<BattleDoc[]> => {
	const { items } = await request<{ items: Web2BattleWire[] }>({
		path: `/api/v1/battles/league/${encodeURIComponent(leagueId)}`,
		method: 'GET'
	});

	return items.map(mapBattle);
};

/** Count of resolved battles the caller's side won. */
export const getMyBattleStats = async (): Promise<{ boutsWon: number }> =>
	await request({ path: '/api/v1/battles/my-stats', method: 'GET' });

/** One battle by id, or `undefined` when unknown. */
export const getBattle = async (battleId: string): Promise<BattleDoc | undefined> => {
	try {
		const { battle } = await request<{ battle: Web2BattleWire }>({
			path: `/api/v1/battles/${encodeURIComponent(battleId)}`,
			method: 'GET'
		});

		return mapBattle(battle);
	} catch (err: unknown) {
		if (err instanceof Web2ApiError && err.status === 404) {
			return;
		}

		throw err;
	}
};

/** Propose a battle. The server stamps proposer, state and the respond-by
 * deadline; league authorisation and challengeability run server-side. */
export const proposeBattle = async ({
	id,
	kind,
	sideA,
	sideB,
	kickoffMs,
	settleMs,
	scope,
	wager,
	trashTalk
}: {
	id: string;
	kind: BattleDoc['kind'];
	sideA: string;
	sideB: string;
	kickoffMs: number;
	settleMs: number;
	scope?: string;
	wager?: number;
	trashTalk?: string;
}): Promise<BattleDoc> => {
	const { battle } = await request<{ battle: Web2BattleWire }>({
		path: '/api/v1/battles/',
		method: 'POST',
		body: {
			id,
			kind,
			sideA,
			sideB,
			kickoffMs,
			settleMs,
			...(isNullish(scope) ? {} : { scope }),
			...(isNullish(wager) ? {} : { wager }),
			...(isNullish(trashTalk) ? {} : { trashTalk })
		}
	});

	return mapBattle(battle);
};

const battleTransition = async ({
	battleId,
	action
}: {
	battleId: string;
	action: 'accept' | 'accept-league' | 'decline' | 'expire' | 'kickoff' | 'resolve';
}): Promise<BattleDoc> => {
	const { battle } = await request<{ battle: Web2BattleWire }>({
		path: `/api/v1/battles/${encodeURIComponent(battleId)}/${action}`,
		method: 'POST'
	});

	return mapBattle(battle);
};

/** Duel accept: proposed -> accepted (kickoff is a later transition). */
export const acceptDuel = (battleId: string): Promise<BattleDoc> =>
	battleTransition({ battleId, action: 'accept' });

/** League accept: proposed -> in_flight in one step, baselines stamped
 * server-side from the sides' league stats. */
export const acceptLeagueBattle = (battleId: string): Promise<BattleDoc> =>
	battleTransition({ battleId, action: 'accept-league' });

export const declineBattle = (battleId: string): Promise<BattleDoc> =>
	battleTransition({ battleId, action: 'decline' });

/** Lazy expiry of a proposal past its respond-by deadline. */
export const expireBattle = (battleId: string): Promise<BattleDoc> =>
	battleTransition({ battleId, action: 'expire' });

export const kickoffBattle = (battleId: string): Promise<BattleDoc> =>
	battleTransition({ battleId, action: 'kickoff' });

/** Resolve a settled league battle from clearing settlement history;
 * idempotent (an already-resolved battle comes back unchanged). */
export const resolveBattle = (battleId: string): Promise<BattleDoc> =>
	battleTransition({ battleId, action: 'resolve' });

/** Retract a still-proposed battle (proposer-only, hard delete). */
export const retractBattle = async (battleId: string): Promise<void> => {
	await request<{ ok: boolean }>({
		path: `/api/v1/battles/${encodeURIComponent(battleId)}`,
		method: 'DELETE'
	});
};

/** Provisional standings of an in-flight league battle; `undefined` when
 * the battle cannot be scored live. */
export const readBattleLiveScore = async (
	battleId: string
): Promise<
	| { scoreA: number; scoreB: number; callsA: number; callsB: number; leader: BattleWinner }
	| undefined
> => {
	const { score } = await request<{
		score?: {
			scoreA: number;
			scoreB: number;
			callsA: number;
			callsB: number;
			leader: BattleWinner;
		} | null;
	}>({ path: `/api/v1/battles/${encodeURIComponent(battleId)}/live-score`, method: 'GET' });

	return score ?? undefined;
};

// ─── Worlds ──────────────────────────────────────────────────────────────
//
// Same identity rename as leagues: the wire keys the member by
// `memberUserId` where `AffiliationDoc` carries a single `member` string.
// Stats, member counts and championships are identity-free aggregates and
// already ride the app's camelCase shapes.

type Web2AffiliationWire = Omit<AffiliationDoc, 'member'> & { memberUserId: string };

const mapAffiliation = (wire: Web2AffiliationWire): AffiliationDoc => {
	const { memberUserId, ...rest } = wire;

	return { ...rest, member: memberUserId };
};

/** The caller's current Worlds slots: at most one university + one country. */
export const getMyAffiliations = async (): Promise<{
	university?: AffiliationDoc;
	country?: AffiliationDoc;
}> => {
	const { university, country } = await request<{
		university?: Web2AffiliationWire | null;
		country?: Web2AffiliationWire | null;
	}>({ path: '/api/v1/worlds/affiliations/mine', method: 'GET' });

	return {
		...(isNullish(university) ? {} : { university: mapAffiliation(university) }),
		...(isNullish(country) ? {} : { country: mapAffiliation(country) })
	};
};

/** Join a Worlds slot. The 90-day lock is server arithmetic; switching
 * identifiers within a kind is gated on the held slot's lock. */
export const setAffiliation = async ({
	kind,
	affiliationIdentifier
}: {
	kind: AffiliationKind;
	affiliationIdentifier: string;
}): Promise<AffiliationDoc> => {
	const { affiliation } = await request<{ affiliation: Web2AffiliationWire }>({
		path: '/api/v1/worlds/affiliations',
		method: 'POST',
		body: { kind, affiliationIdentifier }
	});

	return mapAffiliation(affiliation);
};

/** Leave a Worlds slot (lock-gated server-side, idempotent when absent). */
export const removeAffiliation = async ({
	kind,
	affiliationIdentifier
}: {
	kind: AffiliationKind;
	affiliationIdentifier: string;
}): Promise<void> => {
	await request<{ ok: boolean }>({
		path: `/api/v1/worlds/affiliations/${encodeURIComponent(kind)}/${encodeURIComponent(affiliationIdentifier)}`,
		method: 'DELETE'
	});
};

/** One affiliation's standings, or `undefined` when it has no activity. */
export const getAffiliationStats = async ({
	kind,
	affiliationIdentifier
}: {
	kind: AffiliationKind;
	affiliationIdentifier: string;
}): Promise<AffiliationStatsDoc | undefined> => {
	const { stats } = await request<{ stats?: AffiliationStatsDoc | null }>({
		path: `/api/v1/worlds/stats?${encodeQuery({ kind, affiliationIdentifier })}`,
		method: 'GET'
	});

	return stats ?? undefined;
};

/** Ranked all-time leaderboard for a kind (rank-eligible rows only). */
export const listAffiliationStats = async ({
	kind,
	limit
}: {
	kind: AffiliationKind;
	limit?: number;
}): Promise<AffiliationStatsDoc[]> => {
	const { items } = await request<{ items: AffiliationStatsDoc[] }>({
		path: `/api/v1/worlds/leaderboard?${encodeQuery({
			kind,
			...(isNullish(limit) ? {} : { limit: limit.toString() })
		})}`,
		method: 'GET'
	});

	return items;
};

/** Member tally per affiliation of a kind, biggest first. */
export const listWorldsMemberCounts = async (
	kind: AffiliationKind
): Promise<AffiliationMemberCount[]> => {
	const { items } = await request<{ items: AffiliationMemberCount[] }>({
		path: `/api/v1/worlds/member-counts?${encodeQuery({ kind })}`,
		method: 'GET'
	});

	return items;
};

/** Champion history for one affiliation, newest month first. */
export const listAffiliationChampionships = async ({
	kind,
	affiliationIdentifier
}: {
	kind: AffiliationKind;
	affiliationIdentifier: string;
}): Promise<AffiliationChampionship[]> => {
	const { items } = await request<{ items: AffiliationChampionship[] }>({
		path: `/api/v1/worlds/championships?${encodeQuery({ kind, affiliationIdentifier })}`,
		method: 'GET'
	});

	return items;
};

/** Claim a closed month's Worlds podium finish (freezes the month on first
 * touch; idempotent per place through the award key). */
export const claimWorldsPodiumPrize = async ({
	monthAnchor
}: {
	monthAnchor: string;
}): Promise<{
	monthAnchor: string;
	awardsCreated: number;
	awardsAlreadyClaimed: number;
	notEligible: boolean;
}> =>
	await request({
		path: '/api/v1/worlds/podium/claim',
		method: 'POST',
		body: { monthAnchor }
	});

// ─── Tournaments ─────────────────────────────────────────────────────────
//
// The bracket shapes are identity-free (league ids only) and the API
// speaks the app's camelCase doc shapes with explicit nulls for TBD
// slots, so these are envelope unwraps with type narrowing.

/** The most recent tournament and its bracket; `tournament` is null until
 * the first draw runs. */
export const getCurrentTournament = async (): Promise<{
	tournament: TournamentDoc | null;
	matches: TournamentMatchDoc[];
}> => await request({ path: '/api/v1/tournaments/current', method: 'GET' });

/** Fire the monthly draw; idempotent by the month-anchor key collision. */
export const triggerTournamentDraw = async ({
	monthAnchor
}: {
	monthAnchor: string;
}): Promise<{
	ok: boolean;
	tournamentId?: string;
	reason?: 'already_drawn' | 'month_not_started' | 'insufficient_leagues' | 'invalid_input';
	availableLeagues?: number;
}> => await request({ path: '/api/v1/tournaments/draw', method: 'POST', body: { monthAnchor } });

/** Resolve every still-open match of a closed round; idempotent. */
export const resolveTournamentRound = async ({
	tournamentId,
	round
}: {
	tournamentId: string;
	round: string;
}): Promise<{
	ok: boolean;
	reason?:
		| 'tournament_not_found'
		| 'round_not_yet_closed'
		| 'previous_round_not_resolved'
		| 'no_matches'
		| 'invalid_input';
	matchesResolved?: number;
	tournamentConcluded?: boolean;
}> =>
	await request({
		path: `/api/v1/tournaments/${encodeURIComponent(tournamentId)}/resolve`,
		method: 'POST',
		body: { round }
	});

/** Per-user prize claim on a concluded tournament; idempotent through the
 * award-key collision. */
export const claimTournamentPrize = async ({
	tournamentId
}: {
	tournamentId: string;
}): Promise<{
	ok: boolean;
	reason?: 'tournament_not_found' | 'tournament_not_concluded' | 'not_member_of_top_league';
	awardsCreated?: number;
	awardsAlreadyClaimed?: number;
	totalVxpCredited?: number;
}> =>
	await request({
		path: `/api/v1/tournaments/${encodeURIComponent(tournamentId)}/claim`,
		method: 'POST'
	});

// ─── VXP economy ─────────────────────────────────────────────────────────

/** One row of the caller's award ledger (amounts are VXP base units as
 * decimal strings; `status` tracks the pending -> paid transfer machine). */
export interface Web2VxpAward {
	id: string;
	userId: string;
	awardType: string;
	awardKey: string;
	amountBaseUnits: string;
	status: 'pending' | 'processing' | 'paid' | 'failed';
	earnedAtMs: number;
	paidAtMs?: number;
	blockIndex?: string;
	errorMessage?: string;
}

/** The caller's own award history, newest first, optionally one type. */
export const listMyVxpAwards = async (type?: string): Promise<Web2VxpAward[]> => {
	const { items } = await request<{ items: Web2VxpAward[] }>({
		path: `/api/v1/vxp/awards${isNullish(type) ? '' : `?${encodeQuery({ type })}`}`,
		method: 'GET'
	});

	return items;
};

/** Structured calibration-claim result; `recorded_only` marks an award that
 * was recorded without a transfer (treasury parallel-run mode). */
export interface Web2CalibrationClaim {
	correct: boolean;
	paidNow: boolean;
	alreadyClaimed: boolean;
	rewardBaseUnits?: string;
	newBalanceBaseUnits?: string;
	blockIndex?: string;
	reason?:
		| 'not_engaged_yet'
		| 'balance_above_floor'
		| 'not_vici_market'
		| 'not_binary'
		| 'not_finalised'
		| 'outcome_undetermined'
		| 'rate_limited_hourly'
		| 'rate_limited_daily'
		| 'recorded_only'
		| 'transfer_failed';
	errorMessage?: string;
}

/** Claim the calibration reward for a finalised binary market. Eligibility,
 * correctness and the rate limits are all decided server-side; expected
 * ineligibility resolves (never rejects) with a `reason`. */
export const claimCalibrationReward = async ({
	seriesId,
	chosenSide
}: {
	seriesId: string;
	chosenSide: CallSide;
}): Promise<Web2CalibrationClaim> =>
	await request({
		path: '/api/v1/vxp/calibration/claim',
		method: 'POST',
		body: { seriesId, chosenSide }
	});

/** Retry / self-heal a referral payout. Omitting the referee targets the
 * caller's own referee row; other rows are admin-only server-side. */
export const settleReferralPayout = async (refereeUserId?: string): Promise<void> => {
	await request<Record<string, unknown>>({
		path: '/api/v1/vxp/referral/settle',
		method: 'POST',
		body: isNullish(refereeUserId) ? {} : { refereeUserId }
	});
};

// ─── Referrals ───────────────────────────────────────────────────────────

interface Web2ReferralPayoutWire {
	status: 'none' | 'owed' | 'paid';
	amountBaseUnits: string;
}

/** One redemption where the caller is the referrer. The wire omits the
 * referrer id (it is always the caller); the service restores it. */
export interface Web2ReferralWire {
	referee: string;
	code: string;
	redeemedAtMs: number;
	withinReferrerCap: boolean;
	refereePayout: Web2ReferralPayoutWire;
	referrerPayout: Web2ReferralPayoutWire;
}

/** The caller's referral code; the API assigns one on first read. */
export const getMyReferralCode = async (): Promise<string> => {
	const { code } = await request<{ code: string }>({
		path: '/api/v1/referrals/code',
		method: 'GET'
	});

	return code;
};

/** Resolve a code to its owner's account id (public: invite landings run
 * before the visitor signs in). `undefined` = unknown / malformed. */
export const lookupReferralCode = async (code: string): Promise<string | undefined> => {
	const { owner } = await request<{ owner: string | null }>({
		path: `/api/v1/referrals/lookup?${encodeQuery({ code })}`,
		method: 'GET'
	});

	return owner ?? undefined;
};

/** One-time redemption for the session user. Refusals surface as
 * {@link Web2ApiError} whose `code` carries the stable refusal reason. */
export const redeemReferralCode = async (code: string): Promise<void> => {
	await request<{ ok: boolean }>({
		path: '/api/v1/referrals/redeem',
		method: 'POST',
		body: { code }
	});
};

/** Friendship-only claim for callers past the signup window (no VXP). */
export const claimReferralFriendship = async (code: string): Promise<void> => {
	await request<{ ok: boolean }>({
		path: '/api/v1/referrals/claim-friendship',
		method: 'POST',
		body: { code }
	});
};

/** Every redemption where the caller is the referrer, newest first. */
export const listMyReferrals = async (): Promise<Web2ReferralWire[]> => {
	const { items } = await request<{ items: Web2ReferralWire[] }>({
		path: '/api/v1/referrals/mine',
		method: 'GET'
	});

	return items;
};

// ─── School verification ─────────────────────────────────────────────────

/** Ask the API to mail a 6-digit code to `email`. The school itself is
 * re-resolved server-side from the email domain (plus name/country for a
 * new entry), so no school id rides the request. Rejections (bad domain,
 * daily cap, feature disabled) surface as {@link Web2ApiError}. */
export const submitSchool = async ({
	name,
	country,
	email,
	locale
}: {
	name: string;
	country: string | null;
	email: string;
	locale: string;
}): Promise<{ submissionId: string }> =>
	await request({
		path: '/api/v1/school/submit',
		method: 'POST',
		body: { name, country, email, locale }
	});

/** Verify a mailed code. Resolves `{ ok: false, message }` on a wrong /
 * expired / capped code and `{ ok: true, schoolId, status }` on success. */
export const verifySchoolCode = async ({
	submissionId,
	code
}: {
	submissionId: string;
	code: string;
}): Promise<{ ok: boolean; schoolId?: string; status?: 'pending' | 'public'; message?: string }> =>
	await request({
		path: '/api/v1/school/verify',
		method: 'POST',
		body: { submissionId, code }
	});

// ─── Account lifecycle ───────────────────────────────────────────────────

/** Pre-flight for the delete CTA: owned leagues that still have other
 * members and must be transferred or disbanded first. */
export const listBlockingLeagues = async (): Promise<string[]> => {
	const { leagueIds } = await request<{ leagueIds: string[] }>({
		path: '/api/v1/account/blocking-leagues',
		method: 'GET'
	});

	return leagueIds;
};

export interface Web2DeleteAccountResult {
	ok: boolean;
	reason?: 'owns_non_empty_league' | 'league_resolution_failed' | 'invalid_input';
	blockingLeagueIds?: string[];
	failedLeagueId?: string;
	resolutionReason?: string;
	softDeleted?: boolean;
}

/** Soft-delete the session account: league resolutions apply first (a
 * refusal leaves everything intact), then the anonymous exit signal is
 * recorded and the profile is marked deleted. `transferTo` is the new
 * owner's account id. */
export const deleteMyAccount = async ({
	reason,
	note,
	leagueResolutions
}: {
	reason: ExitSignalReason;
	note: string;
	leagueResolutions?: { leagueId: string; action: 'transfer' | 'delete'; transferTo?: string }[];
}): Promise<Web2DeleteAccountResult> =>
	await request({
		path: '/api/v1/account/delete',
		method: 'POST',
		body: { reason, note, ...(isNullish(leagueResolutions) ? {} : { leagueResolutions }) }
	});

/** Clear a soft-delete inside the recovery window; a lapsed window
 * hard-deletes in place and returns `{ ok: false, reason: 'expired' }`. */
export const recoverMyAccount = async (): Promise<
	{ ok: true; recovered: boolean } | { ok: false; reason: 'expired' }
> => await request({ path: '/api/v1/account/recover', method: 'POST' });

/** Pause the session account (nothing is erased; resume lifts it). */
export const hibernateMyAccount = async (): Promise<{
	ok: boolean;
	reason?: 'no_profile' | 'deleted';
}> => await request({ path: '/api/v1/account/hibernate', method: 'POST' });

/** Lift a hibernation; `resumed: false` when the account was never paused. */
export const resumeMyAccount = async (): Promise<{ ok: boolean; resumed: boolean }> =>
	await request({ path: '/api/v1/account/resume', method: 'POST' });

// ─── Activities + reactions ──────────────────────────────────────────────
//
// The wire activity is the app `Activity` plus the stable doc key
// (`${user}#${timestamp}#${type}`); `user` / `liker` carry account ids in
// this mode, the same `owner` string the swapped profile services key on.

type Web2ActivityWire = Activity & { key: string };

const mapActivity = (wire: Web2ActivityWire): Activity => {
	const { key: _key, ...rest } = wire;

	return rest;
};

/** Publish one feed activity. The route stamps the author from the session
 * and runs the trade-activity award triggers (onboarding milestones,
 * referral settlement) after the write, mirroring the satellite hooks. */
export const createActivity = async ({
	type,
	targetUser,
	marketId,
	title,
	details,
	timestamp
}: {
	type: string;
	targetUser?: string;
	marketId?: string;
	title: string;
	details?: string;
	timestamp: number;
}): Promise<Activity> => {
	const { activity } = await request<{ activity: Web2ActivityWire }>({
		path: '/api/v1/social/activities',
		method: 'POST',
		body: { type, targetUser, marketId, title, details, timestamp }
	});

	return mapActivity(activity);
};

/** Most-recent activities (public read), optionally one type, newest first
 * by server insert time. The route caps `limit` at 500. */
export const listActivities = async ({
	limit,
	type
}: {
	limit: number;
	type?: string;
}): Promise<Activity[]> => {
	const { items } = await request<{ items: Web2ActivityWire[] }>({
		path: `/api/v1/social/activities?${encodeQuery({
			limit: limit.toString(),
			...(isNullish(type) ? {} : { type })
		})}`,
		method: 'GET'
	});

	return items.map(mapActivity);
};

/** Like one activity. The route derives the liker from the session and
 * maintains the count rollup transactionally with the write. */
export const likeActivity = async ({
	activityKey,
	timestamp,
	activityTitle,
	marketId
}: {
	activityKey: string;
	timestamp: number;
	activityTitle: string;
	marketId?: string;
}): Promise<void> => {
	await request<{ ok: boolean }>({
		path: '/api/v1/social/activity-reactions',
		method: 'POST',
		body: { activityKey, timestamp, activityTitle, marketId }
	});
};

/** Remove the caller's like; idempotent when no like exists. */
export const unlikeActivity = async ({ activityKey }: { activityKey: string }): Promise<void> => {
	await request<{ ok: boolean }>({
		path: '/api/v1/social/activity-reactions',
		method: 'DELETE',
		body: { activityKey }
	});
};

/** The most-recent reactions across all users (public read), newest first.
 * The route caps `limit` at 1000. */
export const listActivityReactions = async ({
	limit
}: {
	limit: number;
}): Promise<ActivityReaction[]> => {
	const { items } = await request<{ items: ActivityReaction[] }>({
		path: `/api/v1/social/activity-reactions?${encodeQuery({ limit: limit.toString() })}`,
		method: 'GET'
	});

	return items;
};

/** Rollup like counts for the given activity keys (key-addressed, so the
 * caller derives the keys from the feed window it renders). */
export const getActivityReactionCounts = async ({
	activityKeys
}: {
	activityKeys: string[];
}): Promise<ActivityReactionCount[]> => {
	const { items } = await request<{ items: ActivityReactionCount[] }>({
		path: '/api/v1/social/activity-reactions/counts',
		method: 'POST',
		body: { activityKeys }
	});

	return items;
};
