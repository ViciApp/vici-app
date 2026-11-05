<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import {
		ChevronLeft,
		ChevronRight,
		Copy,
		Check,
		Pencil,
		ImagePlus,
		Trash2
	} from '@lucide/svelte/icons';
	import { onMount } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import ScreenHeader from '#lib/components/layout/ScreenHeader.svelte';
	import CreateBoutModal from '#lib/components/leagues/CreateBoutModal.svelte';
	import LeagueDetailEmptyState from '#lib/components/leagues/LeagueDetailEmptyState.svelte';
	import LeaguePrivacyModal from '#lib/components/leagues/LeaguePrivacyModal.svelte';
	import LeagueRoleBadge from '#lib/components/leagues/LeagueRoleBadge.svelte';
	import TransferOwnershipModal from '#lib/components/leagues/TransferOwnershipModal.svelte';
	import Avatar from '#lib/components/profile/Avatar.svelte';
	import BottomSheet from '#lib/components/ui/BottomSheet.svelte';
	import LoadingSpinner from '#lib/components/ui/LoadingSpinner.svelte';
	import YouBadge from '#lib/components/ui/YouBadge.svelte';
	import { DAY_IN_MS } from '#lib/constants/app.constants.ts';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { authPrincipal } from '#lib/derived/user.derived.ts';
	import { LeaguePrivacy } from '#lib/enums/league.ts';
	import { track } from '#lib/services/analytics.services.ts';
	import {
		acceptBattle,
		buildLeagueShareUrl,
		declineBattle,
		kickoffBattle,
		leaveLeague,
		loadLeaguesByIds,
		maybeExpireBattle,
		resolveBattle,
		retractBattle,
		setMemberRole,
		updateLeague,
		validateLeagueDraft
	} from '#lib/services/leagues.services.ts';
	import { findOwnStanding, getLeagueStandings } from '#lib/services/standings.services.ts';
	import { deleteLeagueImageByUrl, uploadLeagueImage } from '#lib/services/storage.services.ts';
	import { leagueDirectoryStore } from '#lib/stores/league-directory.store.ts';
	import {
		leagueBattlesStore,
		leagueMembersStore,
		leaguesErrorStore,
		leaguesLoadedStore,
		myLeaguesStore,
		refreshMyLeagues
	} from '#lib/stores/leagues.store.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { profilesStore } from '#lib/stores/profiles.store.ts';
	import {
		BATTLE_MAX_CONCURRENT_IN_FLIGHT,
		type BattleDoc,
		type BattleState
	} from '#lib/types/battle.ts';
	import type { LeagueMemberDoc, LeagueMemberRole } from '#lib/types/league-member.ts';
	import {
		leagueEmblem,
		leaguePrivacy,
		LEAGUE_NAME_MAX_LENGTH,
		LEAGUE_NAME_MIN_LENGTH
	} from '#lib/types/league.ts';
	import {
		formatDate,
		formatLocalePercent,
		shortLeagueId,
		shortenPrincipal
	} from '#lib/utils/format.utils.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';
	import { leagueRankOf, rankLeagueMembers } from '#lib/utils/league-rank.utils.ts';
	import { goBack, resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	/**
	 * League detail page.
	 *
	 * Mounts at `/arena/leagues/[id]`. Renders the head card
	 * (gradient logo + emblem + N° rank + inline Invite/Predict
	 * buttons), the league-battle section (active card or
	 * Challenge-another-league CTA), a tappable member leaderboard
	 * (each row opens a member bottom-sheet with avatar + accuracy /
	 * streak stats), a recent-activity feed, and the leave /
	 * transfer-ownership controls. Small leagues (under four members)
	 * swap the podium for a "just getting started" recruit prompt.
	 */
	interface Props {
		leagueId: string;
	}

	const { leagueId }: Props = $props();

	let errorMessage: string | null = $state(null);
	let copied = $state(false);
	let leaving = $state(false);
	let challengeOpen = $state(false);
	let transferOpen = $state(false);
	let privacyOpen = $state(false);
	let leaderboardTab = $state<'week' | 'all'>('week');
	// Member tapped in the leaderboard — drives the member detail
	// bottom-sheet (avatar + accuracy / streak). `null` keeps it closed.
	let openMember = $state<LeagueMemberDoc | null>(null);

	const selfPrincipal = $derived($authPrincipal);

	// Everything below reads from the shared leagues cache. The store
	// hydrates the caller's memberships + every league's roster and
	// battles in one fan-out refresh, so tapping in from the (already
	// warm) list paints instantly while a background refresh runs.
	const mine = $derived($myLeaguesStore.find((m) => m.league.id === leagueId));
	const league = $derived(mine?.league);
	const myRole = $derived<LeagueMemberRole | undefined>(mine?.role);
	const members = $derived($leagueMembersStore.get(leagueId) ?? []);
	const battles = $derived($leagueBattlesStore.get(leagueId) ?? []);

	const loadState = $derived.by<'loading' | 'ready' | 'not_member' | 'error'>(() => {
		if (!$leaguesLoadedStore) {
			return $leaguesErrorStore ? 'error' : 'loading';
		}

		return mine ? 'ready' : 'not_member';
	});

	// Stale-while-revalidate: render the cache and refresh in the
	// background on every mount.
	onMount(() => {
		void refreshMyLeagues();
	});

	// Deep-link: `?challenge=1` from other surfaces opens the challenge
	// sheet immediately on load. Kept the legacy `?propose=1` alias too
	// so older links still work.
	$effect(() => {
		if (
			loadState === 'ready' &&
			isLeagueAdmin &&
			(page.url.searchParams.get('challenge') === '1' ||
				page.url.searchParams.get('propose') === '1') &&
			!challengeOpen
		) {
			challengeOpen = true;
		}
	});

	const accent = $derived(league?.accentColor ?? '#7e9b6a');

	// The emblem rendered inside the gradient tile — the owner's stored
	// pick, with a name-derived 1-char fallback for legacy rows written
	// before the picker shipped.
	const emblem = $derived(league ? leagueEmblem(league) : '◆');

	// A league owner or admin holds the same battle authority — initiate,
	// accept, decline, expire. The satellite assert enforces the same
	// owner-or-admin predicate, so these gates and the backend never drift.
	const isLeagueAdmin = $derived(myRole === 'owner' || myRole === 'admin');
	const canSeeInvite = $derived(isLeagueAdmin);
	const canLeave = $derived(myRole !== 'owner' && nonNullish(myRole));
	const canChallenge = $derived(isLeagueAdmin);
	const canTransfer = $derived(
		myRole === 'owner' && members.filter((m) => m.role !== 'owner').length > 0
	);

	// Owner-only inline rename. The pencil affordance next to the hero
	// title opens a text input seeded with the current name; Enter saves,
	// Esc cancels, plus explicit Save / Cancel controls. Non-owners never
	// see the affordance, so the title stays read-only for them.
	const canRename = $derived(myRole === 'owner');

	// Owner-only cover image. The logo tile renders the uploaded image
	// (cover-fit) when set, else the emblem glyph. Owners get Add/Change
	// + Remove affordances over the tile; non-owners see it read-only.
	const canEditImage = $derived(myRole === 'owner');
	const hasImage = $derived(nonNullish(league?.imageUrl) && league.imageUrl.length > 0);
	let imageInput = $state<HTMLInputElement | null>(null);
	let imageBusy = $state(false);

	const pickImage = () => {
		if (!canEditImage || imageBusy) {
			return;
		}

		imageInput?.click();
	};

	const handleImagePicked = async (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];

		// Reset the input so re-picking the same file fires `change` again.
		input.value = '';

		if (!file || !league || imageBusy) {
			return;
		}

		imageBusy = true;

		let uploadedUrl: string | undefined;

		try {
			const previousUrl = league.imageUrl;
			const imageUrl = await uploadLeagueImage({ leagueId: league.id, file });
			uploadedUrl = imageUrl;
			await updateLeague({ id: league.id, imageUrl });

			// The doc now points at the fresh asset, so don't roll it back below.
			uploadedUrl = undefined;

			// Drop the superseded asset once the doc points at the new one.
			if (nonNullish(previousUrl) && previousUrl !== imageUrl) {
				await deleteLeagueImageByUrl(previousUrl);
			}

			await refreshMyLeagues();
		} catch (err) {
			console.error('LeagueDetailPage: league image upload failed', err);
			errorMessage = t({ locale: $localeStore, key: 'common.error.generic' });

			// The asset uploaded but the doc write failed: best-effort cleanup so
			// the orphaned image doesn't linger in Storage. Swallow cleanup errors.
			if (nonNullish(uploadedUrl)) {
				await deleteLeagueImageByUrl(uploadedUrl);
			}
		} finally {
			imageBusy = false;
		}
	};

	const handleRemoveImage = async () => {
		if (!canEditImage || !league || imageBusy || !hasImage) {
			return;
		}

		imageBusy = true;

		try {
			const previousUrl = league.imageUrl;
			await updateLeague({ id: league.id, imageUrl: '' });

			if (nonNullish(previousUrl)) {
				await deleteLeagueImageByUrl(previousUrl);
			}

			await refreshMyLeagues();
		} catch (err) {
			console.error('LeagueDetailPage: league image remove failed', err);
			errorMessage = t({ locale: $localeStore, key: 'common.error.generic' });
		} finally {
			imageBusy = false;
		}
	};

	let renaming = $state(false);
	let renameDraft = $state('');
	let renameSaving = $state(false);

	const renameError = $derived.by((): MessageKey | undefined => {
		if (!renaming) {
			return;
		}

		const trimmed = renameDraft.trim();

		if (trimmed.length === 0) {
			return 'leagues.detail.rename_error_empty';
		}

		const validation = validateLeagueDraft({ name: trimmed });

		if (validation.ok) {
			return;
		}

		// `description_too_long` can't occur — we validate name only — so
		// the reason is always one of the two length-window failures.
		return validation.reason === 'name_too_short'
			? 'leagues.detail.rename_error_too_short'
			: 'leagues.detail.rename_error_too_long';
	});

	const openRename = () => {
		if (!canRename || !league) {
			return;
		}

		renameDraft = league.name;
		renaming = true;
	};

	const cancelRename = () => {
		renaming = false;
		renameDraft = '';
	};

	const handleRename = async () => {
		if (!league || renameSaving || nonNullish(renameError)) {
			return;
		}

		const trimmed = renameDraft.trim();

		if (trimmed === league.name) {
			cancelRename();

			return;
		}

		renameSaving = true;

		try {
			await updateLeague({ id: league.id, name: trimmed });
			await refreshMyLeagues();
			renaming = false;
			renameDraft = '';
		} catch (err) {
			console.error('LeagueDetailPage: updateLeague failed', err);
			errorMessage = t({ locale: $localeStore, key: 'common.error.generic' });
		} finally {
			renameSaving = false;
		}
	};

	const handleRenameKeydown = (event: KeyboardEvent) => {
		// Ignore Enter while an IME composition is active (CJK input commits
		// the composition with Enter) so we don't save/cancel mid-composition.
		if (event.isComposing || event.keyCode === 229) {
			return;
		}

		if (event.key === 'Enter') {
			event.preventDefault();
			void handleRename();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			cancelRename();
		}
	};

	// Caller's weekly rank-trend within the league — the sign of their
	// week-over-week movement, mapped onto the card convention (negative =
	// climbed, shown as ▲). Sourced from the weekly window's `rankDelta`
	// (`priorRank - rank`), independent of the leaderboard tab so the
	// "this week" copy stays accurate even on the All-time tab. `0` =
	// no comparable prior week (newcomer / no settled position) → "even".
	let standingTrend = $state(0);

	$effect(() => {
		const owner = selfPrincipal;
		const roster = members.map((m) => m.member);

		if (isNullish(owner) || roster.length === 0) {
			standingTrend = 0;

			return;
		}

		// Guard against a stale resolution clobbering fresher state: when the
		// inputs change quickly a prior run's promise can settle after this
		// one, so only commit while this run is still the latest. The teardown
		// flips `cancelled` before the next run starts.
		let cancelled = false;

		getLeagueStandings({ window: 'week', members: roster })
			.then((result) => {
				if (cancelled) {
					return;
				}

				const delta = findOwnStanding({ result, owner })?.rankDelta;

				// `rankDelta` is `priorRank - rank` (positive = climbed); the
				// card convention inverts that (negative = climbed). Leave 0
				// (shown "even") when there is no comparable prior week.
				standingTrend = isNullish(delta) ? 0 : -delta;
			})
			.catch((err: unknown) => {
				if (cancelled) {
					return;
				}

				console.error(err);
				standingTrend = 0;
			});

		return () => {
			cancelled = true;
		};
	});

	// 1-indexed position of the caller for the head card's `N°{NN}` corner
	// badge and the `#N` rank block. It is the caller's index in the same
	// accuracy-ranked roster the leaderboard list renders, so the badge, the
	// rank block, and the list all show one number. Defaults to 1 only when
	// the caller isn't in the (still-hydrating) roster, so it's never blank.
	const yourRank = $derived.by(
		() => leagueRankOf({ sorted: sortedMembers, principal: selfPrincipal }) ?? 1
	);

	// Maps the privacy tier onto its chip label key. A league with an
	// absent field resolves to `open` via `leaguePrivacy`.
	const PRIVACY_CHIP_KEY: Record<LeaguePrivacy, MessageKey> = {
		[LeaguePrivacy.PRIVATE]: 'leagues.detail.hero_chip_private',
		[LeaguePrivacy.OPEN]: 'leagues.detail.hero_chip_open'
	};

	// Editorial-hero eyebrow chips — the kind ("League") and the privacy
	// state (Open / Private). The privacy chip reads the league's
	// `privacy` field through `leaguePrivacy` (absent → Open).
	// The member count now lives on the identity card's overlap row, and
	// the caller's role is surfaced in the battle section ("Admin · you").
	const kindChipLabel = $derived(t({ locale: $localeStore, key: 'leagues.detail.hero_chip_kind' }));

	// The league's effective privacy (absent → Open) + its chip label.
	// Owners can tap the privacy chip to change the league's visibility;
	// for everyone else it stays a read-only chip.
	const currentPrivacy = $derived(league ? leaguePrivacy(league) : LeaguePrivacy.OPEN);
	const canEditPrivacy = $derived(myRole === 'owner');
	const privacyChipLabel = $derived(
		t({ locale: $localeStore, key: PRIVACY_CHIP_KEY[currentPrivacy] })
	);

	const handlePrivacyChanged = () => {
		privacyOpen = false;
		// The privacy flip is read live everywhere it matters (public
		// listing, friend recs), but refresh so this page's chip + cache
		// reflect the new value immediately.
		void refreshMyLeagues();
	};

	const handleTransferred = () => {
		transferOpen = false;
		// The transfer has flipped owner + role rows; reload everything
		// so the user's role drops to 'admin' and the leave / transfer
		// CTAs update accordingly.
		void refreshMyLeagues();
	};

	const handleBattleProposed = () => {
		challengeOpen = false;
		void refreshMyLeagues();
	};

	const handleCopyInvite = async () => {
		if (!league) {
			return;
		}

		try {
			const { url, withReferral } = await buildLeagueShareUrl({
				inviteCode: league.inviteCode
			});
			const shareText = t({
				locale: $localeStore,
				key: 'leagues.share_text'
			});
			await navigator.clipboard.writeText(`${shareText} ${url}`);
			copied = true;

			track({
				name: 'league_invite_sent',
				source: 'leagues',
				leagueId: league.id,
				ok: withReferral
			});

			setTimeout(() => {
				copied = false;
			}, 1600);
		} catch {
			// Clipboard may be unavailable (insecure context). Silent
			// no-op; the user can still read the code in the head card.
		}
	};

	const handleLeave = async () => {
		if (!league || leaving) {
			return;
		}

		leaving = true;

		try {
			await leaveLeague({ leagueId: league.id });
			void goto(`${resolveAppPath(AppPath.Arena)}/leagues`);
		} catch (err) {
			console.error('LeagueDetailPage: leaveLeague failed', err);
			errorMessage = t({ locale: $localeStore, key: 'common.error.generic' });
		} finally {
			leaving = false;
		}
	};

	const handlePredict = () => {
		void goto(resolveAppPath(AppPath.Flow));
	};

	// Open the battle detail page — the running standings + face-off for a
	// live battle live there, not on this card.
	const goToBattle = (battleId: string) => {
		void goto(`${resolveAppPath(AppPath.Arena)}/battles/${battleId}?from=league`);
	};

	const memberHandle = (principal: string): string => {
		const profile = $profilesStore.get(principal);

		if (profile?.nickname && profile.nickname.length > 0) {
			return `@${profile.nickname}`;
		}

		return shortenPrincipal(principal);
	};

	// Avatar props for a roster principal, drawn from the shared
	// profile cache. Falls back to nulls before the cache lands —
	// `<Avatar>` resolves a deterministic placeholder from `owner`.
	const memberAvatar = (principal: string): string | null =>
		$profilesStore.get(principal)?.avatar ?? null;

	const memberAvatarParts = (principal: string): string | null =>
		$profilesStore.get(principal)?.avatarParts ?? null;

	const memberNickname = (principal: string): string | null =>
		$profilesStore.get(principal)?.nickname ?? null;

	// Per-member stats for the leaderboard row + member sheet. The
	// shared profile cache carries `accuracy` (0–100) and `dailyStreak`
	// (consecutive active days); both default to 0 until the profile
	// hydrates.
	const memberAccuracy = (principal: string): number =>
		$profilesStore.get(principal)?.accuracy ?? 0;

	const memberStreak = (principal: string): number =>
		$profilesStore.get(principal)?.dailyStreak ?? 0;

	const formatAccuracy = (principal: string): string =>
		formatLocalePercent({ value: memberAccuracy(principal) / 100, locale: $localeStore });

	// The roster ranked by accuracy — the figure each row surfaces — so the
	// leaderboard reads top-down by performance, like the global one, and the
	// hero rank badge (which indexes into this same order) agrees with it.
	const sortedMembers = $derived(
		rankLeagueMembers({ members, accuracyOf: memberAccuracy, streakOf: memberStreak })
	);

	// The backend allows any number of concurrent battles per league, so
	// the section renders lists, not a single slot. Three buckets:
	//   - incomingRequests — proposals THIS league must accept or decline
	//   - liveBattles      — accepted / in_flight match-ups under way
	//   - outgoingProposals — proposals we sent, awaiting the opponent
	const incomingRequests = $derived(
		battles
			.filter((b) => b.state === 'proposed' && b.sideB === leagueId)
			.sort((a, b) => (a.respondByMs ?? a.kickoffMs) - (b.respondByMs ?? b.kickoffMs))
	);
	const liveBattles = $derived(
		battles
			.filter((b) => b.state === 'in_flight' || b.state === 'accepted')
			.sort((a, b) => a.settleMs - b.settleMs)
	);
	const outgoingProposals = $derived(
		battles
			.filter((b) => b.state === 'proposed' && b.sideA === leagueId)
			.sort((a, b) => a.kickoffMs - b.kickoffMs)
	);
	const hasAnyBattle = $derived(
		incomingRequests.length > 0 || liveBattles.length > 0 || outgoingProposals.length > 0
	);
	const inFlightCount = $derived(battles.filter((b) => b.state === 'in_flight').length);

	const opponentIdOf = (battle: BattleDoc): string =>
		battle.sideA === leagueId ? battle.sideB : battle.sideA;

	// A proposed battle where THIS league is the challenged side (`sideB`):
	// we *received* the challenge and are expected to respond. Drives the
	// recipient-facing copy and the accept/decline affordances.
	const isIncomingProposed = (battle: BattleDoc): boolean =>
		battle.state === 'proposed' && battle.sideB === leagueId;

	const stateLabelKeyOf = (battle: BattleDoc): MessageKey => {
		switch (battle.state) {
			case 'proposed':
				return isIncomingProposed(battle)
					? 'leagues.battle.state.incoming'
					: 'leagues.battle.state.proposed';
			case 'accepted':
				return 'leagues.battle.state.accepted';
			case 'in_flight':
				return 'leagues.battle.state.in_flight';
			case 'resolved':
				return 'leagues.battle.state.resolved';
			case 'declined':
				return 'leagues.battle.state.declined';
			case 'expired':
				return 'leagues.battle.state.expired';
		}
	};

	// A battle stores only the opponent's league id; resolve it to the
	// current name (own memberships → directory cache → shortened id).
	const leagueName = (id: string): string =>
		$myLeaguesStore.find((m) => m.league.id === id)?.league.name ??
		$leagueDirectoryStore.get(id)?.name ??
		shortLeagueId(id);

	// Hydrate the directory for every opponent this league has faced.
	$effect(() => {
		const opponentIds = battles.map((b) => (b.sideA === leagueId ? b.sideB : b.sideA));

		if (opponentIds.length > 0) {
			void loadLeaguesByIds({ ids: opponentIds });
		}
	});

	// Meta line under a battle headline:
	//   Proposed         → "Awaiting acceptance from {opponent}" /
	//                       "{opponent} challenged your league".
	//   Accepted /
	//   in-flight        → "Day {day} of {days} · accuracy face-off".
	const metaLineOf = (battle: BattleDoc): string => {
		if (battle.state === 'proposed') {
			return t({
				locale: $localeStore,
				key: isIncomingProposed(battle)
					? 'leagues.detail.battle_meta_incoming'
					: 'leagues.detail.battle_meta_awaiting',
				params: { opponent: leagueName(opponentIdOf(battle)) }
			});
		}

		const totalDays = Math.max(1, Math.round((battle.settleMs - battle.kickoffMs) / DAY_IN_MS));
		const elapsedDays = Math.max(
			1,
			Math.min(totalDays, Math.ceil((Date.now() - battle.kickoffMs) / DAY_IN_MS))
		);

		return t({
			locale: $localeStore,
			key: 'leagues.detail.battle_meta_day_of',
			params: { day: elapsedDays, days: totalDays }
		});
	};

	// Per-battle transition affordances. Owner-only.
	let actingBattleId = $state<string | null>(null);
	// Battle id → count of lazy auto-resolve attempts. We retry a transient
	// failure on the next effect pass (there's no manual button to fall back
	// on) but cap it so a persistently failing write doesn't hammer the
	// backend on every re-render. Expiry stays a one-shot Set.
	const autoResolveAttempts = new SvelteMap<string, number>();
	const MAX_AUTO_RESOLVE_ATTEMPTS = 3;
	const autoExpireAttempted = new SvelteSet<string>();

	// The challenged side's owner or admin can respond to a proposal.
	// Accept is additionally blocked at the far concurrency rail (a safety
	// bound, not a product limit — see BATTLE_MAX_CONCURRENT_IN_FLIGHT).
	const canRespondToBattle = (battle: BattleDoc): boolean =>
		isLeagueAdmin && battle.state === 'proposed' && battle.sideB === leagueId;

	const canAcceptBattle = (battle: BattleDoc): boolean =>
		canRespondToBattle(battle) && inFlightCount < BATTLE_MAX_CONCURRENT_IN_FLIGHT;

	const canKickoffBattle = (battle: BattleDoc): boolean =>
		isLeagueAdmin &&
		battle.state === 'accepted' &&
		(battle.sideA === leagueId || battle.sideB === leagueId) &&
		Date.now() >= battle.kickoffMs;

	// A settled in-flight battle is shown as "finalizing" to everyone — the
	// resolution is silent, so there is no button to press. Membership only
	// decides who actually triggers the trustless write (below); the label
	// is purely informational.
	const isBattleFinalizing = (battle: BattleDoc): boolean =>
		battle.state === 'in_flight' &&
		(battle.sideA === leagueId || battle.sideB === leagueId) &&
		Date.now() >= battle.settleMs;

	// Any member of this league can trigger the write — the satellite
	// re-derives the scores, so the writer's identity can't skew them.
	const canResolveBattle = (battle: BattleDoc): boolean =>
		nonNullish(myRole) && isBattleFinalizing(battle);

	const canRetractBattle = (battle: BattleDoc): boolean =>
		battle.state === 'proposed' && nonNullish(selfPrincipal) && battle.proposer === selfPrincipal;

	const handleRetractBattle = async (battle: BattleDoc) => {
		if (nonNullish(actingBattleId)) {
			return;
		}

		actingBattleId = battle.id;

		try {
			await retractBattle({ battle });
			await refreshMyLeagues();
		} catch (err) {
			console.error('LeagueDetailPage: retractBattle failed', err);
			errorMessage = t({ locale: $localeStore, key: 'common.error.generic' });
		} finally {
			actingBattleId = null;
		}
	};

	const handleAcceptBattle = async (battle: BattleDoc) => {
		if (nonNullish(actingBattleId)) {
			return;
		}

		actingBattleId = battle.id;

		try {
			await acceptBattle({ battle });
			await refreshMyLeagues();
		} catch (err) {
			console.error('LeagueDetailPage: acceptBattle failed', err);
			errorMessage = t({ locale: $localeStore, key: 'common.error.generic' });
		} finally {
			actingBattleId = null;
		}
	};

	const handleKickoffBattle = async (battle: BattleDoc) => {
		if (nonNullish(actingBattleId)) {
			return;
		}

		actingBattleId = battle.id;

		try {
			await kickoffBattle({ battle });
			await refreshMyLeagues();
		} catch (err) {
			console.error('LeagueDetailPage: kickoffBattle failed', err);
			errorMessage = t({ locale: $localeStore, key: 'common.error.generic' });
		} finally {
			actingBattleId = null;
		}
	};

	const handleDeclineBattle = async (battle: BattleDoc) => {
		if (nonNullish(actingBattleId)) {
			return;
		}

		actingBattleId = battle.id;

		try {
			await declineBattle({ battle });
			// `label` carries the actor's role (owner | admin) so the
			// owner-vs-admin split is visible in product analysis.
			track({ name: 'battle_declined', battleId: battle.id, leagueId, label: myRole });
			await refreshMyLeagues();
		} catch (err) {
			console.error('LeagueDetailPage: declineBattle failed', err);
			errorMessage = t({ locale: $localeStore, key: 'common.error.generic' });
		} finally {
			actingBattleId = null;
		}
	};

	// Lazily expire a stale proposal (Juno has no scheduler). Background
	// sweep — failures stay silent rather than flashing the error banner.
	const handleExpireBattle = async (battle: BattleDoc) => {
		if (nonNullish(actingBattleId)) {
			return;
		}

		actingBattleId = battle.id;

		try {
			const expired = await maybeExpireBattle({ battle });

			if (expired.state === 'expired') {
				track({ name: 'battle_expired', battleId: battle.id, leagueId });
			}

			await refreshMyLeagues();
		} catch (err) {
			console.error('LeagueDetailPage: maybeExpireBattle failed', err);
		} finally {
			actingBattleId = null;
		}
	};

	// Resolve in one tap — scores are each league's window accuracy,
	// computed by the service and re-verified by the satellite assert.
	const handleResolveBattle = async ({
		battle,
		source
	}: {
		battle: BattleDoc;
		source: 'auto' | 'nudge';
	}) => {
		if (nonNullish(actingBattleId)) {
			return;
		}

		actingBattleId = battle.id;

		try {
			const resolved = await resolveBattle({ battle });

			const ourLetter = resolved.sideA === leagueId ? 'A' : 'B';
			const isVoid =
				resolved.winner === 'draw' && (resolved.callsA ?? 0) === 0 && (resolved.callsB ?? 0) === 0;

			track({
				name: 'battle_resolved',
				battleId: resolved.id,
				leagueId,
				source,
				label: isVoid
					? 'void'
					: resolved.winner === 'draw'
						? 'draw'
						: resolved.winner === ourLetter
							? 'win'
							: 'loss',
				value: Math.max(resolved.scoreA ?? 0, resolved.scoreB ?? 0)
			});

			await refreshMyLeagues();
		} catch (err) {
			console.error('LeagueDetailPage: resolveBattle failed', err);
			errorMessage = t({ locale: $localeStore, key: 'common.error.generic' });
		} finally {
			actingBattleId = null;
		}
	};

	// Lazy maintenance (Juno has no scheduler): a settled battle resolves
	// the first time any member of either side opens the league, and stale
	// proposals expire the first time an owner does. One write per pass —
	// the effect re-runs after the refresh and picks up the next candidate.
	$effect(() => {
		if (isNullish(myRole) || nonNullish(actingBattleId)) {
			return;
		}

		const toResolve = battles.find(
			(b) => canResolveBattle(b) && (autoResolveAttempts.get(b.id) ?? 0) < MAX_AUTO_RESOLVE_ATTEMPTS
		);

		if (nonNullish(toResolve)) {
			autoResolveAttempts.set(toResolve.id, (autoResolveAttempts.get(toResolve.id) ?? 0) + 1);
			void handleResolveBattle({ battle: toResolve, source: 'auto' });

			return;
		}

		// Expiry is owner-or-admin — the satellite gate for proposed->expired
		// admits a side owner or admin, so a plain member's attempt would be
		// rejected.
		if (!isLeagueAdmin) {
			return;
		}

		const toExpire = battles.find(
			(b) =>
				b.state === 'proposed' &&
				Date.now() >= (b.respondByMs ?? b.kickoffMs) &&
				!autoExpireAttempted.has(b.id)
		);

		if (nonNullish(toExpire)) {
			autoExpireAttempted.add(toExpire.id);
			void handleExpireBattle(toExpire);
		}
	});

	// Recent activity feed. Built from the battle list — newest first by
	// kickoff (in_flight) or settle (resolved). We cap at 6 rows so the
	// card stays tight on a phone.
	interface ActivityRow {
		battleId: string;
		opponentId: string;
		stateKey: MessageKey;
		ts: number;
		verbKey: MessageKey;
		state: BattleState;
	}

	const activity = $derived.by((): ActivityRow[] => {
		const verbKeys: Record<BattleState, MessageKey> = {
			proposed: 'leagues.detail.activity_verb_proposed',
			accepted: 'leagues.detail.activity_verb_accepted',
			in_flight: 'leagues.detail.activity_verb_in_flight',
			resolved: 'leagues.detail.activity_verb_resolved',
			declined: 'leagues.detail.activity_verb_declined',
			expired: 'leagues.detail.activity_verb_expired'
		};
		const stateKeys: Record<BattleState, MessageKey> = {
			proposed: 'leagues.battle.state.proposed',
			accepted: 'leagues.battle.state.accepted',
			in_flight: 'leagues.battle.state.in_flight',
			resolved: 'leagues.battle.state.resolved',
			declined: 'leagues.battle.state.declined',
			expired: 'leagues.battle.state.expired'
		};

		const rows: ActivityRow[] = battles.map((b) => {
			const opponentId = b.sideA === leagueId ? b.sideB : b.sideA;
			// Newest-first sort key: when the row's defining moment happened.
			const ts =
				b.state === 'resolved'
					? (b.resolvedAtMs ?? b.settleMs)
					: b.state === 'declined'
						? (b.respondedAtMs ?? b.kickoffMs)
						: b.state === 'expired'
							? (b.respondByMs ?? b.kickoffMs)
							: b.kickoffMs;

			return {
				battleId: b.id,
				opponentId,
				stateKey: stateKeys[b.state],
				ts,
				verbKey: verbKeys[b.state],
				state: b.state
			};
		});

		return rows.sort((a, b) => b.ts - a.ts).slice(0, 6);
	});

	// Leaderboard rows — the accuracy-ranked roster, top-6, with a sticky
	// YOU row at the bottom for callers who fall outside it. The "This week"
	// and "All time" tabs still render the same lifetime-accuracy projection;
	// the tab is wired so per-window member stats can replace the sort key
	// without a structural refactor once the clearing canister exposes them.
	const leaderboardTop = $derived(sortedMembers.slice(0, 6));

	const youMember = $derived.by((): LeagueMemberDoc | undefined => {
		if (isNullish(selfPrincipal)) {
			return;
		}

		return members.find((m) => m.member === selfPrincipal);
	});

	// The sticky YOU row at the foot of the leaderboard is a reminder for
	// callers who fell outside the visible top-6 — when the caller already
	// appears in `leaderboardTop` it would just duplicate their own row, so
	// we suppress it.
	const showYouRow = $derived(
		nonNullish(youMember) && !leaderboardTop.some((m) => m.member === selfPrincipal)
	);

	// Small-league recruit state — under four members there isn't
	// enough of a field for a podium, so we surface a "just getting
	// started" prompt with an invite CTA beneath the leaderboard.
	const isRecruiting = $derived(members.length < 4);

	// 1-indexed roster rank of the tapped member — feeds the member
	// sheet's `Rank #NN · {league}` subhead.
	const openMemberRank = $derived.by((): number => {
		if (!openMember) {
			return 1;
		}

		const idx = sortedMembers.findIndex((m) => m.member === openMember?.member);

		return idx === -1 ? 1 : idx + 1;
	});

	// Owner-only promote/demote control in the member sheet. Shown for a
	// member that is neither the owner nor the caller; the satellite assert
	// re-enforces the owner gate, so this is a convenience guard. Promotion
	// only ever toggles member ↔ admin (the owner role is reserved for the
	// owner principal).
	let roleSaving = $state(false);

	const canManageMemberRole = $derived(
		myRole === 'owner' &&
			nonNullish(openMember) &&
			openMember.role !== 'owner' &&
			openMember.member !== selfPrincipal
	);

	const handleSetMemberRole = async ({
		member,
		role
	}: {
		member: LeagueMemberDoc;
		role: 'admin' | 'member';
	}) => {
		if (roleSaving || !league) {
			return;
		}

		roleSaving = true;

		try {
			await setMemberRole({ leagueId: league.id, memberPrincipal: member.member, role });
			await refreshMyLeagues();
			openMember = null;
		} catch (err) {
			console.error('LeagueDetailPage: setMemberRole failed', err);
			errorMessage = t({ locale: $localeStore, key: 'common.error.generic' });
		} finally {
			roleSaving = false;
		}
	};
