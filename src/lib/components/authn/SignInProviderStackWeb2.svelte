<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import { ChevronRight, Mail } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import IconApple from '$lib/components/icons/IconApple.svelte';
	import IconGoogle from '$lib/components/icons/IconGoogle.svelte';
	import IconPasskey from '$lib/components/icons/IconPasskey.svelte';
	import { track } from '$lib/services/analytics.services';
	import { localeStore } from '$lib/stores/locale.store';
	import { t } from '$lib/utils/i18n.utils';
	import {
		getProviders,
		googleSignInUrl,
		requestOtp,
		verifyOtp,
		Web2ApiError,
		type Web2Providers
	} from '$lib/web2/client';
	import { adoptWeb2Session } from '$lib/web2/session';

	interface Props {
		onSuccess?: () => void;
		// External gate mirroring the on-chain stack: when true every control is
		// inert (onboarding holds this until a handle is claimed).
		disabled?: boolean;
	}

	const { onSuccess, disabled = false }: Props = $props();

	// Optimistic defaults so the stack renders immediately; the real statuses
	// arrive from `/auth/providers` on mount. Apple ships disabled either way
	// (the address flow is not wired on the client yet), and passkey has no
	// web2 counterpart at all, so both read as "coming soon".
	let providers = $state<Web2Providers>({
		email: 'available',
		google: 'available',
		apple: 'coming_soon'
	});

	// Email OTP is a two-step flow: request a code, then verify it. The stage
	// drives which sub-form shows.
	type Stage = 'email' | 'code';
	let stage = $state<Stage>('email');
	let email = $state('');
	let code = $state('');
	let busy = $state(false);
	let errorKey = $state<'signin.otp.error' | 'signin.beta_closed' | null>(null);

	// The API refuses gated sign-ins with the stable `beta_closed` code; map it
	// to the private-beta message instead of the generic retry copy.
	const errorKeyFor = (err: unknown): 'signin.otp.error' | 'signin.beta_closed' =>
		err instanceof Web2ApiError && err.code === 'beta_closed'
			? 'signin.beta_closed'
			: 'signin.otp.error';

	const emailValid = $derived(/\S+@\S+\.\S+/.test(email));
	const codeValid = $derived(code.trim().length > 0);
	const googleAvailable = $derived(providers.google === 'available');
	const blocked = $derived(busy || disabled);

	onMount(async () => {
		// A gated OAuth sign-in lands back on `/signin?e=beta` (a redirect flow
		// cannot carry a JSON error body, and this screen is where the message
		// can be shown); surface the private-beta message and strip the marker
		// so it does not outlive this screen.
		const url = new URL(window.location.href);

		if (url.searchParams.get('e') === 'beta') {
			errorKey = 'signin.beta_closed';
			url.searchParams.delete('e');
			history.replaceState(null, '', url);
		}

		try {
			providers = await getProviders();
		} catch (err: unknown) {
			// Provider discovery is best-effort: keep the optimistic defaults so the
			// user can still attempt email sign-in when the probe fails.
			console.error('failed to load auth providers', err);
		}
	});

	const onGoogle = () => {
		if (blocked || !googleAvailable) {
			return;
		}

		// Full-page handoff: the API sets a signed state cookie and 302s to
		// Google, then redirects back to the app where `Authn` picks up the
		// session. `returnTo` is the in-app path to land on after the callback;
		// the API only accepts same-app absolute paths (never a full URL), so
		// send path + query + hash rather than `location.href`.
		const { pathname, search, hash } = window.location;

		window.location.assign(googleSignInUrl({ returnTo: `${pathname}${search}${hash}` }));
	};

	const onEmailSubmit = async (event: SubmitEvent) => {
		event.preventDefault();

		if (!emailValid || blocked) {
			return;
		}

		busy = true;
		errorKey = null;

		try {
			await requestOtp({ email: email.trim() });

			stage = 'code';
			code = '';
		} catch (err: unknown) {
			console.error('otp request failed', err);
			errorKey = errorKeyFor(err);
		} finally {
			busy = false;
		}
	};

	const onCodeSubmit = async (event: SubmitEvent) => {
		event.preventDefault();

		if (!codeValid || blocked) {
			return;
		}

		busy = true;
		errorKey = null;

		try {
			const user = await verifyOtp({ email: email.trim(), code: code.trim() });

			adoptWeb2Session(user);

			// Mirror the on-chain stack: fire at the success boundary so the event
			// carries the now-authenticated session. The address is never a prop.
			track({ name: 'signed_in', source: 'signin_screen', label: 'email' });

			onSuccess?.();
		} catch (err: unknown) {
			console.error('otp verify failed', err);
			errorKey = errorKeyFor(err);
		} finally {
			busy = false;
		}
	};

	const onBack = () => {
		if (busy) {
			return;
		}

		stage = 'email';
		code = '';
		errorKey = null;
	};
</script>

