<script lang="ts">
	import { onMount } from 'svelte';
	import { loadNewAppPageUrl, newAppDomain } from '#lib/services/new-app-redirect.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	// Read once: the screen replaces the whole app, so the URL cannot change
	// under it.
	const newAppUrl = loadNewAppPageUrl();
	const domain = newAppDomain();

	// The satellite cannot answer the app's routes with a redirect (see
	// `isLegacyShutDown`), so the page does it. `replace` keeps the closed
	// site out of the back stack; the link stays for a browser that blocks it.
	onMount(() => {
		window.location.replace(newAppUrl);
	});
</script>

<div class="signin-wrap">
	<div class="signin-card">
		<div class="signin-cluster">
			<div class="signin-head">
				<span class="signin-wordmark" aria-label="VICI">
					<span class="signin-wordmark-letters">VICI</span>
				</span>
				<p class="signin-eyebrow">{t({ locale: $localeStore, key: 'claim.moved.eyebrow' })}</p>
				<h1 class="signin-title">
					{t({ locale: $localeStore, key: 'claim.moved.title', params: { domain } })}
				</h1>
				<p class="signin-sub">
					{t({ locale: $localeStore, key: 'claim.moved.sub_shutdown', params: { domain } })}
				</p>
			</div>

			<a class="signin-email-submit no-underline" href={newAppUrl}>
				{t({ locale: $localeStore, key: 'claim.moved.cta', params: { domain } })}
			</a>
		</div>
	</div>
</div>
