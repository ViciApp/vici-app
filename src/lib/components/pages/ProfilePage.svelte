<script lang="ts">
	import { User } from '@lucide/svelte/icons';
	import { onMount } from 'svelte';
	import ProfileDashboard from '#lib/components/profile/ProfileDashboard.svelte';
	import LoadingSpinner from '#lib/components/ui/LoadingSpinner.svelte';
	import { authBusy, authPrincipal } from '#lib/derived/user.derived.ts';
	import { getProfile } from '#lib/services/profile.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { userStore } from '#lib/stores/user.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	let intervalId: ReturnType<typeof setInterval> | undefined;

	onMount(() => {
		const refreshProfile = async () => {
			if ($authPrincipal) {
				const profileDoc = await getProfile($authPrincipal);
				userStore.update((s) => ({ ...s, profile: profileDoc.data }));
			}
		};

		void refreshProfile();

		intervalId = setInterval(refreshProfile, 60000);

		return () => clearInterval(intervalId);
	});
</script>

<!--
	The Profile page leads with a full-bleed avatar hero (rendered inside
	`ProfileDashboard`) rather than the shared section header: the avatar
	scene IS the header, and the notification + settings controls float over
	it. So this page intentionally does not wrap the loaded state in
	`PageScaffold`: the dashboard owns its own chrome. The loading / empty
	states keep the simple centered card.
-->
<div class="profile-page">
	{#if $userStore.profile}
		<ProfileDashboard profile={$userStore.profile} viewerPrincipal={$authPrincipal ?? ''} />
	{:else if $authBusy}
		<div
			class="border-border bg-card mx-5 flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-24 text-center"
			aria-label={t({ locale: $localeStore, key: 'profile.loading.title' })}
			aria-live="polite"
			role="status"
		>
			<LoadingSpinner size="md" />
			<h2 class="font-display text-foreground mt-6 text-2xl font-semibold">
				{t({ locale: $localeStore, key: 'profile.loading.title' })}
			</h2>
			<p class="text-muted-foreground mt-2 max-w-xs">
				{t({ locale: $localeStore, key: 'profile.loading.sub' })}
			</p>
		</div>
	{:else}
		<div
			class="border-border bg-card mx-5 flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-24 text-center"
		>
			<div class="bg-card mb-6 rounded-full p-6">
				<User class="text-muted-foreground" aria-hidden="true" size={40} strokeWidth={1.6} />
			</div>
			<h2 class="font-display text-foreground text-2xl font-semibold">
				{t({ locale: $localeStore, key: 'profile.empty.title' })}
			</h2>
			<p class="text-muted-foreground mt-2 max-w-xs">
				{t({ locale: $localeStore, key: 'profile.empty.sub' })}
			</p>
		</div>
	{/if}
</div>

<style lang="postcss">
	.profile-page {
		position: relative;
	}
</style>