</script>

<div class="league-detail">
	{#if loadState === 'loading'}
		<ScreenHeader
			back={{
				label: t({ locale: $localeStore, key: 'leagues.detail.back' }),
				onBack: () => goBack(resolveAppPath(AppPath.Arena))
			}}
		/>
		<p class="league-detail-status" aria-busy="true">
			{t({ locale: $localeStore, key: 'leagues.detail.loading' })}
		</p>
	{:else if loadState === 'not_member'}
		<ScreenHeader
			back={{
				label: t({ locale: $localeStore, key: 'leagues.detail.back' }),
				onBack: () => goBack(resolveAppPath(AppPath.Arena))
			}}
		/>
		<LeagueDetailEmptyState />
	{:else if loadState === 'error'}
		<ScreenHeader
			back={{
				label: t({ locale: $localeStore, key: 'leagues.detail.back' }),
				onBack: () => goBack(resolveAppPath(AppPath.Arena))
			}}
		/>
		<p class="league-detail-error" role="alert">
			{errorMessage ?? t({ locale: $localeStore, key: 'leagues.error.generic' })}
		</p>
	{:else if league}
		<!-- ─── Editorial hero · back chevron + serif title on one row,
		     then compact context chips + optional description. Mirrors the
		     source design's title-bar (inline back + 24px serif-italic
		     title) rather than stacking the title under a standalone bar. -->
		<header class="league-detail-hero">
			{#if renaming}
				<div class="league-detail-hero-bar">
					<button
						class="league-detail-hero-back"
						aria-label={t({ locale: $localeStore, key: 'leagues.detail.back' })}
						onclick={() => goBack(resolveAppPath(AppPath.Arena))}
						type="button"
					>
						<ChevronLeft aria-hidden="true" size={18} strokeWidth={1.8} />
					</button>
					<div class="league-detail-rename">
						<div class="league-detail-rename-row">
							<!-- svelte-ignore a11y_autofocus -->
							<input
								class="league-detail-rename-input"
								aria-invalid={nonNullish(renameError)}
								aria-label={t({ locale: $localeStore, key: 'leagues.detail.rename_label' })}
								autofocus
								disabled={renameSaving}
								maxlength={LEAGUE_NAME_MAX_LENGTH}
								minlength={LEAGUE_NAME_MIN_LENGTH}
								onkeydown={handleRenameKeydown}
								type="text"
								bind:value={renameDraft}
							/>
							<button
								class="league-detail-rename-btn is-primary"
								disabled={renameSaving || nonNullish(renameError)}
								onclick={handleRename}
								type="button"
							>
								{t({
									locale: $localeStore,
									key: renameSaving ? 'leagues.detail.rename_saving' : 'leagues.detail.rename_save'
								})}
							</button>
							<button
								class="league-detail-rename-btn is-ghost"
								disabled={renameSaving}
								onclick={cancelRename}
								type="button"
							>
								{t({ locale: $localeStore, key: 'leagues.detail.rename_cancel' })}
							</button>
						</div>
						{#if renameError}
							<p class="league-detail-rename-error" role="alert">
								{t({ locale: $localeStore, key: renameError })}
							</p>
						{/if}
					</div>
				</div>
			{:else}
				<div class="league-detail-hero-bar">
					<button
						class="league-detail-hero-back"
						aria-label={t({ locale: $localeStore, key: 'leagues.detail.back' })}
						onclick={() => goBack(resolveAppPath(AppPath.Arena))}
						type="button"
					>
						<ChevronLeft aria-hidden="true" size={18} strokeWidth={1.8} />
					</button>
					<h1 class="league-detail-hero-title">{league.name}</h1>
					{#if canRename}
						<button
							class="league-detail-hero-edit"
							aria-label={t({ locale: $localeStore, key: 'leagues.detail.rename_label' })}
							onclick={openRename}
							type="button"
						>
							<Pencil aria-hidden="true" size={14} strokeWidth={2} />
						</button>
					{/if}
				</div>
			{/if}
			<div class="league-detail-hero-chips">
				<span class="league-detail-hero-chip num">{kindChipLabel}</span>
				{#if canEditPrivacy}
					<button
						class="league-detail-hero-chip num is-editable"
						aria-label={t({ locale: $localeStore, key: 'leagues.privacy.edit_label' })}
						onclick={() => (privacyOpen = true)}
						type="button"
					>
						{privacyChipLabel}
						<Pencil aria-hidden="true" size={11} strokeWidth={2} />
					</button>
				{:else}
					<span class="league-detail-hero-chip num">{privacyChipLabel}</span>
				{/if}
			</div>
			{#if league.description}
				<p class="league-detail-hero-desc serif-italic">{league.description}</p>
			{/if}
		</header>

		<!-- ─── Identity card · emblem tile + member overlap + actions ─── -->
		<section
			style:--accent={accent}
			style:--accent-grad={`linear-gradient(160deg, ${accent}33 0%, ${accent}11 40%, var(--bg-surface) 100%)`}
			class="league-detail-identity"
		>
			<div class="league-detail-identity-row">
				<div class="league-detail-logo-wrap">
					<div class="league-detail-logo" class:has-image={hasImage} aria-hidden="true">
						{#if hasImage && league.imageUrl}
							<img class="league-detail-logo-image" alt="" src={league.imageUrl} />
						{:else}
							<span class="league-detail-logo-emblem">{emblem}</span>
						{/if}
						<span class="league-detail-logo-corner num">N°{String(yourRank).padStart(2, '0')}</span>
					</div>
					{#if canEditImage}
						<div class="league-detail-logo-actions">
							<input
								bind:this={imageInput}
								class="league-detail-logo-file"
								accept="image/*"
								onchange={handleImagePicked}
								type="file"
							/>
							<button
								class="league-detail-logo-action"
								aria-label={t({
									locale: $localeStore,
									key: hasImage
										? 'leagues.detail.image_change_label'
										: 'leagues.detail.image_add_label'
								})}
								disabled={imageBusy}
								onclick={pickImage}
								type="button"
							>
								<ImagePlus aria-hidden="true" size={13} strokeWidth={2} />
								<span>
									{t({
										locale: $localeStore,
										key: hasImage ? 'leagues.detail.image_change' : 'leagues.detail.image_add'
									})}
								</span>
							</button>
							{#if hasImage}
								<button
									class="league-detail-logo-action is-remove"
									aria-label={t({ locale: $localeStore, key: 'leagues.detail.image_remove_label' })}
									disabled={imageBusy}
									onclick={handleRemoveImage}
									type="button"
								>
									<Trash2 aria-hidden="true" size={13} strokeWidth={2} />
									<span>{t({ locale: $localeStore, key: 'leagues.detail.image_remove' })}</span>
								</button>
							{/if}
						</div>
					{/if}
				</div>
				<div class="league-detail-identity-body">
					<span class="num allcaps league-detail-identity-eyebrow">
						{t({
							locale: $localeStore,
							key: 'leagues.detail.rank_eyebrow',
							params: { league: league.name }
						})}
					</span>
					<div class="league-detail-rank">
						<span class="num league-detail-rank-v">#{yourRank}</span>
						<span class="num league-detail-rank-of">
							{t({
								locale: $localeStore,
								key: 'leagues.detail.rank_of',
								params: { count: members.length }
							})}
						</span>
						{#if standingTrend === 0}
							<span class="num league-detail-rank-mv is-even">
								— {t({ locale: $localeStore, key: 'leagues.detail.trend_even' })}
							</span>
						{:else}
							<span
								class="num league-detail-rank-mv"
								class:is-down={standingTrend > 0}
								class:is-up={standingTrend < 0}
							>
								{standingTrend < 0 ? '▲' : '▼'}
								{t({
									locale: $localeStore,
									key: 'leagues.detail.trend_this_week',
									params: { count: Math.abs(standingTrend) }
								})}
							</span>
						{/if}
					</div>
					<button
						class="league-detail-identity-overlap"
						aria-label={t({
							locale: $localeStore,
							key: 'leagues.detail.members_count_unlimited',
							params: { count: members.length }
						})}
						onclick={() => (leaderboardTab = 'all')}
						type="button"
					>
						<span class="league-detail-overlap-avatars" aria-hidden="true">
							{#each sortedMembers.slice(0, 4) as member, i (member.member)}
								<span style:--i={i} class="league-detail-overlap-avatar">
									<Avatar
										class="league-detail-overlap-img"
										avatar={memberAvatar(member.member)}
										avatarParts={memberAvatarParts(member.member)}
										nickname={memberNickname(member.member)}
										owner={member.member}
										self={member.member === selfPrincipal}
									/>
								</span>
							{/each}
						</span>
						<span class="num allcaps league-detail-overlap-count">
							{t({
								locale: $localeStore,
								key:
									members.length === 1
										? 'leagues.card.member_count_one'
										: 'leagues.card.member_count_many',
								params: { count: members.length }
							})}
						</span>
					</button>
				</div>
			</div>
			<div class="league-detail-identity-actions">
				{#if canSeeInvite}
					<button class="league-detail-head-btn is-ghost" onclick={handleCopyInvite} type="button">
						{#if copied}
							<Check aria-hidden="true" size={13} strokeWidth={2.4} />
							<span>{t({ locale: $localeStore, key: 'leagues.detail.invite_copied' })}</span>
						{:else}
							<Copy aria-hidden="true" size={13} strokeWidth={2} />
							<span>{t({ locale: $localeStore, key: 'leagues.detail.invite_label' })}</span>
						{/if}
					</button>
				{/if}
				<button class="league-detail-head-btn is-primary" onclick={handlePredict} type="button">
					<span>{t({ locale: $localeStore, key: 'leagues.detail.predict_cta' })}</span>
					<ChevronRight aria-hidden="true" size={13} strokeWidth={2.2} />
				</button>
			</div>
		</section>

		<!-- ─── Leaderboard · This week / All time ─── -->
		<!-- Members now live here as tappable rows (avatar + handle +
		     streak + accuracy); the row opens a member detail sheet.
		     The Panini sticker grid is retired in favour of this single
		     roster + the member sheet. -->
		<section class="league-detail-section">
			<div class="league-detail-section-head">
				<span class="eyebrow league-detail-section-title">
					{t({ locale: $localeStore, key: 'leagues.detail.leaderboard_eyebrow' })}
				</span>
				<span class="num league-detail-section-side">
					{t({
						locale: $localeStore,
						key: 'leagues.detail.members_count_unlimited',
						params: { count: members.length }
					})}
				</span>
			</div>
			<div class="league-detail-leaderboard">
				<div class="league-detail-lb-tabs" role="tablist">
					<button
						class="league-detail-lb-tab allcaps"
						class:is-active={leaderboardTab === 'week'}
						aria-selected={leaderboardTab === 'week'}
						onclick={() => (leaderboardTab = 'week')}
						role="tab"
						type="button"
					>
						{t({ locale: $localeStore, key: 'leagues.detail.lb_tab_week' })}
					</button>
					<button
						class="league-detail-lb-tab allcaps"
						class:is-active={leaderboardTab === 'all'}
						aria-selected={leaderboardTab === 'all'}
						onclick={() => (leaderboardTab = 'all')}
						role="tab"
						type="button"
					>
						{t({ locale: $localeStore, key: 'leagues.detail.lb_tab_all' })}
					</button>
				</div>

				<ul class="league-detail-lb-rows">
					{#each leaderboardTop as member, idx (member.member)}
						{@const isYou = member.member === selfPrincipal}
						<li>
							<button
								class="league-detail-lb-row"
								class:is-you={isYou}
								aria-label={memberHandle(member.member)}
								onclick={() => (openMember = member)}
								type="button"
							>
								<span
									class="league-detail-lb-rank num"
									data-rank={idx === 0 ? 'gold' : idx === 1 ? 'silver' : idx === 2 ? 'bronze' : ''}
								>
									{String(idx + 1).padStart(2, '0')}
								</span>
								<Avatar
									class="league-detail-lb-avatar"
									avatar={memberAvatar(member.member)}
									avatarParts={memberAvatarParts(member.member)}
									nickname={memberNickname(member.member)}
									owner={member.member}
									self={member.member === selfPrincipal}
								/>
								<span class="league-detail-lb-id">
									<span class="league-detail-lb-name">{memberHandle(member.member)}</span>
									<LeagueRoleBadge role={member.role} />
									{#if isYou}
										<YouBadge size="xs" />
									{/if}
								</span>
								<span class="league-detail-lb-streak num allcaps">
									{t({
										locale: $localeStore,
										key: 'leagues.detail.lb_streak',
										params: { count: memberStreak(member.member) }
									})}
								</span>
								<span class="league-detail-lb-acc num">{formatAccuracy(member.member)}</span>
							</button>
						</li>
					{/each}
				</ul>

				<!-- Sticky YOU row — only when the caller falls outside the
				     visible top-6 above; otherwise it would duplicate their
				     own row. -->
				{#if showYouRow && youMember}
					<button
						class="league-detail-lb-row league-detail-lb-you-row"
						aria-label={t({ locale: $localeStore, key: 'leagues.detail.you_chip' })}
						onclick={() => (openMember = youMember ?? null)}
						type="button"
					>
						<span class="league-detail-lb-rank num is-you">
							{String(yourRank).padStart(2, '0')}
						</span>
						<Avatar
							class="league-detail-lb-avatar"
							avatar={memberAvatar(youMember.member)}
							avatarParts={memberAvatarParts(youMember.member)}
							nickname={memberNickname(youMember.member)}
							owner={youMember.member}
							self={youMember.member === selfPrincipal}
						/>
						<span class="league-detail-lb-id">
							<span class="league-detail-lb-name">{memberHandle(youMember.member)}</span>
							<LeagueRoleBadge role={youMember.role} />
							<YouBadge size="xs" />
						</span>
						<span class="league-detail-lb-streak num allcaps">
							{t({
								locale: $localeStore,
								key: 'leagues.detail.lb_streak',
								params: { count: memberStreak(youMember.member) }
							})}
						</span>
						<span class="league-detail-lb-acc num">{formatAccuracy(youMember.member)}</span>
					</button>
				{/if}
			</div>

			<!-- Small-league recruit prompt — no podium theatre for a
			     near-empty league; nudge the user to invite instead. -->
			{#if isRecruiting}
				<div class="league-detail-recruit">
					<span class="league-detail-recruit-title">
						{t({ locale: $localeStore, key: 'leagues.detail.recruit_title' })}
					</span>
					<p class="league-detail-recruit-sub">
						{t({ locale: $localeStore, key: 'leagues.detail.recruit_sub' })}
					</p>
					{#if canSeeInvite}
						<button class="league-detail-recruit-cta" onclick={handleCopyInvite} type="button">
							{#if copied}
								<Check aria-hidden="true" size={13} strokeWidth={2.4} />
								<span>{t({ locale: $localeStore, key: 'leagues.detail.invite_copied' })}</span>
							{:else}
								<Copy aria-hidden="true" size={13} strokeWidth={2} />
								<span>{t({ locale: $localeStore, key: 'leagues.detail.invite_label' })}</span>
							{/if}
						</button>
					{/if}
				</div>
			{/if}
		</section>

		<!-- ─── Battle section · secondary to standings, so it sits below the
		     leaderboard. Incoming requests, live match-ups, and the proposals
		     we've sent — the backend allows any number of battles at once. ─── -->
		{#snippet battleCard(battle: BattleDoc)}
			<div class="league-detail-battle-card" data-state={battle.state}>
				<div class="league-detail-battle-tags">
					<span class="league-detail-battle-tag allcaps" data-state={battle.state}>
						{t({ locale: $localeStore, key: stateLabelKeyOf(battle) })}
					</span>
				</div>
				<div class="league-detail-battle-headline">
					<span>{league.name}</span>
					<span class="serif-italic league-detail-battle-vs">vs</span>
					<span>{leagueName(opponentIdOf(battle))}</span>
				</div>
				<p class="league-detail-battle-meta num">{metaLineOf(battle)}</p>

				{#if isIncomingProposed(battle)}
					{#if canRespondToBattle(battle)}
						<div class="league-detail-battle-actions">
							<button
								class="league-detail-battle-action is-primary"
								disabled={nonNullish(actingBattleId) || !canAcceptBattle(battle)}
								onclick={() => handleAcceptBattle(battle)}
								type="button"
							>
								{actingBattleId === battle.id
									? t({ locale: $localeStore, key: 'leagues.battle.action.accepting' })
									: t({ locale: $localeStore, key: 'leagues.battle.action.accept' })}
							</button>
							<button
								class="league-detail-battle-action is-danger"
								disabled={nonNullish(actingBattleId)}
								onclick={() => handleDeclineBattle(battle)}
								type="button"
							>
								{actingBattleId === battle.id
									? t({ locale: $localeStore, key: 'leagues.battle.action.declining' })
									: t({ locale: $localeStore, key: 'leagues.battle.action.decline' })}
							</button>
						</div>
						{#if !canAcceptBattle(battle)}
							<p class="league-detail-battle-hint num">
								{t({ locale: $localeStore, key: 'leagues.battle.cap_reached' })}
							</p>
						{/if}
					{:else}
						<p class="league-detail-battle-hint num">
							{t({ locale: $localeStore, key: 'leagues.detail.battle_owner_accepts' })}
						</p>
					{/if}
				{:else if canKickoffBattle(battle)}
					<button
						class="league-detail-battle-action is-primary"
						disabled={nonNullish(actingBattleId)}
						onclick={() => handleKickoffBattle(battle)}
						type="button"
					>
						{actingBattleId === battle.id
							? t({ locale: $localeStore, key: 'leagues.battle.action.starting' })
							: t({ locale: $localeStore, key: 'leagues.battle.action.kickoff' })}
					</button>
				{:else if isBattleFinalizing(battle)}
					<p class="league-detail-battle-finalizing num" aria-live="polite" role="status">
						<LoadingSpinner size="xs" />
						<span>{t({ locale: $localeStore, key: 'leagues.battle.action.finalizing' })}</span>
					</p>
				{/if}

				{#if canRetractBattle(battle)}
					<button
						class="league-detail-battle-action is-danger"
						disabled={nonNullish(actingBattleId)}
						onclick={() => handleRetractBattle(battle)}
						type="button"
					>
						{actingBattleId === battle.id
							? t({ locale: $localeStore, key: 'leagues.battle.action.retracting' })
							: t({ locale: $localeStore, key: 'leagues.battle.action.retract' })}
					</button>
				{/if}

				{#if battle.state === 'in_flight' || battle.state === 'accepted'}
					<button
						class="league-detail-battle-view allcaps"
						onclick={() => goToBattle(battle.id)}
						type="button"
					>
						{t({ locale: $localeStore, key: 'battles.live.cta' })} →
					</button>
				{/if}
			</div>
		{/snippet}

		<section class="league-detail-section">
			<div class="league-detail-section-head">
				<span class="eyebrow league-detail-section-title">
					{t({ locale: $localeStore, key: 'leagues.detail.battle_eyebrow' })}
				</span>
				{#if canChallenge}
					<span class="num league-detail-section-side">
						{t({ locale: $localeStore, key: 'leagues.detail.battle_admin_chip' })}
					</span>
				{/if}
			</div>

			{#if incomingRequests.length > 0}
				<p class="eyebrow league-detail-battle-group-label">
					{t({ locale: $localeStore, key: 'leagues.detail.battle_requests_label' })}
				</p>
				{#each incomingRequests as battle (battle.id)}
					{@render battleCard(battle)}
				{/each}
			{/if}

			{#each liveBattles as battle (battle.id)}
				{@render battleCard(battle)}
			{/each}

			{#each outgoingProposals as battle (battle.id)}
				{@render battleCard(battle)}
			{/each}

			{#if !hasAnyBattle}
				<div class="league-detail-battle-empty">
					<p class="serif-italic league-detail-battle-empty-lede">
						{t({ locale: $localeStore, key: 'leagues.detail.battle_empty_lede' })}
					</p>
					<p class="league-detail-battle-empty-sub">
						{t({ locale: $localeStore, key: 'leagues.detail.battle_empty_sub' })}
					</p>
				</div>
			{/if}

			{#if canChallenge}
				<button
					class="league-detail-battle-empty-cta"
					onclick={() => (challengeOpen = true)}
					type="button"
				>
					<span>{t({ locale: $localeStore, key: 'leagues.detail.battle_challenge_cta' })}</span>
					<ChevronRight aria-hidden="true" size={13} strokeWidth={2.2} />
				</button>
			{:else}
				<p class="league-detail-battle-hint num">
					{t({ locale: $localeStore, key: 'leagues.detail.battle_admin_only' })}
				</p>
			{/if}
		</section>

		<!-- ─── Recent activity feed ─── -->
		<section class="league-detail-section">
			<div class="league-detail-section-head">
				<span class="eyebrow league-detail-section-title">
					{t({ locale: $localeStore, key: 'leagues.detail.activity_eyebrow' })}
				</span>
			</div>
			{#if activity.length === 0}
				<p class="league-detail-activity-empty">
					{t({ locale: $localeStore, key: 'leagues.detail.activity_empty' })}
				</p>
			{:else}
				<ul class="league-detail-activity">
					{#each activity as row (row.battleId)}
						<li class="league-detail-activity-row">
							<div class="league-detail-activity-body">
								<span class="league-detail-activity-who">
									{t({
										locale: $localeStore,
										key: row.verbKey,
										params: { opponent: leagueName(row.opponentId) }
									})}
								</span>
								<span class="league-detail-activity-when num">{formatDate(row.ts)}</span>
							</div>
							<span class="league-detail-activity-state allcaps" data-state={row.state}>
								{t({ locale: $localeStore, key: row.stateKey })}
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<!-- ─── Day-2 controls — kept for production · transfer + leave ─── -->
		<div class="league-detail-controls">
			{#if canTransfer}
				<button class="league-detail-transfer" onclick={() => (transferOpen = true)} type="button">
					{t({ locale: $localeStore, key: 'leagues.transfer.cta' })}
				</button>
			{/if}
			{#if canLeave}
				<button class="league-detail-leave" disabled={leaving} onclick={handleLeave} type="button">
					{t({
						locale: $localeStore,
						key: leaving ? 'leagues.detail.leaving' : 'leagues.detail.leave'
					})}
				</button>
			{/if}
		</div>
	{/if}
</div>

{#if nonNullish(league) && canChallenge}
	<CreateBoutModal
		fromLeagueId={league.id}
		isOpen={challengeOpen}
		onClose={() => (challengeOpen = false)}
		onProposed={handleBattleProposed}
	/>
{/if}

{#if nonNullish(league) && myRole === 'owner'}
	<TransferOwnershipModal
		currentOwnerPrincipal={league.owner}
		isOpen={transferOpen}
		leagueId={league.id}
		{members}
		onClose={() => (transferOpen = false)}
		onTransferred={handleTransferred}
	/>
{/if}

{#if nonNullish(league) && canEditPrivacy}
	<LeaguePrivacyModal
		{currentPrivacy}
		isOpen={privacyOpen}
		leagueId={league.id}
		onClose={() => (privacyOpen = false)}
		onSaved={handlePrivacyChanged}
	/>
{/if}

<!-- ─── Member detail sheet · avatar + accuracy / streak stats ─── -->
<BottomSheet isOpen={nonNullish(openMember)} onClose={() => (openMember = null)}>
	{#if openMember}
		<div class="league-detail-member-sheet">
			<div class="league-detail-member-sheet-head">
				<Avatar
					class="league-detail-member-sheet-avatar"
					avatar={memberAvatar(openMember.member)}
					avatarParts={memberAvatarParts(openMember.member)}
					nickname={memberNickname(openMember.member)}
					owner={openMember.member}
					self={openMember.member === selfPrincipal}
				/>
				<div class="league-detail-member-sheet-id">
					<span class="league-detail-member-sheet-name-row">
						<span class="league-detail-member-sheet-name">{memberHandle(openMember.member)}</span>
						<LeagueRoleBadge expanded role={openMember.role} />
						{#if openMember.member === selfPrincipal}
							<YouBadge size="xs" />
						{/if}
					</span>
					<span class="num league-detail-member-sheet-rank">
						{t({
							locale: $localeStore,
							key: 'leagues.detail.member_sheet_rank',
							params: {
								rank: String(openMemberRank).padStart(2, '0'),
								league: league?.name ?? ''
							}
						})}
					</span>
				</div>
			</div>
			<div class="league-detail-member-sheet-stats">
				<div class="league-detail-member-stat">
					<span class="eyebrow league-detail-member-stat-label">
						{t({ locale: $localeStore, key: 'leagues.detail.member_stat_accuracy' })}
					</span>
					<span class="num league-detail-member-stat-value"
						>{formatAccuracy(openMember.member)}</span
					>
				</div>
				<div class="league-detail-member-stat">
					<span class="eyebrow league-detail-member-stat-label">
						{t({ locale: $localeStore, key: 'leagues.detail.member_stat_streak' })}
					</span>
					<span class="num league-detail-member-stat-value">{memberStreak(openMember.member)}</span>
				</div>
			</div>

			{#if canManageMemberRole}
				<div class="league-detail-member-sheet-actions">
					{#if openMember.role === 'admin'}
						<button
							class="league-detail-member-role-btn"
							disabled={roleSaving}
							onclick={() =>
								openMember && handleSetMemberRole({ member: openMember, role: 'member' })}
							type="button"
						>
							{t({ locale: $localeStore, key: 'leagues.detail.member_remove_admin' })}
						</button>
					{:else}
						<button
							class="league-detail-member-role-btn is-primary"
							disabled={roleSaving}
							onclick={() =>
								openMember && handleSetMemberRole({ member: openMember, role: 'admin' })}
							type="button"
						>
							{t({ locale: $localeStore, key: 'leagues.detail.member_make_admin' })}
						</button>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</BottomSheet>

<style lang="postcss">
	.league-detail {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		padding: 0 1.25rem 6rem;
	}

	.league-detail-status,
	.league-detail-error {
		margin: 0;
		padding: 1rem;
		font-size: var(--t-13);
		border-radius: var(--r-12);
	}

	.league-detail-status {
		color: var(--text-muted);
		background: color-mix(in srgb, var(--bg-surface) 86%, transparent);
		border: 1px solid var(--border-base);
	}

	.league-detail-error {
		color: var(--no);
		background: color-mix(in srgb, var(--no-wash, var(--no)) 14%, transparent);
		border: 1px solid color-mix(in srgb, var(--no) 35%, var(--border-base));
	}

	/* ─── Editorial hero ────────────────────────────────────────── */

	.league-detail-hero {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.25rem 0 0.1rem;
	}

	/* Title-bar row — inline back chevron + serif title (+ owner rename
	   pencil), vertically centred, mirroring the source design's title
	   bar. 50px min-height + 12px gap keep the chevron and title aligned
	   on a single row. */
	.league-detail-hero-bar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-height: 50px;
	}

	/* Inline back circle — flush to the content edge via the negative
	   margin, so it reads as part of the title row rather than an inset
	   action. */
	.league-detail-hero-back {
		appearance: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: 36px;
		height: 36px;
		margin-left: -8px;
		padding: 0;
		color: var(--text-muted);
		background: transparent;
		border: 0;
		border-radius: var(--r-pill);
		cursor: pointer;
		transition:
			color 140ms var(--ease-vici),
			background 140ms var(--ease-vici);
	}

	.league-detail-hero-back:hover {
		color: var(--text-base);
		background: color-mix(in srgb, var(--text-base) 6%, transparent);
	}

	.league-detail-hero-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	/* Context chips — mono, Title-case, rounded outline. The chip copy
	   carries its own casing (League / 8 members / Public), so no
	   uppercasing transform; the row reads as content, not a status pill. */
	.league-detail-hero-chip {
		font-family: var(--font-mono);
		font-size: var(--t-11);
		letter-spacing: 0.02em;
		padding: 0.25rem 0.625rem;
		border-radius: var(--r-pill);
		color: var(--text-muted);
		border: 1px solid var(--border-base);
	}

	/* The privacy chip is a tappable control for the owner — same pill
	   shape, plus a trailing pencil + hover affordance so it reads as
	   editable rather than a static status pill. */
	button.league-detail-hero-chip.is-editable {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		appearance: none;
		background: none;
		cursor: pointer;
		transition:
			color var(--d-hover) var(--ease-vici),
			border-color var(--d-hover) var(--ease-vici);
	}

	button.league-detail-hero-chip.is-editable:hover {
		color: var(--text-base);
		border-color: var(--color-primary);
	}

	/* League title — serif-italic editorial treatment (the entity name
	   reads as a masthead, not a UI label). Sized to the source design's
	   inline title-bar (24px), filling the row so any trailing pencil
	   sits at the edge; ellipsizes only when truly out of room. */
	.league-detail-hero-title {
		margin: 0;
		flex: 1 1 auto;
		min-width: 0;
		font-family: var(--font-serif, var(--font-display, serif));
		font-style: italic;
		font-size: var(--t-24, 1.5rem);
		font-weight: 400;
		letter-spacing: -0.01em;
		color: var(--text-base);
		line-height: 1.1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.league-detail-hero-desc {
		margin: 0;
		font-size: var(--t-13);
		color: var(--text-muted);
		line-height: 1.45;
	}

	/* ─── Inline rename (owner only) ────────────────────────────── */

	.league-detail-hero-edit {
		appearance: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		padding: 0.25rem;
		color: var(--text-muted);
		background: none;
		border: 0;
		border-radius: var(--r-8);
		cursor: pointer;
		transition:
			color 140ms ease,
			background 140ms ease;
	}

	.league-detail-hero-edit:hover {
		color: var(--text-base);
		background: color-mix(in srgb, var(--text-base) 6%, transparent);
	}

	.league-detail-rename {
		display: flex;
		flex: 1 1 auto;
		min-width: 0;
		flex-direction: column;
		gap: 0.4rem;
	}

	.league-detail-rename-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.league-detail-rename-input {
		flex: 1;
		min-width: 0;
		padding: 0.45rem 0.7rem;
		font: inherit;
		font-family: var(--font-display);
		font-size: var(--t-16);
		font-weight: 600;
		color: var(--text-base);
		background: var(--bg-surface);
		border: 1px solid var(--border-base);
		border-radius: var(--r-8);
	}

	.league-detail-rename-input:focus-visible {
		outline: none;
		border-color: var(--border-strong);
	}

	.league-detail-rename-input[aria-invalid='true'] {
		border-color: color-mix(in srgb, var(--no) 45%, var(--border-base));
	}

	.league-detail-rename-input:disabled {
		opacity: 0.6;
	}

	.league-detail-rename-btn {
		appearance: none;
		flex-shrink: 0;
		padding: 0.45rem 0.85rem;
		font: inherit;
		font-size: var(--t-12);
		font-weight: 700;
		border-radius: var(--r-pill);
		cursor: pointer;
	}

	.league-detail-rename-btn.is-primary {
		color: var(--text-on-accent, #fff);
		background: var(--laurel);
		border: 1px solid var(--laurel);
	}

	.league-detail-rename-btn.is-ghost {
		color: var(--text-base);
		background: color-mix(in srgb, var(--bg-surface) 60%, transparent);
		border: 1px solid var(--border-base);
	}

	.league-detail-rename-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.league-detail-rename-error {
		margin: 0;
		font-size: var(--t-11);
		color: var(--no);
	}

	/* ─── Identity card ─────────────────────────────────────────── */

	.league-detail-identity {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0.95rem 1rem;
		background: color-mix(in srgb, var(--bg-surface) 90%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
	}

	.league-detail-identity-row {
		display: grid;
		grid-template-columns: 5.5rem 1fr;
		gap: 0.9rem;
		align-items: center;
	}

	.league-detail-identity-body {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		min-width: 0;
	}

	.league-detail-identity-eyebrow {
		font-size: var(--t-10);
		letter-spacing: var(--tracking-allcaps);
		color: var(--text-muted);
	}

	/* Rank-forward identity — the caller's standing reads as the headline
	   figure: a large mono "#rank", the "of M" denominator, and a coloured
	   ▲/▼ "N this week" (or "— even") trend, baseline-aligned. */
	.league-detail-rank {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 9px;
	}

	.league-detail-rank-v {
		font-size: 34px;
		font-weight: 700;
		letter-spacing: -0.03em;
		line-height: 0.9;
		color: var(--text-base);
	}

	.league-detail-rank-of {
		font-size: 12px;
		color: var(--text-muted);
	}

	.league-detail-rank-mv {
		margin-left: 2px;
		font-size: 11.5px;
		font-weight: 600;
		white-space: nowrap;
	}

	.league-detail-rank-mv.is-even {
		color: var(--text-muted);
	}

	.league-detail-rank-mv.is-up {
		color: var(--yes);
	}

	.league-detail-rank-mv.is-down {
		color: var(--no);
	}

	.league-detail-identity-overlap {
		appearance: none;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0;
		font: inherit;
		background: none;
		border: 0;
		cursor: pointer;
	}

	.league-detail-overlap-avatars {
		display: inline-flex;
		align-items: center;
	}

	.league-detail-overlap-avatar {
		display: inline-flex;
		margin-left: -7px;
		border-radius: 50%;
		box-shadow: 0 0 0 2px var(--bg-surface);
	}

	.league-detail-overlap-avatar:first-child {
		margin-left: 0;
	}

	:global(.league-detail-overlap-img) {
		width: 1.5rem;
		height: 1.5rem;
	}

	.league-detail-overlap-count {
		font-size: var(--t-10);
		letter-spacing: var(--tracking-allcaps);
		color: var(--text-muted);
	}

	.league-detail-identity-actions {
		display: flex;
		gap: 0.5rem;
	}

	.league-detail-identity-actions .league-detail-head-btn {
		flex: 1;
		justify-content: center;
	}

	.league-detail-logo {
		position: relative;
		width: 5.5rem;
		height: 5.5rem;
		background: var(--accent-grad);
		border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
		border-radius: var(--r-12);
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		flex-shrink: 0;
		box-shadow:
			0 14px 30px -16px rgba(0, 0, 0, 0.55),
			inset 0 1px 0 color-mix(in srgb, var(--text-base) 10%, transparent);
	}

	.league-detail-logo::before {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(
			120deg,
			transparent 35%,
			color-mix(in srgb, var(--text-base) 12%, transparent) 50%,
			transparent 65%
		);
		pointer-events: none;
	}

	.league-detail-logo-emblem {
		position: relative;
		z-index: 2;
		font-family: var(--font-display);
		font-style: italic;
		font-size: 2.1rem;
		font-weight: 600;
		color: var(--accent);
		line-height: 1;
	}

	.league-detail-logo-corner {
		position: absolute;
		bottom: 0.3rem;
		right: 0.35rem;
		z-index: 2;
		font-size: 0.55rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		color: var(--accent);
		opacity: 0.78;
	}

	/* Owner-uploaded cover fills the tile (cover-fit, centred). Sits at
	   z-index 1 so the rank corner badge stays legible above it. */
	.league-detail-logo-image {
		position: absolute;
		inset: 0;
		z-index: 1;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.league-detail-logo.has-image .league-detail-logo-corner {
		color: var(--text-on-accent, #fff);
		opacity: 0.92;
		text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
	}

	.league-detail-logo-wrap {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.league-detail-logo-actions {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.league-detail-logo-file {
		display: none;
	}

	.league-detail-logo-action {
		appearance: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		padding: 0.25rem 0.4rem;
		font: inherit;
		font-size: var(--t-10);
		font-weight: 700;
		letter-spacing: 0.02em;
		color: var(--text-muted);
		background: color-mix(in srgb, var(--bg-surface) 60%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-pill);
		cursor: pointer;
		transition:
			color 140ms ease,
			border-color 140ms ease,
			background 140ms ease;
	}

	.league-detail-logo-action:hover:not(:disabled) {
		color: var(--text-base);
		border-color: var(--border-strong);
	}

	.league-detail-logo-action.is-remove {
		color: var(--no);
		border-color: color-mix(in srgb, var(--no) 35%, var(--border-base));
	}

	.league-detail-logo-action:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.league-detail-head-btn {
		appearance: none;
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.4rem 0.7rem;
		font: inherit;
		font-size: var(--t-12);
		font-weight: 700;
		border-radius: var(--r-pill);
		cursor: pointer;
		transition:
			background 140ms ease,
			border-color 140ms ease,
			color 140ms ease;
	}

	.league-detail-head-btn.is-ghost {
		color: var(--text-base);
		background: color-mix(in srgb, var(--bg-surface) 60%, transparent);
		border: 1px solid var(--border-base);
	}

	.league-detail-head-btn.is-ghost:hover {
		border-color: var(--border-strong);
	}

	.league-detail-head-btn.is-primary {
		color: var(--text-on-accent, #fff);
		background: var(--laurel);
		border: 1px solid var(--laurel);
	}

	.league-detail-head-btn.is-primary:hover {
		background: color-mix(in srgb, var(--laurel) 88%, var(--text-base));
	}

	/* ─── Generic section ───────────────────────────────────────── */

	.league-detail-section {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}

	.league-detail-section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.league-detail-section-title {
		margin: 0;
		color: var(--text-muted);
	}

	.league-detail-section-side {
		font-size: var(--t-10);
		font-weight: 600;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}

	/* ─── Battle section ──────────────────────────────────────────── */

	.league-detail-battle-card {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 0.85rem 0.95rem;
		background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
	}

	.league-detail-battle-card[data-state='in_flight'] {
		border-color: color-mix(in srgb, var(--laurel) 38%, var(--border-base));
	}

	.league-detail-battle-tags {
		display: flex;
		gap: 0.3rem;
	}

	.league-detail-battle-tag {
		font-size: var(--t-10);
		letter-spacing: var(--tracking-allcaps);
		padding: 0.1rem 0.4rem;
		border-radius: var(--r-pill);
		color: var(--text-muted);
		background: color-mix(in srgb, var(--text-muted) 16%, transparent);
	}

	.league-detail-battle-tag[data-state='in_flight'] {
		color: var(--laurel);
		background: color-mix(in srgb, var(--laurel) 22%, transparent);
	}

	.league-detail-battle-headline {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.35rem;
		font-size: var(--t-14);
		font-weight: 600;
		color: var(--text-base);
	}

	.league-detail-battle-vs {
		font-size: var(--t-13);
		color: var(--accent);
	}

	.league-detail-battle-meta {
		font-size: var(--t-11);
		color: var(--text-muted);
	}

	.league-detail-battle-hint {
		margin-top: 0.15rem;
		font-size: var(--t-10);
		color: var(--text-muted);
		opacity: 0.85;
	}

	.league-detail-battle-finalizing {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		margin-top: 0.35rem;
		font-size: var(--t-11);
		font-weight: 700;
		color: var(--text-muted);
	}

	.league-detail-battle-action {
		appearance: none;
		align-self: flex-start;
		margin-top: 0.25rem;
		padding: 0.4rem 0.85rem;
		font: inherit;
		font-size: var(--t-12);
		font-weight: 700;
		border-radius: var(--r-pill);
		cursor: pointer;
	}

	.league-detail-battle-action.is-primary {
		color: var(--text-on-accent, #fff);
		background: var(--laurel);
		border: 1px solid var(--laurel);
	}

	.league-detail-battle-action.is-danger {
		color: var(--no);
		background: color-mix(in srgb, var(--no-wash, var(--no)) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--no) 35%, var(--border-base));
	}

	.league-detail-battle-action:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* "View →" link to the battle detail page — text affordance, not a
	   filled action, so it reads as secondary to the owner CTAs above. */
	.league-detail-battle-view {
		appearance: none;
		align-self: flex-start;
		margin-top: 0.4rem;
		padding: 0;
		font-family: var(--font-mono, var(--font-sans));
		font-size: var(--t-10);
		font-weight: 700;
		letter-spacing: 0.1em;
		color: var(--laurel);
		background: none;
		border: none;
		cursor: pointer;
	}

	/* Accept + Decline sit side by side on an incoming request. */
	.league-detail-battle-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.25rem;
	}

	.league-detail-battle-actions .league-detail-battle-action {
		margin-top: 0;
	}

	.league-detail-battle-group-label {
		margin: 0.15rem 0 -0.15rem;
		color: var(--text-muted);
	}

	.league-detail-battle-tag[data-state='declined'] {
		color: var(--no);
		background: color-mix(in srgb, var(--no) 16%, transparent);
	}

	.league-detail-battle-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4rem;
		padding: 1rem 0.95rem;
		text-align: center;
		background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
		border: 1px dashed var(--border-base);
		border-radius: var(--r-12);
	}

	.league-detail-battle-empty-lede {
		margin: 0;
		font-size: var(--t-14);
		color: var(--accent);
	}

	.league-detail-battle-empty-sub {
		margin: 0;
		font-size: var(--t-12);
		line-height: 1.4;
		color: var(--text-muted);
	}

	.league-detail-battle-empty-cta {
		appearance: none;
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		margin-top: 0.2rem;
		padding: 0.5rem 0.95rem;
		font: inherit;
		font-size: var(--t-12);
		font-weight: 700;
		color: var(--text-on-accent, #fff);
		background: var(--laurel);
		border: 1px solid var(--laurel);
		border-radius: var(--r-pill);
		cursor: pointer;
	}

	.league-detail-battle-empty-cta:hover {
		background: color-mix(in srgb, var(--laurel) 88%, var(--text-base));
	}

	/* ─── Leaderboard ───────────────────────────────────────────── */

	.league-detail-leaderboard {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.85rem 0.95rem;
		background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
	}

	.league-detail-lb-tabs {
		display: flex;
		gap: 0.2rem;
		padding: 0.18rem;
		background: color-mix(in srgb, var(--text-base) 4%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-8);
	}

	.league-detail-lb-tab {
		appearance: none;
		flex: 1;
		padding: 0.4rem 0.5rem;
		font: inherit;
		font-size: var(--t-10);
		font-weight: 600;
		letter-spacing: 0.1em;
		color: var(--text-muted);
		background: transparent;
		border: 0;
		border-radius: var(--r-8);
		cursor: pointer;
		transition:
			background 180ms ease,
			color 180ms ease;
	}

	.league-detail-lb-tab.is-active {
		color: var(--text-base);
		background: color-mix(in srgb, var(--bg-surface) 60%, transparent);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.16);
	}

	.league-detail-lb-rows {
		display: flex;
		flex-direction: column;
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.league-detail-lb-row {
		appearance: none;
		display: grid;
		grid-template-columns: 1.6rem 1.75rem minmax(0, 1fr) auto auto;
		align-items: center;
		gap: 0.55rem;
		width: 100%;
		min-height: 44px;
		padding: 0.5rem 0.3rem;
		font: inherit;
		color: inherit;
		text-align: left;
		background: transparent;
		border: 0;
		border-bottom: 1px solid var(--border-base);
		border-radius: var(--r-8);
		cursor: pointer;
		transition: background 140ms ease;
	}

	.league-detail-lb-rows li:last-child .league-detail-lb-row {
		border-bottom: 0;
	}

	.league-detail-lb-row:hover {
		background: color-mix(in srgb, var(--text-base) 4%, transparent);
	}

	.league-detail-lb-row.is-you {
		background: color-mix(in srgb, var(--accent) 6%, transparent);
	}

	.league-detail-lb-rank {
		text-align: center;
		font-size: var(--t-12);
		font-weight: 700;
		color: var(--text-muted);
	}

	.league-detail-lb-rank[data-rank='gold'] {
		color: var(--laurel);
	}

	.league-detail-lb-rank[data-rank='silver'] {
		color: #c0c5cb;
	}

	.league-detail-lb-rank[data-rank='bronze'] {
		color: #b57c52;
	}

	.league-detail-lb-rank.is-you {
		color: var(--accent);
	}

	:global(.league-detail-lb-avatar) {
		width: 1.75rem;
		height: 1.75rem;
		flex-shrink: 0;
	}

	/* Name cell — handle + role / YOU chips on one line. The handle
	   ellipsizes (min-width:0) while the chips keep their intrinsic width. */
	.league-detail-lb-id {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		min-width: 0;
	}

	.league-detail-lb-name {
		font-size: var(--t-12);
		font-weight: 500;
		color: var(--text-base);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.league-detail-lb-streak {
		font-size: var(--t-10);
		letter-spacing: var(--tracking-allcaps);
		color: var(--text-muted);
		white-space: nowrap;
	}

	.league-detail-lb-acc {
		font-size: var(--t-13);
		font-weight: 700;
		color: var(--accent);
		text-align: right;
	}

	.league-detail-lb-you-row {
		margin-top: 0.4rem;
		padding-left: 0.6rem;
		padding-right: 0.6rem;
		border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border-base));
	}

	/* ─── Small-league recruit prompt ───────────────────────────── */

	.league-detail-recruit {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4rem;
		padding: 1rem 0.95rem;
		text-align: center;
		background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
		border: 1px dashed var(--border-base);
		border-radius: var(--r-12);
	}

	.league-detail-recruit-title {
		font-family: var(--font-display);
		font-size: var(--t-14);
		font-weight: 600;
		color: var(--text-base);
	}

	.league-detail-recruit-sub {
		margin: 0;
		font-size: var(--t-12);
		line-height: 1.4;
		color: var(--text-muted);
	}

	.league-detail-recruit-cta {
		appearance: none;
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		margin-top: 0.2rem;
		padding: 0.5rem 0.95rem;
		font: inherit;
		font-size: var(--t-12);
		font-weight: 700;
		color: var(--text-base);
		background: color-mix(in srgb, var(--bg-surface) 60%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-pill);
		cursor: pointer;
		transition: border-color 140ms ease;
	}

	.league-detail-recruit-cta:hover {
		border-color: var(--border-strong);
	}

	/* ─── Member detail sheet ───────────────────────────────────── */

	.league-detail-member-sheet {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		padding: 0.25rem 0 0.5rem;
	}

	.league-detail-member-sheet-head {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		min-width: 0;
	}

	:global(.league-detail-member-sheet-avatar) {
		width: 3.25rem;
		height: 3.25rem;
		flex-shrink: 0;
	}

	.league-detail-member-sheet-id {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
	}

	.league-detail-member-sheet-name-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
	}

	.league-detail-member-sheet-name {
		font-family: var(--font-display);
		font-size: var(--t-16);
		font-weight: 700;
		color: var(--text-base);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.league-detail-member-sheet-rank {
		font-size: var(--t-11);
		letter-spacing: var(--tracking-wide);
		color: var(--text-muted);
	}

	.league-detail-member-sheet-stats {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
	}

	.league-detail-member-stat {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.7rem 0.85rem;
		background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
	}

	.league-detail-member-stat-label {
		color: var(--text-muted);
	}

	.league-detail-member-stat-value {
		font-size: var(--t-20);
		font-weight: 700;
		color: var(--text-base);
	}

	/* ─── Member sheet · owner-only role control ────────────────── */

	.league-detail-member-sheet-actions {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.85rem;
	}

	.league-detail-member-role-btn {
		appearance: none;
		padding: 0.7rem 1rem;
		font: inherit;
		font-size: var(--t-13);
		font-weight: 700;
		color: var(--text-muted);
		background: none;
		border: 1px solid var(--border-base);
		border-radius: var(--r-pill);
		cursor: pointer;
		transition:
			color var(--d-hover) var(--ease-vici),
			border-color var(--d-hover) var(--ease-vici);
	}

	.league-detail-member-role-btn:hover:not(:disabled) {
		color: var(--text-base);
		border-color: var(--color-primary);
	}

	.league-detail-member-role-btn.is-primary {
		color: var(--text-on-accent, #fff);
		background: var(--laurel);
		border-color: var(--laurel);
	}

	.league-detail-member-role-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* ─── Activity feed ─────────────────────────────────────────── */

	.league-detail-activity {
		display: flex;
		flex-direction: column;
		list-style: none;
		padding: 0.6rem 0.95rem;
		margin: 0;
		background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
	}

	.league-detail-activity-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.7rem;
		padding: 0.55rem 0;
		border-bottom: 1px solid var(--border-base);
	}

	.league-detail-activity-row:last-of-type {
		border-bottom: 0;
	}

	.league-detail-activity-body {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	.league-detail-activity-who {
		font-size: var(--t-12);
		color: var(--text-base);
		line-height: 1.35;
	}

	.league-detail-activity-when {
		font-size: var(--t-10);
		color: var(--text-muted);
	}

	.league-detail-activity-state {
		flex-shrink: 0;
		font-size: 0.55rem;
		letter-spacing: var(--tracking-allcaps);
		padding: 0.1rem 0.4rem;
		border-radius: var(--r-pill);
		color: var(--text-muted);
		background: color-mix(in srgb, var(--text-muted) 14%, transparent);
	}

	.league-detail-activity-state[data-state='in_flight'] {
		color: var(--laurel);
		background: color-mix(in srgb, var(--laurel) 18%, transparent);
	}

	.league-detail-activity-state[data-state='resolved'] {
		opacity: 0.65;
	}

	.league-detail-activity-empty {
		margin: 0;
		padding: 0.75rem 1rem;
		font-size: var(--t-13);
		color: var(--text-muted);
		background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
		border: 1px dashed var(--border-base);
		border-radius: var(--r-12);
	}

	/* ─── Controls ─────────────────────────────────────────────── */

	.league-detail-controls {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	.league-detail-leave {
		appearance: none;
		padding: 0.65rem 1rem;
		font: inherit;
		font-size: var(--t-13);
		font-weight: 700;
		color: var(--no);
		background: color-mix(in srgb, var(--no-wash, var(--no)) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--no) 35%, var(--border-base));
		border-radius: var(--r-12);
		cursor: pointer;
	}

	.league-detail-leave:hover:not(:disabled) {
		background: color-mix(in srgb, var(--no-wash, var(--no)) 20%, transparent);
	}

	.league-detail-leave:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.league-detail-transfer {
		appearance: none;
		padding: 0.65rem 1rem;
		font: inherit;
		font-size: var(--t-13);
		font-weight: 700;
		color: var(--color-primary);
		background: color-mix(in srgb, var(--color-primary) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-primary) 35%, var(--border-base));
		border-radius: var(--r-12);
		cursor: pointer;
	}

	.league-detail-transfer:hover {
		background: color-mix(in srgb, var(--color-primary) 14%, transparent);
	}
</style>
