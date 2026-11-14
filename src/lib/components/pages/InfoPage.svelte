<script lang="ts">
	import { ChevronLeft } from '@lucide/svelte/icons';
	import { AppPath, PublicPath } from '#lib/constants/routes.constants.ts';
	import { userSignedIn } from '#lib/derived/user.derived.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { InfoDoc } from '#lib/types/info-doc.ts';
	import { mailtoHref } from '#lib/utils/email.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { goBack, resolveAppPath } from '#lib/utils/nav.utils.ts';

	/**
	 * Info / legal doc page: single-column reading view with:
	 *  - top-left circular back chevron + the doc title flowing alongside it
	 *  - small accent-coloured eyebrow under the title
	 *  - serif-italic lede paragraph
	 *  - sans-serif body paragraphs at 1.65 line-height
	 *  - custom accent-dot bulleted lists
	 *  - mono-font mailto links underlined in faint laurel
	 *  - bottom "Back to settings" affordance below a 1px divider
	 *
	 * Lists carry a 4px accent dot positioned absolutely at the left of
	 * each item, not the default `list-disc`. Mail links use the mono
	 * font + accent underline + 3px text-underline-offset.
	 */

	interface Props {
		doc: InfoDoc;
	}

	let { doc }: Props = $props();

	// Resolve the document title once for the header + `<title>`:
	// literal for legal docs, keyed (localized) for help docs.
	const title = $derived(
		'title' in doc ? doc.title : t({ locale: $localeStore, key: doc.titleKey })
	);

	// Eyebrow line: literal for legal docs, keyed for help docs.
	const eyebrow = $derived(
		'eyebrow' in doc ? doc.eyebrow : t({ locale: $localeStore, key: doc.eyebrowKey })
	);

	// Back target: signed-in users came from Settings; signed-out
	// (pre-onboarding) users came from the Welcome / signup flow.
	const backTarget = $derived($userSignedIn ? AppPath.Settings : PublicPath.Welcome);
	const handleBack = () => goBack(resolveAppPath(backTarget));

	const footBackKey = $derived<'info.back_to_settings' | 'info.back'>(
		$userSignedIn ? 'info.back_to_settings' : 'info.back'
	);
</script>

<svelte:head>
	<title>{title} · VICI</title>
</svelte:head>

