<script lang="ts">
	import type { PrincipalText } from '@junobuild/schema';
	import Avatar from '#lib/components/profile/Avatar.svelte';
	import YouBadge from '#lib/components/ui/YouBadge.svelte';

	/**
	 * A single row in the Arena → Friends ranked list. Purely
	 * presentational: the parent (`FriendsTab`) resolves every label
	 * (rank, display name, accuracy, h2h delta, VXP balance) and passes
	 * it in as a string, so the shared formatters and the `RankedFriend`
	 * type stay in one place.
	 *
	 * Two variants share the same three lead columns (rank · avatar ·
	 * name/meta) and differ only on the right edge and interactivity:
	 *  - `friend`: a tappable `<button>` opening the mini-profile sheet,
	 *    trailed by the head-to-head accuracy delta chip.
	 *  - `you`: a static `<div>` (the sticky YOU row) trailed by the
	 *    viewer's VXP balance.
	 *
	 * The `<li>` wrapper and the scroll/divider chrome stay in the
	 * parent's `.ranked-list` so the `li + li` separators and the sticky
	 * YOU row keep working without cross-component style scoping.
	 */
	interface Props {
		variant: 'friend' | 'you';
		/** Rank index (`01`, `02`, …); for the `you` row, the viewer's own standing. */
		numLabel: string;
		avatar: string | null | undefined;
		/** Serialized faceted-avatar picks of `owner` (see `Avatar`). */
		avatarParts?: string | null;
		nickname: string | null | undefined;
		owner: PrincipalText;
		/** Resolved `@`-less display name (nickname with fallback applied). */
		displayName: string;
		/** Pre-formatted accuracy, e.g. `48.4%`. */
		accuracyLabel: string;
		/** Consecutive active days (the Flame engine) — rendered as `{n}d`. */
		dailyStreak: number;
		/** friend only — opens the mini-profile sheet. */
		onOpen?: () => void;
		/** friend only — head-to-head accuracy delta, e.g. `+12.3`. */
		h2hValue?: string;
		/** friend only — whether the viewer is ahead (tints the chip). */
		h2hAhead?: boolean;
		/** you only — pre-formatted VXP balance. */
		vxpLabel?: string;
	}

	const {
		variant,
		numLabel,
		avatar,
		avatarParts,
		nickname,
		owner,
		displayName,
		accuracyLabel,
		dailyStreak,
		onOpen,
		h2hValue,
		h2hAhead = false,
		vxpLabel
	}: Props = $props();
</script>

{#snippet lead()}
	<span class="num ranked-num" class:is-you={variant === 'you'}>{numLabel}</span>
	<span class="ranked-avatar">
		<Avatar class="h-full w-full" {avatar} {avatarParts} {nickname} {owner} />
	</span>
	<span class="ranked-copy">
		<span class="ranked-name-row">
			<span class="ranked-name" class:ranked-name-you={variant === 'you'}>
				@{displayName}
			</span>
			{#if variant === 'you'}
				<YouBadge />
			{/if}
		</span>
		<span class="num ranked-meta">
			{accuracyLabel} · {dailyStreak}d
		</span>
	</span>
{/snippet}

{#if variant === 'you'}
	<div class="ranked-row ranked-row-you">
		{@render lead()}
		<span class="num ranked-h2h-you">{vxpLabel}</span>
	</div>
{:else}
	<button class="ranked-row" onclick={onOpen} type="button">
		{@render lead()}
		<span class="ranked-h2h num" class:is-ahead={h2hAhead} class:is-behind={!h2hAhead}>
			{h2hValue}
		</span>
	</button>
{/if}

<style lang="postcss">
	.ranked-row {
		display: grid;
		grid-template-columns: auto auto minmax(0, 1fr) auto;
		gap: 0.65rem;
		align-items: center;
		width: 100%;
		padding: 0.7rem 0.85rem;
		border: 0;
		background: transparent;
		text-align: left;
		cursor: pointer;
		transition: background 140ms ease;
	}

	.ranked-row:hover {
		background: color-mix(in srgb, var(--text-base) 3%, transparent);
	}

	.ranked-row-you {
		background: color-mix(in srgb, var(--color-primary) 10%, var(--bg-popover));
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		box-shadow: 0 0 16px -6px rgba(0, 0, 0, 0.3);
		cursor: default;
	}

	.ranked-row-you:hover {
		background: color-mix(in srgb, var(--color-primary) 10%, var(--bg-popover));
	}

	/* Rank index — centered in a fixed-width column so 01/02/… and the
	   YOU label align under one another. */
	.ranked-num {
		min-width: 26px;
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: var(--t-12);
		font-weight: 800;
		letter-spacing: var(--tracking-wide);
		text-align: center;
	}

	.ranked-num.is-you {
		color: var(--color-primary);
	}

	.ranked-avatar {
		display: inline-flex;
		overflow: hidden;
		width: 2rem;
		height: 2rem;
		flex-shrink: 0;
		border-radius: var(--r-pill);
		background: var(--bg-popover);
	}

	.ranked-copy {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.1rem;
	}

	.ranked-name-row {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 0.4rem;
	}

	.ranked-name {
		min-width: 0;
		overflow: hidden;
		color: var(--text-base);
		font-size: var(--t-13);
		font-weight: 700;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.ranked-name-you {
		color: var(--color-primary);
	}

	.ranked-meta {
		color: var(--text-muted);
		font-size: var(--t-12);
	}

	/* Head-to-head accuracy delta chip — centered with a min-width so
	   single- and double-digit deltas line up in a column, and a 1px
	   tinted border on both the ahead and behind variants. */
	.ranked-h2h {
		min-width: 42px;
		padding: 0.2rem 0.5rem;
		border: 1px solid transparent;
		border-radius: var(--r-pill);
		font-size: var(--t-12);
		font-weight: 700;
		text-align: center;
	}

	.ranked-h2h.is-ahead {
		background: var(--yes-wash, color-mix(in srgb, var(--yes) 16%, transparent));
		border-color: color-mix(in srgb, var(--yes) 25%, transparent);
		color: var(--yes);
	}

	.ranked-h2h.is-behind {
		background: color-mix(in srgb, var(--no) 14%, transparent);
		border-color: color-mix(in srgb, var(--no) 22%, transparent);
		color: var(--no);
	}

	.ranked-h2h-you {
		color: var(--color-primary);
		font-size: var(--t-13);
		font-weight: 700;
	}
</style>
