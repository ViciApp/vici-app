<script lang="ts">
	import WelcomePage from '#lib/components/pages/WelcomePage.svelte';
	import LoadingSpinner from '#lib/components/ui/LoadingSpinner.svelte';
	import { SIGNED_IN_FLAG_KEY } from '#lib/constants/app.constants.ts';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { userSignedIn, userSignedOutResolved } from '#lib/derived/user.derived.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { goto } from '$app/navigation';

	// Root landing gate.
	//
	// - Signed-in sessions are bounced to `/flow` once `userSignedIn`
	//   resolves — Flow mode is the canonical first surface for every
	//   authenticated session. This is always a client-side `goto`, never
	//   a full document load: a hard navigation would re-fetch the document
	//   from the IC HTTP gateway, which occasionally flashes the gateway's
	//   own "500 Internal error" page mid-handshake (#753). Routing in-SPA
	//   keeps us on the already-loaded document, so there is nothing to
	//   500.
	// - While the auth handshake is still unresolved, a device that carries
	//   the `signed-in` hint (`SIGNED_IN_FLAG_KEY`, written by `Authn` on
	//   every auth transition) is almost certainly resuming a session and
	//   about to bounce to `/flow`, so we hold a branded spinner. Everyone
	//   else sees the blank brand shell — this keeps the marketing surface
	//   from ever flashing for a signed-in user the hint missed (private
	//   mode, cleared storage), and a stale hint only costs a brief spinner
	//   before `WelcomePage`.
	// - For signed-out visitors, we render `WelcomePage` once the auth
	//   handshake has settled.
	// One-time, non-reactive snapshot of the device hint — read once at
	// mount, never re-read, so a plain const (not `$state`) is correct.
	const resumingSession = ((): boolean => {
		try {
			return localStorage.getItem(SIGNED_IN_FLAG_KEY) === '1';
		} catch {
			// Private mode / storage disabled — fall through to the blank shell.
			return false;
		}
	})();

	$effect(() => {
		if ($userSignedIn) {
			void goto(resolveAppPath(AppPath.Flow), { replace: true });
		}
	});
</script>

<svelte:head>
	<title>{t({ locale: $localeStore, key: 'seo.home.title' })}</title>
	<meta name="description" content={t({ locale: $localeStore, key: 'seo.home.description' })} />
</svelte:head>

{#if $userSignedOutResolved}
	<WelcomePage />
{:else if resumingSession}
	<div class="bg-background flex min-h-dvh items-center justify-center">
		<LoadingSpinner size="lg" />
	</div>
{:else}
	<div class="bg-background min-h-dvh"></div>
{/if}
