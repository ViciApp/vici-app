<script lang="ts">
	import type { PrincipalText } from '@junobuild/schema';
	import { Pencil } from '@lucide/svelte/icons';
	import ViciAvatar from '#lib/components/ui/ViciAvatar.svelte';
	import { myAvatarParts } from '#lib/stores/avatar.store.ts';
	import { hasUploadedAvatar, resolveAvatarUrl } from '#lib/utils/avatar.utils.ts';
	import { parseParts } from '#lib/utils/vici-avatar.utils.ts';

	interface Props {
		avatar?: string | null;
		/** The owner's serialized faceted-avatar picks (`profile.avatarParts`).
		 *  Pass it on every surface that shows someone ELSE so their saved face
		 *  renders instead of the principal-seeded fallback. Empty / absent /
		 *  malformed falls back to the seeded face. Ignored when `self`; "you"
		 *  surfaces read the live picks from {@link myAvatarParts}. */
		avatarParts?: string | null;
		owner: PrincipalText;
		nickname?: string | null;
		/** When true, render the logged-in user's saved faceted avatar (the
		 *  picks from {@link myAvatarParts}) rather than a face seeded by
		 *  `owner`. Set this on every surface that shows "you" so a save in
		 *  the editor re-renders them all. */
		self?: boolean;
		/** When true, overlay a gold pencil badge marking the avatar as
		 *  editable. Purely a visual affordance: the surrounding surface owns
		 *  the click target. */
		editable?: boolean;
		/** Allow idle motion (blink + bob), always re-gated behind
		 *  `prefers-reduced-motion` inside `ViciAvatar`. */
		animate?: boolean;
		class?: string;
	}

	const {
		avatar,
		avatarParts,
		owner,
		nickname,
		self = false,
		editable = false,
		animate = false,
		class: className = ''
	}: Props = $props();

	// Real uploads win over generated faces, for everyone, "you" included.
	const isUploaded = $derived(hasUploadedAvatar(avatar));

	// "You" surfaces render the user's saved picks (live, so a save in the
	// editor re-renders here); everyone else renders the owner's saved picks
	// when the surface carries them, falling back to a face seeded by their
	// immutable principal (`owner`), never the nickname, which can change.
	const parts = $derived(self ? ($myAvatarParts ?? null) : (parseParts(avatarParts) ?? null));
</script>

<div class="avatar-frame overflow-hidden rounded-full {className}" class:is-editable={editable}>
	{#if isUploaded}
		<img
			class="h-full w-full object-cover"
			alt={nickname ?? 'Avatar'}
			referrerpolicy="no-referrer"
			src={resolveAvatarUrl({ avatar, owner })}
		/>
	{:else}
		<!-- Generated face. For "you", the saved parts; otherwise seeded by
			 the principal. The decorative SVG is aria-hidden inside
			 ViciAvatar; this wrapper carries the named-user semantics so the
			 avatar stays announced. -->
		<span class="vici-avatar-fill h-full w-full" aria-label={nickname ?? 'Avatar'} role="img">
			<ViciAvatar {animate} {parts} seed={owner} />
		</span>
	{/if}

	{#if editable}
		<span class="avatar-edit-badge" aria-hidden="true">
			<Pencil aria-hidden="true" size={12} strokeWidth={2.4} />
		</span>
	{/if}
</div>

<style lang="postcss">
	.avatar-frame {
		position: relative;
		display: block;
	}

	.vici-avatar-fill {
		display: block;
	}

	/* The generated face is sized by the caller's wrapper, not its own
		 pixel `size` prop, so it matches the uploaded `<img>` exactly. */
	.vici-avatar-fill :global(.vici-avatar) {
		width: 100% !important;
		height: 100% !important;
	}

	.vici-avatar-fill :global(.vici-avatar svg) {
		width: 100%;
		height: 100%;
	}

	/* Gold pencil badge: marks the avatar as editable. Bottom-right,
		 overlapping the rim, in the brand accent. */
	.avatar-edit-badge {
		position: absolute;
		right: -1px;
		bottom: -1px;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 34%;
		min-width: 18px;
		max-width: 26px;
		aspect-ratio: 1 / 1;
		border-radius: 50%;
		background: var(--brand);
		color: var(--color-primary-foreground);
		box-shadow:
			0 1px 4px rgba(0, 0, 0, 0.45),
			0 0 0 2px var(--bg-surface);
	}
</style>
