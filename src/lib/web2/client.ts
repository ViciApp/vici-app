import type { ClearingDid, RegistryDid } from '#declarations';
import type { AppLocale } from '#lib/constants/locale.constants.ts';
import type { LeaguePrivacy } from '#lib/enums/league.ts';
import type { ProfileVisibility } from '#lib/enums/profile.ts';
import type { UserRole } from '#lib/enums/user.ts';
import { apiBaseUrl } from '#lib/env/app.env.ts';
import {
	ApiBaseUnitsSchema,
	ApiMeResponseSchema,
	ApiOrderCancelledResponseSchema,
	ApiOrderFilledResponseSchema,
	ApiWalletAssetsResponseSchema,
	ApiWalletBalancesResponseSchema,
	ApiWalletDepositAddressResponseSchema,
	ApiWalletWithdrawalResponseSchema,
	type ApiMeSchema,
	type ApiWalletAssetSchema,
	type ApiWalletBalanceSchema,
	type ApiWalletWithdrawalSchema
} from '#lib/schema/web2-api.schema.ts';
import type {
	AffiliationChampionship,
	AffiliationMemberCount,
	AffiliationStatsDoc
} from '#lib/types/affiliation-stats.ts';
import type { AffiliationDoc, AffiliationKind } from '#lib/types/affiliation.ts';
import type { TrackEventInput } from '#lib/types/analytics-event.ts';
import {
	isBattleScope,
	readBattleDoc,
	type BattleDoc,
	type BattleWinner
} from '#lib/types/battle.ts';
import type {
	ChallengeAnswer,
	ChallengeAnswerItem,
	ChallengeRedeemOutcome,
	ChallengeView,
	OwnChallenge
} from '#lib/types/challenge.ts';
import type { ExitSignalReason } from '#lib/types/exit-signal.ts';
import type { LeagueMemberDoc, LeagueMemberRole } from '#lib/types/league-member.ts';
import type { LeagueDoc } from '#lib/types/league.ts';
import type { MarketMetadata, MarketMetadataInput } from '#lib/types/market-metadata.ts';
import type { MarketTranslation, MarketTranslationInput } from '#lib/types/market-translation.ts';
import type { CallSide } from '#lib/types/market.ts';
import type { UserProfile } from '#lib/types/profile.ts';
import type { FriendRequestOutcome, Relation } from '#lib/types/relation.ts';
import type { Activity, ActivityReaction, ResolvedResult } from '#lib/types/social.ts';
import type {
	TournamentDoc,
	TournamentMatchDoc,
	TriggerTournamentDrawRefusalReason
} from '#lib/types/tournament.ts';
import type { UserStatsDoc } from '#lib/types/user-stats.ts';
import type { HandleRefusal } from '#lib/utils/handle.utils.ts';
import {
	balanceDomainToWire,
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
	type ApiAccountStateResponseWire,
	type ApiCollateralAssetInfoWire,
	type ApiEventWire,
	type ApiLeaderboardEntryWire,
	type ApiLimitOrderWire,
	type ApiPositionWire,
	type ApiPriceCandleWire,
	type ApiSeriesTradePageWire,
	type ApiSeriesTradedVolumeWire,
	type ApiSeriesWire,
	type ApiSettlementStatusWire
} from '#lib/web2/engine-wire.ts';
import { isNullish, nonNullish } from '@dfinity/utils';
import type * as z from 'zod';

/**
 * Thin typed fetch client for the HTTP API (`/api/v1/...`).
 *
 * Sessions ride an HttpOnly cookie, so every request opts in to
 * credentials; the client itself holds no auth state. Error responses use
 * a stable `{ error: string }` envelope, surfaced as {@link ApiError}
 * so callers can branch on `status` / `code` without parsing bodies.
 *
 * Add a typed wrapper here per endpoint a dual-mode service needs; keep
 * the wrappers thin (shape mapping only, no orchestration).
 */

export class ApiError extends Error {
	readonly status: number;
	/** Stable machine-readable code from the `{ error }` envelope. */
	readonly code: string;
	/** What an `insufficient_balance` order refusal adds to the envelope: the
	 * engine's USD base units, as decimal strings. */
	readonly amounts?: ApiErrorAmounts;

	constructor({
		status,
		code,
		amounts
	}: {
		status: number;
		code: string;
		amounts?: ApiErrorAmounts;
	}) {
		super(`API error (${status}): ${code}`);

		this.status = status;
		this.code = code;
		this.amounts = amounts;
	}
}

export interface ApiErrorAmounts {
	available: string;
	required: string;
}

const isWireAmount = (value: unknown): value is string =>
	ApiBaseUnitsSchema.safeParse(value).success;

