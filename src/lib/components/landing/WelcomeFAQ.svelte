<script lang="ts">
	/**
	 * Six visitor-stage questions in an "only one open at a time"
	 * accordion, with the first question expanded by default. Uses
	 * local `$state` rather than native <details>/<summary> so we
	 * keep the single-expanded invariant. All copy resolves through
	 * the `welcome.faq.*` catalog so the section localizes with the
	 * rest of the landing surface.
	 */
	import { ChevronDown } from '@lucide/svelte/icons';
	import { INFO_EMAIL } from '#lib/constants/contact.constants.ts';
	import { PublicPath } from '#lib/constants/routes.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { mailtoHref } from '#lib/utils/email.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	type FaqIndex = 1 | 2 | 3 | 4 | 5 | 6;

	// The fifth answer carries an inline privacy-policy deep link, so it
	// renders out of the plain-text loop. The rest are flat copy.
	const FAQ_INDICES: readonly FaqIndex[] = [1, 2, 3, 4, 5, 6];

	let openIdx = $state(0);
</script>

<section id="faq" class="lp-section lp-root">
	<div class="lp-section-inner">
		<div class="lpc-section-head">
			<span class="lpc-kicker">{t({ locale: $localeStore, key: 'welcome.faq.eyebrow' })}</span>
			<h2 class="lpc-h2">
				{t({ locale: $localeStore, key: 'welcome.faq.title_a' })}
				<span class="acc">
					{t({ locale: $localeStore, key: 'welcome.faq.title_b' })}
				</span>
			</h2>
			<p class="lpc-lede">
				{t({ locale: $localeStore, key: 'welcome.faq.sub' })}
			</p>
		</div>

		<div
			style="
				margin-top:48px; max-width:760px; margin-left:auto; margin-right:auto;
				display:flex; flex-direction:column; gap:2px;
			"
		>
			{#each FAQ_INDICES as n, i (n)}
				{@const isOpen = openIdx === i}
				<div
					style="
						border-bottom:1px solid var(--border);
						border-top:{i === 0 ? '1px solid var(--border)' : 'none'};
					"
				>
					<button
						style="
							appearance:none; background:transparent; border:0;
							width:100%; padding:20px 4px; text-align:left; cursor:pointer;
							display:flex; align-items:center; justify-content:space-between; gap:16px;
							color:var(--fg); font:inherit;
						"
						class="lp-faq-q"
						aria-expanded={isOpen}
						onclick={() => (openIdx = isOpen ? -1 : i)}
						type="button"
					>
						<span
							style="color:{isOpen ? 'var(--accent)' : 'var(--fg)'}; line-height:1.3;"
							class="t-h4 fw-600"
						>
							{t({ locale: $localeStore, key: `welcome.faq.q${n}` as const })}
						</span>
						<span
							style="
								flex-shrink:0;
								transition:transform var(--d-state) var(--ease);
								transform:{isOpen ? 'rotate(180deg)' : 'rotate(0deg)'};
								color:var(--fg-mute); display:inline-flex;
							"
							aria-hidden="true"
						>
							<ChevronDown size={18} strokeWidth={1.8} />
						</span>
					</button>
					{#if isOpen}
						<div
							style="padding:0 4px 22px; line-height:1.6; max-width:64ch; text-wrap:pretty;"
							class="dim t-body"
						>
							{t({ locale: $localeStore, key: `welcome.faq.a${n}` as const })}
							{#if n === 5}
								<a style="color:var(--accent);" href="{PublicPath.Info}/privacy">
									{t({ locale: $localeStore, key: 'welcome.faq.privacy_link' })}
								</a>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>

		<p
			style="margin-top:28px; text-align:center; max-width:520px; margin-left:auto; margin-right:auto;"
			class="dim t-body-sm"
		>
			{t({ locale: $localeStore, key: 'welcome.faq.contact_prefix' })}
			<a style="color:var(--accent); font-weight:600;" href={mailtoHref(INFO_EMAIL)}>
				{INFO_EMAIL}
			</a>
			{t({ locale: $localeStore, key: 'welcome.faq.contact_suffix' })}
		</p>
	</div>
</section>
