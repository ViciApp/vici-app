<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import { Check, ChevronRight } from '@lucide/svelte/icons';
	import Avatar from '#lib/components/profile/Avatar.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import NestedButton from '#lib/components/ui/NestedButton.svelte';
	import { track } from '#lib/services/analytics.services.ts';
	import { buildLeagueShareUrl } from '#lib/services/leagues.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { notificationsStore } from '#lib/stores/notification.store.ts';
	import { profilesStore } from '#lib/stores/profiles.store.ts';
	import type { LeagueMemberRole } from '#lib/types/league-member.ts';
	import { leagueEmblem, type LeagueDoc } from '#lib/types/league.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	/**
	 * Single row in the Leagues list. Renders the gradient logo
	 * tile, the league name + role chip, a member-count meta line
	 * (with an optional ▲/▼ "{N} this week" rank-trend), an optional
	 * friend-overlap row, and a trailing column carrying the caller's
	 * "#rank of M" badge (or a chevron when no rank) above an inline
	 * copy-invite pill.
	 *
	 * The card itself is a `<button>` that routes to the league
	 * detail page; the copy pill is a nested button that stops
	 * propagation so the row click + copy gesture don't fight.
	 */
	interface FriendOverlap {
		/** The first friend's handle (no leading `@`). */
		handle: string;
		/** Total friends in this league, ≥1. */
		count: number;
		/** Principals of the overlapping friends: drives the stacked
		 *  avatar cluster (first three rendered). */
		principals: string[];
	}

	interface Props {
		league: LeagueDoc;
		/** Caller's role. `undefined` for recommendation cards (caller
		 *  is not a member). */
		role?: LeagueMemberRole;
		/** Total members in this league. */
		memberCount: number;
		/** Friend-overlap summary, or `undefined` when no friends
		 *  are in this league. */
		friendOverlap?: FriendOverlap;
		/** Caller's 1-indexed rank inside this league. Hidden when
		 *  undefined (e.g. recommendation cards). */
		yourRank?: number;
		/** Signed rank-trend vs the prior period: negative = climbed
		 *  (shown green ▲), positive = slipped (shown red ▼), 0 = flat
		 *  (hidden). */
		trend?: number;
		/** Marks this card as a recommendation (friends are in, you
		 *  are not). Swaps the role chip for a `REQUEST` chip and
		 *  hides the copy pill. */
		isRecommendation?: boolean;
		/** Count of incoming, not-yet-accepted battle challenges where
		 *  this league is the challenged side. Surfaces a chip so the
		 *  owner sees a pending challenge without opening the league. */
		incomingChallengeCount?: number;
		/** Click handler: opens the league detail page (or join
		 *  flow for recommendations). */
		onclick: () => void;
	}

	const {
		league,
		role,
		memberCount,
		friendOverlap,
		yourRank,
		trend = 0,
		isRecommendation = false,
		incomingChallengeCount = 0,
		onclick
	}: Props = $props();

	const challengeLabel = $derived.by(() => {
		if (incomingChallengeCount <= 0) {
			return;
		}

		return t({
			locale: $localeStore,
			key:
				incomingChallengeCount === 1
					? 'leagues.card.incoming_battle_one'
					: 'leagues.card.incoming_battle_many',
			params: { count: incomingChallengeCount }
		});
	});

	// First three overlapping friends, resolved against the shared
	// profile cache so the stacked cluster shows real avatars.
	const overlapAvatars = $derived.by(() =>
		(friendOverlap?.principals ?? []).slice(0, 3).map((principal) => {
			const profile = $profilesStore.get(principal);

			return {
				principal,
				avatar: profile?.avatar ?? null,
				avatarParts: profile?.avatarParts ?? null,
				nickname: profile?.nickname ?? null
			};
		})
	);

	let copied = $state(false);

	/**
	 * The emblem rendered inside the gradient tile; the owner's stored
	 * pick, with a name-derived 1-char fallback for legacy rows written
	 * before the picker shipped.
	 */
	const emblem = $derived(leagueEmblem(league));

	const accent = $derived(league.accentColor ?? '#7e9b6a');

	const roleLabel = $derived.by(() => {
		if (!role) {
			return;
		}

		const key =
			role === 'owner'
				? 'leagues.role.owner'
				: role === 'admin'
					? 'leagues.role.admin'
					: 'leagues.role.member';

		return t({ locale: $localeStore, key });
	});

	const memberCountLabel = $derived(
		t({
			locale: $localeStore,
			key: memberCount === 1 ? 'leagues.card.member_count_one' : 'leagues.card.member_count_many',
			params: { count: memberCount }
		})
	);

	// The handle is rendered as a separate emphasised span; the suffix
	// covers the "+ N friends" tail. For a single friend the suffix is
	// empty: `<b>@handle</b>` stands on its own.
	const friendOverlapSuffix = $derived.by(() => {
		if (!friendOverlap || friendOverlap.count <= 1) {
			return;
		}

		const others = friendOverlap.count - 1;

		return t({
			locale: $localeStore,
			key:
				others === 1
					? 'leagues.card.friend_overlap_suffix_one'
					: 'leagues.card.friend_overlap_suffix_many',
			params: { count: others }
		});
	});

	const handleCopy = async () => {
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
			}, 1500);
		} catch (err) {
			console.error('LeagueListCard: clipboard write failed', err);
			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'common.error.generic' }),
				message: '',
				type: 'error'
			});
		}
	};
