import {
	DAY_IN_MS,
	MILLISECOND_IN_NANOSECONDS,
	USD_DECIMALS,
	ZERO
} from '#lib/constants/app.constants.ts';
import {
	INBOX_DISMISSED_STORAGE_KEY,
	INBOX_PROGRESS_STORAGE_KEY,
	INBOX_READ_STORAGE_KEY,
	INBOX_SETTLED_READ_STORAGE_KEY
} from '#lib/constants/inbox.constants.ts';
import { DEFAULT_LOCALE, type AppLocale } from '#lib/constants/locale.constants.ts';
import { AppPath } from '#lib/constants/routes.constants.ts';
import { marketsNotInitialized } from '#lib/derived/markets.derived.ts';
import {
	resolvedPositions,
	resolvedPositionsNotInitialized
} from '#lib/derived/resolved-positions.derived.ts';
import { receivedReactionsStore } from '#lib/stores/activity-reactions.store.ts';
import { friendRequestsStore, friendsRelationsLoadedStore } from '#lib/stores/friends.store.ts';
import { leagueDirectoryStore } from '#lib/stores/league-directory.store.ts';
import {
	leagueBattlesStore,
	leaguesLoadedStore,
	myLeaguesStore
} from '#lib/stores/leagues.store.ts';
import { localeStore } from '#lib/stores/locale.store.ts';
import { marketLanguagePreference } from '#lib/stores/market-language.store.ts';
import { displayMarkets, marketTranslations } from '#lib/stores/market-translations.store.ts';
import { preferencesStore } from '#lib/stores/preferences.store.ts';
import { profilesStore } from '#lib/stores/profiles.store.ts';
import { userStore } from '#lib/stores/user.store.ts';
import type { ResolutionItem, ResolutionRevealData } from '#lib/types/flow.ts';
import type { InboxNotification, InboxNotificationKind } from '#lib/types/inbox.ts';
import type { Market } from '#lib/types/market.ts';
import type { ResolvedPosition } from '#lib/types/position.ts';
import type { Relation } from '#lib/types/relation.ts';
import type { ActivityReaction } from '#lib/types/social.ts';
import {
	decimalFixedValueToNumber,
	formatRelativeAgoFromNs,
	shortenWithMiddleEllipsis,
	shortLeagueId
} from '#lib/utils/format.utils.ts';
import { t } from '#lib/utils/i18n.utils.ts';
import { inferResolvedOutcomeId } from '#lib/utils/resolved-position.utils.ts';
import { get, set as setStorage } from '#lib/utils/storage.utils.ts';
import {
	FLAME_STAGE_LABEL_KEYS,
	stageForStreak,
	streakMilestone
} from '#lib/utils/streak.utils.ts';
import { browser } from '$app/env';
import { isNullish, nonNullish } from '@dfinity/utils';
import type { Doc } from '@junobuild/core';
import { derived, get as getStore, writable, type Readable } from 'svelte/store';

/**
 * Turns the viewer's pending friend requests into inbox cards. They are
 * synthetic (not persisted in localStorage) and remain `unread` until the
 * underlying request is accepted or rejected: at which point they drop
 * out of `friendRequestsStore` and disappear from the inbox automatically.
 */
const friendRequestInboxStore: Readable<InboxNotification[]> = derived(
	[friendRequestsStore, profilesStore, userStore, localeStore],
	([$requests, $profiles, $user, $locale]) => {
		const viewer = $user.user?.owner;

		return $requests.map((doc: Doc<Relation>) => {
			const otherPrincipal =
				doc.data.participants.find((p) => p !== viewer) ?? doc.data.participants[0];
			const profile = $profiles.get(otherPrincipal);
			const displayName = profile?.nickname?.trim()
				? `@${profile.nickname.trim()}`
				: shortenWithMiddleEllipsis({ text: otherPrincipal, splitLength: 6 });

			return {
				id: `friend-request-${doc.key}`,
				kind: 'friend_request' as const,
				title: t({ locale: $locale, key: 'inbox.friend_request.title' }),
				body: t({
					locale: $locale,
					key: 'inbox.friend_request.body',
					params: { user: displayName }
				}),
				when: t({ locale: $locale, key: 'inbox.pending' }),
				unread: true,
				// Friends live inside the Arena tab strip. The `request` param
				// forces the Friends tab and scrolls the matching incoming row
				// into view (see `ArenaPage` / `FriendsTab`), so a tap lands on
				// the Accept affordance instead of a bare tab the recipient must
				// hunt through. The relation id contains `#`, so it is
				// percent-encoded into the query value.
				href: `${AppPath.Arena}?request=${encodeURIComponent(doc.key)}`
			};
		});
	}
);

// ── Battle response notifications ───────────────────────────────────────────
// Juno docs aren't pushed live across users, so a league owner whose
// challenge the opponent just accepted or declined wouldn't otherwise know.
// We derive a card from the battles the viewer *proposed* that have left the
// `proposed` state recently: the proposer's league is always `sideA`. The
// card ages out of the window so it can't linger forever; resolution has its
// own surface (the league detail), so resolved battles don't notify here.

const BATTLE_NOTIFICATION_WINDOW_MS = 3 * DAY_IN_MS;

