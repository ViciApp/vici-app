<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { Copy, Share2 } from '@lucide/svelte/icons';
	import { untrack } from 'svelte';
	import IconTelegram from '#lib/components/icons/IconTelegram.svelte';
	import IconWhatsApp from '#lib/components/icons/IconWhatsApp.svelte';
	import SetToggle from '#lib/components/settings/SetToggle.svelte';
	import BottomSheet from '#lib/components/ui/BottomSheet.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import LoadingSpinner from '#lib/components/ui/LoadingSpinner.svelte';
	import { track } from '#lib/services/analytics.services.ts';
	import {
		challengeRefusalOf,
		createChallenge,
		listMyChallenges,
		revokeChallenge,
		setChallengeConsent,
		type ChallengeRefusal
	} from '#lib/services/challenge.services.ts';
	import { notifyShareFailed } from '#lib/services/share.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { notificationsStore } from '#lib/stores/notification.store.ts';
	import type { OwnChallenge } from '#lib/types/challenge.ts';
	import type { ButtonStatus } from '#lib/types/components.ts';
	import {
		challengeLineText,
		challengeShareText,
		challengeUrl
	} from '#lib/utils/challenge.utils.ts';
	import { writeToClipboard } from '#lib/utils/clipboard.utils.ts';
	import { haptic } from '#lib/utils/haptics.utils.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';
	import { appOrigin } from '#lib/utils/nav.utils.ts';
	import { browser } from '$app/env';

	/**
	 * The challenge share sheet: issues (or reopens) the viewer's challenge link for a market,
	 * previews exactly what recipients will see, asks for consent to show the @handle and call on
	 * this link (on by default), sends the link, and lets the owner turn it off. Every value it
	 * shows comes from the server's answer, never from local state. The link is created when the
	 * sheet opens: creation is idempotent, so reopening returns the same link.
	 */
	interface Props {
		isOpen: boolean;
		seriesId: string;
		/** The market title as the viewer reads it (translated for the active locale). */
		title: string;
		onClose: () => void;
	}

	const { isOpen, seriesId, title, onClose }: Props = $props();

	type ShareChannel = 'native' | 'whatsapp' | 'telegram' | 'copy';

	let challenge = $state<OwnChallenge | undefined>();
	let saving = $state(false);
	let confirmingRevoke = $state(false);

	const titleId = $props.id();

	const REFUSAL_KEYS: Record<ChallengeRefusal, MessageKey> = {
		no_position: 'challenge.share.error.no_position',
		market_closed: 'challenge.share.error.market_closed',
		rate_limited: 'challenge.share.error.rate_limited'
	};

	const notifyFailure = (err: unknown) => {
		const refusal = challengeRefusalOf(err);

		notificationsStore.add({
			title: t({ locale: $localeStore, key: 'challenge.share.error.title' }),
			message: t({
				locale: $localeStore,
				key: nonNullish(refusal) ? REFUSAL_KEYS[refusal] : 'challenge.share.error.generic'
			}),
			type: 'error'
		});

		return refusal;
	};

	/** The link no longer exists to share: say why and close. */
	const failAndClose = (err: unknown) => {
		console.error('ChallengeShareSheet: challenge request failed', err);
		notifyFailure(err);
		onClose();
	};

	// A reopened sheet keeps the consent the owner chose last time: creation sends the flag and the
	// API stores what it is sent, so the existing link's flag is read first.
	const load = async ({ isCurrent }: { isCurrent: () => boolean }) => {
		try {
			const existing = (await listMyChallenges()).find((own) => own.seriesId === seriesId);
			const issued = await createChallenge({
				seriesId,
				showIdentity: existing?.showIdentity ?? true
			});

			if (isCurrent()) {
				challenge = issued;
			}
		} catch (err) {
			if (isCurrent()) {
				failAndClose(err);
			}
		}
	};

	$effect(() => {
		if (!isOpen) {
			return;
		}

		const target = seriesId;
		let alive = true;

		untrack(() => {
			challenge = undefined;
			saving = false;
			confirmingRevoke = false;
			void load({ isCurrent: () => alive && target === seriesId });
		});

		return () => {
			alive = false;
		};
	});

	const setConsent = async (showIdentity: boolean) => {
		if (isNullish(challenge) || saving) {
			return;
		}

		saving = true;

		try {
			challenge = await setChallengeConsent({ id: challenge.id, showIdentity });
		} catch (err) {
			console.error('ChallengeShareSheet: consent update failed', err);

			const refusal = notifyFailure(err);

			if (refusal === 'no_position' || refusal === 'market_closed') {
				onClose();
			}
		} finally {
			saving = false;
		}
	};

	const url = $derived(
		nonNullish(challenge) && browser ? challengeUrl({ origin: appOrigin(), id: challenge.id }) : ''
	);
	const shareText = $derived(
		nonNullish(challenge) ? challengeShareText({ view: challenge, locale: $localeStore }) : ''
	);
	const previewLine = $derived(
		nonNullish(challenge) ? challengeLineText({ view: challenge, locale: $localeStore }) : ''
	);

	const buttonStatus = $derived<ButtonStatus>(saving ? 'disabled' : 'enabled');

	const hasNativeShare = $derived(
		browser && typeof navigator !== 'undefined' && typeof navigator.share === 'function'
	);

	const enc = encodeURIComponent;
	const whatsappHref = $derived(`https://wa.me/?text=${enc(`${shareText} ${url}`)}`);
	const telegramHref = $derived(`https://t.me/share/url?url=${enc(url)}&text=${enc(shareText)}`);

	// Neither the handle nor the link id is sent: the consent flag is the one dimension.
	const trackShared = (channel: ShareChannel) => {
		track({
			name: 'market_shared',
			source: 'challenge',
			marketId: seriesId,
			label: channel,
			ok: challenge?.showIdentity
		});
	};

	const shareNative = async () => {
		if (saving || typeof navigator.share !== 'function') {
			return;
		}

		haptic('light-tap');

		try {
			await navigator.share({ title: 'VICI', text: shareText, url });
			trackShared('native');
			onClose();
		} catch (err: unknown) {
			if (err instanceof DOMException && err.name === 'AbortError') {
				return;
			}

			console.error('ChallengeShareSheet: native share failed', err);
			notifyShareFailed();
		}
	};

	const onChannelLink = ({
		event,
		channel
	}: {
		event: MouseEvent;
		channel: 'whatsapp' | 'telegram';
	}) => {
		// A consent change still saving would send the link under the old choice.
		if (saving) {
			event.preventDefault();

			return;
		}

		trackShared(channel);
	};

	const copyLink = async () => {
		if (saving) {
			return;
		}

		haptic('light-tap');

		if (!(await writeToClipboard(url))) {
			notifyShareFailed();

			return;
		}

		trackShared('copy');
		notificationsStore.add({
			title: t({ locale: $localeStore, key: 'market.detail.share.copied_title' }),
			message: t({ locale: $localeStore, key: 'challenge.share.copied' }),
			type: 'success'
		});
	};

	const revoke = async () => {
		if (isNullish(challenge) || saving) {
			return;
		}

		saving = true;

		try {
			await revokeChallenge(challenge.id);
			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'challenge.share.revoked_title' }),
				message: t({ locale: $localeStore, key: 'challenge.share.revoked' }),
				type: 'success'
			});
			onClose();
		} catch (err) {
			console.error('ChallengeShareSheet: revoke failed', err);
			notifyFailure(err);
		} finally {
			saving = false;
		}
	};
