<script lang="ts">
	import Avatar from '#lib/components/profile/Avatar.svelte';
	import BaseButton from '#lib/components/ui/BaseButton.svelte';
	import BottomSheet from '#lib/components/ui/BottomSheet.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { UserProfile } from '#lib/types/profile.ts';
	import { shortenWithMiddleEllipsis } from '#lib/utils/format.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	/**
	 * Friend mini-profile bottom sheet: opens on a ranked-row tap from
	 * {@link FriendsTab}. Surfaces the friend's accuracy / streak / VXP
	 * stats, the head-to-head accuracy delta, and a Remove action. Chrome
	 * (scrim, grip, safe-area inset, Escape, focus-trap, pill-nav hide)
	 * comes from the shared {@link BottomSheet} primitive; this component
	 * owns only the sheet body.
	 *
	 * The host passes formatted display values (accuracy / streak / VXP /
	 * the h2h delta) and the friend identity rather than raw model rows;
	 * the formatters live in `FriendsTab` alongside the rank list so both
	 * surfaces stay in lockstep.
	 */
	interface Props {
		isOpen: boolean;
		profile: UserProfile | undefined;
		friendId: string;
		accuracyValue: string;
		/** Consecutive active days (the Flame engine): rendered as `{n}d`. */
		dailyStreak: number;
		vxpValue: string;
		h2hAhead: boolean;
		h2hValue: string;
		removing: boolean;
		onRemove: () => void;
		onClose: () => void;
	}

	const {
		isOpen,
		profile,
		friendId,
		accuracyValue,
		dailyStreak,
		vxpValue,
		h2hAhead,
		h2hValue,
		removing,
		onRemove,
		onClose
	}: Props = $props();
</script>

<BottomSheet {isOpen} {onClose}>
	<div class="friends-sheet-head">
		<span class="friends-sheet-avatar">
			<Avatar
				class="h-full w-full"
				avatar={profile?.avatar}
				avatarParts={profile?.avatarParts}
				nickname={profile?.nickname}
				owner={profile?.owner ?? friendId}
			/>
		</span>
		<div class="friends-sheet-head-copy">
			<span class="friends-sheet-name">
				@{profile?.nickname ?? t({ locale: $localeStore, key: 'arena.friends.unknown_nickname' })}
			</span>
			<span class="num friends-sheet-sub">
				{shortenWithMiddleEllipsis({ text: friendId, splitLength: 6 })}
			</span>
		</div>
	</div>

	<div class="friends-sheet-stats">
		<div class="friends-sheet-stat">
			<span class="friends-sheet-lbl">
				{t({ locale: $localeStore, key: 'arena.friends.sheet.accuracy' })}
			</span>
			<span class="friends-sheet-val num">{accuracyValue}</span>
		</div>
		<div class="friends-sheet-stat">
			<span class="friends-sheet-lbl">
				{t({ locale: $localeStore, key: 'arena.friends.sheet.streak' })}
			</span>
			<span class="friends-sheet-val num">{dailyStreak}d</span>
		</div>
		<div class="friends-sheet-stat">
			<span class="friends-sheet-lbl">
				{t({ locale: $localeStore, key: 'arena.friends.sheet.vxp' })}
			</span>
			<span class="friends-sheet-val num">{vxpValue}</span>
		</div>
	</div>

	<div class="friends-sheet-h2h" class:is-ahead={h2hAhead} class:is-behind={!h2hAhead}>
		<span class="friends-sheet-lbl">
			{t({ locale: $localeStore, key: 'arena.friends.sheet.h2h' })}
		</span>
		<span class="friends-sheet-val num">
			{h2hAhead
				? t({
						locale: $localeStore,
						key: 'arena.friends.sheet.h2h_ahead',
						params: { delta: h2hValue.replace('+', '') }
					})
				: t({
						locale: $localeStore,
						key: 'arena.friends.sheet.h2h_behind',
						params: { delta: h2hValue.replace('-', '') }
					})}
		</span>
	</div>

	<BaseButton
		class="friends-sheet-remove"
		onclick={onRemove}
		status={removing ? 'pending' : 'enabled'}
	>
		{t({ locale: $localeStore, key: 'arena.friends.sheet.remove' })}
	</BaseButton>
	<BaseButton class="friends-sheet-close" onclick={onClose}>
		{t({ locale: $localeStore, key: 'arena.friends.sheet.close' })}
	</BaseButton>
</BottomSheet>

<style lang="postcss">
	.friends-sheet-head {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.25rem 0 0.85rem;
	}

	.friends-sheet-avatar {
		display: inline-flex;
		overflow: hidden;
		width: 3rem;
		height: 3rem;
		flex-shrink: 0;
		border-radius: var(--r-pill);
		background: var(--bg-surface);
	}

	.friends-sheet-head-copy {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.15rem;
	}

	.friends-sheet-name {
		color: var(--text-base);
		font-size: var(--t-16);
		font-weight: 700;
	}

	.friends-sheet-sub {
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: var(--t-10);
		font-weight: 800;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
	}

	/* Open-column stats: label over value, no per-tile box. The block is
	   bracketed by a top + bottom divider rule so the three columns read as
	   one editorial band rather than three cards. */
	.friends-sheet-stats {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.5rem;
		padding: 0.75rem 0;
		border-top: 1px solid var(--border-base);
		border-bottom: 1px solid var(--border-base);
	}

	.friends-sheet-stat {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		text-align: center;
	}

	.friends-sheet-lbl {
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: 0.6rem;
		font-weight: 800;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
	}

	.friends-sheet-val {
		color: var(--text-base);
		font-family: var(--font-mono);
		font-size: var(--t-16);
		font-weight: 700;
	}

	/* Head-to-head reads as a single open row: label left, delta right,
	   sharing the open-column register of the stats band above (no box). */
	.friends-sheet-h2h {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.85rem 0 0.25rem;
		margin-bottom: 0.6rem;
	}

	.friends-sheet-h2h .friends-sheet-val {
		font-size: var(--t-13);
	}

	.friends-sheet-h2h.is-ahead .friends-sheet-val {
		color: var(--yes);
	}

	.friends-sheet-h2h.is-behind .friends-sheet-val {
		color: var(--no);
	}

	/* Shared `.friends-sheet-remove` / `-close` button styles live in
	   app.css (used by both friends sheets). */
</style>
