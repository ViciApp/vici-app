<script lang="ts">
	/**
	 * Landing surface — a conversion-first, entertainment-first page.
	 *
	 * Sections, top to bottom:
	 *   1. WelcomeNav (desktop + mobile)
	 *   2. WelcomeHero — interactive swipe card + payoff celebration
	 *   3. WelcomeStatus — 3-tab accuracy slider (auto-rotating)
	 *   4. WelcomeProof — how-it-works + live count + calls ticker
	 *   5. WelcomeTrust — condensed trust one-liner
	 *   6. WelcomeFAQ — visitor-stage questions
	 *   7. WelcomeClose — Latin motto + closing CTA
	 *   8. WelcomeFooter — FIFA mark + disclosure
	 *
	 * The whole tree is wrapped in `.lpc .lp-root` so it picks up both the
	 * landing-conversion layout layer (the warm parchment field + section
	 * rhythm) and the shared landing primitives (`.flow-card`, `.tag`,
	 * `.btn`, …) from `src/landing.css`.
	 */
	import { onMount } from 'svelte';
	import WelcomeClose from '#lib/components/landing/WelcomeClose.svelte';
	import WelcomeFAQ from '#lib/components/landing/WelcomeFAQ.svelte';
	import WelcomeFooter from '#lib/components/landing/WelcomeFooter.svelte';
	import WelcomeHero from '#lib/components/landing/WelcomeHero.svelte';
	import WelcomeProof from '#lib/components/landing/WelcomeProof.svelte';
	import WelcomeStatus from '#lib/components/landing/WelcomeStatus.svelte';
	import WelcomeTrust from '#lib/components/landing/WelcomeTrust.svelte';
	import WelcomeNav from '#lib/components/layout/WelcomeNav.svelte';

	onMount(() => {
		document.title = 'VICI';

		// Opt the landing into the contained-scroll viewport (see `.lpc` in
		// `landing.css`). On iOS this moves scrolling off the document into
		// `.lpc`, so the address bar never collapses mid-scroll and the sticky
		// nav can't judder — the same model the authenticated app shell uses.
		// The flag scopes the body lock to this page; every other route keeps
		// its natural body scroll.
		document.documentElement.dataset.landingScroll = '1';

		return () => {
			delete document.documentElement.dataset.landingScroll;
		};
	});
</script>

<div class="lpc lp-root">
	<WelcomeNav />

	<main id="main">
		<WelcomeHero />
		<WelcomeStatus />
		<WelcomeProof />
		<WelcomeTrust />
		<WelcomeFAQ />
		<WelcomeClose />
	</main>

	<WelcomeFooter />
</div>