<div class="signin-providers signin-providers-equal">
	<!-- Google — full-page redirect handled by the API. -->
	<button
		class="signin-provider-btn is-onboarding ob-dark"
		disabled={blocked || !googleAvailable}
		onclick={onGoogle}
		type="button"
	>
		<span class="signin-provider-icon" aria-hidden="true">
			<IconGoogle size="18px" />
		</span>
		<span class="signin-provider-label">
			{t({ locale: $localeStore, key: 'signin.provider.google' })}
		</span>
	</button>

	<!-- Email — one-time code (no passkey / magic link on this transport). -->
	{#if stage === 'email'}
		<form class="signin-email-inline" onsubmit={onEmailSubmit}>
			<div class="signin-email-row">
				<span class="signin-email-icon" aria-hidden="true">
					<Mail size={16} strokeWidth={1.8} />
				</span>
				<input
					class="signin-email-input num"
					aria-label={t({ locale: $localeStore, key: 'signin.email.aria' })}
					autocapitalize="off"
					autocomplete="email"
					disabled={blocked}
					inputmode="email"
					placeholder={t({ locale: $localeStore, key: 'signin.email.placeholder' })}
					spellcheck="false"
					type="email"
					bind:value={email}
				/>
			</div>
			<button class="signin-email-submit" disabled={!emailValid || blocked} type="submit">
				{busy
					? t({ locale: $localeStore, key: 'signin.loading.email' })
					: t({ locale: $localeStore, key: 'signin.email.cta' })}
				{#if !busy}
					<ChevronRight aria-hidden="true" size={16} strokeWidth={2.2} />
				{/if}
			</button>
			{#if nonNullish(errorKey)}
				<p class="signin-otp-error">{t({ locale: $localeStore, key: errorKey })}</p>
			{/if}
		</form>
	{:else}
		<form class="signin-email-inline" onsubmit={onCodeSubmit}>
			<p class="signin-otp-sent">
				{t({ locale: $localeStore, key: 'signin.otp.sent', params: { email: email.trim() } })}
			</p>
			<div class="signin-email-row">
				<!-- svelte-ignore a11y_autofocus -->
				<input
					class="signin-email-input num"
					aria-label={t({ locale: $localeStore, key: 'signin.otp.aria' })}
					autocapitalize="off"
					autocomplete="one-time-code"
					autofocus
					disabled={blocked}
					inputmode="numeric"
					placeholder={t({ locale: $localeStore, key: 'signin.otp.placeholder' })}
					spellcheck="false"
					type="text"
					bind:value={code}
				/>
			</div>
			<button class="signin-email-submit" disabled={!codeValid || blocked} type="submit">
				{busy
					? t({ locale: $localeStore, key: 'signin.loading.email' })
					: t({ locale: $localeStore, key: 'signin.otp.verify_cta' })}
				{#if !busy}
					<ChevronRight aria-hidden="true" size={16} strokeWidth={2.2} />
				{/if}
			</button>
			{#if nonNullish(errorKey)}
				<p class="signin-otp-error">{t({ locale: $localeStore, key: errorKey })}</p>
			{/if}
			<button class="signin-otp-back" disabled={busy} onclick={onBack} type="button">
				{t({ locale: $localeStore, key: 'signin.otp.back' })}
			</button>
		</form>
	{/if}

	<!-- Apple + Passkey — surfaced but disabled: neither is wired on this
			 transport yet, so both read "coming soon" from provider discovery. -->
	<button class="signin-provider-btn is-onboarding ob-faint" disabled type="button">
		<span class="signin-provider-icon" aria-hidden="true">
			<IconApple size="18px" />
		</span>
		<span class="signin-provider-label">
			{t({ locale: $localeStore, key: 'signin.provider.apple' })}
		</span>
		<span class="signin-provider-soon">
			{t({ locale: $localeStore, key: 'signin.provider.coming_soon' })}
		</span>
	</button>

	<button class="signin-provider-btn is-onboarding ob-faint" disabled type="button">
		<span class="signin-provider-icon" aria-hidden="true">
			<IconPasskey size="18px" />
		</span>
		<span class="signin-provider-label">
			{t({ locale: $localeStore, key: 'authn.passkey.signin_button' })}
		</span>
		<span class="signin-provider-soon">
			{t({ locale: $localeStore, key: 'signin.provider.coming_soon' })}
		</span>
	</button>
</div>

<style lang="postcss">
	.signin-otp-sent {
		margin: 0 0 0.25rem;
		font-size: 0.8125rem;
		color: var(--color-muted-foreground);
	}

	.signin-otp-error {
		margin: 0.25rem 0 0;
		font-size: 0.8125rem;
		color: var(--color-destructive);
	}

	.signin-otp-back {
		margin-top: 0.25rem;
		align-self: flex-start;
		background: none;
		border: none;
		padding: 0;
		font-size: 0.8125rem;
		color: var(--color-muted-foreground);
		cursor: pointer;
	}

	.signin-otp-back:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.signin-provider-soon {
		margin-left: auto;
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		opacity: 0.7;
	}
</style>