</script>

<button
	style:--accent={accent}
	style:--accent-grad={`linear-gradient(160deg, ${accent}33 0%, ${accent}11 40%, rgba(20, 18, 15, 0.95) 100%)`}
	class="league-list-card"
	class:is-recommendation={isRecommendation}
	{onclick}
	type="button"
>
	<span class="league-logo" class:has-image={league.imageUrl} aria-hidden="true">
		{#if league.imageUrl}
			<img class="logo-image" alt="" src={league.imageUrl} />
		{:else}
			<span class="emblem">{emblem}</span>
		{/if}
	</span>

	<span class="body">
		<span class="head">
			<span class="name">{league.name}</span>
			{#if isRecommendation}
				<Badge size="xs" variant="success">
					{t({ locale: $localeStore, key: 'leagues.card.recommend_chip' })}
				</Badge>
			{:else if roleLabel && role !== 'member'}
				<Badge size="xs" variant="warning">{roleLabel}</Badge>
			{/if}
			{#if challengeLabel}
				<Badge size="xs" variant="danger">{challengeLabel}</Badge>
			{/if}
		</span>

		<span class="meta num">
			{memberCountLabel}
			{#if trend !== 0}
				<span class="meta-trend" class:is-down={trend > 0} class:is-up={trend < 0}>
					{trend < 0 ? '▲' : '▼'}
					{t({
						locale: $localeStore,
						key: 'leagues.card.trend_this_week',
						params: { count: Math.abs(trend) }
					})}
				</span>
			{/if}
		</span>

		{#if friendOverlap}
			<span class="friend-overlap">
				<span class="friend-avatars" aria-hidden="true">
					{#each overlapAvatars as friend, i (friend.principal)}
						<span style:--i={i} class="friend-avatar">
							<Avatar
								class="friend-avatar-img"
								avatar={friend.avatar}
								avatarParts={friend.avatarParts}
								nickname={friend.nickname}
								owner={friend.principal}
							/>
						</span>
					{/each}
				</span>
				<span class="friend-overlap-text num">
					<b class="friend-overlap-handle">{friendOverlap.handle}</b>
					{#if friendOverlapSuffix}
						<span class="friend-overlap-suffix">{friendOverlapSuffix}</span>
					{/if}
				</span>
			</span>
		{/if}
	</span>

	<span class="trailing">
		{#if nonNullish(yourRank)}
			<span class="rank-badge">
				<span class="rank-v num">#{yourRank}</span>
				<span class="rank-of num">
					{t({
						locale: $localeStore,
						key: 'leagues.card.rank_of',
						params: { count: memberCount }
					})}
				</span>
			</span>
		{:else}
			<ChevronRight aria-hidden="true" size={16} strokeWidth={1.6} />
		{/if}
		{#if !isRecommendation}
			<NestedButton
				class="copy-pill {copied ? 'is-copied' : ''}"
				label={t({
					locale: $localeStore,
					key: copied ? 'leagues.card.copy_done' : 'leagues.card.copy'
				})}
				onclick={() => void handleCopy()}
			>
				{#if copied}
					<Check aria-hidden="true" size={11} strokeWidth={2.4} />
					{t({ locale: $localeStore, key: 'leagues.card.copy_done' })}
				{:else}
					{t({ locale: $localeStore, key: 'leagues.card.copy' })}
				{/if}
			</NestedButton>
		{/if}
	</span>
</button>

<style lang="postcss">
	/* 3-col grid (56 px icon · 1fr body · auto trailing meta column)
	   with the same 56-px tile dimensions as the Create / Join CTA
	   tiles so the leagues list reads as a single uniform column
	   regardless of whether the row is a real league or a CTA. 12 px
	   radius + raised surface + a -1 px hover lift mark interactive
	   rows. */
	.league-list-card {
		display: grid;
		grid-template-columns: 56px 1fr auto;
		gap: 12px;
		align-items: center;
		width: 100%;
		padding: 14px;
		font: inherit;
		text-align: left;
		color: var(--text-base);
		background: var(--bg-surface);
		border: 1px solid var(--border-base);
		border-radius: 12px;
		cursor: pointer;
		transition:
			background-color 180ms var(--ease-vici),
			border-color 180ms var(--ease-vici),
			transform 100ms var(--ease-vici);
	}

	.league-list-card:hover {
		background: var(--bg-popover);
		border-color: var(--border-strong);
		transform: translateY(-1px);
	}

	.league-list-card.is-recommendation {
		border-style: dashed;
		opacity: 0.85;
	}

	/* 56 px square, 10 px radius, per-league-accent-tinted gradient +
	   30 % accent border. The diagonal sheen pseudo adds a soft gloss
	   so a flat colour fill doesn't read as a placeholder; the serif-
	   italic emblem sits above the sheen at z-index 2 so the gloss
	   never washes it out. */
	.league-logo {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 56px;
		height: 56px;
		border-radius: 10px;
		border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
		background: var(--accent-grad);
		overflow: hidden;
	}

	/* Owner-uploaded cover fills the tile; the accent gradient + sheen
	   are hidden behind it so only the photo shows. */
	.logo-image {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.league-logo.has-image::before {
		display: none;
	}

	.league-logo::before {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(
			120deg,
			transparent 35%,
			rgba(242, 236, 220, 0.1) 50%,
			transparent 65%
		);
		border-radius: inherit;
		pointer-events: none;
	}

	.league-logo .emblem {
		position: relative;
		z-index: 2;
		font-family: var(--font-serif, var(--font-display, serif));
		font-style: italic;
		font-size: 24px;
		font-weight: 500;
		color: var(--accent);
		line-height: 1;
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}

	.head {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.name {
		font-size: 15px;
		font-weight: 600;
		letter-spacing: -0.005em;
		color: var(--text-base);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}

	.meta {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 10.5px;
		color: var(--text-muted);
		letter-spacing: var(--tracking-wide);
	}

	.meta-trend {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		font-size: var(--t-10);
		font-weight: 700;
	}

	.meta-trend.is-up {
		color: var(--yes);
	}

	.meta-trend.is-down {
		color: var(--no);
	}

	.friend-overlap {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 2px;
	}

	.friend-avatars {
		display: flex;
		align-items: center;
	}

	.friend-avatar {
		display: inline-flex;
		margin-left: -6px;
		border-radius: 50%;
		outline: 1.5px solid var(--bg-surface);
		transition: outline-color 180ms var(--ease-vici);
	}

	.league-list-card:hover .friend-avatar {
		outline-color: var(--bg-popover);
	}

	.friend-avatar:first-child {
		margin-left: 0;
	}

	:global(.friend-avatar-img) {
		width: 1rem;
		height: 1rem;
	}

	.friend-overlap-text {
		font-size: var(--t-10);
		color: var(--text-muted);
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.friend-overlap-handle {
		color: var(--laurel);
		font-weight: 700;
	}

	.friend-overlap-suffix {
		margin-left: 0.2rem;
	}

	/* Trailing column · rank badge (or chevron) pinned to the top edge,
	   copy pill to the bottom, stretched to the card height so the badge
	   sits flush with the league name and the pill with the meta line. */
	.trailing {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		justify-content: space-between;
		align-self: stretch;
		gap: 8px;
		flex-shrink: 0;
		color: var(--text-muted);
	}

	/* "#rank / of M" stacked badge; the caller's standing within the
	   league, right-aligned and mono so the figures read as a scoreline. */
	.rank-badge {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		line-height: 1;
	}

	.rank-v {
		font-size: 22px;
		font-weight: 700;
		letter-spacing: -0.02em;
		color: var(--text-base);
	}

	.rank-of {
		margin-top: 3px;
		font-size: 9px;
		letter-spacing: 0.04em;
		color: var(--text-muted);
	}

	/* Tiny laurel-tinted chip in mono with a 4 px radius.
	   `--laurel` (NOT `--accent`) for the same reason as `.role-chip`
	   above: the outer button overrides `--accent` to the league's
	   per-card colour for the logo tile gradient, and a bare
	   `var(--accent)` here would tint the copy pill with that per-
	   league colour instead of the global laurel. */
	/* The pill renders inside the shared `NestedButton`, so it's a child-
	   component element; scope the styles under `.trailing` and reach it with
	   `:global(...)` (effectively local; they only match inside this card). */
	.trailing :global(.copy-pill) {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		padding: 3px 6px;
		border-radius: var(--r-4);
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: var(--laurel);
		background: rgba(226, 184, 66, 0.06);
		border: 1px solid rgba(226, 184, 66, 0.22);
		cursor: pointer;
		user-select: none;
		transition: background-color 160ms var(--ease-vici);
	}

	.trailing :global(.copy-pill:hover) {
		background: rgba(226, 184, 66, 0.14);
	}

	.trailing :global(.copy-pill.is-copied) {
		color: var(--laurel);
	}
</style>
