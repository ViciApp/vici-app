<script lang="ts">
	/**
	 * Closing section — the Latin motto, the closing headline, and the
	 * final sign-up CTA. The earned payoff of the page.
	 */
	import { ChevronRight } from '@lucide/svelte/icons';
	import { LATIN_MOTTO_LEAD, LATIN_MOTTO_TAIL } from '#lib/constants/brand.constants.ts';
	import { PublicPath } from '#lib/constants/routes.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';
	import { splitHeadline } from '#lib/utils/landing-headline.utils.ts';

	const tt = (key: MessageKey) => t({ locale: $localeStore, key });

	const headline = $derived(splitHeadline(tt('welcome.close.headline')));
</script>

<section class="lpc-section lpc-close">
	<div class="lpc-wrap">
		<div class="lpc-close-latin">{LATIN_MOTTO_LEAD}<span class="acc">{LATIN_MOTTO_TAIL}</span></div>
		<h2 class="lpc-h2">
			{headline.before}{#if headline.accent}<span class="acc">{headline.accent}</span
				>{/if}{headline.after}
		</h2>
		<div class="lpc-close-cta">
			<a class="btn btn-primary btn-lg" href={PublicPath.SignUp}>
				{tt('welcome.close.cta')}
				<ChevronRight size={16} strokeWidth={2.4} />
			</a>
		</div>
	</div>
</section>
