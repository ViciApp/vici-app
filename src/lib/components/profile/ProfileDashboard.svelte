<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { Check, Pencil, Settings, Shield, Users } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import AffiliationPickerModal from '#lib/components/leagues/AffiliationPickerModal.svelte';
	import MenagerieBadge from '#lib/components/menagerie/MenagerieBadge.svelte';
	import MenagerieBadgeSkeleton from '#lib/components/menagerie/MenagerieBadgeSkeleton.svelte';
	import AvatarEditor from '#lib/components/profile/AvatarEditor.svelte';
	import HandleEditor from '#lib/components/profile/HandleEditor.svelte';
	import ProfileOracleInsight from '#lib/components/profile/ProfileOracleInsight.svelte';
	import CountryFlag from '#lib/components/ui/CountryFlag.svelte';
	import NotifBell from '#lib/components/ui/NotifBell.svelte';
	import ViciAvatar from '#lib/components/ui/ViciAvatar.svelte';
	import { MENAGERIE } from '#lib/constants/menagerie.constants.ts';
	import { nicknameUniqueKey } from '#lib/constants/profile.constants.ts';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { SCHOOL_PASS2_ENABLED } from '#lib/constants/school-picker.constants.ts';
	import { lookupWorldsAffiliation } from '#lib/constants/worlds-affiliations.constants.ts';
	import { leaderboard } from '#lib/derived/leaderboard.derived.ts';
	import { myMenagerieLoading, myMenagerieRows } from '#lib/derived/menagerie.derived.ts';
	import { userIsAdmin } from '#lib/derived/user.derived.ts';
	import { loadMyMenagerieSignals } from '#lib/services/menagerie.services.ts';
	import { upsertProfile } from '#lib/services/profile.services.ts';
	import { getMyReferralCode } from '#lib/services/referral.services.ts';
	import { loadMyUserStats } from '#lib/services/user-stats.services.ts';
	import { myAffiliationsStore, refreshMyAffiliations } from '#lib/stores/affiliations.store.ts';
	import { myAvatarParts } from '#lib/stores/avatar.store.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { displayMarkets } from '#lib/stores/market-translations.store.ts';
	import { notificationsStore } from '#lib/stores/notification.store.ts';
	import { globalStandingsStore } from '#lib/stores/standings.store.ts';
	import { userStore } from '#lib/stores/user.store.ts';
	import type { AffiliationKind } from '#lib/types/affiliation.ts';
	import type { UserProfile } from '#lib/types/profile.ts';
	import type { UserStatsDoc } from '#lib/types/user-stats.ts';
	import { affiliationChipStyle } from '#lib/utils/affiliation-chip.utils.ts';
	import { countryDisplayName } from '#lib/utils/affiliation-name.utils.ts';
	import { writeToClipboard } from '#lib/utils/clipboard.utils.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';
	import {
		avatarBackdropPlanes,
		deterministicParts,
		parseParts
	} from '#lib/utils/vici-avatar.utils.ts';
	import { goto } from '$app/navigation';

	interface Props {
		profile: UserProfile;
		viewerPrincipal?: string;
	}

	const { profile, viewerPrincipal }: Props = $props();

	const isOwnProfile = $derived(viewerPrincipal === profile.owner);

	/* Editable handle -------------------------------------------------- */

	// The handle (public `@`-name) is edited through the dedicated
	// {@link HandleEditor} sheet: a single input with an inline
	// availability indicator and a 30-day change limit. The limit is
	// server-authoritative (the set-profile assertion is the authority,
	// keyed off the profile's `handleLastChangeMs`); the editor mirrors it
	// and a change stamps `handleLastChangeMs` so the next window starts.
	let handleEditOpen = $state(false);
	let profileToast = $state<string | null>(null);
	let profileToastTimer: ReturnType<typeof setTimeout> | undefined;

	const flashProfileToast = (message: string) => {
		profileToast = message;

		if (profileToastTimer) {
			clearTimeout(profileToastTimer);
		}

		profileToastTimer = setTimeout(() => {
			profileToast = null;
		}, 1900);
	};

	const handleSavedHandle = async (handle: string) => {
		handleEditOpen = false;

		// Snapshot the pre-edit profile so we can roll the optimistic
		// update back verbatim if the persist fails.
		const previousProfile = profile;

		// Stamp the change time only on a real (folded) change: a pure
		// re-casing folds to the same key, where the assertion rejects a moved
		// stamp. On a real change the assertion validates it's ~now and starts
		// the cooldown.
		const handleChanged = nicknameUniqueKey(handle) !== nicknameUniqueKey(profile.nickname ?? '');
		const updatedData = {
			...profile,
			nickname: handle,
			...(handleChanged && { handleLastChangeMs: Date.now() })
		};

		// Optimistic local update so the identity card reflects the new
		// handle immediately, then persist.
		userStore.update((curr) => ({ ...curr, profile: updatedData }));

		try {
			await upsertProfile({ key: profile.owner, data: updatedData });

			flashProfileToast(
				t({ locale: $localeStore, key: 'profile.handle.changed', params: { handle } })
			);
		} catch (err: unknown) {
			// Roll the optimistic update back on failure.
			userStore.update((curr) => ({ ...curr, profile: previousProfile }));

			const message = err instanceof Error ? err.message : '';
			const alreadyTaken = message.includes('already taken');

			notificationsStore.add({
				title: t({
					locale: $localeStore,
					key: alreadyTaken
						? 'profile.dashboard.nickname_taken_title'
						: 'profile.dashboard.nickname_save_failed_title'
				}),
				message: alreadyTaken
					? t({
							locale: $localeStore,
							key: 'profile.dashboard.nickname_taken',
							params: { nickname: handle }
						})
					: t({ locale: $localeStore, key: 'profile.dashboard.nickname_save_failed' }),
				type: 'error'
			});
		}
	};

	/* Identity stats -------------------------------------------------- */

	// The viewer's lifetime record (accuracy, rank, streak, calls) surfaces on
	// the Dashboard and Arena; the Profile hero is identity-focused. The few
	// figures kept here drive the credibility line, the Oracle insight, and the
	// Menagerie tiers, not a stats card.
	const accuracy = $derived(profile.accuracy ?? 0);
	const dailyStreak = $derived(profile.dailyStreak ?? 0);
	const totalTrades = $derived(profile.totalTrades ?? 0);

	/**
	 * Global rank: viewer's 1-based index in the cached leaderboard. Drives the
	 * "Top X%" credibility line below the handle and the rank-gated Menagerie
	 * tiers (Goat). The leaderboard is populated lazily by `LoaderLeaderboard`
	 * on app boot; when the slice hasn't resolved yet (or the viewer isn't in
	 * it), the credibility line simply doesn't render.
	 */
	const globalRank = $derived.by<number | undefined>(() => {
		const idx = $leaderboard.findIndex((entry) => entry.owner === profile.owner);

		return idx === -1 ? undefined : idx + 1;
	});

	/**
	 * Credibility line: "Top X% of global predictors". The hero surfaces one
	 * quiet line of social standing under the handle. The percentile is the
	 * viewer's rank over the size of the global ("all") standings window (the
	 * total ranked field). Below 1% it floors to "Top 1%"; we only render the
	 * line once a real rank + a non-empty ranked field exist, so it never reads
	 * as "Top 100%" on an unranked or unloaded profile.
	 */
	const topPercentLabel = $derived.by<string | undefined>(() => {
		// The window's `total` is the full ranked population (`entries` is only the
		// paged slice), so the credibility line agrees with Goat's percentile.
		const total = $globalStandingsStore.get('all')?.total;

		if (isNullish(globalRank) || isNullish(total) || total <= 0) {
			return;
		}

		const pct = (globalRank / total) * 100;
		const rounded = pct < 1 ? 1 : Math.ceil(pct);

		return t({
			locale: $localeStore,
			key: 'profile.dashboard.top_percent',
			params: { percent: rounded }
		});
	});

	/* Invite Friends: growth loop ------------------------------------- */

	// The viewer's auto-assigned referral code, fetched on mount so the share
	// URL is ready synchronously when the CTA is tapped: `navigator.share()`
	// must fire inside the user gesture (an `await` first makes iOS Safari drop
	// it for losing user activation), so we can't resolve the code on demand.
	let inviteCode = $state<string | undefined>(undefined);

	// True while the referral code is still resolving. Drives the hero CTA's
	// skeleton/pulse state so the button holds its place from first paint
	// instead of popping in once the code lands.
	let inviteCodeLoading = $state(true);

	// Canonical invite URL: `https://{origin}/join/{code}`. The slug is the viewer's
	// stable referral code (never their mutable handle), so a shared link never rots on a
	// rename. `/join/[code]` and `/i/[code]` render the same landing, so this resolves the
	// same as the Arena Friends hero's `/i/{code}` link. The handle-based `/join/{handle}`
	// link this used to build had no matching route and 404'd.
	const inviteUrl = $derived(
		nonNullish(inviteCode) && typeof window !== 'undefined'
			? `${window.location.origin}/join/${inviteCode}`
			: undefined
	);

	// The hero CTA shares the viewer's invite link. Native share sheet when
	// available; otherwise copy to clipboard with a toast fallback so the loop
	// still closes on desktop / unsupported browsers.
	const handleInviteFriends = async () => {
		const url = inviteUrl;

		if (isNullish(url)) {
			return;
		}

		const shareText = t({ locale: $localeStore, key: 'profile.dashboard.invite_share_text' });

		if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
			try {
				await navigator.share({
					title: t({ locale: $localeStore, key: 'profile.dashboard.invite_share_title' }),
					text: shareText,
					url
				});

				return;
			} catch (_: unknown) {
				// Cancelled or unsupported: fall through to clipboard.
			}
		}

		const ok = await writeToClipboard(url);

		if (ok) {
			flashProfileToast(t({ locale: $localeStore, key: 'profile.dashboard.invite_copied' }));
		}
	};

	/* Hero gradient: recoloured from the avatar's own backdrop palette ---- */

	// The full-bleed hero figure renders with `noBg`, so it sits on a gradient
	// built from the same two backdrop planes the avatar would otherwise draw.
	// Re-syncs the instant the editor saves (`saveMyAvatarParts` dispatches
	// `avatarchange`) so the gradient tracks a backdrop change without waiting
	// for an incidental re-render. Another user's profile renders their saved
	// picks from the fetched doc; falls back to the principal-seeded face's
	// palette for a user who has never picked.
	const heroParts = $derived(
		isOwnProfile
			? ($myAvatarParts ?? deterministicParts(profile.owner))
			: (parseParts(profile.avatarParts) ?? deterministicParts(profile.owner))
	);
	const heroPalette = $derived(avatarBackdropPlanes(heroParts));

	const handleOpenSettings = () => {
		void goto(resolveAppPath(AppPath.Settings));
	};

	const handleOpenAdmin = () => {
		void goto(resolveAppPath(AppPath.Admin));
	};

	/* User-stats: drives the Oracle insight's latest-settled record line. */

	let userStats = $state<UserStatsDoc | undefined>(undefined);

	const recentSettlements = $derived(userStats?.recentSettlements ?? []);

	/* Affiliations ----------------------------------------------------- */

	let pickerKind = $state<AffiliationKind | null>(null);
	/* When the picker is opened from an unverified Alma Mater slot, this
	   carries the school id so the sheet opens straight on its verify step. */
	let pickerVerifyId = $state<string | null>(null);

	// Read the caller's affiliations from the shared cache (populated by
	// `refreshMyAffiliations`). Only the caller's own profile surfaces
	// the affiliation grid: other profiles keep the slots empty, as
	// before.
	const myUni = $derived(isOwnProfile ? $myAffiliationsStore.university : undefined);
	const myCountry = $derived(isOwnProfile ? $myAffiliationsStore.country : undefined);

	/**
	 * Affiliation grid: the two wired slots, Alma Mater + Citizen. The
	 * earlier locked City / Company "coming soon" placeholders are gone: an
	 * empty slot that can never be filled reads as broken chrome, so the grid
	 * shows only the affiliations a user can actually set.
	 */
	interface AffilSlot {
		key: 'university' | 'country';
		kind: AffiliationKind;
		labelKey: MessageKey;
		filled: boolean;
		value: string | null;
		/** Stored affiliation id: ISO-2 for countries, slug for unis.
		 *  Needed at render time so the country slot can pass an ID to
		 *  `<CountryFlag>` rather than the display `value` (name). */
		affiliationIdentifier: string | null;
		glyph: string;
		/** Affiliation brand palette: tints the filled-slot icon in the
		 *  school's / country's own colour. Absent for roster entries
		 *  without a curated palette. */
		color: string | null;
		text: string | null;
		/** Alma Mater verification state: only meaningful on the
		 *  `university` slot when filled. `null` on every other slot. */
		status: SchoolStatus | null;
	}

	/**
	 * Alma Mater verification state. Persisted on the profile as a loose
	 * string; a filled university slot with no stored status reads as
	 * `'unverified'`. `'pending'` / `'verified'` are reached through the
	 * membership-email verification flow, which is deferred to its own
	 * roadmap item: until then `'unverified'` is the only state a freshly
	 * picked school can hold.
	 */
	type SchoolStatus = 'unverified' | 'pending' | 'verified';

	const SCHOOL_STATUSES: ReadonlySet<string> = new Set<SchoolStatus>([
		'unverified',
		'pending',
		'verified'
	]);

	// Normalize the stored Alma Mater verification state: an absent value
	// or one outside the known set reads as `'unverified'`. This derived
	// status is only surfaced on the slot when a university affiliation
	// exists (see the `status:` assignment on the university slot below).
	const schoolStatus = $derived<SchoolStatus>(
		nonNullish(profile.schoolStatus) && SCHOOL_STATUSES.has(profile.schoolStatus)
			? (profile.schoolStatus as SchoolStatus)
			: 'unverified'
	);

	const slots = $derived.by<AffilSlot[]>(() => {
		const uniOption = myUni
			? lookupWorldsAffiliation({ kind: 'university', id: myUni.affiliationIdentifier })
			: undefined;
		const countryOption = myCountry
			? lookupWorldsAffiliation({ kind: 'country', id: myCountry.affiliationIdentifier })
			: undefined;

		return [
			{
				key: 'university',
				kind: 'university',
				labelKey: 'profile.dashboard.affiliations.university',
				filled: nonNullish(uniOption),
				value: uniOption?.name ?? null,
				affiliationIdentifier: uniOption?.id ?? null,
				glyph: uniOption?.glyph ?? '+',
				color: uniOption?.color ?? null,
				text: uniOption?.text ?? null,
				status: nonNullish(uniOption) ? schoolStatus : null
			},
			{
				key: 'country',
				kind: 'country',
				labelKey: 'profile.dashboard.affiliations.country',
				filled: nonNullish(countryOption),
				value: nonNullish(countryOption)
					? countryDisplayName({
							code: countryOption.id,
							locale: $localeStore,
							fallback: countryOption.name
						})
					: null,
				affiliationIdentifier: countryOption?.id ?? null,
				glyph: countryOption?.glyph ?? '+',
				color: countryOption?.color ?? null,
				text: countryOption?.text ?? null,
				status: null
			}
		];
	});

	const filledSlotCount = $derived(slots.filter((s) => s.filled).length);

	const handleSlotClick = (slot: AffilSlot) => {
		// From an unverified university slot (Pass-2 on), jump the picker
		// straight to that school's email-verification step.
		pickerVerifyId =
			SCHOOL_PASS2_ENABLED && slot.kind === 'university' && slot.status === 'unverified'
				? slot.affiliationIdentifier
				: null;
		pickerKind = slot.kind;
	};

	/* Avatar editor ---------------------------------------------------- */

	let avatarEditorOpen = $state(false);

	// Seed the editor with the user's saved picks, or, for a user who has
	// never customised, a deterministic face derived from their immutable
	// principal, so the editor opens on the same face the rest of the app
	// already shows them.
	const avatarInitialParts = $derived($myAvatarParts ?? deterministicParts(profile.owner));

	/* Oracle weekly insight: the latest settled call as a record line --- */

	// The newest settled call in the recent window: drives the Oracle's
	// record card: a win reads "You called it: '{q}?'", a loss reads "The
	// market went the other way: '{q}?'". `recentSettlements` is newest-first,
	// so the head is the latest resolution. The market title (the question) is
	// resolved live from the shared `displayMarkets` map so it shows the
	// reader's locale; it falls back to the market id only when the market
	// hasn't loaded.
	const latestSettlement = $derived(recentSettlements.at(0));

	interface OracleRecord {
		win: boolean;
		question: string;
	}

	const oracleRecord = $derived.by<OracleRecord | undefined>(() => {
		if (!isOwnProfile || isNullish(latestSettlement)) {
			return;
		}

		const title =
			$displayMarkets.get(latestSettlement.marketId)?.title ?? latestSettlement.marketId;
		// Drop a trailing "?" so the copy can re-add a single one inside the
		// quotes ("…'{q}?'") regardless of how the title is punctuated.
		const question = title.replace(/\?\s*$/, '');

		return { win: latestSettlement.win, question };
	});

	// Fallback insight string: shown when there is no settled call to surface
	// as a record line (a fresh account, or someone else's profile). Kept lean,
	// no archetype fiction.
	const oracleInsight = $derived.by(() => {
		const trades = totalTrades;
		const acc = Math.round(accuracy);
		const d = dailyStreak;

		if (trades === 0) {
			return t({ locale: $localeStore, key: 'profile.dashboard.oracle.no_calls' });
		}

		if (acc >= 80) {
			return t({
				locale: $localeStore,
				key: 'profile.dashboard.oracle.approves',
				params: { acc, trades }
			});
		}

		if (d >= 7) {
			return t({
				locale: $localeStore,
				key: 'profile.dashboard.oracle.streak_acc',
				params: { days: d, acc }
			});
		}

		if (acc >= 60) {
			return t({
				locale: $localeStore,
				key: 'profile.dashboard.oracle.above',
				params: { acc, trades }
			});
		}

		return t({
			locale: $localeStore,
			key: 'profile.dashboard.oracle.room_sharpen',
			params: { trades, acc }
		});
	});

	/* Achievements: the Menagerie trophy layer ------------------------ */

	// All twelve animals, decorated with each one's live tier + progress and
	// sorted earned-first, plus the load gate: both read from the single shared
	// `menagerie.derived` source the Album route also reads, so a trophy can
	// never show as earned here yet locked there. `myMenagerieLoading` holds the
	// rail in its skeleton state until the rank / referral signals resolve, so a
	// not-yet-loaded rank never flashes as a grey "locked" tile.
	const menagerieRailRows = $derived($myMenagerieRows);

	onMount(() => {
		if (!isOwnProfile) {
			return;
		}

		void (async () => {
			try {
				userStats = await loadMyUserStats(profile.owner);
			} catch (err) {
				console.error('ProfileDashboard: failed to load user_stats', err);
			}
		})();

		// Hydrate the Menagerie's live signals (global standings + referral count)
		// into the shared store the rail derives from. Best-effort: each leg
		// settles independently and leaves its trophy at baseline on failure.
		void loadMyMenagerieSignals();

		// Fetch the viewer's referral code so the hero's "Invite Friends" CTA can
		// build the canonical `/join/{code}` share URL. The code is assigned by the
		// satellite profile hook on first profile create (backfilled on the next
		// save for older accounts), if it's missing the CTA simply hides.
		void (async () => {
			try {
				inviteCode = await getMyReferralCode();
			} catch (_: unknown) {
				// Best-effort: CTA hides if the code can't be resolved.
			} finally {
				inviteCodeLoading = false;
			}
		})();

		void refreshMyAffiliations();
	});
