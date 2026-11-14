<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import type { Doc } from '@junobuild/core';
	import { Check, ChevronRight, Link2, Plus, Share2, Zap } from '@lucide/svelte/icons';
	import { onMount, tick } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { fade } from 'svelte/transition';
	import AddFriendSheet from '#lib/components/arena/AddFriendSheet.svelte';
	import FriendProfileSheet from '#lib/components/arena/FriendProfileSheet.svelte';
	import FriendsEmptyState from '#lib/components/arena/FriendsEmptyState.svelte';
	import RankedRow from '#lib/components/arena/RankedRow.svelte';
	import Avatar from '#lib/components/profile/Avatar.svelte';
	import BaseButton from '#lib/components/ui/BaseButton.svelte';
	import LoadingSpinner from '#lib/components/ui/LoadingSpinner.svelte';
	import { MILLISECOND_IN_NANOSECONDS, USD_DECIMALS } from '#lib/constants/app.constants.ts';
	import {
		cumulativeReferrerRewardBaseUnits,
		REFERRAL_MAX_PAID
	} from '#lib/constants/referral.constants.ts';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { VXP_TOKEN } from '#lib/constants/tokens/tokens.ic.constants.ts';
	import { ownGlobalStanding } from '#lib/derived/standings.derived.ts';
	import { authPrincipal } from '#lib/derived/user.derived.ts';
	import { track } from '#lib/services/analytics.services.ts';
	import { getMyReferralCode } from '#lib/services/referral.services.ts';
	import { getFriendResolvedResults } from '#lib/services/relation-queries.services.ts';
	import {
		acceptFriendRequest,
		cancelFriendRequest,
		rejectFriendRequest,
		sendFriendRequest,
		unfriendUser
	} from '#lib/services/relation.services.ts';
	import { getLeagueStandings, loadGlobalStandings } from '#lib/services/standings.services.ts';
	import {
		friendRequestsStore,
		friendsListStore,
		friendsRelationsLoadedStore,
		refreshFriendRelations,
		sentFriendRequestsStore
	} from '#lib/stores/friends.store.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { marketDisplay } from '#lib/stores/market-translations.store.ts';
	import { notificationsStore, type NotificationType } from '#lib/stores/notification.store.ts';
	import { profilesStore } from '#lib/stores/profiles.store.ts';
	import { myReferralsStore, refreshMyReferrals } from '#lib/stores/referrals.store.ts';
	import { globalStandingsStore } from '#lib/stores/standings.store.ts';
	import { userStore } from '#lib/stores/user.store.ts';
	import type { UserProfile } from '#lib/types/profile.ts';
	import type { Relation } from '#lib/types/relation.ts';
	import type { ResolvedResult } from '#lib/types/social.ts';
	import type { StandingEntry, StandingsWindow } from '#lib/types/standings.ts';
	import { writeToClipboard } from '#lib/utils/clipboard.utils.ts';
	import {
		decimalFixedValueToNumber,
		formatRelativeAgoFromNs,
		shortenWithMiddleEllipsis
	} from '#lib/utils/format.utils.ts';
	import { haptic } from '#lib/utils/haptics.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';
	import {
		formatVxpBalance,
		formatWholeVxpMagnitude,
		vxpBaseUnitsFromPoints
	} from '#lib/utils/playground-display.utils.ts';
	import { prefersReducedMotion } from '#lib/utils/reduced-motion.utils.ts';
	import { friendRequestOutcomeNotice } from '#lib/utils/relation.utils.ts';
	import { goto } from '$app/navigation';

	/**
	 * Friends: the Arena tab. Lives only inside Arena; there is no
	 * standalone `/friends` route.
	 *
	 * Sections (top → bottom):
	 *  1. Invite hero: +500 VXP eyebrow, remaining-invites cap line,
	 *     social-proof row when referrals are paid, a Share CTA, and an
	 *     inline copy field whose link line doubles as the copy button
	 *     (flips to a green check + fires a haptic on copy).
	 *  2. Outgoing invites: friend requests this user has sent that
	 *     are still pending the recipient's first call.
	 *  3. Incoming friend requests; each expandable to Accept / Reject.
	 *  4. Friends-ranked list: rank 01, 02, …, h2h accuracy delta chip,
	 *     sticky YOU row pinned at the bottom of the rank list.
	 *  5. Friends results digest; one row per friend with a resolved
	 *     record over the window: W-L tally + net VXP + a standout call.
	 *     Friends with no resolved prediction in the window are excluded;
	 *     an empty graph renders quiet serif-italic copy.
	 *  6. Global ranking link: viewer's leaderboard rank with chevron;
	 *     rank-delta chip deferred until the satellite ships a
	 *     historical-rank snapshot.
	 *  7. Friend mini-profile bottom sheet: opens on row tap; surfaces
	 *     stats + h2h accuracy delta + Remove.
	 *  8. Add-by-handle bottom sheet: `@`-prefixed input. Today writes
	 *     through to `sendFriendRequest` which expects a principal text;
	 *     the visual handle prefix is the user-facing affordance until
	 *     the satellite gains nickname-based lookup.
	 *
	 * The component reuses the existing `friendsListStore` /
	 * `friendRequestsStore` infrastructure rather than re-fetching, so the
	 * inbox bell + Arena tab badge stay in lockstep.
	 */

	interface Props {
		/**
		 * Relation id of an incoming request to focus, set when the user
		 * arrives from a `friend_request` inbox deep-link (see `ArenaPage` /
		 * `inbox.store.ts`). The matching row is scrolled into view and
		 * briefly highlighted so the recipient lands on the Accept affordance.
		 */
		focusRequestKey?: string;
	}

	let { focusRequestKey }: Props = $props();

	const VXP_DECIMALS = VXP_TOKEN.decimals;
	const REFERRAL_BONUS_VXP = 500n * 10n ** BigInt(VXP_DECIMALS);

	const userPrincipal = $derived($authPrincipal ?? '');
	const myProfile = $derived($userStore.profile);

	const activeRelations = $derived($friendsListStore);
	const pendingReceived = $derived($friendRequestsStore);
	const pendingSent = $derived($sentFriendRequestsStore);
	const friendProfiles = $derived($profilesStore);
	const loading = $derived(!$friendsRelationsLoadedStore);

	const otherParticipant = (relation: Relation): string | undefined =>
		relation.participants.find((p) => p !== userPrincipal);

	let inviteCode = $state<string | undefined>(undefined);

	// The viewer's own redemption rows (newest-first), one per friend who signed up
	// with their code. Each row carries `withinReferrerCap`, which marks whether that
	// redemption actually paid the referrer under the diminishing tier curve + hard cap
	// (see `referral.constants.ts`). Read from the shared `referrals.store`; the same
	// cache the Dash stack-sheet reads: so the two surfaces can never disagree and a
	// tab switch reuses the list instead of re-querying. Stays empty on failure so the
	// hero degrades to its zero-state rather than blocking the tab.
	const myReferrals = $derived($myReferralsStore);

	onMount(() => {
		let alive = true;

		void refreshFriendRelations();

		// Hydrate the all-time standings slice so the ranked list reads live
		// clearing accuracy (see `accuracyOf`). Shares the per-window cache
		// with the Leaderboard / Dash, and only fetches on a cache miss:
		// Arena re-mounts this tab on every tab switch, so an unconditional
		// refresh would re-run the multi-page `list_leaderboard` drain each
		// time. Fail-open: on error the rows fall back to the cached profile
		// snapshot instead of blocking the tab.
		if (isNullish($globalStandingsStore.get('all'))) {
			void loadGlobalStandings({ window: 'all' }).catch((err: unknown) => {
				console.error('FriendsTab: failed to load all-time standings', err);
			});
		}

		// Fetch the viewer's referral code so the hero can render the canonical
		// `vici.market/i/{code}` URL. The code is assigned by the satellite profile hook
		// on first profile create; if missing today the next profile save backfills it
		// (see `referral.services.ts`).
		void (async () => {
			try {
				const code = await getMyReferralCode();

				if (alive) {
					inviteCode = code;
				}
			} catch {
				// Guard on `alive` so a late rejection after unmount can't reset
				// state on a destroyed component.
				if (alive) {
					inviteCode = undefined;
				}
			}
		})();

		// Refresh the viewer's redemption rows into the shared store so the hero's
		// social-proof + cap lines reflect the real, tiered economy rather than a flat
		// per-friend estimate. The store fails open internally, leaving the previous
		// cache untouched on error, so the hero falls back to its zero-state on a cold
		// failure.
		void refreshMyReferrals();

		return () => {
			alive = false;
		};
	});

	// ── Invite hero ──────────────────────────────────────────────────
	// Single canonical URL: `https://{origin}/i/{code}`. Same string for preview, copy,
	// and native-share so what the user sees is exactly what gets pasted.
	const inviteUrl = $derived(
		nonNullish(inviteCode) && typeof window !== 'undefined'
			? `${window.location.origin}/i/${inviteCode}`
			: undefined
	);
	const inviteUrlDisplay = $derived(
		nonNullish(inviteUrl) ? inviteUrl.replace(/^https?:\/\//, '') : undefined
	);
	const bonusLabel = $derived(formatVxpBalance({ value: REFERRAL_BONUS_VXP }));

	// Social-proof line above the invite buttons:
	// `{N} friends joined · +{cumulative} VXP earned`. Derived from the viewer's actual
	// redemption rows (`listMyReferrals`).
	//
	// `joinedCount` is the TOTAL number of friends who signed up with this code; every row,
	// regardless of payout. The "joined" headline is a factual count, so it must not shrink to
	// the paid subset once a cap is hit.
	//
	// `referralCreditedCount` is the CREDITED subset, derived the same way the satellite's
	// `countReferrerCredits` tally does it: a row counts as credited when its `referrerPayout.status`
	// is anything other than `none` (`owed | processing | paid`: anything in flight still
	// consumes a slot). This is the authoritative rule the server uses to feed the diminishing
	// reward curve and enforce both caps, so the hero stays in lockstep with it rather than
	// re-reading the stored `withinReferrerCap` flag.
	//
	// The earned total honours the diminishing tier table (and its hard cap) rather than
	// assuming a flat 500 VXP per friend: see `cumulativeReferrerRewardBaseUnits`.
	const joinedCount = $derived(myReferrals.length);
	const referralCreditedCount = $derived(
		myReferrals.filter(({ referrerPayout }) => referrerPayout.status !== 'none').length
	);
	const referralVxpEarnedBaseUnits = $derived(
		cumulativeReferrerRewardBaseUnits(referralCreditedCount)
	);
	const referralVxpEarnedLabel = $derived(formatVxpBalance({ value: referralVxpEarnedBaseUnits }));

	// Rewarded-invites-left line mirrors the satellite's single cap: the lifetime hard cap
	// (`REFERRAL_MAX_PAID`). A row counts as credited once its `referrerPayout.status` is anything
	// other than `none` (anything in flight still consumes a slot), matching `countReferrerCredits`.
	// The diminishing curve + this lifetime cap self-limit, so there is no separate monthly cap.
	const referralsRemaining = $derived(Math.max(0, REFERRAL_MAX_PAID - referralCreditedCount));
	let copied = $state(false);
	let copyResetTimer: ReturnType<typeof setTimeout> | undefined;

	const triggerCopyFeedback = () => {
		copied = true;

		if (copyResetTimer) {
			clearTimeout(copyResetTimer);
		}

		copyResetTimer = setTimeout(() => {
			copied = false;
		}, 1800);
	};

	const handleCopy = async () => {
		if (!inviteUrl) {
			return;
		}

		const ok = await writeToClipboard(inviteUrl);

		if (ok) {
			triggerCopyFeedback();
			// Touch-feedback on copy: pairs the visual green flip with a
			// brief buzz so the affordance reads as committed on mobile.
			haptic('light-tap');
		} else {
			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'arena.friends.title' }),
				message: t({
					locale: $localeStore,
					key: 'profile.dashboard.referrals.code_pending_failed'
				}),
				type: 'error',
				duration: 2000
			});
		}
	};

	const handleShare = async () => {
		if (!inviteUrl || !inviteCode) {
			return;
		}

		const shareText = t({
			locale: $localeStore,
			key: 'profile.dashboard.referrals.share_text',
			params: { code: inviteCode, amount: bonusLabel }
		});
		const shareTitle = t({
			locale: $localeStore,
			key: 'profile.dashboard.referrals.share_title'
		});

		if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
			try {
				await navigator.share({ title: shareTitle, text: shareText, url: inviteUrl });

				return;
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message.toLowerCase() : '';

				if (message.includes('abort')) {
					return;
				}
			}
		}

		await handleCopy();
	};

	// ── Friends ranked list ─────────────────────────────────────────
	// Accuracy is sourced live from the clearing canister's all-time
	// standings (`win_count / settled_count`), NOT from the profile doc:
	// `profile.accuracy` is recomputed only when its owner signs in
	// (`calculateAndSyncStats`), so a friend's cached figure goes stale the
	// moment one of their predictions settles while they're away; the
	// Leaderboard (live) and this tab (cached) would then disagree about
	// the same predictor. The profile snapshot stays as the fallback while
	// the slice loads, on load failure, or for a friend beyond the fetched
	// pages.
	const allTimeAccuracyByOwner = $derived.by(() => {
		const byOwner = new SvelteMap<string, number>();

		for (const { owner, accuracy } of $globalStandingsStore.get('all')?.entries ?? []) {
			byOwner.set(owner, accuracy);
		}

		return byOwner;
	});

	const accuracyOf = ({
		owner,
		profile
	}: {
		owner: string;
		profile: UserProfile | undefined;
	}): number => allTimeAccuracyByOwner.get(owner) ?? profile?.accuracy ?? 0;

	const myAccuracy = $derived(accuracyOf({ owner: userPrincipal, profile: myProfile }));

	interface RankedFriend {
		relation: Relation;
		friendId: string;
		profile: UserProfile | undefined;
		accuracy: number;
		/** Consecutive active days (the Flame engine): rendered as `{n}d`. */
		dailyStreak: number;
		points: number;
	}

	const rankedFriends = $derived.by(() => {
		const rows: RankedFriend[] = [];

		for (const relation of activeRelations) {
			const friendId = otherParticipant(relation);

			if (friendId) {
				const profile = friendProfiles.get(friendId);
				rows.push({
					relation,
					friendId,
					profile,
					accuracy: accuracyOf({ owner: friendId, profile }),
					dailyStreak: profile?.dailyStreak ?? 0,
					points: profile?.points ?? 0
				});
			}
		}

		return rows.sort((a, b) => b.accuracy - a.accuracy);
	});

	// Viewer's slot in the accuracy-ranked friends list. Placed just above the
	// first friend with strictly lower accuracy, so friends at equal-or-higher
	// accuracy stay ahead: on a tie the viewer sits below them, never above.
	// That keeps a viewer with no edge yet (everyone still at 0% on a thin
	// graph) off a misleading #01 and at the bottom instead. Same `accuracyOf`
	// source as the friend rows, so the comparison is apples-to-apples;
	// `rankedFriends` is accuracy-descending, so this scan finds the slot
	// without allocating an intermediate array.
	const myFriendRank = $derived.by(() => {
		const below = rankedFriends.findIndex(({ accuracy }) => accuracy < myAccuracy);

		return (below === -1 ? rankedFriends.length : below) + 1;
	});

	// Slot the YOU row occupies in the rendered list (0-based). Equals
	// `rankedFriends.length` when the viewer trails every friend, where
	// it renders as the final row.
	const youInsertAt = $derived(myFriendRank - 1);

	const formatPct = (value: number): string => {
		// `value` is a 0..100 accuracy percentage; a live standings entry
		// or the profile-doc fallback (see `accuracyOf`). Render with one
		// decimal: `48.4%`.
		const pct = Math.round(value * 10) / 10;

		return `${pct}%`;
	};

	const formatH2h = (friendAccuracy: number): { value: string; ahead: boolean } => {
		// Inputs are 0..100 percentages, so the diff is in
		// percentage-point units already. One-decimal output.
		const diff = Math.round((myAccuracy - friendAccuracy) * 10) / 10;
		const ahead = diff >= 0;
		const sign = ahead && diff !== 0 ? '+' : '';

		return { value: `${sign}${diff}`, ahead };
	};

	// ── Friend mini-profile bottom sheet ────────────────────────────
	let openProfile = $state<RankedFriend | undefined>(undefined);
	let removingFriendId = $state<string | undefined>(undefined);

	const openFriendSheet = (row: RankedFriend) => {
		openProfile = row;
	};

	const closeFriendSheet = () => {
		openProfile = undefined;
	};

	const handleRemoveFriend = async () => {
		if (!openProfile) {
			return;
		}

		const { friendId } = openProfile;
		removingFriendId = friendId;

		try {
			await unfriendUser({ target: friendId, sender: userPrincipal });
			openProfile = undefined;
			await refreshFriendRelations();
		} catch (err: unknown) {
			console.error(err);
			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'arena.friends.title' }),
				message: t({ locale: $localeStore, key: 'arena.friends.error.unfriend_failed' }),
				type: 'error'
			});
		} finally {
			removingFriendId = undefined;
		}
	};

	// ── Pending invites ─────────────────────────────────────────────
	let processingKey = $state<string | undefined>(undefined);

	// Transient highlight for a request reached via inbox deep-link.
	const HIGHLIGHT_DURATION_MS = 2400;
	let highlightedKey = $state<string | undefined>(undefined);
	let lastFocusedKey: string | undefined;

	const focusPendingRow = (key: string) => {
		// Dedupe: scroll/highlight once per deep-link key, not on every
		// `pendingReceived` refresh that re-satisfies the effect.
		if (key === lastFocusedKey) {
			return;
		}

		lastFocusedKey = key;
		highlightedKey = key;

		void tick().then(() => {
			document
				.querySelector<HTMLElement>(`[data-request-key="${CSS.escape(key)}"]`)
				?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		});

		setTimeout(() => {
			if (highlightedKey === key) {
				highlightedKey = undefined;
			}
		}, HIGHLIGHT_DURATION_MS);
	};

	// Scroll an incoming request into view once it is both requested (via the
	// `?request=` deep-link) and present in the loaded list. Owns its own
	// fade timer in `focusPendingRow`, decoupled from this effect's lifecycle.
	$effect(() => {
		if (isNullish(focusRequestKey)) {
			return;
		}

		if (pendingReceived.some((doc) => doc.key === focusRequestKey)) {
			focusPendingRow(focusRequestKey);
		}
	});

	const handleAccept = async (doc: Doc<Relation>) => {
		processingKey = doc.key;

		try {
			await acceptFriendRequest({ currentRelation: doc });
			await refreshFriendRelations();

			const friendId = otherParticipant(doc.data);
			const nickname =
				(nonNullish(friendId) ? friendProfiles.get(friendId)?.nickname : undefined) ??
				t({ locale: $localeStore, key: 'arena.friends.unknown_nickname' });

			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'arena.friends.title' }),
				message: t({
					locale: $localeStore,
					key: 'arena.friends.accept.success',
					params: { nickname }
				}),
				type: 'success'
			});
		} catch (err: unknown) {
			// Keep the satellite trap message (e.g. "Only the recipient can
			// accept") and the relation id so a future iOS report is
			// diagnosable from the console, not just the generic toast.
			console.error('Friend-request accept failed', { relationId: doc.key, error: err });
			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'arena.friends.title' }),
				message: t({ locale: $localeStore, key: 'arena.friends.error.accept_failed' }),
				type: 'error'
			});
		} finally {
			processingKey = undefined;
		}
	};

	const handleReject = async (doc: Doc<Relation>) => {
		processingKey = doc.key;

		try {
			await rejectFriendRequest({ currentRelation: doc });
			await refreshFriendRelations();
		} catch (err: unknown) {
			console.error('Friend-request reject failed', { relationId: doc.key, error: err });
			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'arena.friends.title' }),
				message: t({ locale: $localeStore, key: 'arena.friends.error.reject_failed' }),
				type: 'error'
			});
		} finally {
			processingKey = undefined;
		}
	};

	const handleCancelSent = async (doc: Doc<Relation>) => {
		processingKey = doc.key;

		try {
			await cancelFriendRequest({ currentRelation: doc });
			await refreshFriendRelations();
		} catch (err: unknown) {
			console.error(err);
			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'arena.friends.title' }),
				message: t({ locale: $localeStore, key: 'arena.friends.error.cancel_failed' }),
				type: 'error'
			});
		} finally {
			processingKey = undefined;
		}
	};

	// ── Add-by-handle bottom sheet ──────────────────────────────────
	let addSheetOpen = $state(false);
	let addInput = $state('');
	let adding = $state(false);

	const openAddSheet = () => {
		addSheetOpen = true;
		addInput = '';
	};

	const closeAddSheet = () => {
		addSheetOpen = false;
		addInput = '';
	};

	const handleAddSubmit = async () => {
		const trimmed = addInput.trim();

		if (!trimmed) {
			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'arena.friends.title' }),
				message: t({ locale: $localeStore, key: 'friends.add.error.empty' }),
				type: 'warning'
			});

			return;
		}

		adding = true;

		const notify = ({ message, type }: { message: string; type: NotificationType }) => {
			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'arena.friends.title' }),
				message,
				type
			});
		};

		try {
			// The Friends UI accepts either `@handle` (nickname) or a raw
			// principal text; the service resolves a handle to a principal
			// via `searchProfiles` before calling the satellite. Known
			// non-success outcomes come back as typed statuses; resolution
			// failures throw `not_found` / `self`, mapped in the catch.
			const outcome = await sendFriendRequest({ target: trimmed, sender: userPrincipal });

			track({ name: 'friend_request_sent', source: 'arena', label: outcome.status });

			if (outcome.status === 'sent' || outcome.status === 'auto_accepted') {
				await refreshFriendRelations();
				addSheetOpen = false;
				addInput = '';
			}

			const notice = friendRequestOutcomeNotice({ outcome, locale: $localeStore });

			if (nonNullish(notice)) {
				notify(notice);
			}
		} catch (err: unknown) {
			console.error(err);

			const code = err instanceof Error ? err.message : '';
			const known = code === 'not_found' || code === 'self';

			track({ name: 'friend_request_sent', source: 'arena', label: known ? code : 'error' });

			if (known) {
				notify({
					message: t({
						locale: $localeStore,
						key: code === 'not_found' ? 'arena.friends.error.not_found' : 'arena.friends.error.self'
					}),
					type: 'error'
				});
			} else {
				// Unexpected failure: keep the copy friendly but carry a short
				// technical detail so a user screenshot is enough to diagnose.
				notify({
					message: t({
						locale: $localeStore,
						key: 'arena.friends.error.send_failed_detail',
						params: { detail: code.trim().slice(0, 140) || 'unknown' }
					}),
					type: 'error'
				});
			}
		} finally {
			adding = false;
		}
	};

	// ── Global ranking link ─────────────────────────────────────────
	// The viewer's own position on the global board, read from the same
	// confidence-adjusted standings the Leaderboard renders (`ownGlobalStanding`
	// → the all-time `globalStandingsRows` partition), NOT the satellite points
	// ranking. The two surfaces must agree: a viewer below the qualify gate is
	// `provisional` here exactly as they are there, never a phantom points #1.
	// The 'all' slice is hydrated on mount above.
	const ownStanding = ownGlobalStanding('all');

	const goToLeaderboard = () => {
		// Leaderboard lives at /arena/leaderboard; this keeps the user inside
		// the Arena shell instead of forking to a sibling tab.
		void goto(resolveAppPath(`${AppPath.Arena}/leaderboard`));
	};

	// ── Friends results digest ──────────────────────────────────────
	// One row per friend summarising their resolved record over a recent
	// window: W-L tally + net VXP (from the friend-scoped league standings
	// aggregate) and a standout call (the friend's resolved prediction with
	// the largest |net VXP|, read from the `resolved_results` collection).
	// Open / unresolved calls carry no outcome, so they never appear.
	const friendIdSet = $derived(
		new Set(rankedFriends.map((row) => row.friendId).filter((id): id is string => id.length > 0))
	);

	// The window the digest aggregates over. `'month'` sits inside the
	// `resolved_results` retention horizon (so the standout source and the
	// standings aggregate cover the same span) while still yielding fuller
	// rows on a thin friend graph than `'week'` would.
	const DIGEST_WINDOW: StandingsWindow = 'month';

	// Friend-scoped standings slice (W-L + net VXP per friend), hydrated by
	// the effect below into a per-owner map. Held locally rather than in the
	// shared `globalStandingsStore` so it can't collide with that store's
	// global / all-time slices for the same window.
	const friendStandingsByOwner = new SvelteMap<string, StandingEntry>();

	// The friend set's resolved-result rows over the retention window; the
	// source for each row's standout call. One bounded bulk read, not one
	// call per friend.
	let friendResolvedResults = $state<ResolvedResult[]>([]);

	// Signature of the friend set the digest was last hydrated for. Arena
	// re-mounts this tab on every tab switch, so guarding on it keeps a
	// re-mount (or a friend-list refresh that doesn't change the set) from
	// re-draining the two reads.
	let hydratedFriendKey: string | undefined;

	// Hydrate the friend-scoped standings slice + resolved-results once the
	// friend set is known and whenever it actually changes. Fail-open: on
	// error the digest degrades to the rows it can build (or none) rather
	// than blocking the tab.
	$effect(() => {
		const friends = [...friendIdSet];
		const key = friends.slice().sort().join('#');

		if (friends.length === 0 || key === hydratedFriendKey) {
			return;
		}

		hydratedFriendKey = key;

		void (async () => {
			try {
				const [standings, resolved] = await Promise.all([
					getLeagueStandings({ window: DIGEST_WINDOW, members: friends }),
					getFriendResolvedResults({ friends })
				]);

				friendStandingsByOwner.clear();

				for (const entry of standings.entries) {
					friendStandingsByOwner.set(entry.owner, entry);
				}

				friendResolvedResults = resolved;
			} catch (err: unknown) {
				console.error('FriendsTab: failed to hydrate results digest', err);
				// Release the guard so a later store refresh can retry; a transient
				// read failure shouldn't permanently strand the digest on empty rows
				// for this friend set.
				hydratedFriendKey = undefined;
			}
		})();
	});

	// Each friend's standout call: the resolved-result row with the greatest
	// absolute net VXP (their most consequential result, win or loss),
	// tie-broken to the most recent resolution.
	const standoutByOwner = $derived.by(() => {
		const byOwner = new SvelteMap<string, ResolvedResult>();

		for (const row of friendResolvedResults) {
			const current = byOwner.get(row.owner);
			const better =
				isNullish(current) ||
				Math.abs(row.netVxp) > Math.abs(current.netVxp) ||
				(Math.abs(row.netVxp) === Math.abs(current.netVxp) &&
					row.resolvedAtMs > current.resolvedAtMs);

			if (better) {
				byOwner.set(row.owner, row);
			}
		}

		return byOwner;
	});

	interface FriendDigest {
		friendId: string;
		profile: UserProfile | undefined;
		won: number;
		lost: number;
		total: number;
		/** Signed net-VXP label, e.g. `+312` / `−58`, win/loss colored via `netUp`. */
		netLabel: string;
		netUp: boolean;
		/** Relative window label from the standout's resolution time, when present. */
		windowLabel: string | undefined;
		standout: { marketId: string; title: string } | undefined;
	}

	const friendDigests = $derived.by<FriendDigest[]>(() =>
		rankedFriends
			// Keep only friends with a resolved record in the window; a zero
			// `settledCount` (or no standings entry) is the open-call exclusion.
			.filter((friend) => {
				const entry = friendStandingsByOwner.get(friend.friendId);

				return nonNullish(entry) && entry.settledCount > 0;
			})
			.map((friend): FriendDigest => {
				// Safe by the filter above.
				const entry = friendStandingsByOwner.get(friend.friendId) as StandingEntry;
				const netVxp = decimalFixedValueToNumber({
					value: entry.realizedPnl,
					decimals: USD_DECIMALS
				});
				const netUp = netVxp >= 0;
				const standoutRow = standoutByOwner.get(friend.friendId);

				return {
					friendId: friend.friendId,
					profile: friend.profile,
					won: entry.winCount,
					lost: Math.max(0, entry.settledCount - entry.winCount),
					total: entry.settledCount,
					netLabel: `${netUp ? '+' : '−'}${formatWholeVxpMagnitude(netVxp)}`,
					netUp,
					windowLabel: nonNullish(standoutRow)
						? formatRelativeAgoFromNs({
								timestampNs:
									BigInt(Math.trunc(standoutRow.resolvedAtMs)) * MILLISECOND_IN_NANOSECONDS,
								locale: $localeStore
							})
						: undefined,
					standout: nonNullish(standoutRow)
						? {
								marketId: standoutRow.marketId,
								// Localize via the translation overlay (not `displayMarkets`,
								// which would couple the digest to price ticks); the
								// denormalized English title is the durable fallback for
								// pruned/expired markets and only the title is displayed.
								title: $marketDisplay({
									id: standoutRow.marketId,
									title: standoutRow.title,
									description: '',
									resolution: ''
								}).title
							}
						: undefined
				};
			})
			// Newest standout first; rows without a standout (no retained result
			// row) sort after the timestamped ones.
			.sort((a, b) => {
				const at = standoutByOwner.get(a.friendId)?.resolvedAtMs ?? 0;
				const bt = standoutByOwner.get(b.friendId)?.resolvedAtMs ?? 0;

				return bt - at;
			})
	);

	// The Zap reaction is kept as a transient acknowledgement on the digest
	// row: a digest row is not an `Activity` doc, so it has no
	// `activity_reactions` identity to persist against; v1 keeps the visual
	// + motion and still fires `friend_feed_reaction` so the engagement
	// series stays continuous across the swap from the per-call feed.
	const REACTION_MOTION_MS = 600;
	const firingKeys = new SvelteSet<string>();
	const reactedKeys = new SvelteSet<string>();

	const isFiring = (friendId: string): boolean => firingKeys.has(friendId);
	const isReacted = (friendId: string): boolean => reactedKeys.has(friendId);

	const toggleReaction = (friendId: string) => {
		const desired = !reactedKeys.has(friendId);

		if (desired) {
			reactedKeys.add(friendId);
			haptic('light-tap');

			if (!prefersReducedMotion()) {
				firingKeys.add(friendId);
				setTimeout(() => firingKeys.delete(friendId), REACTION_MOTION_MS);
			}
		} else {
			reactedKeys.delete(friendId);
		}

		track({
			name: 'friend_feed_reaction',
			source: 'arena',
			label: desired ? 'like' : 'unlike'
		});
	};

	const openDigest = (digest: FriendDigest) => {
		const marketId = digest.standout?.marketId;

		if (nonNullish(marketId) && marketId.length > 0) {
			track({ name: 'friend_digest_opened', source: 'arena', marketId });
			void goto(resolveAppPath(`${AppPath.Markets}/${marketId}`));

			return;
		}

		// No standout to navigate to: open the friend mini-profile sheet so
		// the row stays interactive rather than a dead tap.
		const row = rankedFriends.find((friend) => friend.friendId === digest.friendId);

		if (nonNullish(row)) {
			track({ name: 'friend_digest_opened', source: 'arena' });
			openFriendSheet(row);
		}
	};
