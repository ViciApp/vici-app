<script lang="ts">
	import { X } from '@lucide/svelte/icons';
	import { CLAIM_BANNER_DISMISSED_KEY } from '$lib/constants/claim.constants';
	import { isClaimHandoffAvailable, startClaimHandoff } from '$lib/services/claim-handoff.services';
	import { localeStore } from '$lib/stores/locale.store';
	import { notificationsStore } from '$lib/stores/notification.store';
	import { t } from '$lib/utils/i18n.utils';

	// Legacy-build-only surface: the whole banner is inert on the web2 build
	// (the availability gate lives in the claim service, not here).
	const available = isClaimHandoffAvailable();

	const readDismissed = (): boolean => {
		try {
			return localStorage.getItem(CLAIM_BANNER_DISMISSED_KEY) === '1';
		} catch {
			return false;
		}
	};

	let dismissed = $state(readDismissed());
	let busy = $state(false);

	const dismiss = () => {
		dismissed = true;

		try {
			localStorage.setItem(CLAIM_BANNER_DISMISSED_KEY, '1');
		} catch {
			// Best-effort persistence: the in-memory flag already hides the banner
			// for this session.
		}
	};

	const onMove = async () => {
		if (busy) {
			return;
		}

		busy = true;

		try {
			const opened = await startClaimHandoff();

			if (!opened) {
				notificationsStore.add({
					title: t({ locale: $localeStore, key: 'claim.banner.title' }),
					message: t({ locale: $localeStore, key: 'claim.handoff.error' }),
					type: 'error'
				});
			}
		} finally {
			busy = false;
		}
	};
</script>

{#if available && !dismissed}
	<div
		class="claim-banner"
		aria-label={t({ locale: $localeStore, key: 'claim.banner.title' })}
		role="region"
	>
		<p class="claim-banner-text">
			{t({ locale: $localeStore, key: 'claim.banner.text' })}
		</p>
		<button class="claim-banner-cta" disabled={busy} onclick={onMove} type="button">
			{t({ locale: $localeStore, key: 'claim.banner.cta' })}
		</button>
		<button
			class="claim-banner-dismiss"
			aria-label={t({ locale: $localeStore, key: 'claim.banner.dismiss_aria' })}
			onclick={dismiss}
			type="button"
		>
			<X aria-hidden="true" size={16} strokeWidth={2} />
		</button>
	</div>
{/if}

<style lang="postcss">
	.claim-banner {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.5rem 0.75rem;
		padding-top: calc(0.5rem + env(safe-area-inset-top, 0px));
		background: var(--bg-surface);
		border-bottom: 1px solid var(--border-base);
		color: var(--text-base);
	}

	.claim-banner-text {
		margin: 0;
		flex: 1;
		min-width: 0;
		font-size: 0.8125rem;
		line-height: 1.3;
	}

	.claim-banner-cta {
		flex-shrink: 0;
		border: none;
		border-radius: 999px;
		padding: 0.375rem 0.875rem;
		background: var(--accent);
		color: var(--ink-deep);
		font-size: 0.8125rem;
		font-weight: 700;
		cursor: pointer;
	}

	.claim-banner-cta:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.claim-banner-dismiss {
		flex-shrink: 0;
		display: grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		border: none;
		border-radius: 999px;
		background: transparent;
		color: inherit;
		cursor: pointer;
		opacity: 0.7;
	}

	.claim-banner-dismiss:hover {
		opacity: 1;
	}
</style>