const battleInboxStore: Readable<InboxNotification[]> = derived(
	[leagueBattlesStore, leagueDirectoryStore, userStore, localeStore],
	([$battles, $directory, $user, $locale]) => {
		const viewer = $user.user?.owner;

		if (isNullish(viewer)) {
			return [];
		}

		const now = Date.now();
		// A battle between two leagues the viewer owns appears in both
		// per-league lists, so dedupe by id (Map keeps the last seen).
		const proposed = [...$battles.values()]
			.flat()
			.filter(
				(battle) =>
					battle.proposer === viewer &&
					(battle.state === 'in_flight' || battle.state === 'declined')
			);

		const matched = [...new Map(proposed.map((battle) => [battle.id, battle])).values()]
			.map((battle) => ({
				battle,
				respondedAtMs: battle.respondedAtMs ?? battle.kickoffMs
			}))
			.filter(({ respondedAtMs }) => now - respondedAtMs <= BATTLE_NOTIFICATION_WINDOW_MS);

		return matched
			.sort((a, b) => b.respondedAtMs - a.respondedAtMs)
			.map(({ battle, respondedAtMs }) => {
				const accepted = battle.state === 'in_flight';
				const opponent = $directory.get(battle.sideB)?.name ?? shortLeagueId(battle.sideB);

				return {
					id: `battle-${battle.state}-${battle.id}`,
					kind: accepted ? ('battle_accepted' as const) : ('battle_declined' as const),

					title: t({
						locale: $locale,
						key: accepted ? 'inbox.battle_accepted.title' : 'inbox.battle_declined.title'
					}),
					body: t({
						locale: $locale,
						key: accepted ? 'inbox.battle_accepted.body' : 'inbox.battle_declined.body',
						params: { opponent }
					}),
					when: formatRelativeAgoFromNs({
						timestampNs: BigInt(Math.round(respondedAtMs)) * MILLISECOND_IN_NANOSECONDS,
						locale: $locale
					}),
					unread: true,
					href: `${AppPath.Arena}/leagues/${battle.sideA}`
				};
			});
	}
);

// ── Incoming-challenge notifications ────────────────────────────────────────
// The mirror of `battleInboxStore` for the *recipient*: a league owner whose
// league has just been challenged. The challenged league is always `sideB`,
// and the recipient already reads the `proposed` battle via
// `leagueBattlesStore` (the satellite returns battles referencing the league
// as either side). We derive one card per `proposed`, `kind='league'` battle
// where the viewer owns `sideB`. The card ages out of the same 3-day window
// and drops automatically once the proposal leaves `proposed` (accepted /
// declined / expired), since the filter no longer matches.

const battleIncomingInboxStore: Readable<InboxNotification[]> = derived(
	[leagueBattlesStore, myLeaguesStore, leagueDirectoryStore, userStore, localeStore],
	([$battles, $myLeagues, $directory, $user, $locale]) => {
		const viewer = $user.user?.owner;

		if (isNullish(viewer)) {
			return [];
		}

		const now = Date.now();
		const ownedLeagueIds = new Set(
			$myLeagues.filter((m) => m.role === 'owner').map((m) => m.league.id)
		);

		const incoming = [...$battles.values()].flat().filter(
			(battle) =>
				battle.kind === 'league' &&
				battle.state === 'proposed' &&
				// The viewer owns the challenged side (`sideB`) but must NOT be on
				// the challenging side: the proposer (and any co-owner of `sideA`)
				// already sees the outgoing challenge via `battleInboxStore`, so an
				// incoming card for one's own challenge would be a self-notification.
				// A self-vs-self challenge (`sideA === sideB`) is excluded too.
				ownedLeagueIds.has(battle.sideB) &&
				battle.sideA !== battle.sideB &&
				battle.proposer !== viewer &&
				!ownedLeagueIds.has(battle.sideA)
		);
		// A challenge can surface under more than one per-league list, so dedupe
		// by battle id (Map keeps the last seen), mirroring `battleInboxStore`.
		const matched = [...new Map(incoming.map((battle) => [battle.id, battle])).values()].filter(
			(battle) => now - battle.kickoffMs <= BATTLE_NOTIFICATION_WINDOW_MS
		);

		return matched
			.sort((a, b) => b.kickoffMs - a.kickoffMs)
			.map((battle) => {
				const opponent = $directory.get(battle.sideA)?.name ?? shortLeagueId(battle.sideA);
				const days = Math.max(1, Math.ceil((battle.settleMs - battle.kickoffMs) / DAY_IN_MS));

				return {
					id: `battle-proposed-${battle.id}`,
					kind: 'battle_incoming' as const,
					title: t({ locale: $locale, key: 'inbox.battle_incoming.title' }),
					body: t({
						locale: $locale,
						key: 'inbox.battle_incoming.body',
						params: { opponent, days }
					}),
					when: formatRelativeAgoFromNs({
						timestampNs: BigInt(Math.round(battle.kickoffMs)) * MILLISECOND_IN_NANOSECONDS,
						locale: $locale
					}),
					unread: true,
					href: `${AppPath.Arena}/leagues/${battle.sideB}`
				};
			});
	}
);

// ── Settled-event notifications ─────────────────────────────────────────────

const loadSettledReadSet = (): Set<bigint> => {
	const raw = get<string[]>({ key: INBOX_SETTLED_READ_STORAGE_KEY });

	if (isNullish(raw)) {
		return new Set();
	}

	try {
		return new Set(raw.map((id) => BigInt(id)));
	} catch {
		return new Set();
	}
};

const persistSettledReadSet = (set: Set<bigint>): void => {
	setStorage({
		key: INBOX_SETTLED_READ_STORAGE_KEY,
		value: Array.from(set, (id) => id.toString())
	});
};

/**
 * Per-event read state for Settled-event inbox cards, keyed by `event_id`.
 * Persisted to localStorage so the read marker survives reloads. Events
 * themselves come from the clearing canister, so we only need to remember
 * which ones the user has already acknowledged.
 */