</script>

<div class="friends-tab">
	<!-- Invite hero ─────────────────────────────────────────────────
	     Inviting IS the job when the list is short, so the full hero only
	     leads while the viewer has two or fewer friends. With a real ranking
	     present it demotes to the compact strip below. -->
	{#if rankedFriends.length <= 2}
		<section class="invite-hero" aria-labelledby="invite-hero-title">
			<span class="invite-eyebrow">
				<span class="num invite-bonus">+{bonusLabel} VXP</span>
				<span class="invite-eyebrow-suffix">
					{t({ locale: $localeStore, key: 'arena.friends.invite.eyebrow_suffix' })}
				</span>
			</span>
			<h3 id="invite-hero-title" class="invite-title">
				{t({ locale: $localeStore, key: 'arena.friends.invite.title' })}
			</h3>
			<p class="invite-sub">
				{#if referralsRemaining > 0}
					{t({
						locale: $localeStore,
						key: 'arena.friends.invite.sub',
						params: { amount: bonusLabel }
					})}
					<span class="num invite-cap">
						{t({
							locale: $localeStore,
							key: 'arena.friends.invite.cap_remaining',
							params: { remaining: referralsRemaining }
						})}
					</span>
				{:else}
					{t({ locale: $localeStore, key: 'arena.friends.invite.cap_reached' })}
					<span class="num invite-cap">
						{t({ locale: $localeStore, key: 'arena.friends.invite.cap_resets' })}
					</span>
				{/if}
			</p>

			{#if joinedCount > 0}
				<div class="invite-proof num">
					<span>
						<b>{joinedCount}</b>
						{t({
							locale: $localeStore,
							key:
								joinedCount === 1
									? 'arena.friends.invite.proof_one'
									: 'arena.friends.invite.proof_many'
						})}
					</span>
					{#if referralCreditedCount > 0}
						<span class="invite-proof-dot" aria-hidden="true">·</span>
						<span class="invite-proof-earned">
							<b>+{referralVxpEarnedLabel}</b>
							{t({ locale: $localeStore, key: 'arena.friends.invite.proof_earned' })}
						</span>
					{/if}
				</div>
			{/if}

			<div class="invite-row">
				<BaseButton
					class="invite-share"
					onclick={handleShare}
					status={inviteUrl ? 'enabled' : 'disabled'}
				>
					<Share2 aria-hidden="true" size={14} strokeWidth={1.8} />
					<span>
						{t({ locale: $localeStore, key: 'arena.friends.invite.share' })}
					</span>
				</BaseButton>
			</div>

			<!-- Inline copy field: the link line IS the copy CTA. Tapping it
		     copies the canonical share URL, flips the trailing chip to a
		     green check + "Copied", and fires a brief haptic. The `/i/{code}`
		     path is resolved by `src/routes/i/[code]/+page.svelte`. -->
			{#if inviteUrlDisplay}
				<BaseButton
					class={`invite-copyfield${copied ? ' is-copied' : ''}`}
					aria-label={copied
						? t({ locale: $localeStore, key: 'arena.friends.invite.copied' })
						: t({ locale: $localeStore, key: 'arena.friends.invite.copy' })}
					onclick={handleCopy}
					status={inviteUrl ? 'enabled' : 'disabled'}
				>
					<Link2 aria-hidden="true" size={14} strokeWidth={1.8} />
					<span class="num invite-copyurl">{inviteUrlDisplay}</span>
					<span class="invite-copychip" aria-hidden="true">
						{#if copied}
							<span class="invite-copy-inner" in:fade={{ duration: 150 }}>
								<Check size={13} strokeWidth={2.4} />
								{t({ locale: $localeStore, key: 'arena.friends.invite.copied' })}
							</span>
						{:else}
							<span class="invite-copy-inner" in:fade={{ duration: 150 }}>
								{t({ locale: $localeStore, key: 'arena.friends.invite.copy' })}
							</span>
						{/if}
					</span>
				</BaseButton>
			{/if}
		</section>
	{:else}
		<!-- Compact invite strip: the ranking leads (≥3 friends), so inviting
		     demotes to a single tappable line carrying the referral proof. -->
		<BaseButton
			class="friends-invite-strip"
			onclick={handleShare}
			status={inviteUrl ? 'enabled' : 'disabled'}
		>
			<span class="friends-invite-strip-ic" aria-hidden="true">
				<Share2 size={13} strokeWidth={1.8} />
			</span>
			<span class="friends-invite-strip-tx">
				{#if referralsRemaining > 0}
					<span>
						{t({ locale: $localeStore, key: 'arena.friends.invite.strip' })}
						<span class="num invite-strip-bonus">
							{t({
								locale: $localeStore,
								key: 'arena.friends.invite.strip_bonus',
								params: { amount: bonusLabel }
							})}
						</span>
					</span>
				{:else}
					<span>
						{t({ locale: $localeStore, key: 'arena.friends.invite.cap_reached' })}
						<span class="num invite-strip-cap">
							{t({ locale: $localeStore, key: 'arena.friends.invite.cap_resets' })}
						</span>
					</span>
				{/if}
				{#if joinedCount > 0 && referralsRemaining > 0}
					<span class="num friends-invite-strip-proof">
						{t({
							locale: $localeStore,
							key: 'arena.friends.invite.strip_proof',
							params: { count: joinedCount, amount: referralVxpEarnedLabel }
						})}
					</span>
				{/if}
			</span>
			{#if referralsRemaining > 0}
				<span class="friends-invite-strip-go" aria-hidden="true">→</span>
			{/if}
		</BaseButton>
	{/if}

	<!-- Pending sent: outgoing invites still waiting on the recipient's
	     first call. Sits directly under the invite hero. -->
	{#if pendingSent.length > 0}
		<section class="friends-section">
			<header class="section-eyebrow">
				<span>{t({ locale: $localeStore, key: 'arena.friends.sent.eyebrow' })}</span>
				<span class="num section-count">{pendingSent.length}</span>
			</header>
			<ul class="pending-list">
				{#each pendingSent as doc (doc.key)}
					{@const friendId = otherParticipant(doc.data)}
					{@const profile = friendId ? friendProfiles.get(friendId) : undefined}
					{@const isProcessing = processingKey === doc.key}
					<li>
						<div class="pending-row">
							<span class="pending-avatar">
								<Avatar
									class="h-full w-full"
									avatar={profile?.avatar}
									avatarParts={profile?.avatarParts}
									nickname={profile?.nickname}
									owner={profile?.owner ?? friendId ?? ''}
								/>
							</span>
							<span class="pending-copy">
								<span class="pending-name">
									@{profile?.nickname ??
										t({ locale: $localeStore, key: 'arena.friends.unknown_nickname' })}
								</span>
								<span class="num pending-meta">
									{friendId ? shortenWithMiddleEllipsis({ text: friendId, splitLength: 5 }) : ''}
								</span>
							</span>
							<BaseButton
								class="pending-cancel"
								onclick={() => handleCancelSent(doc)}
								status={isProcessing ? 'pending' : 'enabled'}
							>
								{t({ locale: $localeStore, key: 'arena.friends.action.cancel' })}
							</BaseButton>
						</div>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<!-- Incoming friend requests ────────────────────────────────── -->
	{#if pendingReceived.length > 0}
		<section class="friends-section">
			<header class="section-eyebrow">
				<span>{t({ locale: $localeStore, key: 'arena.friends.pending.eyebrow' })}</span>
				<span class="num section-count">{pendingReceived.length}</span>
			</header>
			<ul class="pending-list">
				{#each pendingReceived as doc (doc.key)}
					{@const friendId = otherParticipant(doc.data)}
					{@const profile = friendId ? friendProfiles.get(friendId) : undefined}
					{@const isProcessing = processingKey === doc.key}
					<li data-request-key={doc.key}>
						<div class="pending-row" class:is-focused={doc.key === highlightedKey}>
							<span class="pending-avatar">
								<Avatar
									class="h-full w-full"
									avatar={profile?.avatar}
									avatarParts={profile?.avatarParts}
									nickname={profile?.nickname}
									owner={profile?.owner ?? friendId ?? ''}
								/>
							</span>
							<span class="pending-copy">
								<span class="pending-name">
									@{profile?.nickname ??
										t({ locale: $localeStore, key: 'arena.friends.unknown_nickname' })}
								</span>
								<span class="num pending-meta">
									{friendId ? shortenWithMiddleEllipsis({ text: friendId, splitLength: 5 }) : ''}
								</span>
							</span>
							<span class="pending-actions">
								<BaseButton
									class="pending-action pending-accept"
									onclick={() => handleAccept(doc)}
									status={isProcessing ? 'pending' : 'enabled'}
								>
									{t({ locale: $localeStore, key: 'arena.friends.action.accept' })}
								</BaseButton>
								<BaseButton
									class="pending-action pending-reject"
									onclick={() => handleReject(doc)}
									status={isProcessing ? 'pending' : 'enabled'}
								>
									{t({ locale: $localeStore, key: 'arena.friends.action.reject' })}
								</BaseButton>
							</span>
						</div>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<!-- Friends ranked ─────────────────────────────────────────── -->
	{#if loading}
		<div class="friends-loading">
			<LoadingSpinner inlinePad />
		</div>
	{:else}
		<section class="friends-section">
			<header class="section-eyebrow">
				<span>{t({ locale: $localeStore, key: 'arena.friends.ranked.eyebrow' })}</span>
				<span class="ranked-head-right">
					<button
						class="ranked-add"
						aria-label={t({ locale: $localeStore, key: 'arena.friends.add.cta' })}
						onclick={openAddSheet}
						type="button"
					>
						<Plus size={12} strokeWidth={2} />
						{t({ locale: $localeStore, key: 'arena.friends.ranked.add' })}
					</button>
					<span class="num section-count">{rankedFriends.length}</span>
				</span>
			</header>
			{#if rankedFriends.length === 0}
				<FriendsEmptyState
					canInvite={nonNullish(inviteUrl) && referralsRemaining > 0}
					onAdd={openAddSheet}
					onInvite={() => void handleShare()}
				/>
			{:else}
				{#snippet youRow()}
					<li class="ranked-li-you">
						<RankedRow
							accuracyLabel={formatPct(myAccuracy)}
							avatar={myProfile?.avatar}
							avatarParts={myProfile?.avatarParts}
							dailyStreak={myProfile?.dailyStreak ?? 0}
							displayName={myProfile?.nickname ??
								t({ locale: $localeStore, key: 'arena.friends.unknown_nickname' })}
							nickname={myProfile?.nickname}
							numLabel={String(myFriendRank).padStart(2, '0')}
							owner={userPrincipal}
							variant="you"
							vxpLabel={formatVxpBalance({ value: vxpBaseUnitsFromPoints(myProfile?.points ?? 0) })}
						/>
					</li>
				{/snippet}
				<ul class="ranked-list">
					{#each rankedFriends as row, idx (row.friendId)}
						{#if idx === youInsertAt}
							{@render youRow()}
						{/if}
						{@const h2h = formatH2h(row.accuracy)}
						<li>
							<RankedRow
								accuracyLabel={formatPct(row.accuracy)}
								avatar={row.profile?.avatar}
								avatarParts={row.profile?.avatarParts}
								dailyStreak={row.dailyStreak}
								displayName={row.profile?.nickname ??
									t({ locale: $localeStore, key: 'arena.friends.unknown_nickname' })}
								h2hAhead={h2h.ahead}
								h2hValue={h2h.value}
								nickname={row.profile?.nickname}
								numLabel={String(idx < youInsertAt ? idx + 1 : idx + 2).padStart(2, '0')}
								onOpen={() => openFriendSheet(row)}
								owner={row.profile?.owner ?? row.friendId}
								variant="friend"
							/>
						</li>
					{/each}
					{#if youInsertAt >= rankedFriends.length}
						{@render youRow()}
					{/if}
				</ul>
			{/if}
		</section>
	{/if}

	<!-- Friends results digest ─────────────────────────────────── -->
	<!--
		One row per friend with a resolved record over the window: their W-L
		tally + net VXP (from the friend-scoped league standings aggregate)
		and a standout call (their resolved prediction with the largest
		|net VXP|). Friends with no resolved prediction in the window do not
		appear; when the graph has yet to resolve anything we keep the quiet
		copy block so the surface stays discoverable without faking data.
	-->
	{#if !loading && friendDigests.length > 0}
		<section class="friends-section">
			<header class="section-eyebrow">
				<span>{t({ locale: $localeStore, key: 'arena.friends.feed.eyebrow' })}</span>
			</header>
			<ul class="feed-list">
				{#each friendDigests as digest (digest.friendId)}
					<li>
						<div class="feed-row">
							<button class="feed-main" onclick={() => openDigest(digest)} type="button">
								<span class="feed-avatar">
									<Avatar
										class="h-full w-full"
										avatar={digest.profile?.avatar}
										avatarParts={digest.profile?.avatarParts}
										nickname={digest.profile?.nickname}
										owner={digest.profile?.owner ?? digest.friendId}
									/>
								</span>
								<span class="feed-copy">
									<span class="feed-line">
										<b class="feed-handle"
											>@{digest.profile?.nickname ??
												t({ locale: $localeStore, key: 'arena.friends.unknown_nickname' })}</b
										>
										<span class="feed-action">
											{t({
												locale: $localeStore,
												key:
													digest.total === 1
														? 'arena.friends.feed.resolved_one'
														: 'arena.friends.feed.resolved_many',
												params: { count: digest.total }
											})}
										</span>
										<span class="num feed-record"
											>· <span class="feed-record-win"
												>{t({
													locale: $localeStore,
													key: 'arena.friends.feed.record_won',
													params: { count: digest.won }
												})}</span
											>–<span class="feed-record-loss"
												>{t({
													locale: $localeStore,
													key: 'arena.friends.feed.record_lost',
													params: { count: digest.lost }
												})}</span
											></span
										>
									</span>
									<span class="feed-meta">
										{#if nonNullish(digest.windowLabel)}
											<span class="num feed-when">{digest.windowLabel}</span>
										{/if}
										{#if nonNullish(digest.standout)}
											<span class="feed-market">
												{t({
													locale: $localeStore,
													key: 'arena.friends.feed.standout',
													params: { question: digest.standout.title }
												})}
											</span>
										{/if}
									</span>
								</span>
								<span class="num feed-net" class:is-down={!digest.netUp} class:is-up={digest.netUp}>
									{digest.netLabel} VXP
								</span>
							</button>
							<button
								class="feed-react"
								class:is-firing={isFiring(digest.friendId)}
								class:is-liked={isReacted(digest.friendId)}
								aria-label={t({ locale: $localeStore, key: 'arena.friends.feed.like' })}
								aria-pressed={isReacted(digest.friendId)}
								onclick={() => toggleReaction(digest.friendId)}
								type="button"
							>
								<Zap aria-hidden="true" size={16} strokeWidth={1.6} />
								<span class="react-burst" aria-hidden="true">
									<span></span>
									<span></span>
									<span></span>
									<span></span>
									<span></span>
									<span></span>
									<span></span>
									<span></span>
								</span>
							</button>
						</div>
					</li>
				{/each}
			</ul>
		</section>
	{:else if !loading && rankedFriends.length > 0}
		<section class="friends-section">
			<header class="section-eyebrow">
				<span>{t({ locale: $localeStore, key: 'arena.friends.feed.eyebrow' })}</span>
			</header>
			<div class="feed-empty">
				<p class="feed-empty-copy">
					{t({ locale: $localeStore, key: 'arena.friends.feed.empty_a' })}
					<span class="feed-empty-italic">
						{t({ locale: $localeStore, key: 'arena.friends.feed.empty_b' })}
					</span>
				</p>
			</div>
		</section>
	{/if}

	<!-- Global ranking link ─────────────────────────────────── -->
	<button class="global-link" onclick={goToLeaderboard} type="button">
		<span class="global-link-copy">
			<span class="num global-link-eyebrow">
				{t({ locale: $localeStore, key: 'arena.friends.global.eyebrow' })}
			</span>
			<span class="global-link-value num">
				<span class="global-link-rank">
					{#if nonNullish($ownStanding?.displayRank)}
						#{$ownStanding.displayRank}
					{:else if $ownStanding?.provisional}
						{t({ locale: $localeStore, key: 'arena.friends.global.provisional' })}
					{:else}
						{t({ locale: $localeStore, key: 'arena.friends.global.unranked' })}
					{/if}
				</span>
				<!-- Rank delta (↑/↓ N this week) deferred until the satellite
				     ships a `previousRank` snapshot. -->
			</span>
		</span>
		<ChevronRight aria-hidden="true" size={18} strokeWidth={1.6} />
	</button>
</div>

<!-- Friend mini-profile bottom sheet ──────────────────────────── -->
{#if openProfile}
	{@const row = openProfile}
	{@const h2h = formatH2h(row.accuracy)}
	<FriendProfileSheet
		accuracyValue={formatPct(row.accuracy)}
		dailyStreak={row.dailyStreak}
		friendId={row.friendId}
		h2hAhead={h2h.ahead}
		h2hValue={h2h.value}
		isOpen={nonNullish(openProfile)}
		onClose={closeFriendSheet}
		onRemove={handleRemoveFriend}
		profile={row.profile}
		removing={removingFriendId === row.friendId}
		vxpValue={formatVxpBalance({ value: vxpBaseUnitsFromPoints(row.points) })}
	/>
{/if}

<!-- Add-by-handle bottom sheet ───────────────────────────────── -->
<AddFriendSheet
	{adding}
	inviteHintAmount={bonusLabel}
	isOpen={addSheetOpen}
	onClose={closeAddSheet}
	onSubmit={() => void handleAddSubmit()}
	bind:value={addInput}
/>

<style lang="postcss">
	/* Horizontal inset is owned by the Arena page wrapper (its only
	   mount point); adding our own would double it and push the tab
	   content in past the tab strip above. Keep only vertical padding. */
	.friends-tab {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-width: 40rem;
		margin: 0 auto;
		padding: 0.85rem 0 5rem;
	}

	/* ── Invite hero ────────────────────────────────────────── */
	/* Invite hero: accent gradient wash over the raised surface,
	   gold-tinted border. */
	/* Compact invite strip: the demoted invite affordance once the ranking
	   leads. A single gold-accent tappable line carrying the referral proof. */
	:global(.friends-invite-strip) {
		display: flex;
		width: 100%;
		align-items: center;
		gap: 0.7rem;
		padding: 0.7rem 0.8rem;
		border: 1px solid color-mix(in srgb, var(--color-primary) 26%, transparent);
		border-radius: var(--r-12);
		background:
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--color-primary) 7%, transparent),
				transparent
			),
			var(--bg-popover);
		color: var(--text-base);
		text-align: left;
		cursor: pointer;
		transition: border-color 140ms var(--ease-vici, ease);
	}

	:global(.friends-invite-strip:hover) {
		border-color: color-mix(in srgb, var(--color-primary) 42%, transparent);
	}

	.friends-invite-strip-ic {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		flex: none;
		border-radius: 8px;
		background: var(--accent-glow, color-mix(in srgb, var(--color-primary) 14%, transparent));
		color: var(--color-primary);
	}

	.friends-invite-strip-tx {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: var(--t-13);
		font-weight: 600;
	}

	.invite-strip-bonus,
	.invite-strip-cap {
		color: var(--color-primary);
	}

	.invite-strip-cap {
		color: var(--text-muted);
	}

	.friends-invite-strip-proof {
		font-size: var(--t-10);
		font-weight: 400;
		letter-spacing: 0.02em;
		color: var(--text-muted);
	}

	.friends-invite-strip-go {
		flex: none;
		font-family: var(--font-mono);
		font-size: var(--t-15, 0.95rem);
		color: var(--color-primary);
	}

	.invite-hero {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 1.1rem 1.1rem 1rem;
		border: 1px solid color-mix(in srgb, var(--color-primary) 30%, var(--border-base));
		border-radius: var(--r-12);
		background:
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--color-primary) 10%, transparent),
				color-mix(in srgb, var(--color-primary) 2%, transparent) 70%,
				transparent
			),
			var(--bg-popover);
	}

	.invite-eyebrow {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: var(--t-10);
		font-weight: 800;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
	}

	.invite-bonus {
		color: var(--color-primary);
		font-size: var(--t-12);
		letter-spacing: var(--tracking-wide);
	}

	/* Invite headline: display sans-serif, 20 px, weight 600, slight
	   negative tracking. NO serif-italic; the surrounding card uses
	   serif-italic for the *editorial* `Invite a friend.` lede in
	   other surfaces, but this hero block leads with a structural
	   prompt, not an editorial accent, so it stays on the display
	   stack to read as a clear call to action. */
	.invite-title {
		margin: 0 0 4px;
		color: var(--text-base);
		font-family: var(--font-display);
		font-size: 20px;
		font-weight: 600;
		letter-spacing: -0.015em;
	}

	.invite-sub {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--t-13);
		line-height: var(--leading-snug);
	}

	.invite-cap {
		margin-left: 0.35rem;
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: var(--t-10);
		font-weight: 800;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
	}

	.invite-proof {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.4rem;
		color: var(--text-muted);
		font-size: var(--t-12);
	}

	.invite-proof b {
		color: var(--text-base);
		font-weight: 700;
	}

	.invite-proof-dot {
		color: var(--text-muted);
	}

	.invite-proof-earned {
		color: var(--color-primary);
	}

	.invite-proof-earned b {
		color: var(--color-primary);
	}

	.invite-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.25rem;
	}

	:global(.invite-share) {
		display: inline-flex;
		flex: 1;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0.75rem 1rem;
		border: 1px solid color-mix(in srgb, var(--color-primary) 45%, var(--border-base));
		border-radius: var(--r-pill);
		background: var(--color-primary);
		color: var(--color-primary-foreground, white);
		font-size: var(--t-13);
		font-weight: 700;
	}

	/* Inline copy-link field: the URL line IS the copy CTA. Tapping it
	   copies the share link and flips the trailing chip to green. Border
	   + background animate toward the accent-green "yes" tone on success. */
	:global(.invite-copyfield) {
		display: flex;
		width: 100%;
		align-items: center;
		gap: 0.6rem;
		padding: 0.6rem 0.6rem 0.6rem 0.75rem;
		border: 1px solid var(--border-base);
		border-radius: 0.6rem;
		background: color-mix(in srgb, var(--text-base) 3%, transparent);
		color: var(--text-muted);
		cursor: pointer;
		transition:
			border-color 200ms ease,
			background 200ms ease;
	}

	:global(.invite-copyfield:hover) {
		border-color: var(--border-strong);
	}

	:global(.invite-copyfield) > :global(svg) {
		flex-shrink: 0;
		color: var(--text-muted);
	}

	.invite-copyurl {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		color: var(--text-base);
		font-family: var(--font-mono);
		font-size: var(--t-12);
		text-align: left;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.invite-copychip {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		gap: 0.3rem;
		padding: 0.35rem 0.75rem;
		border-radius: 0.45rem;
		background: color-mix(in srgb, var(--color-primary) 14%, transparent);
		color: var(--color-primary);
		font-size: var(--t-10);
		font-weight: 700;
		letter-spacing: var(--tracking-wide);
		transition:
			background 220ms ease,
			color 220ms ease,
			transform 220ms ease;
	}

	:global(.invite-copyfield.is-copied) {
		border-color: color-mix(in srgb, var(--yes) 50%, transparent);
		background: color-mix(in srgb, var(--yes) 6%, transparent);
	}

	:global(.invite-copyfield.is-copied) .invite-copychip {
		background: var(--yes);
		color: var(--yes-deep, #07120d);
		transform: scale(1.04);
	}

	.invite-copy-inner {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}

	/* ── Sections ──────────────────────────────────────────── */
	.friends-section {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}

	.section-eyebrow {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: var(--t-10);
		font-weight: 800;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
	}

	.section-count {
		color: var(--color-primary);
	}

	.ranked-head-right {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}

	/* Accent-tinted add-friend chip. */
	.ranked-add {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.25rem 0.6rem;
		border: 1px solid color-mix(in srgb, var(--color-primary) 25%, var(--border-base));
		border-radius: var(--r-pill);
		background: color-mix(in srgb, var(--color-primary) 8%, transparent);
		color: var(--color-primary);
		font-family: var(--font-mono);
		font-size: var(--t-10);
		font-weight: 800;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
		cursor: pointer;
		transition:
			background 140ms ease,
			border-color 140ms ease;
	}

	/* Keep the chip visually compact while giving it a ≥44px tap target. */
	.ranked-add::after {
		content: '';
		position: absolute;
		left: 50%;
		top: 50%;
		width: 100%;
		min-width: 44px;
		height: 44px;
		transform: translate(-50%, -50%);
	}

	.ranked-add:hover {
		background: color-mix(in srgb, var(--color-primary) 14%, transparent);
		border-color: color-mix(in srgb, var(--color-primary) 40%, var(--border-base));
	}

	/* ── Pending list ──────────────────────────────────────── */
	/* Single unified card with internal dividers. Per-row borders
	   are replaced by a `border-bottom` on each `<li>` except last. */
	.pending-list {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		background: var(--bg-popover);
		overflow: hidden;
	}

	.pending-list > li + li {
		border-top: 1px solid var(--border-base);
	}

	.pending-row {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.65rem;
		width: 100%;
		padding: 0.7rem 0.85rem;
		border-radius: var(--r-12);
		transition: background var(--d-state) ease;
	}

	/* Transient highlight when reached via an inbox deep-link, so the
	   recipient's eye lands on the right request. Fades after
	   HIGHLIGHT_DURATION_MS. */
	.pending-row.is-focused {
		background: color-mix(in srgb, var(--color-primary) 12%, transparent);
	}

	.pending-avatar {
		display: inline-flex;
		overflow: hidden;
		width: 2rem;
		height: 2rem;
		flex-shrink: 0;
		border-radius: var(--r-pill);
		background: var(--bg-popover);
	}

	.pending-copy {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.1rem;
	}

	.pending-name {
		overflow: hidden;
		color: var(--text-base);
		font-size: var(--t-13);
		font-weight: 700;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.pending-meta {
		color: var(--text-muted);
		font-size: var(--t-12);
	}

	.pending-actions {
		display: inline-flex;
		flex-shrink: 0;
		gap: 0.4rem;
	}

	:global(.pending-action) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.45rem 0.85rem;
		border: 1px solid var(--border-base);
		border-radius: var(--r-pill);
		background: var(--bg-surface);
		color: var(--text-base);
		font-size: var(--t-12);
		font-weight: 700;
	}

	:global(.pending-accept) {
		border-color: color-mix(in srgb, var(--yes) 45%, var(--border-base));
		background: color-mix(in srgb, var(--yes) 16%, var(--bg-surface));
		color: var(--yes);
	}

	:global(.pending-reject) {
		color: var(--no);
	}

	:global(.pending-cancel) {
		padding: 0.35rem 0.75rem;
		border: 1px solid var(--border-base);
		border-radius: var(--r-pill);
		background: var(--bg-surface);
		color: var(--text-muted);
		font-size: var(--t-12);
		font-weight: 700;
	}

	/* ── Ranked list ───────────────────────────────────────── */
	/* Single unified card with internal dividers. The
	   list is its own internal-scroll container (`overflow: auto;
	   max-height: 60vh`) so the YOU `<li>` can stick to the nearest
	   card edge on scroll, instead of being trapped by the page
	   scroll context. */
	.ranked-list {
		position: relative;
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		background: var(--bg-popover);
		overflow: auto;
		max-height: 60vh;
	}

	.ranked-list > li + li {
		border-top: 1px solid var(--border-base);
	}

	/* Sticky YOU row: sits inline at the viewer's real rank and, on
	   scroll, glues to whichever card edge its natural slot has passed
	   (top when the slot is above the fold, bottom when below) via a
	   single sticky element with both insets set; it flows back inline
	   when the slot is on screen.
	   `position: sticky` lives on the `<li>` wrapper (not the inner row
	   element rendered by `RankedRow`): a sticky element is constrained
	   by its containing block, and the `<li>` is a direct child of the
	   scrollable `.ranked-list`: putting sticky on the inner row would
	   constrain it to the `<li>`'s own height, so no visible sticking. */
	.ranked-li-you {
		position: sticky;
		top: 0;
		bottom: 0;
		z-index: 2;
	}

	/* ── Empty ─────────────────────────────────────────────── */
	.friends-loading {
		display: flex;
		justify-content: center;
		padding: 1.5rem 0;
	}

	/* ── Feed (results digest) ─────────────────────────────── */
	/* Unified card with internal dividers: same pattern as the ranked
	   and pending lists. Each row is one friend's resolved record (W-L +
	   net VXP + standout) and a transient Zap reaction. */
	.feed-list {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		background: var(--bg-popover);
		overflow: hidden;
	}

	.feed-list > li + li {
		border-top: 1px solid var(--border-base);
	}

	.feed-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.6rem 0.7rem 0.6rem 0.85rem;
	}

	.feed-main {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.65rem;
		flex: 1;
		min-width: 0;
		padding: 0;
		border: 0;
		background: transparent;
		text-align: left;
		cursor: pointer;
	}

	.feed-avatar {
		display: inline-flex;
		overflow: hidden;
		width: 2rem;
		height: 2rem;
		flex-shrink: 0;
		border-radius: var(--r-pill);
		background: var(--bg-popover);
	}

	.feed-copy {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.15rem;
	}

	.feed-line {
		color: var(--text-muted);
		font-size: var(--t-12);
		line-height: var(--leading-snug);
	}

	.feed-handle {
		color: var(--text-base);
		font-weight: 600;
	}

	.feed-action {
		color: var(--text-muted);
	}

	/* W-L tally: mono numerals, base weight so the record reads as the
	   row's spine. Wins/losses carry the same yes/no color as the net
	   figure plus a leading W/L glyph, so the split reads at a glance
	   without leaning on color alone. */
	.feed-record {
		color: var(--text-muted);
		font-weight: 700;
	}

	.feed-record-win {
		color: var(--yes);
	}

	.feed-record-loss {
		color: var(--no);
	}

	/* Window label + standout, on one wrapping meta line under the record. */
	.feed-meta {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.4rem;
		min-width: 0;
	}

	.feed-market {
		overflow: hidden;
		color: var(--text-base);
		font-family: var(--font-serif, var(--font-display, serif));
		font-size: var(--t-12);
		font-style: italic;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.feed-when {
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: var(--t-10);
		font-weight: 800;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
	}

	/* Signed net VXP: the row's headline figure, colored win (yes) / loss
	   (no) and right-aligned beside the copy. */
	.feed-net {
		justify-self: end;
		flex-shrink: 0;
		font-size: var(--t-13);
		font-weight: 800;
		white-space: nowrap;
	}

	.feed-net.is-up {
		color: var(--yes);
	}

	.feed-net.is-down {
		color: var(--no);
	}

	/* Like react: acknowledge a friend's result. Brand forbids emoji,
	   so the cue is the `Zap` glyph. Resting state is
	   dimmed; tapping commits to full opacity + an accent wash, plus a
	   one-beat tilt and particle burst (both reduced-motion gated). The
	   accent uses `--color-primary` (laurel in dark, the contrast-safe
	   laurel-deep in light / peach) rather than raw `--laurel`. */
	.feed-react {
		position: relative;
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		padding: 0.35rem 0.45rem;
		border: 0;
		border-radius: var(--r-pill);
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		opacity: 0.45;
		transition:
			opacity 160ms ease,
			background 160ms ease,
			transform 100ms ease;
	}

	.feed-react:hover {
		opacity: 0.8;
		background: color-mix(in srgb, var(--color-primary) 6%, transparent);
	}

	.feed-react:active {
		transform: scale(0.92);
	}

	.feed-react.is-liked {
		opacity: 1;
		background: color-mix(in srgb, var(--color-primary) 14%, transparent);
		color: var(--color-primary);
	}

	.feed-react.is-firing :global(svg) {
		animation: react-tilt 420ms var(--ease-vici);
	}

	.react-burst {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.react-burst span {
		position: absolute;
		top: 50%;
		left: 50%;
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: var(--color-primary);
		opacity: 0;
	}

	.feed-react.is-firing .react-burst span {
		animation: react-burst 540ms ease-out forwards;
	}

	.react-burst span:nth-child(1) {
		--tx: 18px;
		--ty: 0;
	}
	.react-burst span:nth-child(2) {
		--tx: 13px;
		--ty: 13px;
	}
	.react-burst span:nth-child(3) {
		--tx: 0;
		--ty: 18px;
	}
	.react-burst span:nth-child(4) {
		--tx: -13px;
		--ty: 13px;
	}
	.react-burst span:nth-child(5) {
		--tx: -18px;
		--ty: 0;
	}
	.react-burst span:nth-child(6) {
		--tx: -13px;
		--ty: -13px;
	}
	.react-burst span:nth-child(7) {
		--tx: 0;
		--ty: -18px;
	}
	.react-burst span:nth-child(8) {
		--tx: 13px;
		--ty: -13px;
	}

	@keyframes react-tilt {
		0% {
			transform: rotate(0) scale(0.9);
		}
		35% {
			transform: rotate(-14deg) scale(1.15);
		}
		70% {
			transform: rotate(10deg) scale(1.02);
		}
		100% {
			transform: rotate(0) scale(1);
		}
	}

	@keyframes react-burst {
		0% {
			transform: translate(-50%, -50%) scale(1);
			opacity: 1;
		}
		100% {
			transform: translate(calc(-50% + var(--tx)), calc(-50% + var(--ty))) scale(0.2);
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.feed-react.is-firing :global(svg),
		.feed-react.is-firing .react-burst span {
			animation: none;
		}
	}

	/* ── Feed (empty) ──────────────────────────────────────── */
	.feed-empty {
		padding: 0.85rem;
		border: 1px dashed var(--border-base);
		border-radius: var(--r-12);
		background: var(--bg-surface);
	}

	.feed-empty-copy {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--t-13);
		line-height: var(--leading-snug);
	}

	.feed-empty-italic {
		color: var(--color-primary);
		font-family: var(--font-serif, var(--font-display, serif));
		font-style: italic;
	}

	/* ── Global link ───────────────────────────────────────── */
	.global-link {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.65rem;
		padding: 0.9rem 1rem;
		border: 1px solid var(--border-base);
		border-radius: 1rem;
		background: var(--bg-popover);
		color: var(--text-base);
		text-align: left;
		cursor: pointer;
	}

	.global-link:hover {
		border-color: var(--border-strong);
	}

	.global-link-copy {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.global-link-eyebrow {
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: var(--t-10);
		font-weight: 800;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
	}

	.global-link-value {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-size: var(--t-18);
		font-weight: 800;
	}

	.global-link-rank {
		color: var(--color-primary);
	}
</style>