</script>

<div class="profile-dashboard">
	<!-- Full-bleed avatar hero. The avatar scene IS the header: the figure
	     renders with `noBg` on a gradient built from its own backdrop palette,
	     a top scrim keeps the floating controls legible, and a soft bottom fade
	     melts the panel into the page. Tapping the panel opens the avatar
	     editor (own profile only). -->
	<section class="profile-hero">
		<button
			style:background={`linear-gradient(165deg, ${heroPalette.p1} 0%, ${heroPalette.p2} 100%)`}
			class="profile-hero-panel"
			class:is-editable={isOwnProfile}
			aria-label={t({ locale: $localeStore, key: 'profile.dashboard.edit_avatar' })}
			disabled={!isOwnProfile}
			onclick={() => isOwnProfile && (avatarEditorOpen = true)}
			type="button"
		>
			<span class="profile-hero-figure" aria-hidden="true">
				<ViciAvatar
					animate
					decor={false}
					frame={false}
					noBg
					parts={heroParts}
					seed={profile.owner}
					signature={false}
					size={500}
				/>
			</span>
			<!-- Soft bottom fade into the page. Kept short + below the figure so
			     it never clips the bust. -->
			<span class="profile-hero-fade" aria-hidden="true"></span>
			{#if isOwnProfile}
				<span class="profile-hero-edit" aria-hidden="true">
					<Pencil size={12} strokeWidth={1.8} />
					{t({ locale: $localeStore, key: 'profile.dashboard.edit_label' })}
				</span>
			{/if}
		</button>

		<!-- Top scrim so the floating controls read over any backdrop. -->
		<span class="profile-hero-scrim" aria-hidden="true"></span>

		<!-- Floating controls: notification bell + settings (+ admin), on
		     translucent discs. The bell uses its cream variant for contrast. -->
		<div class="profile-hero-controls">
			<span class="profile-hero-disc">
				<NotifBell light />
			</span>
			{#if $userIsAdmin}
				<button
					class="profile-hero-disc profile-hero-disc-btn"
					aria-label={t({ locale: $localeStore, key: 'nav.admin' })}
					onclick={handleOpenAdmin}
					type="button"
				>
					<Shield aria-hidden="true" size={18} strokeWidth={1.7} />
				</button>
			{/if}
			<button
				class="profile-hero-disc profile-hero-disc-btn"
				aria-label={t({ locale: $localeStore, key: 'settings.title' })}
				onclick={handleOpenSettings}
				type="button"
			>
				<Settings aria-hidden="true" size={18} strokeWidth={1.7} />
			</button>
		</div>

		<!-- Editable handle + one credibility line, centered below the figure. -->
		<div class="profile-hero-meta">
			{#if isOwnProfile}
				<button
					class="profile-hero-handle profile-hero-handle-btn"
					aria-label={t({ locale: $localeStore, key: 'profile.handle.edit' })}
					onclick={() => (handleEditOpen = true)}
					type="button"
				>
					<span class="profile-hero-handle-text">@{profile.nickname}</span>
					<Pencil
						class="profile-hero-handle-pencil"
						aria-hidden="true"
						size={15}
						strokeWidth={1.7}
					/>
				</button>
			{:else}
				<h1 class="profile-hero-handle">@{profile.nickname}</h1>
			{/if}

			{#if nonNullish(topPercentLabel)}
				<span class="num profile-hero-credibility">{topPercentLabel}</span>
			{/if}

			{#if isOwnProfile && (inviteCodeLoading || nonNullish(inviteUrl))}
				<button
					class="profile-hero-invite"
					class:profile-hero-invite--pending={inviteCodeLoading}
					disabled={inviteCodeLoading}
					onclick={() => void handleInviteFriends()}
					type="button"
				>
					<Users aria-hidden="true" size={15} strokeWidth={1.8} />
					{t({ locale: $localeStore, key: 'profile.dashboard.invite_friends' })}
				</button>
			{/if}
		</div>
	</section>

	<!-- Affiliations · 2-slot grid (Alma Mater + Citizen) -->
	<section class="profile-affiliations">
		<div class="profile-affiliations-head">
			<span class="profile-affiliations-eyebrow">
				{t({ locale: $localeStore, key: 'profile.dashboard.affiliations.title' })}
			</span>
			<span class="num profile-affiliations-count">
				{t({
					locale: $localeStore,
					key: 'profile.dashboard.affiliations.count',
					params: { count: filledSlotCount, total: slots.length }
				})}
			</span>
		</div>
		<div class="profile-affiliations-grid">
			{#each slots as slot (slot.key)}
				<button
					class="affil-slot"
					class:is-empty={!slot.filled}
					class:is-filled={slot.filled}
					aria-label={slot.filled
						? `${t({ locale: $localeStore, key: slot.labelKey })}: ${slot.value}`
						: t({ locale: $localeStore, key: slot.labelKey })}
					disabled={!isOwnProfile}
					onclick={() => handleSlotClick(slot)}
					type="button"
				>
					<span
						style={affiliationChipStyle({
							color: slot.filled && slot.kind !== 'country' ? (slot.color ?? undefined) : undefined,
							text: slot.text ?? undefined
						})}
						class="affil-slot-icon"
						class:has-brand={slot.filled && slot.kind !== 'country' && nonNullish(slot.color)}
						aria-hidden="true"
					>
						{#if slot.kind === 'country' && nonNullish(slot.affiliationIdentifier)}
							<CountryFlag class="affil-slot-flag" countryCode={slot.affiliationIdentifier} />
						{:else}
							{slot.glyph}
						{/if}
					</span>
					<span class="affil-slot-label">
						{t({ locale: $localeStore, key: slot.labelKey })}
					</span>
					<span class="affil-slot-value" class:dim={!slot.filled}>
						{#if slot.filled}
							{slot.value}
						{:else}
							{t({ locale: $localeStore, key: 'profile.dashboard.affiliations.add' })}
						{/if}
					</span>
					{#if slot.status === 'verified'}
						<span class="affil-slot-badge affil-slot-badge-verified">
							<Check aria-hidden="true" size={9} strokeWidth={3.5} />
							<span class="sr-only">
								{t({
									locale: $localeStore,
									key: 'profile.dashboard.affiliations.status_verified'
								})}
							</span>
						</span>
					{:else if slot.status === 'pending'}
						<span class="affil-slot-badge affil-slot-badge-pending num">
							{t({ locale: $localeStore, key: 'profile.dashboard.affiliations.status_pending' })}
						</span>
					{:else if slot.status === 'unverified'}
						<!-- Unverified Alma Mater. When membership-email verification
						     is live ({@link SCHOOL_PASS2_ENABLED}), surface an
						     actionable "Verify your school →" footnote; the slot is
						     a button, so tapping it opens the picker straight on this
						     school's verify step (see `handleSlotClick`). When the flow
						     is gated off, fall back to a subtle, non-actionable
						     "verification: coming soon" hint (a bare "Unverified" pill
						     on every Alma Mater would read as a defect). Either way it
						     flows in-line as a footnote, too long for the top-right
						     pill slot used by the verified / pending badges. -->
						<span class="affil-slot-hint num" class:affil-slot-cta={SCHOOL_PASS2_ENABLED}>
							{t({
								locale: $localeStore,
								key: SCHOOL_PASS2_ENABLED
									? 'profile.dashboard.affiliations.verify_cta'
									: 'profile.dashboard.affiliations.verify_soon'
							})}
						</span>
					{/if}
				</button>
			{/each}
		</div>
	</section>

	<!-- Achievements: the Menagerie trophy layer. Each animal renders as a
	     squircle badge (the shared `MenagerieBadge`) at its live tier, earned
	     trophies first; "All" opens the full Menagerie album. -->
	<section class="profile-achievements">
		<div class="profile-achievements-head">
			<h2 class="profile-section-title">
				{t({ locale: $localeStore, key: 'profile.dashboard.achievements' })}
			</h2>
			<button
				class="profile-achievements-all"
				onclick={() => goto(resolveAppPath(AppPath.Album))}
				type="button"
			>
				{t({ locale: $localeStore, key: 'profile.dashboard.all' })}
			</button>
		</div>
		<div class="profile-achievements-rail">
			{#if $myMenagerieLoading}
				{#each MENAGERIE as animal (animal.slug)}
					<div class="profile-menagerie-tile is-skeleton">
						<MenagerieBadgeSkeleton size={68} />
						<span class="profile-menagerie-name-skeleton animate-pulse"></span>
						<span class="profile-menagerie-concept-skeleton animate-pulse"></span>
					</div>
				{/each}
			{:else}
				{#each menagerieRailRows as row (row.animal.slug)}
					{@const earned = nonNullish(row.tier)}
					<button
						class="profile-menagerie-tile"
						onclick={() => goto(resolveAppPath(AppPath.Album))}
						type="button"
					>
						<MenagerieBadge size={68} slug={row.animal.slug} tier={row.tier} />
						<span class="profile-menagerie-name">
							{t({ locale: $localeStore, key: row.animal.nameKey })}
						</span>
						{#if earned}
							<span class="profile-menagerie-concept">
								{t({ locale: $localeStore, key: row.animal.conceptKey })}
							</span>
						{:else}
							<span class="profile-menagerie-concept is-locked">
								{t({ locale: $localeStore, key: 'menagerie.locked' })}
							</span>
						{/if}
					</button>
				{/each}
			{/if}
		</div>
	</section>

	<!-- Oracle weekly insight: the latest settled call as a record line. -->
	<ProfileOracleInsight {oracleInsight} record={oracleRecord} />
</div>

{#if nonNullish(pickerKind)}
	<AffiliationPickerModal
		current={{ university: myUni, country: myCountry }}
		initialVerifyId={pickerVerifyId ?? undefined}
		isOpen={true}
		kind={pickerKind}
		onClose={() => {
			pickerKind = null;
			pickerVerifyId = null;
		}}
		onPicked={() => {
			pickerKind = null;
			pickerVerifyId = null;
			void refreshMyAffiliations();
		}}
	/>
{/if}

{#if handleEditOpen}
	<HandleEditor
		current={profile.nickname}
		lastChangeMs={profile.handleLastChangeMs}
		onClose={() => (handleEditOpen = false)}
		onSaved={(handle) => void handleSavedHandle(handle)}
		owner={profile.owner}
	/>
{/if}

{#if nonNullish(profileToast)}
	<div class="profile-toast num" aria-live="polite" role="status">
		{profileToast}
	</div>
{/if}

{#if avatarEditorOpen && isOwnProfile}
	<AvatarEditor
		initial={avatarInitialParts}
		onClose={() => (avatarEditorOpen = false)}
		onSaved={() => (avatarEditorOpen = false)}
	/>
{/if}

<style lang="postcss">
	.profile-dashboard {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 0 1.25rem;
	}

	.profile-section-title {
		margin: 0;
		color: var(--text-base);
		font-size: var(--t-18);
		font-weight: 700;
		letter-spacing: var(--tracking-tight);
	}

	/* Full-bleed avatar hero ------------------------------------------- */
	/* Breaks out of the dashboard's horizontal padding so the avatar scene
	   reaches both edges, then re-insets its meta column. */
	.profile-hero {
		position: relative;
		margin: 0 -1.25rem 0.25rem;
	}

	.profile-hero-panel {
		display: block;
		position: relative;
		width: 100%;
		/* Tall enough to clear the bust figure (≤244px) with headroom above the
		   head, so the avatar reads fully (the figure is bottom-anchored, so the
		   extra height becomes breathing room over the head rather than a bigger
		   bust). */
		height: clamp(272px, 64vw, 304px);
		padding: 0;
		border: 0;
		overflow: hidden;
		cursor: default;
	}

	.profile-hero-panel.is-editable {
		cursor: pointer;
	}

	/* The figure sits at the foot of the panel, oversized so the bust fills
	   the lower-centre and bleeds off the bottom edge. */
	.profile-hero-figure {
		position: absolute;
		bottom: 4%;
		left: 50%;
		width: 64%;
		max-width: 244px;
		aspect-ratio: 1 / 1;
		transform: translateX(-50%);
	}

	.profile-hero-figure :global(.vici-avatar),
	.profile-hero-figure :global(.vici-avatar svg) {
		width: 100% !important;
		height: 100% !important;
	}

	/* Soft fade into the page: short + low so it never clips the bust.
	   Fade from the page colour at *zero alpha*, not bare `transparent`:
	   `transparent` is transparent-black, so over the avatar's coloured
	   backdrop the gradient passed through a muddy grey midtone that read as a
	   faint seam. The relative-colour start keeps the fade in the bg hue; the
	   plain-`transparent` line is the fallback for engines without `rgb(from …)`. */
	.profile-hero-fade {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 14%;
		background: linear-gradient(to bottom, transparent 0%, var(--bg-base) 100%);
		background: linear-gradient(
			to bottom,
			rgb(from var(--bg-base) r g b / 0) 0%,
			var(--bg-base) 100%
		);
		pointer-events: none;
	}

	.profile-hero-edit {
		position: absolute;
		right: 14px;
		bottom: 14px;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 12px;
		border-radius: var(--r-pill);
		border: 1px solid rgba(242, 236, 220, 0.18);
		background: rgba(14, 13, 11, 0.55);
		-webkit-backdrop-filter: blur(8px);
		backdrop-filter: blur(8px);
		color: #f2ecdc;
		font-family: var(--font-mono);
		font-size: var(--t-10);
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
	}

	/* Top scrim keeps the floating controls legible over any backdrop. */
	.profile-hero-scrim {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 96px;
		background: linear-gradient(to bottom, rgba(14, 13, 11, 0.45) 0%, rgba(14, 13, 11, 0) 100%);
		pointer-events: none;
		z-index: 2;
	}

	.profile-hero-controls {
		position: absolute;
		top: 12px;
		right: 12px;
		display: flex;
		align-items: center;
		gap: 8px;
		z-index: 3;
	}

	.profile-hero-disc {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		border: 1px solid rgba(242, 236, 220, 0.16);
		background: rgba(14, 13, 11, 0.45);
		-webkit-backdrop-filter: blur(8px);
		backdrop-filter: blur(8px);
		color: #f2ecdc;
		transition:
			transform 130ms var(--ease-vici, ease),
			filter 160ms var(--ease-vici, ease);
	}

	.profile-hero-disc-btn {
		cursor: pointer;
	}

	.profile-hero-disc:hover {
		filter: brightness(1.18);
	}

	.profile-hero-disc:active {
		transform: scale(0.9);
		filter: brightness(1.28);
	}

	/* The bell renders its own 36px button inside the 40px disc; centre it. */
	.profile-hero-disc :global(.notif-bell) {
		width: 100%;
		height: 100%;
		border-radius: 50%;
	}

	.profile-hero-meta {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 0 1.25rem;
		margin-top: -8px;
	}

	.profile-hero-handle {
		margin: 0;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		max-width: 100%;
		color: var(--text-base);
		font-size: 1.625rem;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	.profile-hero-handle-btn {
		appearance: none;
		border: 0;
		padding: 0;
		background: transparent;
		cursor: pointer;
		font: inherit;
		font-size: 1.625rem;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	.profile-hero-handle-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.profile-hero-handle-btn :global(.profile-hero-handle-pencil) {
		flex-shrink: 0;
		color: var(--fg-faint);
	}

	.profile-hero-handle-btn:hover,
	.profile-hero-handle-btn:hover :global(.profile-hero-handle-pencil) {
		color: var(--color-primary);
	}

	.profile-hero-credibility {
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: var(--t-10);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		white-space: nowrap;
	}

	/* Invite Friends: gold-accent growth CTA. */
	.profile-hero-invite {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		margin-top: 6px;
		padding: 9px 18px;
		border: 1px solid color-mix(in srgb, var(--color-primary) 30%, transparent);
		border-radius: var(--r-pill);
		background: var(--accent-glow, color-mix(in srgb, var(--color-primary) 12%, transparent));
		color: var(--color-primary);
		font-family: var(--font-mono);
		font-size: var(--t-12);
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		white-space: nowrap;
		cursor: pointer;
		transition: border-color var(--d-hover, 140ms) var(--ease-vici, ease);
	}

	.profile-hero-invite:hover:not(:disabled) {
		border-color: color-mix(in srgb, var(--color-primary) 50%, transparent);
	}

	/* Pending: the code is still resolving. The button holds its place from
	   first paint and pulses to read as a skeleton until the share URL lands. */
	.profile-hero-invite--pending {
		cursor: default;
		animation: profile-hero-invite-pulse 1.4s ease-in-out infinite;
	}

	@keyframes profile-hero-invite-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.45;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.profile-hero-invite--pending {
			animation: none;
			opacity: 0.6;
		}
	}

	/* Country-flag SVG inside an affiliation tile: fills the same 1.6rem
	   square as the alphabetic glyph so the row geometry is stable. */
	.profile-dashboard :global(.affil-slot-flag) {
		width: 100%;
		height: 100%;
		border-radius: var(--r-pill);
		object-fit: cover;
	}

	/* Affiliations card ------------------------------------------------ */
	/* Wrapped in its own bordered card surface (border / radius / popover
	   background / card shadow) so the AFFILIATIONS header + 2-slot grid read
	   as a single contained card rather than floating on the page background. */
	.profile-affiliations {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem;
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		background: var(--bg-popover);
		box-shadow: var(--shadow-card);
	}

	.profile-affiliations-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.profile-affiliations-eyebrow {
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: var(--t-10);
		font-weight: 800;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
	}

	.profile-affiliations-count {
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: var(--t-10);
		letter-spacing: 0.1em;
	}

	.profile-affiliations-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
	}

	.affil-slot {
		display: flex;
		position: relative; /* anchor for the .affil-slot-badge pill */
		flex-direction: column;
		gap: 0.375rem;
		min-height: 5.25rem;
		padding: 0.75rem 0.85rem;
		border: 1px solid var(--border-base);
		border-radius: var(--r-8);
		/* Tiles sit one surface step inside the affiliations card (which is
		   `--bg-popover`), so they read as distinct tiles rather than blending
		   into the card. `--bg-surface` is the darker step in every theme. */
		background: var(--bg-surface);
		color: var(--text-base);
		text-align: left;
		cursor: pointer;
		transition:
			background-color var(--d-hover) var(--ease-vici),
			border-color var(--d-hover) var(--ease-vici);
	}

	/* Empty (addable) slots read as dashed outlines on a transparent
	   surface, so they're visually distinct from a filled tile and invite
	   the user to add an affiliation. */
	.affil-slot.is-empty {
		border-style: dashed;
		background: transparent;
	}

	.affil-slot.is-empty:hover {
		border-color: var(--border-strong);
		background: color-mix(in srgb, var(--color-primary) 4%, transparent);
	}

	.affil-slot.is-filled {
		border-color: color-mix(in srgb, var(--laurel) 45%, var(--border-base));
		background: color-mix(in srgb, var(--laurel) 6%, var(--bg-surface));
	}

	.affil-slot:disabled {
		cursor: default;
	}

	.affil-slot-icon {
		display: inline-flex;
		overflow: hidden;
		width: 1.75rem;
		height: 1.75rem;
		align-items: center;
		justify-content: center;
		border-radius: var(--r-pill);
		/* The tile is now `--bg-surface`, so the icon chip uses a faint
		   text-tint overlay (light in dark theme, dark in light/peach) to
		   stay distinct on the tile rather than matching it. */
		background: color-mix(in srgb, var(--text-base) 8%, transparent);
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: var(--t-12);
		font-weight: 700;
	}

	.affil-slot.is-empty .affil-slot-icon {
		font-size: 0.95rem;
	}

	.affil-slot.is-filled .affil-slot-icon {
		background: color-mix(in srgb, var(--laurel) 18%, var(--bg-surface));
		color: var(--laurel);
	}

	/* Brand-tinted slot icon (university with a curated palette): the
	   inline `background`/`color` carry the school's own colour, so the
	   icon just adds the inset highlight that reads on a saturated fill,
	   overriding the laurel stand-in above. */
	.affil-slot.is-filled .affil-slot-icon.has-brand {
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
	}

	.affil-slot-label {
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: 0.6rem;
		font-weight: 800;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
	}

	.affil-slot-value {
		overflow: hidden;
		color: var(--text-base);
		font-size: var(--t-13);
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.affil-slot-value.dim {
		color: var(--text-muted);
		font-weight: 500;
	}

	/* Verification pill on the Alma Mater (university) slot. Pinned to the
	   top-right of the tile. The verified state is a gold tick (matching the
	   established-school badge in the picker); unverified / pending are text
	   pills (blue / amber). */
	.affil-slot-badge {
		display: inline-flex;
		position: absolute;
		top: 0.45rem;
		right: 0.45rem;
		align-items: center;
		justify-content: center;
		gap: 0.15rem;
	}

	.affil-slot-badge-verified {
		width: 1rem;
		height: 1rem;
		border-radius: var(--r-pill);
		background: var(--laurel);
		color: var(--ink, #0e0d0b);
	}

	.affil-slot-badge-pending {
		padding: 0.1rem 0.4rem;
		border-radius: var(--r-pill);
		font-size: var(--t-10);
		font-weight: 600;
		letter-spacing: 0.08em;
		white-space: nowrap;
	}

	/* "Verification: coming soon" hint. Deliberately quiet and
	   theme-adaptive (neutral muted text, no chrome) so it
	   reads as a passive promise rather than the actionable / attention-
	   seeking pill the verified (gold) and pending (amber) states use.
	   Too long to pin to the corner like those pills, so it flows in-line at
	   the bottom of the slot (`margin-top: auto`) and stays within the tile's
	   width. No live control hangs off it; the verify flow is gated off
	   until the membership-email pass ships. */
	.affil-slot-hint {
		margin-top: auto;
		max-width: 100%;
		color: var(--text-muted);
		font-size: var(--t-10);
		font-weight: 600;
		letter-spacing: 0.02em;
		line-height: 1.25;
		opacity: 0.85;
	}

	/* When membership-email verification is live, the footnote is an
	   actionable CTA (the slot opens the picker on its verify step), so it
	   reads with the accent colour + full opacity instead of the passive
	   muted hint. */
	.affil-slot-hint.affil-slot-cta {
		color: var(--color-primary);
		opacity: 1;
	}

	.affil-slot-badge-pending {
		/* Amber "awaiting verification": distinct from the gold accent
		   (verified) and the blue unverified pill. */
		color: #d8a23a;
		background: color-mix(in srgb, #d8a23a 12%, transparent);
		border: 1px solid color-mix(in srgb, #d8a23a 35%, transparent);
	}

	/* Achievements rail ----------------------------------------------- */
	.profile-achievements-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.625rem;
	}

	.profile-achievements-all {
		border: 0;
		background: transparent;
		color: var(--color-primary);
		font-family: var(--font-mono);
		font-size: 0.65rem;
		font-weight: 800;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
		cursor: pointer;
	}

	.profile-achievements-rail {
		display: flex;
		gap: 0.625rem;
		overflow-x: auto;
		padding-bottom: 0.5rem;
		scroll-snap-type: x mandatory;
		-webkit-overflow-scrolling: touch;
		scrollbar-width: none;
	}

	.profile-achievements-rail::-webkit-scrollbar {
		display: none;
	}

	/* Menagerie tile: a squircle badge with the animal name + its concept /
	   "Locked" line, centred in a fixed-width carousel card. Tapping opens the
	   Menagerie album. */
	.profile-menagerie-tile {
		display: flex;
		flex: 0 0 8.25rem;
		flex-direction: column;
		align-items: center;
		gap: 0;
		padding: 0.875rem;
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		background: var(--bg-popover);
		color: inherit;
		text-align: center;
		scroll-snap-align: start;
		cursor: pointer;
		font: inherit;
	}

	.profile-menagerie-name {
		margin-top: 0.75rem;
		color: var(--text-base);
		font-size: var(--t-13);
		font-weight: 600;
	}

	.profile-menagerie-concept {
		margin-top: 0.1875rem;
		color: var(--color-primary);
		font-family: var(--font-mono);
		font-size: var(--t-10);
		letter-spacing: 0.06em;
	}

	.profile-menagerie-concept.is-locked {
		color: var(--text-muted);
	}

	/* Skeleton tile: same footprint as a real tile, with the badge + the two
	   text lines replaced by pulsing placeholders while the trophy signals load. */
	.profile-menagerie-tile.is-skeleton {
		cursor: default;
	}

	.profile-menagerie-name-skeleton {
		width: 4.5rem;
		height: 0.8125rem;
		margin-top: 0.75rem;
		border-radius: var(--r-pill);
		background: color-mix(in srgb, var(--text-base) 12%, transparent);
	}

	.profile-menagerie-concept-skeleton {
		width: 3rem;
		height: 0.625rem;
		margin-top: 0.375rem;
		border-radius: var(--r-pill);
		background: color-mix(in srgb, var(--text-base) 8%, transparent);
	}

	/* Confirmation toast: floats above the pill-nav after a handle
	   change, auto-dismisses after ~1.9s. */
	.profile-toast {
		position: fixed;
		bottom: calc(120px + env(safe-area-inset-bottom, 0px));
		left: 50%;
		z-index: 110;
		padding: 0.625rem 1rem;
		border: 1px solid var(--border-base);
		border-radius: var(--r-pill);
		background: var(--bg-popover);
		color: var(--text-base);
		font-family: var(--font-mono);
		font-size: var(--t-10);
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
		box-shadow: 0 12px 32px -12px rgba(0, 0, 0, 0.5);
		transform: translateX(-50%);
		animation: profile-toast-rise var(--d-state, 200ms) ease-out both;
	}

	@keyframes profile-toast-rise {
		from {
			opacity: 0;
			transform: translate(-50%, 8px);
		}
		to {
			opacity: 1;
			transform: translate(-50%, 0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.profile-toast {
			animation: none;
		}

		.profile-hero-disc,
		.profile-hero-invite {
			transition: none;
		}

		.profile-hero-disc:active {
			transform: none;
		}
	}
</style>