const settledReadStore = writable<Set<bigint>>(loadSettledReadSet());

/**
 * Maps a resolved-position record to its inbox card. Body copy picks the
 * won/lost/neutral variant from the realized PnL sign, and the absolute
 * amount is formatted in clearing-USD units so it can flow into the
 * already-existing "X.YZ USD" presentation downstream surfaces use.
 */
const settledInboxStore: Readable<InboxNotification[]> = derived(
	[resolvedPositions, displayMarkets, marketsNotInitialized, settledReadStore, localeStore],
	([$resolved, $displayMarkets, $marketsNotInitialized, $read, $locale]) => {
		// The card body bakes the market title into its copy ("You won $X on
		// {market}"), so there is no room for a title skeleton: until the
		// catalog loads we'd render "Unknown Market" inline. Hold the settled
		// cards back instead; they surface the moment titles resolve. Read state
		// lives in `settledReadStore`, so this display-only gate can't lose an
		// acknowledgement.
		if ($marketsNotInitialized) {
			return [];
		}

		return $resolved.map((entry): InboxNotification => {
			const market = $displayMarkets.get(entry.marketId);

			const variant: 'won' | 'lost' | 'neutral' = entry.result;
			const titleKey =
				variant === 'won'
					? 'inbox.resolve.title.won'
					: variant === 'lost'
						? 'inbox.resolve.title.lost'
						: 'inbox.resolve.title.neutral';
			const bodyKey =
				variant === 'won'
					? 'inbox.resolve.body.won'
					: variant === 'lost'
						? 'inbox.resolve.body.lost'
						: 'inbox.resolve.body.neutral';

			// Body shows the absolute amount; the sign is conveyed by the
			// won / lost copy itself.
			const absPnl = entry.realizedPnlUsd < ZERO ? -entry.realizedPnlUsd : entry.realizedPnlUsd;
			const amount = decimalFixedValueToNumber({ value: absPnl, decimals: USD_DECIMALS }).toFixed(
				2
			);

			const marketTitle = market?.title ?? t({ locale: $locale, key: 'portfolio.unknown_market' });

			return {
				id: `settled-${entry.eventId.toString()}`,
				kind: 'resolve',
				title: t({ locale: $locale, key: titleKey }),
				body: t({
					locale: $locale,
					key: bodyKey,
					params: { amount, market: marketTitle }
				}),
				when: formatRelativeAgoFromNs({ timestampNs: entry.timestampNs, locale: $locale }),
				unread: !$read.has(entry.eventId),
				// Deep-link to the resolved market's detail via the kind router
				// (`notificationDestination`): `mid` carries the market id.
				mid: entry.marketId
			};
		});
	}
);

// ── Likes received on your own calls ────────────────────────────────────────

/**
 * Likes other users left on the viewer's OWN friend-feed calls, as inbox cards. Synthetic: derived
 * live from `receivedReactionsStore` (a key-prefix read scoped to the viewer), not persisted, so a
 * card disappears automatically when its reaction doc is deleted (an unlike), with no history store
 * to retain it. Self-likes are excluded. Mirrors {@link friendRequestInboxStore}; the per-id read
 * overlay in {@link combinedInboxStore} drives the read/unread state.
 *
 * Aggregated: all likes on one call collapse into a SINGLE card ("{user} and N more liked your
 * call"), keyed by the activity (not per-liker), so a burst of likes is one inbox entry and one
 * toast: not N. The card carries the most-recent liker's name + timestamp; marking it read marks
 * the whole burst. The stable per-activity id means a later like on an already-read call updates the
 * count in place without re-pinging.
 */
const likesReceivedInboxStore: Readable<InboxNotification[]> = derived(
	[receivedReactionsStore, profilesStore, userStore, localeStore],
	([$received, $profiles, $user, $locale]) => {
		const viewer = $user.user?.owner;

		if (isNullish($received) || isNullish(viewer)) {
			return [];
		}

		// Group likes by the call they're on. The read is author-scoped already; guard against a stale
		// page from a previous principal, and never notify the viewer about liking their own call.
		const byActivity = new Map<string, ActivityReaction[]>();

		for (const reaction of $received) {
			if (reaction.activityKey.startsWith(`${viewer}#`) && reaction.liker !== viewer) {
				const likes = byActivity.get(reaction.activityKey) ?? [];
				likes.push(reaction);
				byActivity.set(reaction.activityKey, likes);
			}
		}

		return Array.from(byActivity.values(), (likes): InboxNotification => {
			// Most-recent like fronts the card (name + timestamp + denormalized title / market).
			// Single pass for the latest reaction: no sort allocation; the count is the rest.
			// `likes` is non-empty (a group exists only because a reaction was pushed into it).
			const latest = likes.reduce((max, reaction) =>
				reaction.timestamp > max.timestamp ? reaction : max
			);
			const restCount = likes.length - 1;
			const profile = $profiles.get(latest.liker);
			const displayName = profile?.nickname?.trim()
				? `@${profile.nickname.trim()}`
				: shortenWithMiddleEllipsis({ text: latest.liker, splitLength: 6 });

			return {
				// Keyed by the activity (not the liker) so the burst is one card and the read overlay
				// sticks across refreshes as the count grows.
				id: `like-received-${latest.activityKey}`,
				kind: 'social',
				title:
					restCount === 0
						? t({
								locale: $locale,
								key: 'inbox.like_received.title',
								params: { user: displayName }
							})
						: t({
								locale: $locale,
								key: 'inbox.like_received.title_multi',
								params: { user: displayName, count: restCount }
							}),
				// The denormalized call title (spec A wrote it onto the reaction doc).
				body: latest.activityTitle,
				when: formatRelativeAgoFromNs({
					timestampNs: BigInt(latest.timestamp) * MILLISECOND_IN_NANOSECONDS,
					locale: $locale
				}),
				unread: true,
				// Deep-link to the liked call's market via the kind router; falls back to Arena.
				...(nonNullish(latest.marketId) && latest.marketId !== '' ? { mid: latest.marketId } : {})
			};
		});
	}
);

