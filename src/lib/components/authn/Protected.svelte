<script lang="ts">
	import type { Snippet } from 'svelte';
	import SignInModal from '#lib/components/authn/SignInModal.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import LoadingSpinner from '#lib/components/ui/LoadingSpinner.svelte';
	import { authBusy, userSignedIn } from '#lib/derived/user.derived.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		children: Snippet;
		title?: string;
		description?: string;
	}

	const { children, title, description }: Props = $props();

	let showSignInModal = $state(false);

	const openSignInModal = () => {
		showSignInModal = true;
	};
</script>

{#if $userSignedIn}
	{@render children()}
{:else if $authBusy}
	<div
		class="py-20"
		aria-label={t({ locale: $localeStore, key: 'authn.checking.aria' })}
		aria-live="polite"
		role="status"
	>
		<LoadingSpinner inlinePad size="md" />
	</div>
{:else}
	<div class="flex flex-col items-center justify-center py-20 text-center">
		<div class="mb-12 max-w-md">
			<h2 class="text-foreground text-4xl font-black">
				{title ?? t({ locale: $localeStore, key: 'authn.required.title' })}
			</h2>
			<p class="text-muted-foreground mt-4 text-lg">
				{description ?? t({ locale: $localeStore, key: 'authn.required.description' })}
			</p>
		</div>

		<div class="border-border bg-card rounded-3xl border p-12 shadow-2xl">
			<div class="flex flex-col items-center gap-6">
				<div
					class="bg-primary text-primary-foreground flex h-16 w-16 items-center justify-center rounded-2xl text-2xl font-bold shadow-xl"
				>
					V
				</div>
				<Button onclick={openSignInModal}
					>{t({ locale: $localeStore, key: 'authn.required.cta' })}</Button
				>
			</div>
		</div>
	</div>

	<SignInModal bind:show={showSignInModal} />
{/if}
