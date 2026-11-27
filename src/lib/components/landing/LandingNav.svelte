<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import { onMount } from 'svelte';
	import LandingClaim from '#lib/components/landing/LandingClaim.svelte';
	import LandingNavSwitch from '#lib/components/landing/LandingNavSwitch.svelte';
	import {
		LANDING_CLAIM_MIN_ORIGIN_PX,
		LANDING_NAV_WORDMARK_SRC
	} from '#lib/constants/landing-claim.constants.ts';
	import { landingClaimStore } from '#lib/stores/landing-claim.store.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { LandingClaimSubmit, LandingView } from '#lib/types/landing-claim.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { readClaimedHandle, rememberClaimedHandle } from '#lib/utils/landing-claim.utils.ts';

	/**
	 * The landing's top bar: the wordmark, the Cards / Markets switch and the
	 * "Claim your @handle" button, which widens into the claim capsule
	 * (handle, email, code). Open it from anywhere on the page through
	 * `landingClaimStore.open({ ack })`.
	 */
	interface Props {
		// The waitlist calls behind the email and code steps.
		submit: LandingClaimSubmit;
		view?: LandingView;
		onview?: (view: LandingView) => void;
		// Fires once the waitlist holds the visitor's handle.
		onclaimed?: (handle: string) => void;
		// A passing line the button reads in place of its label, until a handle is claimed.
		nudge?: string;
		// Off when the page has one view only: the switch is not shown.
		canSwitch?: boolean;
	}

	const {
		submit,
		view = 'cards',
		onview = () => {},
		onclaimed = () => {},
		nudge,
		canSwitch = true
	}: Props = $props();

	let cta = $state<HTMLButtonElement>();
	let ctaWidth = $state(0);
	let claimedHandle = $state<string>();

	const claiming = $derived($landingClaimStore.open);

	onMount(() => {
		claimedHandle = readClaimedHandle();

		return () => landingClaimStore.reset();
	});

	const onClaimed = (handle: string) => {
		claimedHandle = handle;
		rememberClaimedHandle(handle);
		onclaimed(handle);
	};
</script>

<nav class="ln" class:is-claiming={claiming}>
	<img class="ln-mark" alt="VICI" height="274" src={LANDING_NAV_WORDMARK_SRC} width="1024" />
	<div class="ln-r">
		{#if canSwitch}
			<LandingNavSwitch {onview} {view} />
		{/if}
		<button
			bind:this={cta}
			class="ln-cta"
			aria-expanded={claiming}
			aria-haspopup="dialog"
			onclick={() => landingClaimStore.open()}
			type="button"
			bind:offsetWidth={ctaWidth}
		>
			{#if claimedHandle}
				{t({ locale: $localeStore, key: 'landing.nav.handle', params: { handle: claimedHandle } })}
			{:else if nonNullish(nudge)}
				<span role="status">{nudge}</span>
			{:else}
				<span class="ln-long">{t({ locale: $localeStore, key: 'landing.nav.claim' })}</span>
				<span class="ln-short">{t({ locale: $localeStore, key: 'landing.nav.claim_short' })}</span>
			{/if}
		</button>
	</div>
	<LandingClaim
		{claimedHandle}
		onclaimed={onClaimed}
		onreturnfocus={() => cta?.focus({ preventScroll: true })}
		originWidth={Math.max(LANDING_CLAIM_MIN_ORIGIN_PX, ctaWidth)}
		{submit}
	/>
</nav>

<style lang="postcss">
	.ln {
		--ln-pad: clamp(16px, 3vw, 32px);
		--ln-out: cubic-bezier(0.23, 1, 0.32, 1);
		position: fixed;
		inset: 0 0 auto 0;
		z-index: 30;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		padding: calc(16px + env(safe-area-inset-top, 0px)) var(--ln-pad) 0;
		pointer-events: none;
	}

	.ln > * {
		pointer-events: auto;
	}

	/* The artwork carries generous transparent margins; pull them in so the letters sit on the gutter. */
	.ln-mark {
		display: block;
		width: auto;
		height: 32px;
		margin: -6px -35px -10px -28px;
	}

	.ln-r {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.ln-r,
	.ln-mark {
		transition: opacity 140ms var(--ln-out);
	}

	/* The button has become the capsule; what sat beside it steps aside. */
	.ln.is-claiming .ln-r {
		opacity: 0;
		pointer-events: none;
	}

	.ln-cta {
		position: relative;
		padding: 12px 14px;
		border: 0;
		border-radius: 999px;
		background: var(--laurel);
		color: var(--ink);
		font: 600 15px/1 var(--font-display);
		white-space: nowrap;
		cursor: pointer;
		transition:
			transform 160ms var(--ln-out),
			background 180ms var(--ln-out);
	}

	/* A finger-sized target around the pill without growing it. */
	.ln-cta::after {
		content: '';
		position: absolute;
		inset: -6px -2px;
	}

	.ln-cta:active {
		transform: scale(0.96);
	}

	.ln-cta:focus-visible {
		outline: 2px solid var(--parchment);
		outline-offset: 3px;
	}

	.ln-short {
		display: none;
	}

	@media (hover: hover) and (pointer: fine) {
		.ln-cta:hover {
			background: color-mix(in srgb, var(--laurel) 86%, var(--parchment));
		}
	}

	@media (pointer: coarse) {
		.ln-cta {
			min-height: 44px;
		}
	}

	@media (max-width: 760px) {
		.ln.is-claiming .ln-mark {
			opacity: 0;
		}

		.ln-cta {
			padding-right: 12px;
			padding-left: 12px;
			font-size: 14px;
		}

		.ln-long {
			display: none;
		}

		.ln-short {
			display: inline;
		}
	}

	@media (max-width: 560px) {
		.ln-mark {
			height: 28px;
			margin: -5px -31px -8px -24px;
		}
	}

	@media (max-width: 520px) {
		.ln-r {
			gap: 4px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.ln-r,
		.ln-mark,
		.ln-cta {
			transition: none;
		}
	}
</style>
