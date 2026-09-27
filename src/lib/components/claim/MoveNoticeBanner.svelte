<script lang="ts">
	import MigrationBanner from '$lib/components/claim/MigrationBanner.svelte';
	import { shouldShowMoveNotice } from '$lib/services/claim-handoff.services';
	import { newAppDomain } from '$lib/services/new-app-redirect.services';
	import { localeStore } from '$lib/stores/locale.store';
	import { t } from '$lib/utils/i18n.utils';
	import { MOVE_NOTICE_DISMISSED_KEY } from '$lib/utils/migration-banner.utils';

	// Informational only: existing accounts keep playing here until the
	// cutover, so this banner deliberately offers no way to start the move.
	// The build and cutover-switch gates live in the claim service.

	const domain = newAppDomain();

	const readDismissed = (): boolean => {
		try {
			return localStorage.getItem(MOVE_NOTICE_DISMISSED_KEY) === '1';
		} catch {
			return false;
		}
	};

	let dismissed = $state(readDismissed());

	const visible = $derived(shouldShowMoveNotice({ dismissed }));

	const dismiss = () => {
		dismissed = true;

		try {
			localStorage.setItem(MOVE_NOTICE_DISMISSED_KEY, '1');
		} catch {
			// Best-effort persistence: the in-memory flag already hides the notice
			// for this session.
		}
	};
</script>

{#if visible}
	<MigrationBanner
		dismissLabel={t({ locale: $localeStore, key: 'claim.notice.dismiss_aria' })}
		label={t({ locale: $localeStore, key: 'claim.notice.title', params: { domain } })}
		lead={t({ locale: $localeStore, key: 'claim.notice.title', params: { domain } })}
		onDismiss={dismiss}
		text={t({ locale: $localeStore, key: 'claim.notice.text' })}
	/>
{/if}
