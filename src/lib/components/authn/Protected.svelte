<script lang="ts">
	import type { Snippet } from 'svelte';
	import LoadingSpinner from '#lib/components/ui/LoadingSpinner.svelte';
	import { userSignedIn } from '#lib/derived/user.derived.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		children: Snippet;
	}

	const { children }: Props = $props();
</script>

<!-- Only ever mounted under the (app) layout, which sends a signed-out
     visitor to /signin: until a session lands this holds a loader, never a
     sign-in prompt of its own. -->
{#if $userSignedIn}
	{@render children()}
{:else}
	<div
		class="py-20"
		aria-label={t({ locale: $localeStore, key: 'authn.checking.aria' })}
		aria-live="polite"
		role="status"
	>
		<LoadingSpinner inlinePad size="md" />
	</div>
{/if}
