<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { isWebAuthnAvailable, signIn, signUp } from '@junobuild/core';
	import { ChevronRight, Mail } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import SignInProviderStackWeb2 from '#lib/components/authn/SignInProviderStackWeb2.svelte';
	import IconApple from '#lib/components/icons/IconApple.svelte';
	import IconGoogle from '#lib/components/icons/IconGoogle.svelte';
	import IconIc from '#lib/components/icons/IconIC.svelte';
	import IconPasskey from '#lib/components/icons/IconPasskey.svelte';
	import IconRobot from '#lib/components/icons/IconRobot.svelte';
	import { II_MAX_TIME_TO_LIVE_NS } from '#lib/constants/app.constants.ts';
	import { PENDING_ONBOARDING_STORAGE_KEY } from '#lib/constants/profile.constants.ts';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { TestId } from '#lib/constants/test-ids.constants.ts';
	import { isDev, isNotSkylab, isProd } from '#lib/env/app.env.ts';
	import { track } from '#lib/services/analytics.services.ts';
	import {
		AppleSignInCancelledError,
		signInWithApple
	} from '#lib/services/apple-signin.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { isWeb2Backend } from '#lib/web2/backend-mode.ts';

	interface Props {
		onSuccess?: () => void;
		// `signup` for new accounts (onboarding), `signin` for returning
		// users (the /signin gate and every "sign in to continue" modal).
		// Only the WebAuthn passkey path branches on this: Juno splits
		// `signUp` (create a new passkey, which is the only call that can
		// name it) from `signIn` (authenticate an existing one).
		mode?: 'signin' | 'signup';
		// Onboarding handle, used only to label a freshly-created passkey
		// (`VICI · {handle}`) so it's recognizable in the OS / password
		// manager. Absent → a plain `VICI` label. The user can rename it
		// afterwards from their authenticator.
		handle?: string | null;
		// External gate: when true every provider is inert. The one-screen
		// onboarding sets this until a valid handle is claimed, so auth can't
		// start before there's a name to attach to the account.
		disabled?: boolean;
	}

	const { onSuccess, mode = 'signin', handle = null, disabled = false }: Props = $props();

	const isSignUp = $derived(mode === 'signup');

	// Friendly display name for a newly-created passkey. Shown by the
	// authenticator's account picker; not required to be unique and freely
	// renamable by the user later.
	const passkeyDisplayName = $derived(
		nonNullish(handle) && handle.trim().length > 0 ? `VICI · ${handle.trim()}` : 'VICI'
	);

	// Provider IDs used to drive per-provider loading + faded-others state.
	type ProviderId = 'apple' | 'google' | 'email' | 'ii' | 'passkey' | 'dev';

	// Per-provider visibility flags: show/hide the button entirely.
	// Apple is flag-off: returning V3 users never created an account with it,
	// so offering it was misleading. `onApple` / `apple-signin.services` / the
	// Apple icon + keys stay dormant behind this flag (reversible).
	const APPLE_LOGIN_ENABLED = false;
	const GOOGLE_LOGIN_ENABLED = true;
	const EMAIL_LOGIN_ENABLED = true;
	const INTERNET_IDENTITY_LOGIN_ENABLED = false;
	const PASSKEY_LOGIN_ENABLED = true;
	const DEV_LOGIN_ENABLED = true;

	let signingIn = $state<ProviderId | null>(null);
	let emailOpen = $state(false);
	let email = $state('');

	// Passkey (WebAuthn) is only worth offering on platforms that can
	// actually complete the ceremony: otherwise the button is a dead
	// end. The capability probe is async, so resolve it on mount and
	// hide the provider when it isn't available.
	let passkeyAvailable = $state(true);

	onMount(async () => {
		passkeyAvailable = await isWebAuthnAvailable();
	});

	const productionAvailable = $derived(isProd() && isNotSkylab());
	const emailValid = $derived(/\S+@\S+\.\S+/.test(email));
	// A provider can't be started while another is resolving, or while the
	// host has gated the stack (`disabled`).
	const isBusy = $derived(nonNullish(signingIn));
	const blocked = $derived(isBusy || disabled);
	// When the email row is expanded the other providers dim to 0.4.
	const isFaded = $derived(emailOpen && isNullish(signingIn));

	// Record which provider finished the onboarding flow into the pending
	// stash, BEFORE the provider runs; a redirect provider (Google) navigates
	// away inside `run()`, so this is the only point the provider id can be
	// captured for the post-redirect drain's `onboarding_completed` analytics.
	// Single-field merge, mirroring `stashPendingEmail`. Signup only: a
	// returning-user sign-in has no onboarding to attribute, and a lone
	// `{ provider }` payload is dropped by the drain's parser anyway.
	const stashPendingProvider = (id: ProviderId): void => {
		if (!isSignUp) {
			return;
		}

		try {
			const raw = localStorage.getItem(PENDING_ONBOARDING_STORAGE_KEY);
			const parsed: Record<string, unknown> = nonNullish(raw)
				? ((): Record<string, unknown> => {
						try {
							const value: unknown = JSON.parse(raw);

							return typeof value === 'object' && nonNullish(value)
								? (value as Record<string, unknown>)
								: {};
						} catch {
							return {};
						}
					})()
				: {};
			parsed.provider = id;
			localStorage.setItem(PENDING_ONBOARDING_STORAGE_KEY, JSON.stringify(parsed));
		} catch {
			// Storage unavailable (private mode): analytics provenance is lost,
			// sign-in still works.
		}
	};

	const startSignIn = async ({
		id,
		run
	}: {
		id: ProviderId;
		run: () => Promise<void>;
	}): Promise<void> => {
		if (nonNullish(signingIn)) {
			return;
		}

		signingIn = id;
		stashPendingProvider(id);

		try {
			await run();

			// Fire at the success boundary so the now-authenticated principal is
			// stitched onto the event (identity is absent before sign-in). `email`
			// resolves to a passkey ceremony but stays a distinct user-facing
			// choice; the address itself is never a prop (no PII). The sign-up
			// counterpart belongs to the out-of-scope onboarding funnel.
			if (!isSignUp) {
				track({ name: 'signed_in', source: 'signin_screen', label: id });
			}

			onSuccess?.();
		} catch (err: unknown) {
			console.error(`${id} sign-in failed`, err);
		} finally {
			signingIn = null;
		}
	};

	// Apple sign-in routes through Internet Identity 2.0's OpenID flow
	// (Juno has no Apple provider), so it bypasses Juno's `signIn()` and
	// drives `@icp-sdk/auth` directly via `signInWithApple`. That persists
	// the delegation to the same store Juno reads but does NOT update
	// Juno's in-memory auth state: so we can't use the shared `startSignIn`
	// (whose success path assumes Juno is already aware of the session).
	// Instead: flush host state via `onSuccess` (in the signup onboarding
	// flow that persists the pending picks to storage), then hard-load Flow.
	// A full document load re-runs `initSatellite()` / `loadAuth()`, which
	// adopts the persisted delegation, fires `onAuthStateChange`, and (via
	// the (app) layout) drains any pending onboarding. The signed-out bounce
	// waits for the auth handshake, so there's no signin flash.
	const onApple = async () => {
		if (nonNullish(signingIn)) {
			return;
		}

		signingIn = 'apple';
		stashPendingProvider('apple');

		try {
			await signInWithApple();
		} catch (err: unknown) {
			if (!(err instanceof AppleSignInCancelledError)) {
				console.error('apple sign-in failed', err);
			}

			signingIn = null;

			return;
		}

		onSuccess?.();

		window.location.assign(resolveAppPath(AppPath.Flow));
	};

	const onGoogle = () =>
		startSignIn({
			id: 'google',
			run: async () => {
				await signIn({
					google: {
						options: {
							redirect: {
								clientId: isDev()
									? '794351932143-em7c7j4rko2ok5fhk4crhv6f44ifmpqv.apps.googleusercontent.com'
									: '215111139647-7hat1jefroe7tkgu5kds4s8sv4dgf3fu.apps.googleusercontent.com',
								redirectUrl: `${window.location.origin}/auth/callback/google`
							}
						}
					}
				});
			}
		});

	const onIi = () =>
		startSignIn({
			id: 'ii',
			run: async () => {
				await signIn({
					internet_identity: {
						options: {
							maxTimeToLiveInNanoseconds: II_MAX_TIME_TO_LIVE_NS
						}
					}
				});
			}
		});

	// Passkey is the one provider where Juno splits create-vs-authenticate.
	// In the sign-up flow we register a NEW passkey (`signUp`); the only
	// call that accepts a display name, so this is where the `VICI · {handle}`
	// label is set. Everywhere else (the /signin gate, "sign in to continue"
	// modals) we authenticate an EXISTING passkey (`signIn`).
	const onPasskey = () =>
		startSignIn({
			id: 'passkey',
			run: async () => {
				if (isSignUp) {
					await signUp({
						webauthn: {
							options: {
								passkey: { user: { displayName: passkeyDisplayName, name: passkeyDisplayName } }
							}
						}
					});

					return;
				}

				await signIn({ webauthn: {} });
			}
		});

	const onDev = () =>
		startSignIn({
			id: 'dev',
			run: async () => {
				await signIn({ dev: {} });
			}
		});

	const onEmailOpen = () => {
		if (isBusy) {
			return;
		}

		emailOpen = true;
	};

	// Merge the address into the pending-onboarding payload so the
	// post-sign-in drain in `(app)/+layout.svelte` persists it onto the
	// freshly-created profile (the WebAuthn `User` carries no email of its
	// own). Mirrors the single-field merge `/i/[code]` and `/league/[code]`
	// already do for their codes. Best-effort: the email is a profile
	// nicety, not required for auth to succeed.
	const stashPendingEmail = (address: string): void => {
		try {
			const raw = localStorage.getItem(PENDING_ONBOARDING_STORAGE_KEY);
			const parsed: Record<string, unknown> = nonNullish(raw)
				? ((): Record<string, unknown> => {
						try {
							const value: unknown = JSON.parse(raw);

							return typeof value === 'object' && nonNullish(value)
								? (value as Record<string, unknown>)
								: {};
						} catch {
							return {};
						}
					})()
				: {};
			parsed.email = address;
			localStorage.setItem(PENDING_ONBOARDING_STORAGE_KEY, JSON.stringify(parsed));
		} catch {
			// Storage unavailable (private mode): sign-in still works, the
			// address just won't be persisted to the profile.
		}
	};

	// Email accounts are passkey-backed: there is no magic link. On sign-up
	// we register a new passkey (labelled by the address) and stash the
	// address for the profile; on sign-in we authenticate the existing
	// passkey (the address is already on the profile from sign-up).
	const onEmailSubmit = (event: SubmitEvent) => {
		event.preventDefault();

		if (!emailValid || isBusy || !productionAvailable) {
			return;
		}

		const address = email.trim();

		void startSignIn({
			id: 'email',
			run: async () => {
				if (isSignUp) {
					await signUp({
						webauthn: {
							options: { passkey: { user: { displayName: address, name: address } } }
						}
					});

					// Stash only AFTER the passkey ceremony succeeds; a cancelled
					// or failed `signUp` throws here, so the address never lingers
					// in pending-onboarding to be wrongly applied to a later
					// successful sign-up (e.g. a Passkey attempt after a cancelled
					// email one).
					stashPendingEmail(address);

					return;
				}

				await signIn({ webauthn: {} });
			}
		});
	};