// ── "While you were away" resolution digest ─────────────────────────────────
// The Flow entry away-digest and the Dashboard resolution banner both surface
// the calls that settled since the user last acknowledged their resolutions.
// "Unacknowledged" is the same per-event read marker the Settled inbox cards
// use (`settledReadStore`), so opening the digest and marking it seen keeps the
// banner and the bell badge in lockstep; one settlement is never counted twice
// or surfaced in one place after being cleared in the other.

/**
 * Side the user held on a settled market, mapped to the visual chip bucket.
 * Mirrors the Portfolio resolved-row inference (`inferResolvedOutcomeId`) so
 * the digest rows read identically to the history rows. Categorical losers
 * can't be disambiguated, so they fall back to the neutral `hold` bucket.
 */
const resolvedSide = ({
	resolved,
	market
}: {
	resolved: Pick<ResolvedPosition, 'outcomeId'>;
	market?: Market;
}): { label: string; sideKey: ResolutionItem['sideKey'] } => {
	const outcomeId = inferResolvedOutcomeId({ resolved, market });

	if (outcomeId === 'YES') {
		return { label: 'YES', sideKey: 'yes' };
	}

	if (outcomeId === 'NO') {
		return { label: 'NO', sideKey: 'no' };
	}

	const label = outcomeId
		? (market?.outcomes?.find((o) => o.id === outcomeId)?.title ?? outcomeId)
		: '–';

	return { label, sideKey: 'hold' };
};

/**
 * The away-digest: every settled call the user hasn't acknowledged yet,
 * aggregated into net VXP, win/loss tallies, and per-call rows. A `count` of 0
 * means there is nothing new to reveal. Per-call and net VXP are carried at
 * full precision; the digest renderers round for display (a sub-1 favourite
 * win reads "<1" rather than a broken "+0": see `formatWholeVxpMagnitude`).
 */
export const maturedResolutions: Readable<ResolutionRevealData> = derived(
	[
		resolvedPositions,
		displayMarkets,
		marketsNotInitialized,
		settledReadStore,
		localeStore,
		marketTranslations,
		marketLanguagePreference
	],
	([
		$resolved,
		$displayMarkets,
		$marketsNotInitialized,
		$read,
		$locale,
		$translations,
		$preference
	]) => {
		const unseen = $resolved.filter((entry) => !$read.has(entry.eventId));

		const items: ResolutionItem[] = unseen.map((entry) => {
			const market = $displayMarkets.get(entry.marketId);
			const { label, sideKey } = resolvedSide({ resolved: entry, market });
			// Full precision: the digest renderers round for display via
			// `formatWholeVxpMagnitude` (a sub-1 favourite win reads "<1", not a
			// broken "+0"). Summing the precise per-call nets also keeps the
			// digest total honest rather than dropping every sub-1 win to zero.
			const net = decimalFixedValueToNumber({
				value: entry.realizedPnlUsd,
				decimals: USD_DECIMALS
			});

			return {
				eventId: entry.eventId,
				marketId: entry.marketId,
				question: market?.title ?? t({ locale: $locale, key: 'portfolio.unknown_market' }),
				side: label,
				sideKey,
				result: entry.result,
				won: entry.result === 'won',
				net
			};
		});

		const wins = items.filter((it) => it.result === 'won').length;
		const neutrals = items.filter((it) => it.result === 'neutral').length;
		const netVxp = items.reduce((sum, it) => sum + it.net, 0);

		// For a non-English reader showing translations, a title is only final
		// once the translation overlay has answered for its market; the overlay
		// gains an entry per series when its locale chain has been fetched,
		// translation and confirmed-absent alike, so a missing key means the
		// lookup is still in flight. Only markets the catalog knows about count:
		// an id the catalog itself can't resolve is a genuine `Unknown Market`,
		// not a pending one.
		const translationsPending =
			$locale !== DEFAULT_LOCALE &&
			$preference === 'translated' &&
			unseen.some(
				(entry) => $displayMarkets.has(entry.marketId) && !$translations.has(entry.marketId)
			);

		return {
			items,
			count: items.length,
			wins,
			losses: items.length - wins - neutrals,
			neutrals,
			netVxp,
			// Counts and net VXP above come straight off the positions and are
			// already correct; only the per-row titles depend on the catalog and
			// the translation overlay. The reveals hold or skeleton the titles
			// while this is true, rather than rendering the `Unknown Market`
			// fallback (a genuine miss once the catalog is in) or flashing the
			// untranslated original.
			titlesLoading: $marketsNotInitialized || translationsPending
		};
	}
);

/**
 * Acknowledges every call currently in the away-digest by adding its
 * `eventId` to the persisted read set: the same marker the Settled inbox
 * cards use. Called when the user enters Flow (the entry digest settles) or
 * opens the Dashboard ResolutionReveal, so the banner and bell badge clear
 * together. Idempotent: re-running with the digest empty is a no-op.
 */
