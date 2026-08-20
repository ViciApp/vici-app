<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import SignInProviderStackWeb2 from '$lib/components/authn/SignInProviderStackWeb2.svelte';
	import Logo from '$lib/components/layout/Logo.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import LoadingSpinner from '$lib/components/ui/LoadingSpinner.svelte';
	import { CLAIM_BLOB_STORAGE_KEY } from '$lib/constants/claim.constants';
	import { AppPath } from '$lib/constants/routes.constants';
	import {
		isClaimPortalEnabled,
		submitClaimBlob,
		type ClaimSubmitOutcome
	} from '$lib/services/claim-handoff.services';
	import { localeStore } from '$lib/stores/locale.store';
	import { t } from '$lib/utils/i18n.utils';
	import { web2SessionStore } from '$lib/web2/session';

	// The claim portal exists on the web2 build only; the legacy build serves
	// the handoff surfaces instead (banner + settings row).
	const enabled = isClaimPortalEnabled();

	type Stage = 'loading' | 'missing' | 'signin' | 'submitting' | 'done' | 'error';

	let stage = $state<Stage>('loading');
	let blob = $state<string | undefined>(undefined);
	let outcome = $state<ClaimSubmitOutcome | undefined>(undefined);

	// Plain (non-reactive) once-guard: the submit effect below both reads the
	// session store and flips this, so keeping it out of the reactive graph
	// avoids a self-triggering effect.
	let submitted = false;

	onMount(() => {
		if (!enabled) {
			void goto('/', { replaceState: true });

			return;
		}

		// The blob rides the URL fragment so it never reaches any server log.
		// Park it in sessionStorage: the OAuth sign-in roundtrip drops
		// fragments, and stripping it from the address bar keeps the
		// short-lived bearer proof out of history and screenshots.
		const fromHash = window.location.hash.length > 1 ? window.location.hash.slice(1) : undefined;

		if (nonNullish(fromHash)) {
			try {
				sessionStorage.setItem(CLAIM_BLOB_STORAGE_KEY, fromHash);
			} catch {
				// Storage may be unavailable; the in-memory copy still covers the
				// already-signed-in path.
			}

			history.replaceState(null, '', window.location.pathname);
			blob = fromHash;

			return;
		}

		try {
			blob = sessionStorage.getItem(CLAIM_BLOB_STORAGE_KEY) ?? undefined;
		} catch {
			blob = undefined;
		}

		if (isNullish(blob)) {
			stage = 'missing';
		}
	});

	const clearStash = () => {
		try {
			sessionStorage.removeItem(CLAIM_BLOB_STORAGE_KEY);
		} catch {
			// Best-effort cleanup; the blob expires server-side regardless.
		}
	};

	// Submit as soon as a session and a blob are both present. The session
	// arrives either from the boot probe (already signed in) or from the
	// sign-in stack below (OTP inline, Google via the returnTo roundtrip).
	$effect(() => {
		if (!enabled || isNullish(blob) || submitted) {
			return;
		}

		const { user, authBusy } = $web2SessionStore;

		if (authBusy) {
			stage = 'loading';

			return;
		}

		if (isNullish(user)) {
			stage = 'signin';

			return;
		}

		submitted = true;
		stage = 'submitting';

		const pending = blob;

		void (async () => {
			const result = await submitClaimBlob(pending);

			outcome = result;

			if (result.kind === 'error') {
				// A conflict or an invalid blob is terminal for this blob; only a
				// generic (network-ish) failure is worth retrying with the same one.
				if (result.code !== 'generic') {
					clearStash();
				}

				submitted = result.code !== 'generic';
				stage = 'error';

				return;
			}

			clearStash();
			stage = 'done';
		})();
	});

	const retry = () => {
		if (stage !== 'error') {
			return;
		}

		submitted = false;
		// Re-trigger the submit effect: reassigning the same blob value would
		// not invalidate it, so route through a transient undefined.
		const current = blob;

		blob = undefined;
		blob = current;
	};

	const errorKey = $derived.by(() => {
		if (isNullish(outcome) || outcome.kind !== 'error') {
			return 'claim.page.error.generic' as const;
		}

		switch (outcome.code) {
			case 'invalid':
				return 'claim.page.error.invalid' as const;
			case 'stale':
				return 'claim.page.error.stale' as const;
			case 'conflict':
				return 'claim.page.error.conflict' as const;
			default:
				return 'claim.page.error.generic' as const;
		}
	});
</script>

<svelte:head>
	<title>{t({ locale: $localeStore, key: 'claim.page.title' })} · VICI</title>
</svelte:head>

{#if enabled}
	<div class="claim-page">
		<div class="claim-card">
			<div class="claim-logo">
				<Logo />
			</div>

			<h1 class="claim-title">{t({ locale: $localeStore, key: 'claim.page.title' })}</h1>

			{#if stage === 'loading'}
				<div class="claim-center" aria-live="polite" role="status">
					<LoadingSpinner size="lg" />
				</div>
			{:else if stage === 'missing'}
				<p class="claim-copy">{t({ locale: $localeStore, key: 'claim.page.missing' })}</p>
			{:else if stage === 'signin'}
				<p class="claim-copy">{t({ locale: $localeStore, key: 'claim.page.signin_hint' })}</p>
				<SignInProviderStackWeb2 />
			{:else if stage === 'submitting'}
				<div class="claim-center" aria-live="polite" role="status">
					<LoadingSpinner size="lg" />
					<p class="claim-copy">{t({ locale: $localeStore, key: 'claim.page.verifying' })}</p>
				</div>
			{:else if stage === 'done'}
				<p class="claim-success">{t({ locale: $localeStore, key: 'claim.page.success_title' })}</p>
				<p class="claim-copy">
					{nonNullish(outcome) && outcome.kind === 'already_linked'
						? t({ locale: $localeStore, key: 'claim.page.already_linked' })
						: t({ locale: $localeStore, key: 'claim.page.success_body' })}
				</p>
				<Button onclick={() => void goto(resolve(AppPath.Home))} size="lg" variant="primary">
					{t({ locale: $localeStore, key: 'claim.page.open_app_cta' })}
				</Button>
			{:else}
				<p class="claim-error">{t({ locale: $localeStore, key: errorKey })}</p>
				{#if nonNullish(outcome) && outcome.kind === 'error' && outcome.code === 'generic'}
					<Button onclick={retry} size="lg" variant="secondary">
						{t({ locale: $localeStore, key: 'claim.page.retry_cta' })}
					</Button>
				{/if}
			{/if}
		</div>
	</div>
{/if}

<style lang="postcss">
	.claim-page {
		min-height: 100dvh;
		display: grid;
		place-items: center;
		padding: 1.5rem;
		padding-top: calc(1.5rem + env(safe-area-inset-top, 0px));
		background: var(--bg-base);
		color: var(--text-base);
	}

	.claim-card {
		width: 100%;
		max-width: 26rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.claim-logo {
		display: flex;
		justify-content: center;
	}

	.claim-title {
		margin: 0;
		font-size: 1.375rem;
		font-weight: 800;
		text-align: center;
	}

	.claim-center {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem 0;
	}

	.claim-copy {
		margin: 0;
		font-size: 0.9375rem;
		line-height: 1.45;
		text-align: center;
		color: var(--text-muted);
	}

	.claim-success {
		margin: 0;
		font-size: 1.0625rem;
		font-weight: 700;
		text-align: center;
		color: var(--accent);
	}

	.claim-error {
		margin: 0;
		font-size: 0.9375rem;
		line-height: 1.45;
		text-align: center;
		color: var(--danger);
	}
</style>
