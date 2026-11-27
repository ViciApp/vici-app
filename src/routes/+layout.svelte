<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import Authn from '#lib/components/authn/Authn.svelte';
	import TweaksPanel from '#lib/components/dev/TweaksPanel.svelte';
	import LoadingSpinner from '#lib/components/ui/LoadingSpinner.svelte';
	import Notifications from '#lib/components/ui/Notifications.svelte';
	import { initAnalytics } from '#lib/services/analytics.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { previousPathStore } from '#lib/stores/previous-path.store.ts';
	import { ensureLocaleCatalogs, t } from '#lib/utils/i18n.utils.ts';
	import { browser } from '$app/env';
	import { afterNavigate } from '$app/navigation';
	// eslint-disable-next-line import/no-relative-parent-imports
	import '../app.css';

	interface Props {
		children: Snippet;
	}

	const { children }: Props = $props();

	// Non-`en` catalogs load on demand (see `ensureLocaleCatalogs`); holding
	// the boot gate until the active locale's chain is in memory keeps the
	// first paint from flashing the `en` fallback. Resolves immediately for
	// `en`.
	let localeCatalogsReady = $state(false);

	$effect(() => {
		const locale = $localeStore;

		void ensureLocaleCatalogs(locale).then(() => {
			localeCatalogsReady = true;
		});
	});

	// Product-analytics capture: the tab-hide flush and the opening
	// `session_started` event.
	onMount(initAnalytics);

	// RTL scripts: kept in sync with the flash-free locale boot in
	// `app.html` so the document direction stays correct after hydrate.
	const RTL_LANGS = ['ar', 'he', 'fa', 'ur'];

	$effect(() => {
		if (!browser) {
			return;
		}

		const el = document.documentElement;
		const lang = $localeStore.split('-')[0].toLowerCase();

		el.lang = $localeStore;
		el.setAttribute('data-locale', $localeStore);
		el.dir = RTL_LANGS.includes(lang) ? 'rtl' : 'ltr';
	});

	afterNavigate(({ from, shallow, type }) => {
		if (shallow && type === 'goto') {
			return;
		}

		if (from?.url) {
			previousPathStore.set(from.url.pathname + from.url.search);
		}
	});
</script>

{#if !localeCatalogsReady}
	<div
		class="flex h-screen items-center justify-center"
		aria-label={t({ locale: $localeStore, key: 'ui.loading' })}
		aria-live="polite"
		role="status"
	>
		<LoadingSpinner size="lg" />
	</div>
{:else}
	<Authn>
		{@render children()}
	</Authn>
{/if}

<Notifications />

<TweaksPanel />