</script>

{#if isWeb2Backend()}
	<!-- Web2 backend: cookie sessions replace the on-chain identity flow, so the
			 provider handlers are entirely different (email one-time code, API-driven
			 Google redirect, coming-soon Apple/Passkey). The on-chain stack below is
			 left untouched and renders whenever the flag is off (the default). -->
	<SignInProviderStackWeb2 {disabled} {onSuccess} />
{:else}
	<div class="signin-providers signin-providers-equal">
		<!-- Apple: live via Internet Identity 2.0 OpenID one-click. -->
		{#if APPLE_LOGIN_ENABLED}
			<button
				class="signin-provider-btn is-onboarding ob-dark"
				class:is-faded={isFaded}
				class:is-loading={signingIn === 'apple'}
				aria-busy={signingIn === 'apple'}
				disabled={blocked}
				onclick={onApple}
				type="button"
			>
				<span class="signin-provider-icon" aria-hidden="true">
					<IconApple size="18px" />
				</span>
				<span class="signin-provider-label">
					{signingIn === 'apple'
						? t({ locale: $localeStore, key: 'signin.loading.apple' })
						: t({ locale: $localeStore, key: 'signin.provider.apple' })}
				</span>
				{#if signingIn === 'apple'}
					<span class="signin-spinner" aria-hidden="true"></span>
				{/if}
			</button>
		{/if}

		<!-- Google: live. -->
		{#if GOOGLE_LOGIN_ENABLED}
			<button
				class="signin-provider-btn is-onboarding ob-dark"
				class:is-faded={isFaded}
				class:is-loading={signingIn === 'google'}
				aria-busy={signingIn === 'google'}
				disabled={blocked}
				onclick={onGoogle}
				type="button"
			>
				<span class="signin-provider-icon" aria-hidden="true">
					<IconGoogle size="18px" />
				</span>
				<span class="signin-provider-label">
					{signingIn === 'google'
						? t({ locale: $localeStore, key: 'signin.loading.google' })
						: t({ locale: $localeStore, key: 'signin.provider.google' })}
				</span>
				{#if signingIn === 'google'}
					<span class="signin-spinner" aria-hidden="true"></span>
				{/if}
			</button>
		{/if}

		<!-- Email: progressive disclosure. Passkey-backed (no magic link),
			 so it shares the WebAuthn capability + production gating. -->
		{#if EMAIL_LOGIN_ENABLED && passkeyAvailable}
			{#if !emailOpen}
				<button
					class="signin-provider-btn email is-onboarding ob-faint"
					class:is-faded={isFaded}
					disabled={blocked}
					onclick={onEmailOpen}
					type="button"
				>
					<span class="signin-provider-icon" aria-hidden="true">
						<Mail size={18} strokeWidth={1.8} />
					</span>
					<span class="signin-provider-label">
						{t({ locale: $localeStore, key: 'signin.provider.email' })}
					</span>
				</button>
			{:else}
				<form class="signin-email-inline" onsubmit={onEmailSubmit}>
					<div class="signin-email-row">
						<span class="signin-email-icon" aria-hidden="true">
							<Mail size={16} strokeWidth={1.8} />
						</span>
						<!-- svelte-ignore a11y_autofocus -->
						<input
							id="signin-email-input"
							class="signin-email-input num"
							autocapitalize="off"
							autocomplete="email webauthn"
							autofocus
							disabled={blocked || !productionAvailable}
							inputmode="email"
							placeholder={t({ locale: $localeStore, key: 'signin.email.placeholder' })}
							spellcheck="false"
							type="email"
							bind:value={email}
						/>
					</div>
					<button
						class="signin-email-submit"
						disabled={!emailValid || blocked || !productionAvailable}
						type="submit"
					>
						{signingIn === 'email'
							? t({ locale: $localeStore, key: 'signin.loading.email' })
							: t({ locale: $localeStore, key: 'signin.email.cta' })}
						{#if signingIn !== 'email'}
							<ChevronRight aria-hidden="true" size={16} strokeWidth={2.2} />
						{/if}
					</button>
					<p class="signin-fineprint">
						{t({ locale: $localeStore, key: 'signin.email.fineprint' })}
					</p>
				</form>
			{/if}
		{/if}

		<!-- Internet Identity: production-need. Uses the shared
			 `signin-provider-btn` style. -->
		{#if INTERNET_IDENTITY_LOGIN_ENABLED}
			<button
				class="signin-provider-btn is-onboarding ob-faint"
				class:is-faded={isFaded}
				class:is-loading={signingIn === 'ii'}
				aria-busy={signingIn === 'ii'}
				disabled={blocked || !productionAvailable}
				onclick={onIi}
				type="button"
			>
				<span class="signin-provider-icon" aria-hidden="true">
					<IconIc size="18px" />
				</span>
				<span class="signin-provider-label">
					{signingIn === 'ii'
						? t({ locale: $localeStore, key: 'signin.loading.ii' })
						: t({ locale: $localeStore, key: 'authn.signin_with.ii' })}
				</span>
				{#if signingIn === 'ii'}
					<span class="signin-spinner" aria-hidden="true"></span>
				{/if}
			</button>
		{/if}

		<!-- Passkey: production-need (C-8 keep). -->
		{#if PASSKEY_LOGIN_ENABLED && passkeyAvailable}
			<button
				class="signin-provider-btn is-onboarding ob-faint"
				class:is-faded={isFaded}
				class:is-loading={signingIn === 'passkey'}
				aria-busy={signingIn === 'passkey'}
				disabled={blocked || !productionAvailable}
				onclick={onPasskey}
				type="button"
			>
				<span class="signin-provider-icon" aria-hidden="true">
					<IconPasskey size="18px" />
				</span>
				<span class="signin-provider-label">
					{signingIn === 'passkey'
						? t({ locale: $localeStore, key: 'signin.loading.passkey' })
						: isSignUp
							? t({ locale: $localeStore, key: 'authn.passkey.create_button' })
							: t({ locale: $localeStore, key: 'authn.passkey.signin_button' })}
				</span>
				{#if signingIn === 'passkey'}
					<span class="signin-spinner" aria-hidden="true"></span>
				{/if}
			</button>
		{/if}

		<!-- Dev shortcut: dev-only. -->
		{#if DEV_LOGIN_ENABLED && isDev()}
			<button
				class="signin-provider-btn is-onboarding ob-faint"
				class:is-faded={isFaded}
				class:is-loading={signingIn === 'dev'}
				aria-busy={signingIn === 'dev'}
				data-tid={TestId.SignInDev}
				disabled={blocked}
				onclick={onDev}
				type="button"
			>
				<span class="signin-provider-icon" aria-hidden="true">
					<IconRobot size="18px" />
				</span>
				<span class="signin-provider-label">
					{signingIn === 'dev'
						? t({ locale: $localeStore, key: 'signin.loading.dev' })
						: t({ locale: $localeStore, key: 'signin.provider.dev' })}
				</span>
				{#if signingIn === 'dev'}
					<span class="signin-spinner" aria-hidden="true"></span>
				{/if}
			</button>
		{/if}
	</div>
{/if}