<div class="info-page">
	<header class="info-appbar">
		<button class="appbar-icon-btn info-back" onclick={handleBack} type="button">
			<ChevronLeft aria-hidden="true" size={18} strokeWidth={1.8} />
			<span class="sr-only">{t({ locale: $localeStore, key: 'info.back' })}</span>
		</button>
		<h1 class="info-hero-title">{title}</h1>
	</header>

	<div class="info-body">
		<div class="info-eyebrow allcaps">{eyebrow}</div>

		<article class="info-article">
			{#each doc.blocks as block, i (i)}
				{#if block.kind === 'lede'}
					<p class="info-lede serif-italic">
						{'text' in block ? block.text : t({ locale: $localeStore, key: block.key })}
					</p>
				{:else if block.kind === 'h'}
					<h2 class="info-heading">
						{'text' in block ? block.text : t({ locale: $localeStore, key: block.key })}
					</h2>
				{:else if block.kind === 'p'}
					<p class="info-paragraph">
						{'text' in block
							? block.text
							: t({
									locale: $localeStore,
									key: block.key,
									params: 'params' in block ? block.params : undefined
								})}
					</p>
				{:else if block.kind === 'list'}
					<ul class="info-list">
						{#each 'items' in block ? block.items : block.itemKeys.map( (k) => t( { locale: $localeStore, key: k } ) ) as item, j (j)}
							<li class="info-list-item">{item}</li>
						{/each}
					</ul>
				{:else if block.kind === 'mail'}
					<a class="info-mail num" href={mailtoHref(block.text)}>{block.text}</a>
				{:else if block.kind === 'link'}
					<a class="info-link" href={block.href} rel="noopener noreferrer" target="_blank">
						{block.text}
					</a>
				{:else if block.kind === 'badge'}
					<a class="info-badge" href={block.href} rel="noopener noreferrer" target="_blank">
						<img
							alt={block.alt}
							height={block.height}
							loading="lazy"
							src={block.src}
							width={block.width}
						/>
					</a>
				{/if}
			{/each}
		</article>

		<!--
			Bottom back-to-settings affordance: divider + ghost button.
			Lands on Settings for signed-in users, Welcome otherwise.
		-->
		<div class="info-foot">
			<button class="info-foot-back" onclick={handleBack} type="button">
				<ChevronLeft aria-hidden="true" size={14} strokeWidth={1.8} />
				<span>{t({ locale: $localeStore, key: footBackKey })}</span>
			</button>
		</div>
	</div>
</div>

<style lang="postcss">
	.info-page {
		display: flex;
		flex-direction: column;
		padding: 0.5rem 0 2rem;
	}

	/* Back arrow + title on the same row: the arrow is vertically
	   centred against the (possibly multi-line) title block so it
	   tracks the title's mass rather than its top edge. */
	.info-appbar {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		padding: 0.5rem 1.25rem 0.25rem;
		max-width: 40rem;
		margin: 0 auto;
		width: 100%;
	}

	.info-back {
		flex: 0 0 auto;
	}

	/* Matches the design system's base `h2` size (44 px / weight 600 /
	   tight leading + tracking). Held at a flat 2.75 rem (not clamped)
	   so it stays consistent across every mobile width, even at 320 px. */
	.info-hero-title {
		flex: 1 1 auto;
		min-width: 0;
		margin: 0;
		color: var(--text-base);
		font-size: 2.75rem;
		font-weight: 600;
		letter-spacing: var(--tracking-tight);
		line-height: 1.05;
		text-wrap: balance;
	}

	.info-body {
		display: flex;
		flex-direction: column;
		gap: 0;
		padding: 0.25rem 1.5rem 2rem;
		max-width: 40rem;
		margin: 0 auto;
		width: 100%;
	}

	/* Editorial eyebrow under the title: accent colour + 0.16em
	   tracking. */
	.info-eyebrow {
		margin: 0.75rem 0 1rem;
		font-size: var(--t-11);
		font-weight: 700;
		letter-spacing: 0.16em;
		color: var(--color-primary);
	}

	.info-article {
		display: flex;
		flex-direction: column;
	}

	/* Serif-italic lede: sets the editorial tone before the body. */
	.info-lede {
		margin: 0 0 1.5rem;
		font-size: clamp(1.15rem, 4.2vw, 1.5rem);
		line-height: 1.45;
		color: var(--text-base);
		text-wrap: balance;
	}

	.info-heading {
		margin: 1.4rem 0 0.5rem;
		font-size: var(--t-15, 0.95rem);
		font-weight: 600;
		letter-spacing: -0.005em;
		color: var(--text-base);
	}

	.info-paragraph {
		margin: 0 0 0.75rem;
		font-size: var(--t-14);
		line-height: 1.65;
		color: var(--text-muted);
	}

	/* Custom accent-dot list: 4px primary-coloured dot at the left of
	   each item, no default `list-disc` bullet. */
	.info-list {
		margin: 0 0 0.875rem;
		padding-left: 1.125rem;
		list-style: none;
	}

	.info-list-item {
		position: relative;
		padding-left: 0.875rem;
		margin: 0 0 0.25rem;
		font-size: var(--t-14);
		line-height: 1.65;
		color: var(--text-muted);
	}

	.info-list-item::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0.6rem;
		width: 4px;
		height: 4px;
		border-radius: var(--r-pill);
		background: var(--color-primary);
	}

	/* Mono-font mailto with faint primary-coloured underline. */
	.info-mail {
		display: inline-block;
		margin-bottom: 0.75rem;
		font-family: var(--font-mono);
		font-weight: 600;
		font-size: var(--t-14);
		color: var(--color-primary);
		text-decoration: underline;
		text-decoration-color: color-mix(in srgb, var(--color-primary) 40%, transparent);
		text-underline-offset: 3px;
	}

	.info-mail:hover {
		text-decoration-color: var(--color-primary);
	}

	/* Outbound prose link: same accent underline as the mail link, but in
	   the body face. The mono treatment belongs to identifier-like strings
	   (addresses), not to a sentence. */
	.info-link {
		display: inline-block;
		margin-bottom: 0.75rem;
		font-size: var(--t-14);
		font-weight: 600;
		line-height: 1.65;
		color: var(--color-primary);
		text-decoration: underline;
		text-decoration-color: color-mix(in srgb, var(--color-primary) 40%, transparent);
		text-underline-offset: 3px;
	}

	.info-link:hover {
		text-decoration-color: var(--color-primary);
	}

	/* Linked certification badge. The artwork carries its own card
	   framing, so the block only sizes and spaces it. */
	.info-badge {
		display: block;
		margin: 0.5rem 0 1rem;
		width: min(11rem, 60%);
	}

	.info-badge img {
		display: block;
		width: 100%;
		height: auto;
	}

	.info-foot {
		margin-top: 2rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border-base);
	}

	.info-foot-back {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.55rem 1rem;
		font-size: var(--t-13);
		font-weight: 600;
		color: var(--text-base);
		text-decoration: none;
		border: 1px solid var(--border-base);
		background: transparent;
		border-radius: var(--r-pill);
		cursor: pointer;
		transition:
			background-color var(--d-hover) var(--ease-vici),
			border-color var(--d-hover) var(--ease-vici);
	}

	.info-foot-back:hover {
		color: var(--text-base);
		border-color: var(--border-strong);
		background: color-mix(in srgb, var(--text-base) 4%, transparent);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
