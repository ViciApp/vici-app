<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import BaseButton from '#lib/components/ui/BaseButton.svelte';
	import { BRAND_WORDMARK } from '#lib/constants/brand.constants.ts';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { goto } from '$app/navigation';

	/** Wordmark sizes, smallest to largest; each maps to one type step. */
	type LogoSize = 'xs' | 'sm' | 'md' | 'lg';

	interface Props {
		/** Render a link to this path instead of the in-app home button. */
		href?: string;
		/** Replace the home navigation with this action (still a button). */
		onclick?: () => void;
		/** Accessible name of the link or button; the wordmark itself by default. */
		label?: string;
		/** The mark alone, with no link or button around it. */
		plain?: boolean;
		size?: LogoSize;
		/**
		 * `parchment` pins the reversed variant for surfaces that stay dark in
		 * every theme (the landing over footage); `auto` follows the theme.
		 */
		tone?: 'auto' | 'parchment';
	}

	const { href, onclick, label, plain = false, size = 'lg', tone = 'auto' }: Props = $props();

	const handleClick = () => {
		if (nonNullish(onclick)) {
			onclick();

			return;
		}

		goto(AppPath.Home);
	};
</script>

{#snippet wordmark()}
	<span class="logo-mark logo-{size}" class:is-parchment={tone === 'parchment'} aria-hidden="true">
		{BRAND_WORDMARK}
	</span>
{/snippet}

{#if plain}
	<span class="logo inline-flex items-center" aria-label={label ?? BRAND_WORDMARK} role="img">
		{@render wordmark()}
	</span>
{:else if href}
	<a class="logo inline-flex items-center" aria-label={label ?? BRAND_WORDMARK} {href}>
		{@render wordmark()}
	</a>
{:else}
	<BaseButton
		class="logo flex items-center"
		aria-label={label ?? t({ locale: $localeStore, key: 'a11y.logo_home' })}
		onclick={handleClick}
	>
		{@render wordmark()}
	</BaseButton>
{/if}

<style lang="postcss">
	/* Type-set live per the brand book: Hanken Grotesk Bold, ALL CAPS,
	   0.18em tracking, in the UI face whatever the surrounding text uses.
	   Colour resolves to parchment on dark surfaces and ink on light via
	   the theme foreground; laurel gold is reserved for the app-icon tile
	   and must not appear on the mark. No drop-shadow / glow / gradient
	   hover effects on the mark itself. */
	.logo-mark {
		display: inline-block;
		color: var(--color-foreground);
		font-family: var(--font-display);
		font-weight: 700;
		letter-spacing: 0.18em;
		line-height: 1;
		text-transform: uppercase;
		transition: opacity 200ms var(--ease-vici);
	}

	.logo-mark.is-parchment {
		color: var(--parchment);
	}

	.logo-xs {
		font-size: var(--t-11);
	}

	.logo-sm {
		font-size: var(--t-13);
	}

	.logo-md {
		font-size: var(--t-20);
	}

	.logo-lg {
		font-size: var(--t-24);
	}

	:global(.logo:hover) > .logo-mark {
		opacity: 0.8;
	}

	@media (prefers-reduced-motion: reduce) {
		.logo-mark {
			transition: none;
		}
	}
</style>
