<script lang="ts">
	import { ChevronRight, Copy, Users } from '@lucide/svelte/icons';
	import Button from '#lib/components/ui/Button.svelte';
	import { REFERRAL_VXP_BONUS_VALUE } from '#lib/constants/referral.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { userStore } from '#lib/stores/user.store.ts';
	import { writeToClipboard } from '#lib/utils/clipboard.utils.ts';
	import { djb2 } from '#lib/utils/hash.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { browser } from '$app/env';

	interface Props {
		sessionXp?: number;
	}

	const { sessionXp = 0 }: Props = $props();

	const INVITE_TOAST_MS = 2_200;

	let toast = $state('');

	const handle = $derived.by(() => {
		const nick = $userStore.profile?.nickname?.trim();

		if (nick && nick.length > 0) {
			return nick;
		}

		return t({ locale: $localeStore, key: 'settings.identity.fallback' });
	});

	const inviteCode = $derived.by(() => {
		const seed = `${handle}|${sessionXp}|${$userStore.profile?.level ?? 0}`;
		const suffix = djb2(seed).toString(36).slice(0, 5).toUpperCase();
		const prefix = handle.replace(/\s+/g, '-').toUpperCase().slice(0, 24);

		return `${prefix}-${suffix}`;
	});

	const inviteUrl = $derived(
		browser ? `${window.location.origin}/i/${inviteCode}` : `/i/${inviteCode}`
	);
	const shareText = $derived(t({ locale: $localeStore, key: 'flow.invite.share_text' }));

	const showToast = (message: string) => {
		toast = message;
		setTimeout(() => {
			toast = '';
		}, INVITE_TOAST_MS);
	};

	const copyCode = async () => {
		const ok = await writeToClipboard(inviteCode);
		showToast(
			t({
				locale: $localeStore,
				key: ok ? 'flow.invite.toast_code_copied' : 'flow.invite.toast_copy_failed'
			})
		);
	};

	const shareInvite = async () => {
		if (navigator.share) {
			try {
				await navigator.share({ title: 'VICI', text: shareText, url: inviteUrl });

				return;
			} catch (e: unknown) {
				if (e instanceof Error && e.name === 'AbortError') {
					return;
				}
			}
		}

		const ok = await writeToClipboard(`${shareText} ${inviteUrl}`);
		showToast(
			t({
				locale: $localeStore,
				key: ok ? 'flow.invite.toast_invite_copied' : 'flow.invite.toast_copy_failed'
			})
		);
	};
</script>

<section class="flow-invite">
	<div class="flow-invite-head">
		<div>
			<p class="eyebrow flow-invite-label">
				{t({ locale: $localeStore, key: 'flow.invite.title' })}
			</p>
			<p class="flow-invite-copy">
				{t({ locale: $localeStore, key: 'flow.invite.copy_lead' })}
				<span class="num text-laurel">
					{t({
						locale: $localeStore,
						key: 'flow.invite.copy_vxp',
						params: { vxp: REFERRAL_VXP_BONUS_VALUE }
					})}
				</span>
				{t({ locale: $localeStore, key: 'flow.invite.copy_tail' })}
			</p>
		</div>
		<span class="flow-invite-head-icon" aria-hidden="true">
			<Users size={16} strokeWidth={1.8} />
		</span>
	</div>

	<div class="flow-invite-actions">
		<button
			class="flow-invite-code"
			aria-label={t({ locale: $localeStore, key: 'flow.invite.copy_code_aria' })}
			onclick={copyCode}
			type="button"
		>
			<span class="flow-invite-code-text">
				<span class="eyebrow">{t({ locale: $localeStore, key: 'flow.invite.code_label' })}</span>
				<span class="num flow-invite-code-value">{inviteCode}</span>
			</span>
			<Copy class="flow-invite-code-copy" aria-hidden="true" size={14} strokeWidth={1.8} />
		</button>
		<Button class="flow-invite-share" onclick={shareInvite}>
			<span class="flow-invite-share-inner">
				{t({ locale: $localeStore, key: 'flow.invite.share' })}
				<ChevronRight aria-hidden="true" size={14} strokeWidth={2} />
			</span>
		</Button>
	</div>

	{#if toast}
		<p class="flow-invite-toast" role="status">{toast}</p>
	{/if}
</section>

<style lang="postcss">
	.flow-invite {
		margin-top: 0.75rem;
		padding: 1rem;
		border-radius: var(--r-12);
		border: 1px solid var(--border-base);
		background: var(--bg-surface);
	}

	.flow-invite-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.65rem;
	}

	.flow-invite-head-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: var(--r-pill);
		color: var(--laurel);
		background: color-mix(in srgb, var(--laurel) 12%, transparent);
	}

	.flow-invite-label {
		margin: 0;
		color: var(--laurel);
	}

	.flow-invite-copy {
		margin: 0.35rem 0 0;
		font-size: var(--t-13);
		line-height: var(--leading-normal);
		color: var(--text-muted);
	}

	.flow-invite-actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	.flow-invite-code {
		flex: 1 1 auto;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-radius: var(--r-8);
		border: 1px solid var(--border-base);
		background: var(--bg-popover);
		cursor: pointer;
		text-align: left;
	}

	.flow-invite-code-text {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	:global(.flow-invite-code-copy) {
		flex-shrink: 0;
		color: var(--text-muted);
	}

	.flow-invite-share-inner {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}

	.flow-invite-code-value {
		font-size: var(--t-13);
		font-weight: 600;
		letter-spacing: 0.06em;
		color: var(--text-base);
	}

	:global(.flow-invite-share) {
		flex: 0 0 auto;
	}

	.flow-invite-toast {
		margin: 0.5rem 0 0;
		font-size: var(--t-12);
		color: var(--laurel);
	}
</style>