export const markResolutionsSeen = (): void => {
	const digest = getStore(maturedResolutions);

	if (digest.count === 0) {
		return;
	}

	settledReadStore.update((current) => {
		const next = new Set(current);

		for (const item of digest.items) {
			next.add(item.eventId);
		}

		persistSettledReadSet(next);

		return next;
	});
};

// ── Per-id read overlay + dismissed set ─────────────────────────────────────
// Two persisted string-id sets, keyed by the notification `id`:
//   • read: overlays `unread` for cards NOT backed by the settled
//                 read-set (synthetic friend requests, seeds), so tapping a
//                 card's unread dot marks it read in place across reloads.
//   • dismissed: cards the user swiped away; filtered out of the list.
// Settled cards keep using `settledReadStore` (keyed by `event_id`) so the
// away-digest banner and the bell badge stay in lockstep; the read overlay
// here is purely additive on top of that.

const loadStringSet = (key: string): Set<string> => {
	const raw = get<unknown>({ key });

	if (!Array.isArray(raw) || !raw.every((id) => typeof id === 'string')) {
		return new Set();
	}

	return new Set(raw);
};

const persistStringSet = ({ key, set }: { key: string; set: Set<string> }): void => {
	setStorage({ key, value: Array.from(set) });
};

const inboxReadStore = writable<Set<string>>(loadStringSet(INBOX_READ_STORAGE_KEY));
const inboxDismissedStore = writable<Set<string>>(loadStringSet(INBOX_DISMISSED_STORAGE_KEY));

// ── Streak + level progress notifications ───────────────────────────────────
// `level` and the daily-streak milestone are monotonic counters: a pure
// derivation of "you're level 4" would pin the card forever and replay it on a
// fresh device. So a persisted high-water marker gates each card; a card
// exists only while the live value exceeds the marker. The marker seeds to the
// current value on first observation (no retroactive backlog), advances on
// acknowledge, and, for the streak, which resets to SPARK on a break, lowers
// when the run drops below it so re-climbing re-notifies. `initInboxProgress`
// (mounted by `NotifToastHost`) maintains the marker and records when an
// unacknowledged milestone first appeared (`*CrossedAt_ms`, for the card's
// relative-time label); the card stores below are pure derivations of
// (profile, marker).

interface InboxProgress {
	seenLevel?: number;
	seenStreakMilestone?: number;
	levelCrossedAt_ms?: number;
	streakCrossedAt_ms?: number;
}

const loadInboxProgress = (): InboxProgress => {
	const raw = get<InboxProgress>({ key: INBOX_PROGRESS_STORAGE_KEY });

	return nonNullish(raw) && typeof raw === 'object' ? raw : {};
};

const inboxProgressStore = writable<InboxProgress>(loadInboxProgress());

const updateInboxProgress = (updater: (current: InboxProgress) => InboxProgress): void => {
	inboxProgressStore.update((current) => {
		const next = updater(current);

		// `initInboxProgress` returns the same reference when nothing changed;
		// skip the localStorage write in that case to avoid churning the key on
		// every profile tick.
		if (next !== current) {
			setStorage({ key: INBOX_PROGRESS_STORAGE_KEY, value: next });
		}

		return next;
	});
};

/**
 * Relative-time label for a milestone card. Uses the recorded crossing time
 * when known; falls back to a "just now" label for the rare case where the
 * card is derived before the maintenance effect stamped the crossing (the
 * card is fresh either way).
 */
const milestoneWhen = ({ atMs, locale }: { atMs?: number; locale: AppLocale }): string =>
	// Guard `Number.isFinite` so a corrupt / hand-edited persisted stamp (NaN,
	// Infinity) can't reach `BigInt(...)` and throw: fall back to "just now".
	nonNullish(atMs) && Number.isFinite(atMs)
		? formatRelativeAgoFromNs({
				timestampNs: BigInt(Math.round(atMs)) * MILLISECOND_IN_NANOSECONDS,
				locale
			})
		: t({ locale, key: 'inbox.just_now' });

/**
 * Level-up card. Synthetic, gated by the high-water marker: present only
 * while the live `profile.level` exceeds `seenLevel`. `seenLevel` is
 * `undefined` until the maintenance effect seeds it, so a cold start emits
 * nothing until the marker is known. Routes to the Profile surface via the
 * kind default (no `mid`).
 */
const levelInboxStore: Readable<InboxNotification[]> = derived(
	[userStore, inboxProgressStore, localeStore],
	([$user, $progress, $locale]) => {
		const { profile } = $user;

		if (isNullish(profile) || isNullish($progress.seenLevel)) {
			return [];
		}

		const level = profile.level ?? 1;

		if (level <= $progress.seenLevel) {
			return [];
		}

		return [
			{
				id: `level-${level}`,
				kind: 'level' as const,
				title: t({ locale: $locale, key: 'inbox.level.title' }),
				body: t({ locale: $locale, key: 'inbox.level.body', params: { level } }),
				when: milestoneWhen({ atMs: $progress.levelCrossedAt_ms, locale: $locale }),
				unread: true
			}
		];
	}
);

/**
 * Streak-milestone card. Synthetic, gated by the high-water marker and the
 * `notify.streakReminder` preference: present only while the live flame
 * milestone (`streakMilestone(dailyStreak)`) exceeds `seenStreakMilestone`.
 * Routes to Flow via the kind default (no `mid`).
 */
