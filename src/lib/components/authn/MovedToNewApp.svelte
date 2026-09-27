<script lang="ts">
	import { isNullish } from '@dfinity/utils';
	import { onMount } from 'svelte';
	import { pinToVisualViewport } from '$lib/actions/pin-to-visual-viewport';
	import { TestId } from '$lib/constants/test-ids.constants';
	import { loadNewAppSignupUrl, newAppDomain } from '$lib/services/new-app-redirect.services';
	import { localeStore } from '$lib/stores/locale.store';
	import { createFocusTrap } from '$lib/utils/focus-trap.utils';
	import { t, type MessageKey } from '$lib/utils/i18n.utils';

	interface Props {
		// `signup`: rendered in place of the sign-up flow, for a visitor who
		// has not signed in. `new_account`: a modal over the app for a sign-in
		// that resolved to a principal with no account here, which the auth
		// layer has already signed back out.
		reason: 'signup' | 'new_account';
		onSignIn: () => void;
	}

	const { reason, onSignIn }: Props = $props();

	const DOMAIN_PLACEHOLDER = '{domain}';
	const titleId = $props.id();

	// Read once: the stash only changes on the invite landings, which navigate
	// here rather than mutating it under a mounted screen.
	const newAppUrl = loadNewAppSignupUrl();
	const domain = newAppDomain();

	const isOverlay = $derived(reason === 'new_account');
	const subKey = $derived<MessageKey>(
		isOverlay ? 'claim.moved.sub_new_account' : 'claim.moved.sub_signup'
	);
	const footerPromptKey = $derived<MessageKey>(
		isOverlay ? 'claim.moved.footer.prompt_new_account' : 'claim.moved.footer.prompt_signup'
	);
	const footerCtaKey = $derived<MessageKey>(
		isOverlay ? 'claim.moved.footer.cta_new_account' : 'claim.moved.footer.cta_signup'
	);

	const titleParts = $derived.by(() => {
		const template = t({ locale: $localeStore, key: 'claim.moved.title' });
		const index = template.indexOf(DOMAIN_PLACEHOLDER);

		if (index < 0) {
			return { before: template, after: '' };
		}

		return {
			before: template.slice(0, index),
			after: template.slice(index + DOMAIN_PLACEHOLDER.length)
		};
	});

	let dialogEl = $state<HTMLDivElement | undefined>(undefined);

	onMount(() => {
		if (isNullish(dialogEl)) {
			return;
		}

		// The overlay covers a live app shell; trap Tab inside it so the page
		// underneath is not keyboard-reachable while the message is up.
		const trap = createFocusTrap(dialogEl);

		trap.activate();

		return () => trap.deactivate();
	});
</script>

{#snippet card()}
	<div class="signin-wrap" data-tid={TestId.MovedToNewApp}>
		<div class="signin-card">
			<div class="signin-cluster">
				<div class="signin-head">
					<span class="signin-wordmark" aria-label="VICI">
						<span class="signin-wordmark-letters">VICI</span>
					</span>
					<p class="signin-eyebrow">{t({ locale: $localeStore, key: 'claim.moved.eyebrow' })}</p>
					<h1 id={titleId} class="signin-title">
						{titleParts.before}<span class="serif-italic acc">{domain}</span>{titleParts.after}
					</h1>
					<p class="signin-sub">
						{t({ locale: $localeStore, key: subKey, params: { domain } })}
					</p>
				</div>

				<a
					class="signin-email-submit no-underline"
					data-tid={TestId.MovedToNewAppCta}
					href={newAppUrl}
				>
					{t({ locale: $localeStore, key: 'claim.moved.cta', params: { domain } })}
				</a>
			</div>

			<div class="signin-foot">
				<span class="mute">{t({ locale: $localeStore, key: footerPromptKey })}</span>
				<button
					class="signin-link"
					data-tid={TestId.MovedToNewAppSignIn}
					onclick={onSignIn}
					type="button"
				>
					{t({ locale: $localeStore, key: footerCtaKey })}
				</button>
			</div>
		</div>
	</div>
{/snippet}

{#if isOverlay}
	<div
		bind:this={dialogEl}
		class="fixed inset-0 z-[90] outline-none"
		aria-labelledby={titleId}
		aria-modal="true"
		role="dialog"
		tabindex="-1"
		use:pinToVisualViewport
	>
		{@render card()}
	</div>
{:else}
	{@render card()}
{/if}
