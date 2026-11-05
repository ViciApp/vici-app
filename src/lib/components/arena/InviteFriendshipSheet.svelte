<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import type { PrincipalText } from '@junobuild/schema';
	import { onMount } from 'svelte';
	import Avatar from '#lib/components/profile/Avatar.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { getProfile } from '#lib/services/profile.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { UserProfile } from '#lib/types/profile.ts';
	import { shortenWithMiddleEllipsis } from '#lib/utils/format.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	/**
	 * Friendship-only explainer rendered by `/i/[code]` when an existing user (account older
	 * than the referral signup window) uses an invite link. Makes it crystal clear that no
	 * VXP bonus is involved — the only outcome is adding the inviter as a friend.
	 *
	 * Two CTAs:
	 *   - **Add as friend** → calls `claimReferralFriendship` on the satellite (parent owns the
	 *     handler so the page can drive the loading state + route on success).
	 *   - **Skip** → bail back home; no friendship written.
	 */
	interface Props {
		referrerPrincipal: PrincipalText;
		busy?: boolean;
		onAddFriend: () => void | Promise<void>;
		onSkip: () => void;
	}

	const { referrerPrincipal, busy = false, onAddFriend, onSkip }: Props = $props();

	let referrerProfile = $state<UserProfile | undefined>(undefined);

	// Lightweight profile fetch — only need nickname + avatar to render. The principal is
	// always available; lookup failures fall through to a short-form principal slug.
	onMount(() => {
		void (async () => {
			try {
				const doc = await getProfile(referrerPrincipal);

				referrerProfile = doc.data;
			} catch {
				referrerProfile = undefined;
			}
		})();
	});

	const handleLabel = $derived.by(() => {
		const nickname = referrerProfile?.nickname?.trim();

		if (nonNullish(nickname) && nickname.length > 0) {
			return `@${nickname}`;
		}

		return shortenWithMiddleEllipsis({ text: referrerPrincipal, splitLength: 5 });
	});
</script>

<section class="invite-sheet">
	<header class="invite-sheet-head">
		<span class="invite-sheet-eyebrow allcaps">
			{t({ locale: $localeStore, key: 'invite.sheet.eyebrow' })}
		</span>
		<div class="invite-sheet-identity">
			<Avatar
				class="h-14 w-14"
				avatar={referrerProfile?.avatar}
				avatarParts={referrerProfile?.avatarParts}
				nickname={referrerProfile?.nickname}
				owner={referrerPrincipal}
			/>
			<div class="invite-sheet-name">
				<span class="invite-sheet-handle num">{handleLabel}</span>
				<span class="invite-sheet-tag">
					{t({ locale: $localeStore, key: 'invite.sheet.tag' })}
				</span>
			</div>
		</div>
	</header>

	<h1 class="invite-sheet-title">
		{t({ locale: $localeStore, key: 'invite.sheet.title' })}
	</h1>

	<p class="invite-sheet-body">
		{t({
			locale: $localeStore,
			key: 'invite.sheet.body',
			params: { handle: handleLabel }
		})}
	</p>

	<ul class="invite-sheet-bullets">
		<li>{t({ locale: $localeStore, key: 'invite.sheet.bullet_no_bonus' })}</li>
		<li>{t({ locale: $localeStore, key: 'invite.sheet.bullet_friendship' })}</li>
	</ul>

	<div class="invite-sheet-actions">
		<Button class="w-full" onclick={onAddFriend} status={busy ? 'pending' : 'enabled'}>
			{t({
				locale: $localeStore,
				key: 'invite.sheet.cta_add',
				params: { handle: handleLabel }
			})}
		</Button>
		<Button class="w-full" onclick={onSkip} variant="ghost">
			{t({ locale: $localeStore, key: 'invite.sheet.cta_skip' })}
		</Button>
	</div>
</section>

<style lang="postcss">
	.invite-sheet {
		display: flex;
		width: 100%;
		max-width: 26rem;
		flex-direction: column;
		gap: 1.1rem;
		padding: 1.6rem 1.4rem 1.4rem;
		border-radius: var(--r-16, 16px);
		background: var(--bg-popover);
		border: 1px solid var(--border-base);
		box-shadow: 0 24px 52px rgba(0, 0, 0, 0.24);
	}

	.invite-sheet-head {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
	}

	.invite-sheet-eyebrow {
		font-size: 10.5px;
		letter-spacing: var(--tracking-allcaps);
		color: var(--text-muted);
		font-weight: 700;
	}

	.invite-sheet-identity {
		display: flex;
		align-items: center;
		gap: 0.8rem;
	}

	.invite-sheet-name {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.invite-sheet-handle {
		font-size: 1.05rem;
		font-weight: 700;
		color: var(--text-base);
		letter-spacing: 0.01em;
	}

	.invite-sheet-tag {
		font-size: var(--t-12);
		color: var(--text-muted);
	}

	.invite-sheet-title {
		margin: 0;
		font-family: var(--font-display, inherit);
		font-size: 1.45rem;
		font-weight: 700;
		line-height: var(--leading-snug);
		color: var(--text-base);
	}

	.invite-sheet-body {
		margin: 0;
		color: var(--text-muted);
		line-height: var(--leading-normal);
		font-size: var(--t-14, 0.875rem);
	}

	.invite-sheet-bullets {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		font-size: var(--t-13, 0.8125rem);
		color: var(--text-base);
	}

	.invite-sheet-bullets li {
		padding-left: 1.1rem;
		position: relative;
	}

	.invite-sheet-bullets li::before {
		content: '·';
		position: absolute;
		left: 0.3rem;
		top: -0.15rem;
		font-size: 1.4rem;
		color: var(--color-primary);
		line-height: 1;
	}

	.invite-sheet-actions {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		margin-top: 0.35rem;
	}
</style>