const streakInboxStore: Readable<InboxNotification[]> = derived(
	[userStore, preferencesStore, inboxProgressStore, localeStore],
	([$user, $prefs, $progress, $locale]) => {
		const { profile } = $user;

		if (
			isNullish(profile) ||
			!$prefs.notify.streakReminder ||
			isNullish($progress.seenStreakMilestone)
		) {
			return [];
		}

		const milestone = streakMilestone(profile.dailyStreak ?? 0);

		if (milestone <= $progress.seenStreakMilestone) {
			return [];
		}

		const stageLabel = t({
			locale: $locale,
			key: FLAME_STAGE_LABEL_KEYS[stageForStreak(milestone)]
		});

		return [
			{
				id: `streak-milestone-${milestone}`,
				kind: 'streak' as const,
				title: t({ locale: $locale, key: 'inbox.streak.title' }),
				body: t({
					locale: $locale,
					key: 'inbox.streak.body',
					params: { stage: stageLabel, count: milestone }
				}),
				when: milestoneWhen({ atMs: $progress.streakCrossedAt_ms, locale: $locale }),
				unread: true
			}
		];
	}
);

/**
 * Advances the level marker to the current level and clears the crossing
 * stamp, so an acknowledged level-up card drops out and stays gone across
 * reloads. Idempotent.
 */
const acknowledgeLevel = (): void => {
	const level = getStore(userStore).profile?.level ?? 1;

	updateInboxProgress((current) => ({
		...current,
		seenLevel: Math.max(current.seenLevel ?? level, level),
		levelCrossedAt_ms: undefined
	}));
};

/**
 * Advances the streak marker to the current milestone and clears the crossing
 * stamp. Idempotent.
 */
const acknowledgeStreak = (): void => {
	const milestone = streakMilestone(getStore(userStore).profile?.dailyStreak ?? 0);

	updateInboxProgress((current) => ({
		...current,
		seenStreakMilestone: Math.max(current.seenStreakMilestone ?? milestone, milestone),
		streakCrossedAt_ms: undefined
	}));
};

/**
 * Maintains the streak/level high-water marker from the live profile:
 *   • seeds each marker to the current value on first observation (so a
 *     returning user gets no retroactive card),
 *   • records the crossing time the first time the live value exceeds the
 *     marker (for the card's `when` label),
 *   • lowers the streak marker when the run resets below it, so re-climbing
 *     re-notifies (the streak, unlike the monotonic level, breaks to SPARK).
 * The marker only moves *up* on acknowledge, which is what surfaces the card.
 *
 * On an owner change it reloads the marker from localStorage, which
 * `reconcileIdentityScopedStorage` (run by `Authn` before the new profile is
 * set) has already cleared on a real account switch, so the previous user's
 * `seen*` markers can't suppress the next user's cards. (The other in-memory
 * inbox stores only carry read-state and re-read on the next app load; this
 * one gates card *visibility*, so it re-reads on the switch itself.)
 *
 * Mounted from `NotifToastHost`'s `onMount` (beside `initInboxToasts`) so the
 * side-effect runs only while the shell is rendered; returns a teardown.
 */
export const initInboxProgress = (): (() => void) => {
	if (!browser) {
		return () => undefined;
	}

	let lastOwner: string | undefined;

	return userStore.subscribe(($user) => {
		const owner = $user.user?.owner;

		if (owner !== lastOwner) {
			lastOwner = owner;
			inboxProgressStore.set(loadInboxProgress());
		}

		const { profile } = $user;

		if (isNullish(profile)) {
			return;
		}

		const level = profile.level ?? 1;
		const milestone = streakMilestone(profile.dailyStreak ?? 0);

		updateInboxProgress((current) => {
			let next = current;

			if (isNullish(next.seenLevel)) {
				next = { ...next, seenLevel: level };
			} else if (level > next.seenLevel && isNullish(next.levelCrossedAt_ms)) {
				next = { ...next, levelCrossedAt_ms: Date.now() };
			}

			if (isNullish(next.seenStreakMilestone)) {
				next = { ...next, seenStreakMilestone: milestone };
			} else if (milestone < next.seenStreakMilestone) {
				next = { ...next, seenStreakMilestone: milestone, streakCrossedAt_ms: undefined };
			} else if (milestone > next.seenStreakMilestone && isNullish(next.streakCrossedAt_ms)) {
				next = { ...next, streakCrossedAt_ms: Date.now() };
			}

			return next;
		});
	});
};

/**
 * The inbox surface (Notifications page, bell badge) reads from this combined
 * view. Order: live actionable items (friend requests), then incoming league
 * challenges, then battle responses, then real settled-event notifications,
 * then likes received on your calls, then streak / level milestones. Every
 * card is derived from live data: there is no seeded/mock layer.
 *
 * Dismissed cards are filtered out, and the per-id read overlay is applied
 * on top of each item's own `unread` so a card tapped read in place stays
 * read across reloads.
 */
export const combinedInboxStore: Readable<InboxNotification[]> = derived(
	[
		friendRequestInboxStore,
		battleIncomingInboxStore,
		battleInboxStore,
		settledInboxStore,
		likesReceivedInboxStore,
		streakInboxStore,
		levelInboxStore,
		inboxReadStore,
		inboxDismissedStore
	],
	([
		$requests,
		$battleIncoming,
		$battles,
		$settled,
		$likesReceived,
		$streak,
		$level,
		$read,
		$dismissed
	]) =>
		[
			...$requests,
			...$battleIncoming,
			...$battles,
			...$settled,
			...$likesReceived,
			...$streak,
			...$level
		]
			.filter((item) => !$dismissed.has(item.id))
			.map((item) => (item.unread && $read.has(item.id) ? { ...item, unread: false } : item))
);

