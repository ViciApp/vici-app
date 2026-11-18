<script lang="ts">
	import { isNullish } from '@dfinity/utils';
	import LoginRequired from '#lib/components/authn/LoginRequired.svelte';
	import FlowMode from '#lib/components/market/FlowMode.svelte';
	import LoadingSpinner from '#lib/components/ui/LoadingSpinner.svelte';
	import { guestMode } from '#lib/derived/guest.derived.ts';
	import { authBusy } from '#lib/derived/user.derived.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { userStore } from '#lib/stores/user.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
</script>

{#if $authBusy}
	<div
		class="flex min-h-[calc(100vh-10rem)] items-center justify-center"
		aria-label={t({ locale: $localeStore, key: 'a11y.checking_signin' })}
		aria-live="polite"
		role="status"
	>
		<LoadingSpinner size="md" />
	</div>
{:else if isNullish($userStore.user) && !$guestMode}
	<LoginRequired />
{:else}
	<FlowMode />
{/if}