</script>

<BottomSheet desktopCentered {isOpen} labelledBy={titleId} {onClose}>
	<div class="challenge-sheet" aria-busy={isNullish(challenge) || saving}>
		<h2 id={titleId} class="challenge-sheet-title">
			{t({ locale: $localeStore, key: 'challenge.action.label' })}
		</h2>

		{#if isNullish(challenge)}
			<div class="challenge-sheet-loading" role="status">
				<LoadingSpinner size="sm" />
				<span class="sr-only">{t({ locale: $localeStore, key: 'challenge.share.loading' })}</span>
			</div>
		{:else}
			<span class="challenge-sheet-eyebrow">
				{t({ locale: $localeStore, key: 'challenge.share.preview_label' })}
			</span>
			<figure class="challenge-preview">
				<blockquote class="challenge-preview-line">{previewLine}</blockquote>
				<figcaption class="challenge-preview-market">{title}</figcaption>
			</figure>
			<p class="challenge-sheet-note">
				{t({ locale: $localeStore, key: 'challenge.share.current_position_note' })}
			</p>

			<div class="challenge-consent">
				<SetToggle
					checked={challenge.showIdentity}
					disabled={saving}
					label={t({ locale: $localeStore, key: 'challenge.share.consent_label' })}
					onchange={(value) => void setConsent(value)}
					sub={t({ locale: $localeStore, key: 'challenge.share.consent_note' })}
				/>
			</div>

			<div class="challenge-send">
				{#if hasNativeShare}
					<Button onclick={() => void shareNative()} status={buttonStatus} variant="primary">
						<Share2 aria-hidden="true" size={16} strokeWidth={2} />
						{t({ locale: $localeStore, key: 'challenge.share.send' })}
					</Button>
				{:else}
					<a
						class="challenge-channel"
						aria-disabled={saving}
						href={whatsappHref}
						onclick={(event) => onChannelLink({ event, channel: 'whatsapp' })}
						rel="noopener noreferrer"
						target="_blank"
					>
						<span style:color="#25D366" class="challenge-channel-icon"><IconWhatsApp /></span>
						{t({ locale: $localeStore, key: 'flow.share.whatsapp' })}
					</a>
					<a
						class="challenge-channel"
						aria-disabled={saving}
						href={telegramHref}
						onclick={(event) => onChannelLink({ event, channel: 'telegram' })}
						rel="noopener noreferrer"
						target="_blank"
					>
						<span style:color="#229ED9" class="challenge-channel-icon"><IconTelegram /></span>
						{t({ locale: $localeStore, key: 'flow.share.telegram' })}
					</a>
				{/if}
				<button
					class="challenge-channel"
					disabled={saving}
					onclick={() => void copyLink()}
					type="button"
				>
					<span class="challenge-channel-icon"><Copy aria-hidden="true" size={16} /></span>
					{t({ locale: $localeStore, key: 'challenge.share.copy' })}
				</button>
			</div>

			<div class="challenge-revoke">
				{#if confirmingRevoke}
					<p class="challenge-sheet-note">
						{t({ locale: $localeStore, key: 'challenge.share.revoke_confirm' })}
					</p>
					<div class="challenge-revoke-actions">
						<Button
							onclick={() => (confirmingRevoke = false)}
							size="sm"
							status={buttonStatus}
							variant="ghost"
						>
							{t({ locale: $localeStore, key: 'challenge.share.revoke_cancel' })}
						</Button>
						<Button onclick={() => void revoke()} size="sm" status={buttonStatus} variant="danger">
							{t({ locale: $localeStore, key: 'challenge.share.revoke_confirm_cta' })}
						</Button>
					</div>
				{:else}
					<button
						class="challenge-revoke-link"
						disabled={saving}
						onclick={() => (confirmingRevoke = true)}
						type="button"
					>
						{t({ locale: $localeStore, key: 'challenge.share.revoke' })}
					</button>
				{/if}
				<p class="challenge-sheet-note">
					{t({ locale: $localeStore, key: 'challenge.share.revoke_note' })}
				</p>
			</div>
		{/if}
	</div>
</BottomSheet>

<style lang="postcss">
	.challenge-sheet {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		padding-bottom: 0.5rem;
	}

	.challenge-sheet-title {
		font-family: var(--font-display);
		font-size: var(--t-18);
		font-weight: 600;
		color: var(--text-base);
	}

	.challenge-sheet-loading {
		display: flex;
		justify-content: center;
		padding: 2rem 0;
	}

	.challenge-sheet-eyebrow {
		margin-bottom: -0.375rem;
		font-family: var(--font-mono);
		font-size: var(--t-10);
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--fg-faint);
	}

	.challenge-preview {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0;
		padding: 0.875rem 1rem;
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		background: color-mix(in srgb, var(--text-base) 4%, transparent);
	}

	.challenge-preview-line {
		margin: 0;
		font-size: var(--t-14);
		font-weight: 600;
		line-height: 1.35;
		color: var(--text-base);
	}

	.challenge-preview-market {
		font-size: var(--t-13);
		line-height: 1.4;
		color: var(--fg-dim);
	}

	.challenge-sheet-note {
		margin: 0;
		font-size: var(--t-12);
		line-height: 1.45;
		color: var(--text-muted);
	}

	.challenge-consent {
		overflow: hidden;
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
	}

	.challenge-send {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.challenge-send :global(.btn) {
		flex: 1 1 auto;
	}

	.challenge-channel {
		display: inline-flex;
		flex: 1 1 0;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		min-width: 6rem;
		padding: 0.625rem 0.75rem;
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		background: transparent;
		color: var(--text-base);
		font-family: inherit;
		font-size: var(--t-13);
		font-weight: 500;
		text-decoration: none;
		cursor: pointer;
		transition: border-color var(--d-hover) var(--ease-vici);
	}

	.challenge-channel:hover {
		border-color: var(--border-strong);
	}

	.challenge-channel:disabled,
	.challenge-channel[aria-disabled='true'] {
		opacity: 0.6;
		cursor: default;
	}

	.challenge-channel-icon {
		display: inline-flex;
		width: 1.125rem;
		height: 1.125rem;
		align-items: center;
		justify-content: center;
	}

	.challenge-revoke {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--border-base);
	}

	.challenge-revoke-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	.challenge-revoke-link {
		align-self: flex-start;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--no);
		font-family: inherit;
		font-size: var(--t-13);
		font-weight: 600;
		cursor: pointer;
	}

	.challenge-revoke-link:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