export const combinedInboxUnreadCount: Readable<number> = derived(
	combinedInboxStore,
	($items) => $items.filter((item) => item.unread).length
);

// ── New-arrival toast feed ──────────────────────────────────────────────────
// The slide-in popup (`NotifToastHost`) surfaces on a genuinely NEW inbox
// item: a real event (a freshly-settled market, an incoming friend request,
// …) that wasn't present on the previous tick.
//
// Gating strategy: user-scoped async sources (trade history / resolvedPositions,
// friend relations) are still loading at cold start. The first synchronous
// `combinedInboxStore` emission carries an incomplete snapshot: if we diffed
// from that we'd fire arrival toasts for every pre-existing unread item.
// Instead we delay the diff until BOTH async sources report ready:
//   • `resolvedPositionsNotInitialized` flips false → trade history has loaded
//   • `friendsRelationsLoadedStore` flips true → friend relations have loaded
// Until then every emission is treated as baseline-only (ids are accumulated,
// no toast is fired). The seed store (localStorage) is synchronous; its
// content is included in the baseline naturally.
//
// On auth transitions `Authn.svelte` resets `tradeHistoryStore` to `undefined`
// and calls `clearFriendRelations()`, which reverts both signals to
// "not loaded". That drives `sourcesHydrated` back to `false`, so the next
// sign-in's cold-start data is baseline-only too: a different principal's
// existing unreads never replay as arrival toasts.

export interface InboxToast {
	id: string;
	kind: InboxNotificationKind;
	title: string;
	body: string;
	mid?: string;
	href?: string;
}

const inboxToastStore = writable<InboxToast | undefined>(undefined);

/**
 * The most recent newly-arrived unread inbox item, or `undefined` once
 * dismissed / consumed. `NotifToastHost` subscribes to this and animates the
 * popup in; calling {@link clearInboxToast} retracts it.
 */
export const latestInboxToast: Readable<InboxToast | undefined> = inboxToastStore;

export const clearInboxToast = (): void => {
	inboxToastStore.set(undefined);
};

/**
 * True once both async user-scoped inbox sources have completed their initial
 * load. We use this to gate the toast diff so cold-start data never fires
 * arrival toasts.
 *
 * - `resolvedPositionsNotInitialized` starts `true`, flips `false` once the
 *   clearing-canister trade history fetch completes (even if empty).
 * - `friendsRelationsLoadedStore` starts `false`, flips `true` once the
 *   first `refreshFriendRelations()` call completes.
 * - `receivedReactionsStore` starts `undefined`, becomes an array once the
 *   first received-reactions load completes (even if empty), so a cold-start
 *   backlog of likes on the viewer's calls is absorbed into the baseline
 *   instead of replaying as arrival toasts.
 *
 * Leagues are deliberately NOT part of this gate: `refreshMyLeagues()` only
 * runs on Leagues/Battles/LeagueDetail pages, so a session that never visits
 * them would otherwise leave `sourcesHydrated` false forever and suppress
 * arrival toasts for EVERY kind. The `battle_incoming` cold-start backlog is
 * instead absorbed locally in {@link initInboxToasts}, gated on
 * `leaguesLoadedStore`, so the other kinds toast normally meanwhile.
 */
const sourcesHydrated: Readable<boolean> = derived(
	[resolvedPositionsNotInitialized, friendsRelationsLoadedStore, receivedReactionsStore],
	([$notInit, $friendsLoaded, $received]) => !$notInit && $friendsLoaded && nonNullish($received)
);

/**
 * Wires the arrival-toast diff: subscribes to the combined inbox snapshot
 * (gated on {@link sourcesHydrated}) and pushes a freshly-arrived unread item
 * into {@link inboxToastStore}. The "seen" baseline is kept LOCAL to this
 * subscription rather than at module scope, so the side-effect only runs while
 * `NotifToastHost` is mounted (it calls this once and tears it down on
 * destroy). Returns a teardown that stops the subscription: mirrors
 * `initFlowPrewarm` in `flow.store.ts`.
 *
 * Baseline semantics are unchanged: until both async sources hydrate, every
 * emission just refreshes the baseline (no toast); on the first hydrated tick
 * the existing backlog is absorbed into the baseline; only genuinely new
 * unread items thereafter fire a toast.
 *
 * Leagues are gated locally rather than via {@link sourcesHydrated}: the
 * `battle_incoming` cold-start backlog materialises only when
 * `refreshMyLeagues()` finally runs (on first visit to a Leagues/Battles page),
 * which may be long after the global sources hydrate or never at all. So the
 * incoming-challenge diff is suppressed until `leaguesLoadedStore` flips, and
 * the tick it flips the whole incoming backlog is folded into the baseline
 * rather than replaying as arrival toasts. Other kinds keep toasting normally
 * even in a session that never loads leagues.
 */
const BATTLE_INCOMING_ID_PREFIX = 'battle-proposed-';

