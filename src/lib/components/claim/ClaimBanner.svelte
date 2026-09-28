<script lang="ts">
	import MigrationBanner from '$lib/components/claim/MigrationBanner.svelte';
	import { CLAIM_BANNER_DISMISSED_KEY } from '$lib/constants/claim.constants';
	import { isClaimHandoffAvailable, startClaimHandoff } from '$lib/services/claim-handoff.services';
	import { localeStore } from '$lib/stores/locale.store';
	import { notificationsStore } from '$lib/stores/notification.store';
	import { t } from '$lib/utils/i18n.utils';

	// Legacy-build-only surface: the whole banner is inert on the web2 build
	// and until the cutover switch is on (the availability gate lives in the
	// claim service, not here).
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
	<MigrationBanner
		dismissLabel={t({ locale: $localeStore, key: 'claim.banner.dismiss_aria' })}
		label={t({ locale: $localeStore, key: 'claim.banner.title' })}
		onDismiss={dismiss}
		text={t({ locale: $localeStore, key: 'claim.banner.text' })}
	>
		{#snippet action()}
			<button class="claim-banner-cta" disabled={busy} onclick={onMove} type="button">
				{t({ locale: $localeStore, key: 'claim.banner.cta' })}
			</button>
		{/snippet}
	</MigrationBanner>
{/if}

<style lang="postcss">
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
</style>