const apiError = async (response: Response): Promise<ApiError> => {
	const { status } = response;

	try {
		const payload: unknown = await response.json();

		if (
			!isNullish(payload) &&
			typeof payload === 'object' &&
			'error' in payload &&
			typeof payload.error === 'string'
		) {
			const { available, required } = payload as Partial<Record<keyof ApiErrorAmounts, unknown>>;

			return new ApiError({
				status,
				code: payload.error,
				amounts:
					isWireAmount(available) && isWireAmount(required) ? { available, required } : undefined
			});
		}
	} catch {
		// Non-JSON error body (proxy error page, empty 502); the generic code below applies.
	}

	return new ApiError({ status, code: 'unknown_error' });
};

let onSessionLost: (() => void) | undefined;

/**
 * Register what runs when a request is refused because the cookie carries no
 * live session (expired, revoked, or signed out from another tab): the API's
 * `unauthenticated` refusal, not any other 401 (a wrong sign-in code is one
 * too). Returns the function that removes it.
 */
export const setSessionLostHandler = (handler: () => void): (() => void) => {
	onSessionLost = handler;

	return () => {
		if (onSessionLost === handler) {
			onSessionLost = undefined;
		}
	};
};

/** The error a non-2xx response throws; tells the session handler when the
 * refusal says the session is gone. */
const refusal = async (response: Response): Promise<ApiError> => {
	const error = await apiError(response);

	if (error.status === 401 && error.code === 'unauthenticated') {
		onSessionLost?.();
	}

	return error;
};

interface RequestArgs {
	path: string;
	method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
	body?: Record<string, unknown>;
}

