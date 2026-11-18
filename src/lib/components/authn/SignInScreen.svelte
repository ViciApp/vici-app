<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import { onMount } from 'svelte';
	import SignInProviderStack from '#lib/components/authn/SignInProviderStack.svelte';
	import { PENDING_ONBOARDING_STORAGE_KEY } from '#lib/constants/profile.constants.ts';
	import { AppPath, PublicPath } from '#lib/constants/routes.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { browser } from '$app/env';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	interface Props {
		// Mode: `signin` for returning users (welcome-back framing),
		// `signup` for new accounts.
		mode?: 'signin' | 'signup';
		// Callback for after a successful auth handshake. Defaults to
		// navigating to `AppPath.Flow`; the canonical first surface for
		// every authenticated session; routes calling this from a layout
		// can pass a different post-auth target.
		onSuccess?: () => void;
	}

	const {
		mode = 'signin',
		onSuccess = () => {
			void goto(resolveAppPath(AppPath.Flow));
		}
	}: Props = $props();

	const BRAND_PLACEHOLDER = '{brand}';
	const isSignUp = $derived(mode === 'signup');
	let hasPendingOnboarding = $state(false);

	onMount(() => {
		if (!browser) {
			return;
		}

		hasPendingOnboarding = nonNullish(localStorage.getItem(PENDING_ONBOARDING_STORAGE_KEY));
	});

	const onboardingComplete = $derived(
		page.url.searchParams.get('onboarded') === '1' || hasPendingOnboarding
	);

	// The signin hero ("Welcome back.") already carries the welcome beat in its
	// accent word, so the eyebrow would only echo it: drop it on the signin
	// path. Signup/onboarded keep their distinct eyebrows.
	const eyebrowKey = $derived<MessageKey | null>(
		onboardingComplete ? 'signin.eyebrow.onboarded' : isSignUp ? 'signin.eyebrow.signup' : null
	);
	const titleKey = $derived<MessageKey>(
		onboardingComplete
			? 'signin.title.onboarded'
			: isSignUp
				? 'signin.title.signup'
				: 'signin.title.signin'
	);
	// The accent word that fills the title's `{brand}` slot, per mode: signup /
	// onboarded keep the "VICI." brand accent, signin reads "back." so the hero
	// mirrors V3's serif-italic-accent headline (`Claim your *handle.*`).
	const titleAccentKey = $derived<MessageKey>(
		onboardingComplete
			? 'signin.title.accent.onboarded'
			: isSignUp
				? 'signin.title.accent.signup'
				: 'signin.title.accent.signin'
	);
	const subcopyKey = $derived<MessageKey>(
		onboardingComplete
			? 'signin.sub.onboarded'
			: isSignUp
				? 'signin.sub.signup'
				: 'signin.sub.signin'
	);
	const footerPromptKey = $derived<MessageKey>(
		isSignUp ? 'signin.footer.prompt.signin' : 'signin.footer.prompt.signup'
	);
	const footerCtaKey = $derived<MessageKey>(
		isSignUp ? 'signin.footer.cta.signin' : 'signin.footer.cta.signup'
	);
	const titleTemplate = $derived(t({ locale: $localeStore, key: titleKey }));
	const titleAccent = $derived(t({ locale: $localeStore, key: titleAccentKey }));
	const titleParts = $derived.by(() => {
		const brandIndex = titleTemplate.indexOf(BRAND_PLACEHOLDER);

		if (brandIndex < 0) {
			return { before: titleTemplate, after: '' };
		}

		return {
			before: titleTemplate.slice(0, brandIndex),
			after: titleTemplate.slice(brandIndex + BRAND_PLACEHOLDER.length)
		};
	});

	const termsHref = `${PublicPath.Info}/terms`;
	const privacyHref = `${PublicPath.Info}/privacy`;

	const handleSwitch = () => {
		void goto(resolve(isSignUp ? PublicPath.SignIn : PublicPath.SignUp));
	};
</script>

<div class="signin-wrap">
	<div class="signin-card">
		<div class="signin-cluster">
			<div class="signin-head">
				<span class="signin-wordmark" aria-label="VICI">
					<span class="signin-wordmark-letters">VICI</span>
				</span>
				{#if nonNullish(eyebrowKey)}
					<p class="signin-eyebrow">{t({ locale: $localeStore, key: eyebrowKey })}</p>
				{/if}
				<h1 class="signin-title">
					{titleParts.before}<span class="serif-italic acc">{titleAccent}</span>{titleParts.after}
				</h1>
				<p class="signin-sub">{t({ locale: $localeStore, key: subcopyKey })}</p>
			</div>

			<SignInProviderStack {mode} {onSuccess} />
		</div>

		<div class="signin-foot">
			<span class="mute">{t({ locale: $localeStore, key: footerPromptKey })}</span>
			<button class="signin-link" onclick={handleSwitch} type="button">
				{t({ locale: $localeStore, key: footerCtaKey })}
			</button>
		</div>
	</div>

	<div class="signin-legal">
		<p class="signin-legal-line">
			{t({ locale: $localeStore, key: 'signin.legal.line1' })}
		</p>
		<p class="signin-legal-line dim">
			{t({ locale: $localeStore, key: 'signin.legal.line2.prefix' })}
			<a href={termsHref}>{t({ locale: $localeStore, key: 'signin.legal.terms' })}</a>
			{t({ locale: $localeStore, key: 'signin.legal.line2.and' })}
			<a href={privacyHref}>{t({ locale: $localeStore, key: 'signin.legal.privacy' })}</a>.
		</p>
	</div>
</div>
