<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import { INFO_EMAIL } from '#lib/constants/contact.constants.ts';
	import {
		LANDING_CLAIM_PRIVACY_PATH,
		LANDING_NAV_WORDMARK_SRC
	} from '#lib/constants/landing-claim.constants.ts';
	import { LANDING_TERMS_PATH } from '#lib/constants/landing-page.constants.ts';
	import { PublicPath } from '#lib/constants/routes.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { mailtoHref } from '#lib/utils/email.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { resolve } from '$app/paths';

	/**
	 * The landing's footer, at the end of the Markets list: the wordmark and
	 * the claim on the left, three short link groups on the right (sign-in
	 * among them: the landing's quiet way in for an existing account), the legal
	 * line on a hairline beneath.
	 */
	interface Props {
		onclaim?: () => void;
		// Back to the card deck; without it the page has no deck to go back to.
		oncards?: () => void;
	}

	const { onclaim = () => {}, oncards }: Props = $props();
</script>

<footer class="lf">
	<div class="lf-top">
		<div class="lf-brand">
			<img alt="VICI" draggable="false" height="274" src={LANDING_NAV_WORDMARK_SRC} width="1024" />
			<button class="lf-cta" onclick={onclaim} type="button">
				{t({ locale: $localeStore, key: 'landing.nav.claim' })}
			</button>
		</div>
		<nav class="lf-links" aria-label={t({ locale: $localeStore, key: 'landing.footer.label' })}>
			<div>
				<b>{t({ locale: $localeStore, key: 'landing.footer.product' })}</b>
				{#if nonNullish(oncards)}
					<button onclick={oncards} type="button">
						{t({ locale: $localeStore, key: 'landing.footer.cards' })}
					</button>
				{/if}
				<a href={resolve(PublicPath.SignIn)}>{t({ locale: $localeStore, key: 'nav.signin' })}</a>
			</div>
			<div>
				<b>{t({ locale: $localeStore, key: 'landing.footer.company' })}</b>
				<a href={mailtoHref(INFO_EMAIL)}>
					{t({ locale: $localeStore, key: 'landing.footer.contact' })}
				</a>
			</div>
			<div>
				<b>{t({ locale: $localeStore, key: 'landing.footer.legal' })}</b>
				<a href={resolveAppPath(LANDING_TERMS_PATH)}>
					{t({ locale: $localeStore, key: 'footer.terms' })}
				</a>
				<a href={resolveAppPath(LANDING_CLAIM_PRIVACY_PATH)}>
					{t({ locale: $localeStore, key: 'footer.privacy' })}
				</a>
			</div>
		</nav>
	</div>
	<div class="lf-base">
		<p>{t({ locale: $localeStore, key: 'landing.footer.rights' })}</p>
	</div>
</footer>

<style lang="postcss">
	.lf {
		--lf-out: cubic-bezier(0.23, 1, 0.32, 1);
		--lf-quiet: color-mix(in srgb, var(--parchment) 64%, transparent);
		display: grid;
		gap: 28px;
		margin-top: 36px;
		padding: 32px 0 calc(28px + env(safe-area-inset-bottom, 0px));
		border-top: 1px solid color-mix(in srgb, var(--parchment) 14%, transparent);
		color: var(--lf-quiet);
		font: 500 14px/1.5 var(--font-display);
	}

	.lf-top {
		display: grid;
		grid-template-columns: minmax(0, 1.2fr) minmax(0, 2fr);
		gap: 32px 48px;
		align-items: start;
	}

	.lf-brand {
		display: grid;
		gap: 14px;
		justify-items: start;
	}

	.lf-brand img {
		display: block;
		width: auto;
		height: 18px;
	}

	.lf-cta {
		height: 44px;
		padding: 0 18px;
		border: 0;
		border-radius: 999px;
		background: var(--parchment);
		color: var(--ink);
		font: 700 14px/1 var(--font-display);
		cursor: pointer;
		transition: transform 140ms var(--lf-out);
	}

	.lf-cta:active {
		transform: scale(0.97);
	}

	.lf-links {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 24px;
	}

	.lf-links > div {
		display: grid;
		gap: 10px;
		align-content: start;
		justify-items: start;
	}

	.lf-links b {
		color: var(--parchment);
		font: 600 13px/1.2 var(--font-display);
	}

	.lf-links a,
	.lf-links button {
		min-height: 24px;
		padding: 0;
		border: 0;
		background: none;
		color: var(--lf-quiet);
		font: inherit;
		text-align: left;
		text-decoration: none;
		cursor: pointer;
		transition: color 140ms var(--lf-out);
	}

	.lf-links a:focus-visible,
	.lf-links button:focus-visible,
	.lf-cta:focus-visible {
		border-radius: 4px;
		outline: 2px solid var(--parchment);
		outline-offset: 3px;
	}

	.lf-cta:focus-visible {
		border-radius: 999px;
	}

	.lf-base {
		padding-top: 20px;
		border-top: 1px solid color-mix(in srgb, var(--parchment) 10%, transparent);
		font-size: 12.5px;
		line-height: 1.5;
	}

	.lf-base p {
		margin: 0;
	}

	@media (hover: hover) and (pointer: fine) {
		.lf-links a:hover,
		.lf-links button:hover {
			color: var(--parchment);
		}
	}

	@media (max-width: 760px) {
		.lf-top {
			grid-template-columns: minmax(0, 1fr);
		}

		.lf-links {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.lf-links > div {
			gap: 0;
		}

		.lf-links b {
			margin-bottom: 4px;
		}

		.lf-links a,
		.lf-links button {
			display: flex;
			align-items: center;
			min-height: 44px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.lf-cta,
		.lf-links a,
		.lf-links button {
			transition: none;
		}
	}
</style>