const send = async ({ path, method, body }: RequestArgs): Promise<Response> => {
	const response = await fetch(`${apiBaseUrl()}${path}`, {
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
		throw await refusal(response);
	}

	return response;
};

/** Trusts the 2xx body to be a `T` without checking it; money and identity
 * endpoints go through {@link parsedRequest} instead. */
const request = async <T>(args: RequestArgs): Promise<T> => (await (await send(args)).json()) as T;

/**
 * A request whose 2xx body is checked against `schema` before any caller reads
 * it. A body that does not match throws a {@link ApiError} with the
 * response's own 2xx status and the `invalid_response` code: the API may already
 * have acted on the request, so a caller treats the outcome as unknown, never as
 * success.
 */
const parsedRequest = async <S extends z.ZodType>({
	schema,
	...args
}: RequestArgs & { schema: S }): Promise<z.output<S>> => {
	const response = await send(args);
	const parsed = schema.safeParse(await response.json().catch(() => undefined));

	if (!parsed.success) {
		throw new ApiError({ status: response.status, code: 'invalid_response' });
	}

	return parsed.data;
};

export type ApiProviderStatus = 'available' | 'coming_soon';

export interface ApiProviders {
	email: ApiProviderStatus;
	google: ApiProviderStatus;
	apple: ApiProviderStatus;
}

export type ApiMe = z.output<typeof ApiMeSchema>;

export const getProviders = async (): Promise<ApiProviders> => {
	const { providers } = await request<{ providers: ApiProviders }>({
		path: '/api/v1/auth/providers',
		method: 'GET'
	});

	return providers;
};

export const getMe = async (): Promise<ApiMe> => {
	const { user } = await parsedRequest({
		path: '/api/v1/me',
		method: 'GET',
		schema: ApiMeResponseSchema
	});

	return user;
};

/**
 * Ask the API to email a one-time code to `email`, with a Turnstile token
 * solved for the email-code action. Resolves on a queued send; a refusal
 * (invalid address, refused or uncheckable token, rate limit, beta gate)
 * surfaces as {@link ApiError} so the caller can message the user.
 */
export const requestOtp = async ({
	email,
	turnstileToken
}: {
	email: string;
	turnstileToken: string;
}): Promise<void> => {
	await request<{ ok: boolean }>({
		path: '/api/v1/auth/otp/request',
		method: 'POST',
		body: { email, turnstileToken }
	});
};

/**
 * Exchange an emailed code for a session. The API sets the HttpOnly session
 * cookie on the response and echoes the `/me` body, so the returned user can
 * seed the session store without a second round-trip. A wrong or expired
 * code throws {@link ApiError} (`status` 401), a locked address 429.
 */
export const verifyOtp = async ({
	email,
	code
}: {
	email: string;
	code: string;
}): Promise<ApiMe> => {
	const { user } = await parsedRequest({
		path: '/api/v1/auth/otp/verify',
		method: 'POST',
		body: { email, code },
		schema: ApiMeResponseSchema
	});

	return user;
};

/**
 * Absolute URL of the Google sign-in entry. It is a full-page redirect
 * target (the API sets a signed state cookie and 302s on to Google), not a
 * fetch, so callers navigate to it. `returnTo` is the in-app path the API
 * redirects to after its callback; it must be a same-app absolute path
 * (`/flow?x=1`, never a full URL): the API embeds it in the signed OAuth
 * state and clamps anything else to `/` to rule out open redirects.
 */
export const googleSignInUrl = ({ returnTo }: { returnTo?: string } = {}): string => {
	const url = `${apiBaseUrl()}/api/v1/auth/google`;

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

// ─── Profiles + social + leaderboard ─────────────────────────────────────
//
// The HTTP API keys a user by an opaque `userId` (uuid). The app's domain shape (`UserProfile`, `Relation`,
// `ResolvedResult`) uses the single `owner` string for that identity, so the
// wrappers below carry the wire→app rename (`userId` → `owner`) and re-narrow
// the loose wire string unions back to the app enums, keeping the return shapes
// the shapes every store and component reads.

const encodeQuery = (params: Record<string, string>): string =>
	Object.entries(params)
		.map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
		.join('&');

/** Wire profile: the app profile with `owner` carried as `userId`. The API can
 * also carry an `email` column on this row; it is dropped in {@link mapProfile}
 * so it never rides a public profile object (leaderboard / search) on the
 * client, mirroring the on-chain split that keeps the address off the public
 * doc. */
type ApiProfileWire = Omit<UserProfile, 'owner' | 'visibility' | 'role'> & {
	userId: string;
	visibility: string;
	role?: string;
	email?: string;
};

const mapProfile = (wire: ApiProfileWire): UserProfile => {
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
interface ApiRelationWire {
	key: string;
	category: Relation['category'];
	state: Relation['state'];
	participants: [string, string];
}

const mapRelation = (wire: ApiRelationWire): Relation => ({
	category: wire.category,
	state: wire.state,
	participants: wire.participants
});

interface ApiUserStatsWire {
	userId: string;
	categoryStats: UserStatsDoc['categoryStats'];
	recentSettlements: UserStatsDoc['recentSettlements'];
	computedAtMs: number;
}

interface ApiResolvedResultWire {
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
	const { profile } = await request<{ profile: ApiProfileWire | null }>({
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
	const { profile } = await request<{ profile: ApiProfileWire | null }>({
		path: '/api/v1/profiles/me',
		method: 'GET'
	});

	return profile?.email?.trim() ?? '';
};

/** A public profile by id, or `undefined` when absent / hidden to the caller. */
export const getProfileById = async (userId: string): Promise<UserProfile | undefined> => {
	const { profile } = await request<{ profile: ApiProfileWire | null }>({
		path: `/api/v1/profiles/${encodeURIComponent(userId)}`,
		method: 'GET'
	});

	return isNullish(profile) ? undefined : mapProfile(profile);
};

/** Full-doc write of the caller's own profile; returns the stored result. */
export const upsertMyProfile = async (data: Record<string, unknown>): Promise<UserProfile> => {
	const { profile } = await request<{ profile: ApiProfileWire }>({
		path: '/api/v1/profiles/me',
		method: 'PUT',
		body: data
	});

	return mapProfile(profile);
};

export type ApiNicknameAvailability =
	{ available: true } | { available: false; reason: HandleRefusal };

/** Server-side nickname validity + uniqueness probe. The caller's own current
 * nickname never counts as a conflict (the session identifies the caller). */
export const checkNicknameAvailability = async (
	nickname: string
): Promise<ApiNicknameAvailability> =>
	await request({
		path: `/api/v1/profiles/nickname-availability?${encodeQuery({ nickname })}`,
		method: 'GET'
	});

/** A proof that this client passed the bot check, valid for `ttlMs` from
 * issue and only from the IP that asked for it. */
export interface ApiNicknameCheckProof {
	proof: string;
	ttlMs: number;
}

/** Trade a single-use Turnstile token for a reusable proof. A refused token
 * throws {@link ApiError} `turnstile_failed` (403); Cloudflare out of
 * reach or a server without its secret in production, 503. */
export const issueNicknameCheckProof = async ({
	turnstileToken
}: {
	turnstileToken: string;
}): Promise<ApiNicknameCheckProof> =>
	await request({
		path: '/api/v1/profiles/nickname-check-proof',
		method: 'POST',
		body: { turnstileToken }
	});

/** The signed-out twin of {@link checkNicknameAvailability}, same answer. A
 * missing, expired or foreign proof throws {@link ApiError}
 * `human_proof_required` (403). */
export const checkNicknameAvailabilityPublic = async ({
	nickname,
	proof
}: {
	nickname: string;
	proof: string;
}): Promise<ApiNicknameAvailability> =>
	await request({
		path: `/api/v1/profiles/public-nickname-availability?${encodeQuery({ nickname, proof })}`,
		method: 'GET'
	});

/**
 * The public profile a typed `@handle` names: the one holding exactly that
 * handle, otherwise the one whose handle is the same once case, accents and
 * separators are ignored. `undefined` when none is visible to the caller.
 */
export const getProfileByHandle = async (handle: string): Promise<UserProfile | undefined> => {
	try {
		const { profile } = await request<{ profile: ApiProfileWire }>({
			path: `/api/v1/profiles/by-handle?${encodeQuery({ handle })}`,
			method: 'GET'
		});

		return mapProfile(profile);
	} catch (err: unknown) {
		if (err instanceof ApiError && err.status === 404) {
			return;
		}

		throw err;
	}
};

/** Case-insensitive search over nickname, id, and linked legacy principal. */

export const searchProfiles = async (queryStr: string): Promise<UserProfile[]> => {
	const { items } = await request<{ items: ApiProfileWire[] }>({
		path: `/api/v1/profiles/search?${encodeQuery({ q: queryStr })}`,
		method: 'GET'
	});

	return items.map(mapProfile);
};

/** The caller's dashboard stat cache, or `undefined` before the first sync. */
export const getUserStats = async (): Promise<UserStatsDoc | undefined> => {
	const { stats } = await request<{ stats: ApiUserStatsWire | null }>({
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
	const { items } = await request<{ items: ApiProfileWire[] }>({
		path: '/api/v1/leaderboard/',
		method: 'GET'
	});

	return items.map(mapProfile);
};

/** One account's place in the full points ranking plus the ranked population
 * size, the counterpart of the satellite's self-rank query. The wire carries
 * an unranked account's `rank` as `null`; the app shape leaves it absent. */
export const getUserRankAndCount = async ({
	userId
}: {
	userId: string;
}): Promise<{ rank?: number; count: number }> => {
	const { rank, count } = await request<{ rank: number | null; count: number }>({
		path: `/api/v1/leaderboard/rank/${encodeURIComponent(userId)}`,
		method: 'GET'
	});

	return isNullish(rank) ? { count } : { rank, count };
};

const listRelations = async (path: string): Promise<Relation[]> => {
	const { items } = await request<{ items: ApiRelationWire[] }>({ path, method: 'GET' });

	return items.map(mapRelation);
};

export const listFriends = (): Promise<Relation[]> => listRelations('/api/v1/social/friends');

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

/** Friend-scoped resolved-result rows for the Arena results digest. */
export const listFriendResolvedResults = async (friends: string[]): Promise<ResolvedResult[]> => {
	if (friends.length === 0) {
		return [];
	}

	const { items } = await request<{ items: ApiResolvedResultWire[] }>({
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

/** Every stored metadata row (public), for the catalog-wide tag and
 * suggested-flag projections. */
export const listMarketMetadata = async (): Promise<MarketMetadata[]> => {
	const { items } = await request<{ items: MarketMetadata[] }>({
		path: '/api/v1/markets/metadata',
		method: 'GET'
	});

	return items;
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
// `#declarations` candid types, so services hand downstream utils and stores
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
	const { series } = await request<{ series: ApiSeriesWire[] }>({
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
		const { series } = await request<{ series: ApiSeriesWire }>({
			path: `/api/v1/engine/series/${encodeURIComponent(seriesId)}`,
			method: 'GET'
		});

		return mapSeries(series);
	} catch (err: unknown) {
		// The route encodes "unknown series" as a 404; the app expects the same
		// `undefined` the candid optional decodes to.
		if (err instanceof ApiError && err.status === 404) {
			return;
		}

		throw err;
	}
};

/** Clearing's settlement view for one series, `undefined` while unresolved. */
export const getEngineSettlementStatus = async (
	seriesId: string
): Promise<ClearingDid.SettlementStatusView | undefined> => {
	const { settlement } = await request<{ settlement: ApiSettlementStatusWire | null }>({
		path: `/api/v1/engine/series/${encodeURIComponent(seriesId)}/settlement`,
		method: 'GET'
	});

	return isNullish(settlement) ? undefined : mapSettlementStatus(settlement);
};

/** The route caps one settlements request at this many series ids. */
const ENGINE_SETTLEMENTS_CHUNK_SIZE = 100;

/** Clearing's settlement views for a series set, without the unresolved ones.
 * One request at a time: a catalog-wide backfill runs behind an already-painted
 * list, so it must not hold the API's memory on many parallel reads. Fails open
 * per request, so an unreadable one costs only its own series their labels. */
export const listEngineSettlementStatuses = async (
	seriesIds: string[]
): Promise<ClearingDid.SettlementStatusView[]> => {
	const results: ClearingDid.SettlementStatusView[] = [];

	for (let start = 0; start < seriesIds.length; start += ENGINE_SETTLEMENTS_CHUNK_SIZE) {
		try {
			const { settlements } = await request<{ settlements: ApiSettlementStatusWire[] }>({
				path: '/api/v1/engine/series/settlements',
				method: 'POST',
				body: { seriesIds: seriesIds.slice(start, start + ENGINE_SETTLEMENTS_CHUNK_SIZE) }
			});

			results.push(...settlements.map(mapSettlementStatus));
		} catch (err: unknown) {
			console.error('Failed to read settlement statuses', err);
		}
	}

	return results;
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
	const { candles } = await request<{ candles: ApiPriceCandleWire[] }>({
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
	const { page } = await request<{ page: ApiSeriesTradePageWire }>({
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
		const { volumes } = await request<{ volumes: ApiSeriesTradedVolumeWire[] }>({
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
	const { assets } = await request<{ assets: ApiCollateralAssetInfoWire[] }>({
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
// are mapped back into the `#declarations` candid types like the public reads
// above, so stores and utils stay backend-agnostic.

/**
 * Clearing's account view for the session user in `domain`. The API rides the
 * engine's domain-scoped update read: its read-only query computes equity and
 * margin for Settlement alone, which reads as nothing reserved on ViciXp.
 */
export const getEngineAccountState = async (
	domain: ClearingDid.BalanceDomain
): Promise<ClearingDid.AccountStateResponse> => {
	const { account } = await request<{ account: ApiAccountStateResponseWire }>({
		path: `/api/v1/engine/account?domain=${balanceDomainToWire(domain)}`,
		method: 'GET'
	});

	return mapAccountStateResponse(account);
};

/** The session user's open positions across all series and domains. */
export const listEnginePositions = async (): Promise<ClearingDid.Position[]> => {
	const { positions } = await request<{ positions: ApiPositionWire[] }>({
		path: '/api/v1/engine/positions',
		method: 'GET'
	});

	return positions.map(mapPosition);
};

/** The session user's open limit orders across all series and domains. */
export const listEngineOrders = async (): Promise<ClearingDid.LimitOrder[]> => {
	const { orders } = await request<{ orders: ApiLimitOrderWire[] }>({
		path: '/api/v1/engine/orders',
		method: 'GET'
	});

	return orders.map(mapLimitOrder);
};

/** The session user's own trade / settlement event history. */
export const listEngineTradeHistory = async (): Promise<ClearingDid.Event[]> => {
	const { events } = await request<{ events: ApiEventWire[] }>({
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
	priceDecimals,
	callSize
}: {
	orderId: string;
	seriesId: string;
	outcomeId?: string;
	side: 'buy' | 'sell';
	qty: bigint;
	/** Fixed-point price mantissa, matching the engine's DecimalValue encoding. */
	priceValue: bigint;
	priceDecimals: number;
	/** ViciXp call size in whole VXP; the API refuses an order whose notional disagrees with it. */
	callSize?: number;
}): Promise<boolean> => {
	const { filled } = await parsedRequest({
		path: '/api/v1/engine/orders/limit',
		method: 'POST',
		schema: ApiOrderFilledResponseSchema,
		body: {
			orderId,
			seriesId,
			...(isNullish(outcomeId) ? {} : { outcomeId }),
			side,
			qty: qty.toString(),
			priceValue: priceValue.toString(),
			priceDecimals,
			...(isNullish(callSize) ? {} : { callSize })
		}
	});

	return filled;
};

/** Execute against one resting order (`qty` caps the take at that level). */
export const submitEngineMarketOrder = async ({
	tradeId,
	seriesId,
	matchingOrderId,
	qty,
	callSize
}: {
	tradeId: string;
	/** The series of the resting order, whose book the API prices the take from. */
	seriesId: string;
	matchingOrderId: string;
	qty?: bigint;
	/** ViciXp call size in whole VXP; the API refuses a take that costs more. */
	callSize?: number;
}): Promise<boolean> => {
	const { filled } = await parsedRequest({
		path: '/api/v1/engine/orders/market',
		method: 'POST',
		schema: ApiOrderFilledResponseSchema,
		body: {
			tradeId,
			seriesId,
			matchingOrderId,
			...(isNullish(qty) ? {} : { qty: qty.toString() }),
			...(isNullish(callSize) ? {} : { callSize })
		}
	});

	return filled;
};

export const cancelEngineOrder = async ({ orderId }: { orderId: string }): Promise<boolean> => {
	const { cancelled } = await parsedRequest({
		path: '/api/v1/engine/orders/cancel',
		method: 'POST',
		body: { orderId },
		schema: ApiOrderCancelledResponseSchema
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

// ─── Custodial wallet ────────────────────────────────────────────────────
//
// Balances, deposit addresses and withdrawals live on the API's custody
// ledger; `assetId` here is the custody asset id from `/wallet/assets`, a
// separate namespace from the engine's collateral `asset_id`.

export type ApiWalletAsset = z.output<typeof ApiWalletAssetSchema>;

export type ApiWalletBalance = z.output<typeof ApiWalletBalanceSchema>;

export type ApiWalletWithdrawal = z.output<typeof ApiWalletWithdrawalSchema>;

/** The withdrawable asset catalog (public read). */
export const listWalletAssets = async (): Promise<ApiWalletAsset[]> => {
	const { assets } = await parsedRequest({
		path: '/api/v1/wallet/assets',
		method: 'GET',
		schema: ApiWalletAssetsResponseSchema
	});

	return assets;
};

/** The session user's custodial accounts and per-asset balances. */
export const getWalletBalances = async (): Promise<{
	accounts: { chain: string; address: string }[];
	balances: ApiWalletBalance[];
}> =>
	await parsedRequest({
		path: '/api/v1/wallet/balances',
		method: 'GET',
		schema: ApiWalletBalancesResponseSchema
	});

/** The session user's deposit address on one chain (`ic` = the custodial
 * principal). A disabled chain surfaces as a 503 {@link ApiError}. */
export const getWalletDepositAddress = async (
	chain: string
): Promise<{ chain: string; address: string }> =>
	await parsedRequest({
		path: `/api/v1/wallet/deposit-address/${encodeURIComponent(chain)}`,
		method: 'GET',
		schema: ApiWalletDepositAddressResponseSchema
	});

/**
 * Request a custodial withdrawal (the self-custody exit when `selfCustody`).
 * The API executes best-effort inline, so the returned row already carries the
 * outcome state (`submitted`, or `failed` with the hold refunded).
 * `idempotencyKey` is fresh for each withdrawal the user asks for and resent
 * unchanged on any retry of it (the Wallet send keeps it with `pendingSendFor`):
 * the API answers a repeated key with the withdrawal it already filed instead
 * of holding the funds a second time.
 */
export const requestWalletWithdrawal = async ({
	assetId,
	amount,
	destination,
	selfCustody,
	idempotencyKey
}: {
	assetId: string;
	amount: bigint;
	destination: string;
	selfCustody?: boolean;
	idempotencyKey: string;
}): Promise<ApiWalletWithdrawal> => {
	const { withdrawal } = await parsedRequest({
		path: '/api/v1/wallet/withdrawals',
		method: 'POST',
		body: {
			assetId,
			amount: amount.toString(),
			destination,
			...(isNullish(selfCustody) ? {} : { selfCustody }),
			idempotencyKey
		},
		schema: ApiWalletWithdrawalResponseSchema
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
	const { items, total } = await request<{ items: ApiLeaderboardEntryWire[]; total: string }>({
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

type ApiLeagueWire = Omit<LeagueDoc, 'owner' | 'privacy'> & {
	ownerUserId: string;
	privacy: string;
};

const mapLeague = (wire: ApiLeagueWire): LeagueDoc => {
	const { ownerUserId, privacy, ...rest } = wire;

	return { ...rest, owner: ownerUserId, privacy: privacy as LeaguePrivacy };
};

type ApiLeagueMemberWire = Omit<LeagueMemberDoc, 'member'> & { memberUserId: string };

const mapLeagueMember = (wire: ApiLeagueMemberWire): LeagueMemberDoc => {
	const { memberUserId, ...rest } = wire;

	return { ...rest, member: memberUserId };
};

type ApiBattleWire = Omit<BattleDoc, 'proposer' | 'scope'> & {
	proposerUserId: string;
	scope?: string;
};

const mapBattle = (wire: ApiBattleWire): BattleDoc => {
	const { proposerUserId, scope, ...rest } = wire;

	return readBattleDoc({
		...rest,
		proposer: proposerUserId,
		// Drop anything outside the closed scope set, like the satellite
		// projection does for legacy / unknown values.
		...(nonNullish(scope) && isBattleScope(scope) ? { scope } : {})
	});
};

/** Every league the session user belongs to, with role and member tally. */
export const listMyLeagues = async (): Promise<
	{ league: LeagueDoc; role: LeagueMemberRole; joinedAtMs: number; memberCount: number }[]
> => {
	const { items } = await request<{
		items: {
			league: ApiLeagueWire;
			role: LeagueMemberRole;
			joinedAtMs: number;
			memberCount: number;
		}[];
	}>({ path: '/api/v1/leagues/mine', method: 'GET' });

	return items.map(({ league, ...rest }) => ({ league: mapLeague(league), ...rest }));
};

/** The opponent pool for the create-battle picker. */
export const listChallengeableLeagues = async (): Promise<LeagueDoc[]> => {
	const { items } = await request<{ items: ApiLeagueWire[] }>({
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
		items: { league: ApiLeagueWire; memberCount: number; friendMemberUserIds: string[] }[];
	}>({ path: '/api/v1/leagues/friend-recommended', method: 'GET' });

	return items.map(({ league, memberCount, friendMemberUserIds }) => ({
		league: mapLeague(league),
		memberCount,
		friendMembers: friendMemberUserIds
	}));
};

/** Resolve an invite code to its league; `undefined` = invalid code (UX). */
export const lookupLeagueByInvite = async (inviteCode: string): Promise<LeagueDoc | undefined> => {
	const { league } = await request<{ league?: ApiLeagueWire | null }>({
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
	const { league } = await request<{ league: ApiLeagueWire }>({
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
	const { league } = await request<{ league: ApiLeagueWire }>({
		path: `/api/v1/leagues/${encodeURIComponent(leagueId)}`,
		method: 'PATCH',
		body: {
			...(isNullish(name) ? {} : { name }),
			...(isNullish(privacy) ? {} : { privacy })
		}
	});

	return mapLeague(league);
};

export interface ApiTransferLeagueOwnershipResult {
	ok: boolean;
	reason?: 'not_owner' | 'league_not_found' | 'new_owner_not_member' | 'new_owner_is_caller';
}

export const transferLeagueOwnership = async ({
	leagueId,
	newOwnerUserId
}: {
	leagueId: string;
	newOwnerUserId: string;
}): Promise<ApiTransferLeagueOwnershipResult> =>
	await request({
		path: `/api/v1/leagues/${encodeURIComponent(leagueId)}/transfer-ownership`,
		method: 'POST',
		body: { newOwnerUserId }
	});

/** Full roster of a league, earliest joiner first. */
export const listLeagueMembers = async (leagueId: string): Promise<LeagueMemberDoc[]> => {
	const { items } = await request<{ items: ApiLeagueMemberWire[] }>({
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
	const { member } = await request<{ member: ApiLeagueMemberWire }>({
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
	const { member } = await request<{ member: ApiLeagueMemberWire }>({
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
		`${apiBaseUrl()}/api/v1/leagues/${encodeURIComponent(leagueId)}/image`,
		{ method: 'POST', credentials: 'include', body }
	);

	if (!response.ok) {
		throw await refusal(response);
	}

	const { league } = (await response.json()) as { league: ApiLeagueWire };

	return mapLeague(league);
};

/** Owner-only cover removal: clears the row's URL and drops the stored
 * asset; the league falls back to its emblem glyph. */
export const deleteLeagueImage = async (leagueId: string): Promise<LeagueDoc> => {
	const { league } = await request<{ league: ApiLeagueWire }>({
		path: `/api/v1/leagues/${encodeURIComponent(leagueId)}/image`,
		method: 'DELETE'
	});

	return mapLeague(league);
};

/** Every battle involving the caller (duels by id, league bouts by owned
 * leagues), kickoff ascending. */
export const listMyBattles = async (): Promise<BattleDoc[]> => {
	const { items } = await request<{ items: ApiBattleWire[] }>({
		path: '/api/v1/battles/mine',
		method: 'GET'
	});

	return items.map(mapBattle);
};

/** Battles referencing a league on either side, kickoff ascending. */
export const listLeagueBattles = async (leagueId: string): Promise<BattleDoc[]> => {
	const { items } = await request<{ items: ApiBattleWire[] }>({
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
		const { battle } = await request<{ battle: ApiBattleWire }>({
			path: `/api/v1/battles/${encodeURIComponent(battleId)}`,
			method: 'GET'
		});

		return mapBattle(battle);
	} catch (err: unknown) {
		if (err instanceof ApiError && err.status === 404) {
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
	amount,
	trashTalk
}: {
	id: string;
	kind: BattleDoc['kind'];
	sideA: string;
	sideB: string;
	kickoffMs: number;
	settleMs: number;
	scope?: string;
	amount?: number;
	trashTalk?: string;
}): Promise<BattleDoc> => {
	const { battle } = await request<{ battle: ApiBattleWire }>({
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
			...(isNullish(amount) ? {} : { amount }),
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
	const { battle } = await request<{ battle: ApiBattleWire }>({
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

type ApiAffiliationWire = Omit<AffiliationDoc, 'member'> & { memberUserId: string };

const mapAffiliation = (wire: ApiAffiliationWire): AffiliationDoc => {
	const { memberUserId, ...rest } = wire;

	return { ...rest, member: memberUserId };
};

/** The caller's current Worlds slots: at most one university + one country. */
export const getMyAffiliations = async (): Promise<{
	university?: AffiliationDoc;
	country?: AffiliationDoc;
}> => {
	const { university, country } = await request<{
		university?: ApiAffiliationWire | null;
		country?: ApiAffiliationWire | null;
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
	const { affiliation } = await request<{ affiliation: ApiAffiliationWire }>({
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
	reason?: TriggerTournamentDrawRefusalReason;
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

/** Structured calibration-claim result; `recorded_only` marks an award that
 * was recorded without a transfer (treasury parallel-run mode). */
export interface ApiCalibrationClaim {
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
		| 'already_called'
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
}): Promise<ApiCalibrationClaim> =>
	await request({
		path: '/api/v1/vxp/calibration/claim',
		method: 'POST',
		body: { seriesId, chosenSide }
	});

// ─── Referrals ───────────────────────────────────────────────────────────

interface ApiReferralPayoutWire {
	status: 'none' | 'owed' | 'paid';
	amountBaseUnits: string;
}

/** One redemption where the caller is the referrer. The wire omits the
 * referrer id (it is always the caller); the service restores it. */
export interface ApiReferralWire {
	referee: string;
	code: string;
	redeemedAtMs: number;
	withinReferrerCap: boolean;
	refereePayout: ApiReferralPayoutWire;
	referrerPayout: ApiReferralPayoutWire;
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
 * {@link ApiError} whose `code` carries the stable refusal reason. */
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
export const listMyReferrals = async (): Promise<ApiReferralWire[]> => {
	const { items } = await request<{ items: ApiReferralWire[] }>({
		path: '/api/v1/referrals/mine',
		method: 'GET'
	});

	return items;
};

// ─── Challenge links ─────────────────────────────────────────────────────

const challengePath = (id: string): string => `/api/v1/challenges/${encodeURIComponent(id)}`;

/** Issues the session user's link for a market, or returns their active one (same id), refreshed
 * with the position the engine holds now and the consent flag sent. Refusals (`no_position`,
 * `market_closed`, `unknown_series`, `unsupported_series`) surface as {@link ApiError}. */
export const createChallenge = async ({
	seriesId,
	showIdentity
}: {
	seriesId: string;
	showIdentity: boolean;
}): Promise<OwnChallenge> => {
	const { challenge } = await request<{ challenge: OwnChallenge }>({
		path: '/api/v1/challenges/',
		method: 'POST',
		body: { seriesId, showIdentity }
	});

	return challenge;
};

/** The public read of a link (no session needed). An unknown, revoked or hidden link answers
 * 404 `challenge_not_found`. */
export const getChallenge = async (id: string): Promise<ChallengeView> => {
	const { challenge } = await request<{ challenge: ChallengeView }>({
		path: challengePath(id),
		method: 'GET'
	});

	return challenge;
};

/** The owner turns the identity on the link's public read on or off. */
export const setChallengeConsent = async ({
	id,
	showIdentity
}: {
	id: string;
	showIdentity: boolean;
}): Promise<OwnChallenge> => {
	const { challenge } = await request<{ challenge: OwnChallenge }>({
		path: challengePath(id),
		method: 'PATCH',
		body: { showIdentity }
	});

	return challenge;
};

/** The owner turns the link off: it reads as not found from then on. */
export const revokeChallenge = async (id: string): Promise<void> => {
	await request<{ ok: boolean }>({ path: challengePath(id), method: 'DELETE' });
};

/** Credits the link's challenger as the session user's referrer. */
export const redeemChallenge = async (id: string): Promise<ChallengeRedeemOutcome> => {
	const { outcome } = await request<{ outcome: ChallengeRedeemOutcome }>({
		path: `${challengePath(id)}/redeem`,
		method: 'POST'
	});

	return outcome;
};

/** Records the session user's own call on the link's market as an answer. The API reads the
 * position from the engine; nothing about it is sent. */
export const answerChallenge = async (id: string): Promise<ChallengeAnswer> => {
	const { answer } = await request<{ answer: ChallengeAnswer }>({
		path: `${challengePath(id)}/answer`,
		method: 'POST'
	});

	return answer;
};

/** The session user's active links, newest first, with their answer counts. */
export const listMyChallenges = async (): Promise<OwnChallenge[]> => {
	const { items } = await request<{ items: OwnChallenge[] }>({
		path: '/api/v1/challenges/mine',
		method: 'GET'
	});

	return items;
};

/** Answers to the session user's links, newest first. */
export const listChallengeAnswers = async (): Promise<ChallengeAnswerItem[]> => {
	const { items } = await request<{ items: ChallengeAnswerItem[] }>({
		path: '/api/v1/challenges/answers',
		method: 'GET'
	});

	return items;
};

// ─── School verification ─────────────────────────────────────────────────

/** Ask the API to mail a 6-digit code to `email`. The school itself is
 * re-resolved server-side from the email domain (plus name/country for a
 * new entry), so no school id rides the request. Rejections (bad domain,
 * daily cap, feature disabled) surface as {@link ApiError}. */
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

export interface ApiDeleteAccountResult {
	ok: boolean;
	/** `holds_custody_funds`: the wallet still holds funds or a withdrawal is
	 * in flight; the user withdraws first. Only the API sends it. */
	reason?:
		'holds_custody_funds' | 'owns_non_empty_league' | 'league_resolution_failed' | 'invalid_input';
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
}): Promise<ApiDeleteAccountResult> =>
	await request({
		path: '/api/v1/account/delete',
		method: 'POST',
		body: { reason, note, ...(isNullish(leagueResolutions) ? {} : { leagueResolutions }) }
	});

/** Clear a soft-delete inside the recovery window; a lapsed window
 * hard-deletes in place and returns `{ ok: false, reason: 'expired' }`, unless
 * the account still holds funds, which recovers it instead. */
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

type ApiActivityWire = Activity & { key: string };

const mapActivity = (wire: ApiActivityWire): Activity => {
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
	const { activity } = await request<{ activity: ApiActivityWire }>({
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
	const { items } = await request<{ items: ApiActivityWire[] }>({
		path: `/api/v1/social/activities?${encodeQuery({
			limit: limit.toString(),
			...(isNullish(type) ? {} : { type })
		})}`,
		method: 'GET'
	});

	return items.map(mapActivity);
};

/** The most-recent likes on the session user's own activities, newest first.
 * The route caps `limit` at 1000. */
export const listReceivedActivityReactions = async ({
	limit
}: {
	limit: number;
}): Promise<ActivityReaction[]> => {
	const { items } = await request<{ items: ActivityReaction[] }>({
		path: `/api/v1/social/activity-reactions/received?${encodeQuery({ limit: limit.toString() })}`,
		method: 'GET'
	});

	return items;
};