export const initInboxToasts = (): (() => void) => {
	if (!browser) {
		return () => undefined;
	}

	let seenInboxIds: Set<string> | undefined;
	let leaguesLoadedSeen = false;

	return derived(
		[combinedInboxStore, sourcesHydrated, leaguesLoadedStore],
		([$items, $hydrated, $leaguesLoaded]) => ({
			items: $items,
			hydrated: $hydrated,
			leaguesLoaded: $leaguesLoaded
		})
	).subscribe(({ items, hydrated, leaguesLoaded }) => {
		if (!hydrated) {
			// Sources still loading: accumulate ids as baseline without diffing.
			seenInboxIds = new Set(items.map((item) => item.id));

			return;
		}

		if (isNullish(seenInboxIds)) {
			// Hydration just completed but no baseline recorded yet (edge case:
			// subscribe fired with hydrated=true before any non-hydrated tick).
			seenInboxIds = new Set(items.map((item) => item.id));
			leaguesLoadedSeen = leaguesLoaded;

			return;
		}

		// Leagues just finished their first load this tick; the incoming
		// backlog appears all at once. Suppress the incoming diff for this one
		// tick so the backlog is absorbed; non-incoming kinds still diff.
		const leaguesJustLoaded = leaguesLoaded && !leaguesLoadedSeen;
		leaguesLoadedSeen = leaguesLoaded;

		const baseline = seenInboxIds;
		// An incoming-challenge id can't be a genuine arrival until leagues have
		// loaded (the source hasn't been fetched), and the first loaded tick is
		// the cold-start backlog: treat incoming as already-seen in both cases.
		const incomingSettled = leaguesLoaded && !leaguesJustLoaded;
		const next = items.find(
			(item) =>
				item.unread &&
				!baseline.has(item.id) &&
				(incomingSettled || !item.id.startsWith(BATTLE_INCOMING_ID_PREFIX))
		);

		seenInboxIds = new Set(items.map((item) => item.id));

		if (isNullish(next)) {
			return;
		}

		inboxToastStore.set({
			id: next.id,
			kind: next.kind,
			title: next.title,
			body: next.body,
			mid: next.mid,
			href: next.href
		});
	});
};

/**
 * Marks every currently-visible settled-event card as read by adding
 * its `event_id` to the persisted per-event read set. See the
 * `markAllInboxRead` public entry point further below, which also overlays
 * a per-id read marker on the remaining synthetic cards.
 */
const markAllSettledRead = (): void => {
	const visible = getStore(settledInboxStore);

	if (visible.length === 0) {
		return;
	}

	// `settled-<eventId>`: strip the prefix to recover the bigint id.
	const SETTLED_PREFIX = 'settled-';
	const idsToMark = visible.flatMap((item) => {
		if (!item.id.startsWith(SETTLED_PREFIX)) {
			return [];
		}

		try {
			return [BigInt(item.id.slice(SETTLED_PREFIX.length))];
		} catch {
			// Defensive: non-numeric id shouldn't reach here.
			return [];
		}
	});

	if (idsToMark.length === 0) {
		return;
	}

	settledReadStore.update((current) => {
		const next = new Set(current);

		for (const id of idsToMark) {
			next.add(id);
		}

		persistSettledReadSet(next);

		return next;
	});
};

/**
 * Marks a single inbox card read in place by its `id`. Settled cards route
 * to the per-event read-set (so the away-digest banner clears in lockstep);
 * streak / level cards advance their high-water marker (so the milestone card
 * drops out and stays gone); every other id goes to the per-id read overlay.
 * Idempotent.
 */
export const markInboxRead = (id: string): void => {
	const SETTLED_PREFIX = 'settled-';

	if (id.startsWith(SETTLED_PREFIX)) {
		let eventId: bigint;

		try {
			eventId = BigInt(id.slice(SETTLED_PREFIX.length));
		} catch {
			return;
		}

		settledReadStore.update((current) => {
			if (current.has(eventId)) {
				return current;
			}

			const next = new Set(current);
			next.add(eventId);
			persistSettledReadSet(next);

			return next;
		});

		return;
	}

	if (id.startsWith('level-')) {
		acknowledgeLevel();

		return;
	}

	if (id.startsWith('streak-milestone-')) {
		acknowledgeStreak();

		return;
	}

	inboxReadStore.update((current) => {
		if (current.has(id)) {
			return current;
		}

		const next = new Set(current);
		next.add(id);
		persistStringSet({ key: INBOX_READ_STORAGE_KEY, set: next });

		return next;
	});
};

/**
 * Dismisses a single inbox card by its `id`, persisting the dismissal so the
 * card stays hidden across reloads. Filtered out of {@link combinedInboxStore}.
 * Streak / level cards instead advance their high-water marker (no separate
 * dismissed entry needed: the marker drops the card and a later, higher
 * milestone still surfaces under a fresh id).
 */
export const dismissInboxNotification = (id: string): void => {
	if (id.startsWith('level-')) {
		acknowledgeLevel();

		return;
	}

	if (id.startsWith('streak-milestone-')) {
		acknowledgeStreak();

		return;
	}

	inboxDismissedStore.update((current) => {
		if (current.has(id)) {
			return current;
		}

		const next = new Set(current);
		next.add(id);
		persistStringSet({ key: INBOX_DISMISSED_STORAGE_KEY, set: next });

		return next;
	});
};

/**
 * Public "mark all read" entry point. Clears the per-event Settled read-state
 * and the streak / level high-water markers, and overlays a read marker on
 * every other currently-visible card (synthetic friend requests, battle
 * responses, likes) so the badge fully clears. Callers (NotificationsPage,
 * bell action) should use this: never the layer-specific helpers directly.
 */
export const markAllInboxRead = (): void => {
	markAllSettledRead();
	acknowledgeLevel();
	acknowledgeStreak();

	const unreadIds = getStore(combinedInboxStore)
		.filter((item) => item.unread)
		.map((item) => item.id);

	if (unreadIds.length === 0) {
		return;
	}

	inboxReadStore.update((current) => {
		const next = new Set(current);

		for (const id of unreadIds) {
			next.add(id);
		}

		persistStringSet({ key: INBOX_READ_STORAGE_KEY, set: next });

		return next;
	});
};
