<script lang="ts">
	import { isNullish } from '@dfinity/utils';
	/**
	 * Two nav variants on the landing surface: `.dnav` (≥1024px,
	 * horizontal pattern with scroll-spy + smooth scroll) and
	 * `.lp-nav` / `.lp-pill` (<1024px, pill morph + slide-down sheet).
	 * CSS in `src/landing.css` flips visibility at the 1024px
	 * breakpoint so both render in the markup and the right one
	 * shows.
	 */
	import { Globe, Lock } from '@lucide/svelte/icons';
	import { onMount } from 'svelte';
	import Logo from '#lib/components/layout/Logo.svelte';
	import LocalePicker from '#lib/components/ui/LocalePicker.svelte';
	import LocaleSheet from '#lib/components/ui/LocaleSheet.svelte';
	import { LOCALE_REGISTRY, type AppLocale } from '#lib/constants/locale.constants.ts';
	import { PublicPath } from '#lib/constants/routes.constants.ts';
	import {
		clearLocaleChoice,
		detectedLocale,
		localeChoiceExplicit,
		localeStore,
		setLocale
	} from '#lib/stores/locale.store.ts';
	import { THEME_SWATCHES, theme } from '#lib/stores/theme.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { goto } from '$app/navigation';

	// Landing in-page sections the nav links to. `status` (the
	// accuracy-as-status board) reuses the `nav.leaderboard` label
	// ("Social"); `faq` uses the universal "FAQ" literal.
	const sections = [
		{ id: 'status', labelKey: 'nav.leaderboard' as const },
		{ id: 'faq', labelKey: null }
	] as const;

	type NavSection = (typeof sections)[number];

	// "FAQ" is a universal literal (same in every supported locale); other
	// sections resolve through the i18n catalog.
	const navLabel = (section: NavSection): string =>
		isNullish(section.labelKey) ? 'FAQ' : t({ locale: $localeStore, key: section.labelKey });
	// Theme labels resolve from the canonical `ui.theme.*` catalog — the
	// same source AppearancePicker uses — so the appearance tooltips/aria
	// stay localized and in sync rather than hardcoded English.
	const themeOpts = $derived(
		THEME_SWATCHES.map(({ id, labelKey }) => ({
			id,
			label: t({ locale: $localeStore, key: labelKey })
		}))
	);

	let scrolled = $state(false);
	let active = $state<string>('');
	let menuOpen = $state(false);
	let langOpen = $state(false);
	let dnavLangOpen = $state(false);
	let dnavLangRef: HTMLDivElement | null = $state(null);
	let lpNavEl: HTMLElement | null = $state(null);

	// Region the "Use automatic" reset would fall back to, for its sub-label.
	const detectedRegionLabel = $derived(
		LOCALE_REGISTRY.find(({ id }) => id === detectedLocale)?.regionLabel ?? null
	);

	// What actually scrolls differs by platform: on iOS the landing scrolls
	// inside the `.lpc` viewport (contained scroll, like the authenticated app
	// shell — see `html[data-ios] .lpc` in `landing.css`), everywhere else the
	// window scrolls. Resolve it at mount by walking up to the nearest
	// scrollable ancestor so frost-on-scroll, scroll-spy and smooth-scroll all
	// track whichever one is live, with no per-platform branching elsewhere.
	let scrollRoot: HTMLElement | Window | null = null;

	const findScrollRoot = (el: HTMLElement | null): HTMLElement | Window => {
		let node: HTMLElement | null = el?.parentElement ?? null;

		while (node) {
			const oy = getComputedStyle(node).overflowY;

			if (oy === 'auto' || oy === 'scroll') {
				return node;
			}

			node = node.parentElement;
		}

		return window;
	};

	const scrollTopOf = (root: HTMLElement | Window): number =>
		root === window ? window.scrollY : (root as HTMLElement).scrollTop;

	onMount(() => {
		if (typeof document !== 'undefined') {
			// `data-theme` is owned by the canonical theme store + the
			// no-FOUC inline script in `app.html`; we only stamp the brand
			// accent here.
			document.documentElement.setAttribute('data-accent', 'laurel');
		}

		// Resolve whichever element actually scrolls: the `.lpc` viewport on
		// iOS (contained scroll) or the window everywhere else.
		const root = findScrollRoot(lpNavEl);
		scrollRoot = root;

		// Hysteresis (8px to engage, 4px to release) so iOS momentum/rubber-band
		// jitter around the threshold can't rapidly toggle the scrolled state and
		// make the nav background tremble. A small deadband, not a single edge.
		const onScroll = () => {
			const y = scrollTopOf(root);
			scrolled = scrolled ? y > 4 : y > 8;
		};

		onScroll();
		root.addEventListener('scroll', onScroll, { passive: true });

		// Scroll spy — observe against the live scroll root so it still fires
		// when `.lpc` (not the window) is the scroller. `rootMargin` collapses
		// the root to a thin band in the upper-middle of the viewport; whichever
		// observed section sits in that band is the active one. We gate on
		// `isIntersecting` alone (not `intersectionRatio`): a tall section like
		// `#faq` can only ever overlap a thin slice of the band, so its ratio
		// never crosses a fixed threshold and the indicator would never advance
		// to it. Sections between observed ones aren't tracked, so the last
		// active section persists across them — which is the desired behaviour.
		const els = sections
			.map((s) => document.getElementById(s.id))
			.filter((el): el is HTMLElement => Boolean(el));
		const io =
			els.length === 0
				? null
				: new IntersectionObserver(
						(entries) => {
							entries.forEach((e) => {
								if (e.isIntersecting) {
									active = e.target.id;
								}
							});
						},
						{
							root: root === window ? null : (root as HTMLElement),
							rootMargin: '-30% 0px -55% 0px',
							threshold: 0
						}
					);

		if (io) {
			els.forEach((el) => io.observe(el));
		}

		return () => {
			root.removeEventListener('scroll', onScroll);

			if (io) {
				io.disconnect();
			}
		};
	});

	$effect(() => {
		if (typeof document === 'undefined') {
			return;
		}

		document.body.style.overflow = menuOpen ? 'hidden' : '';

		return () => {
			document.body.style.overflow = '';
		};
	});

	$effect(() => {
		if (!menuOpen || typeof window === 'undefined') {
			return;
		}

		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				menuOpen = false;
			}
		};

		window.addEventListener('keydown', onKey);

		return () => window.removeEventListener('keydown', onKey);
	});

	// Outside-click + Escape for the desktop lang popover. The mobile picker is
	// a `LocaleSheet`, which owns its own scrim, Escape handling and focus trap.
	$effect(() => {
		if (!dnavLangOpen) {
			return;
		}

		const onDoc = (e: MouseEvent) => {
			const { target } = e;

			// `instanceof` narrowing (not a cast): `contains` needs a `Node`.
			if (dnavLangRef && target instanceof Node && !dnavLangRef.contains(target)) {
				dnavLangOpen = false;
			}
		};

		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				dnavLangOpen = false;
			}
		};

		document.addEventListener('mousedown', onDoc);
		window.addEventListener('keydown', onKey);

		return () => {
			document.removeEventListener('mousedown', onDoc);
			window.removeEventListener('keydown', onKey);
		};
	});

	const closeMenu = () => {
		menuOpen = false;
	};

	const onLinkClick =
		(id: string) =>
		(e: MouseEvent): void => {
			if (typeof document === 'undefined') {
				return;
			}

			const el = document.getElementById(id);

			if (!el) {
				return;
			}

			e.preventDefault();
			// Move the indicator immediately on click rather than waiting for the
			// scroll-spy observer to catch up mid-animation.
			active = id;
			const root = scrollRoot ?? window;

			if (root === window) {
				const y = el.getBoundingClientRect().top + window.scrollY - 72;
				window.scrollTo({ top: y, behavior: 'smooth' });
			} else {
				const rootEl = root as HTMLElement;
				const y =
					el.getBoundingClientRect().top -
					rootEl.getBoundingClientRect().top +
					rootEl.scrollTop -
					72;
				rootEl.scrollTo({ top: y, behavior: 'smooth' });
			}

			history.replaceState(null, '', `#${id}`);
		};

	// Mobile menu links: scroll via `onLinkClick` (works whether the window or
	// `.lpc` is the active scroller — native `#` fragment scrolling is
	// unreliable on iOS once the document is locked) then close the sheet.
	const onMenuLinkClick =
		(id: string) =>
		(e: MouseEvent): void => {
			onLinkClick(id)(e);
			closeMenu();
		};

	const setLocaleAndClose = (loc: AppLocale) => {
		setLocale(loc);
		langOpen = false;
		dnavLangOpen = false;
	};

	const useAutomaticAndClose = () => {
		clearLocaleChoice();
		langOpen = false;
		dnavLangOpen = false;
	};
</script>

<!-- ─── Desktop nav (≥1024px) ─── -->
<nav
	class="dnav"
	class:is-scrolled={scrolled}
	aria-label={t({ locale: $localeStore, key: 'a11y.landing' })}
>
	<a class="dnav-skip" href="#main">
		{t({ locale: $localeStore, key: 'welcome.nav.skip_to_content' })}
	</a>
	<div class="dnav-inner">
		<span class="dnav-logo"><Logo href={PublicPath.Welcome} /></span>
		<div class="dnav-links">
			{#each sections as section (section.id)}
				<a
					class:is-active={active === section.id}
					aria-current={active === section.id ? 'page' : undefined}
					href="#{section.id}"
					onclick={onLinkClick(section.id)}
				>
					<span class="ltext">{navLabel(section)}</span>
					<span class="dot" aria-hidden="true"></span>
				</a>
			{/each}
		</div>
		<div class="dnav-right">
			<div bind:this={dnavLangRef} class="dnav-lang-wrap">
				<button
					class="dnav-globe"
					aria-expanded={dnavLangOpen}
					aria-haspopup="listbox"
					aria-label={t({ locale: $localeStore, key: 'a11y.language' })}
					onclick={() => (dnavLangOpen = !dnavLangOpen)}
					type="button"
				>
					<Globe aria-hidden="true" />
				</button>
				{#if dnavLangOpen}
					<div class="dnav-lang-pop">
						<LocalePicker
							current={$localeStore}
							maxHeight={440}
							onPick={(loc) => setLocaleAndClose(loc)}
						/>
						{#if $localeChoiceExplicit}
							<button class="lp-auto-reset" onclick={useAutomaticAndClose} type="button">
								<Globe aria-hidden="true" size={15} strokeWidth={1.8} />
								<span>
									{t({ locale: $localeStore, key: 'picker.use_auto' })}{detectedRegionLabel
										? ` · ${detectedRegionLabel}`
										: ''}
								</span>
							</button>
						{/if}
					</div>
				{/if}
			</div>
			<div
				class="dnav-theme"
				aria-label={t({ locale: $localeStore, key: 'a11y.appearance' })}
				role="radiogroup"
			>
				{#each themeOpts as o (o.id)}
					<button
						class="dnav-theme-dot dnav-app-{o.id}"
						class:active={$theme === o.id}
						aria-checked={$theme === o.id}
						aria-label={o.label}
						data-tooltip={o.label.toUpperCase()}
						onclick={() => theme.set(o.id)}
						role="radio"
						type="button"
					>
						<span class="inner" aria-hidden="true"></span>
					</button>
				{/each}
			</div>
			<span class="dnav-divider" aria-hidden="true"></span>
			<a class="dnav-signin" href={PublicPath.SignIn}>
				{t({ locale: $localeStore, key: 'nav.signin' })}
			</a>
			<a class="btn btn-primary dnav-cta" href={PublicPath.SignUp}>
				{t({ locale: $localeStore, key: 'nav.cta' })}
			</a>
		</div>
	</div>
</nav>

<!-- ─── Pill nav (mobile/tablet, <1024px) ─── -->
<nav
	bind:this={lpNavEl}
	class="lp-nav lp-root"
	class:is-open={menuOpen}
	class:is-scrolled={scrolled}
	aria-label={t({ locale: $localeStore, key: 'a11y.landing' })}
>
	<div class="lp-nav-inner">
		<div class="lp-pill" class:open={menuOpen}>
			<div class="lp-pill-topline">
				<span class="lp-logo">
					<Logo href={PublicPath.Welcome} />
				</span>
				<div class="lp-pill-right">
					<div class="lp-lang-wrap">
						<button
							class="lp-globe"
							aria-expanded={langOpen}
							aria-haspopup="listbox"
							aria-label={t({ locale: $localeStore, key: 'a11y.language' })}
							onclick={() => (langOpen = !langOpen)}
							type="button"
						>
							<Globe aria-hidden="true" />
						</button>
					</div>
					<a class="lp-signin-top" href={PublicPath.SignIn}>
						{t({ locale: $localeStore, key: 'nav.signin' })}
					</a>
					<button
						class="btn btn-primary lp-cta"
						onclick={() => goto(PublicPath.SignUp)}
						type="button"
					>
						{t({ locale: $localeStore, key: 'nav.cta' })}
					</button>
					<button
						class="lp-ham"
						class:open={menuOpen}
						aria-expanded={menuOpen}
						aria-label={menuOpen
							? t({ locale: $localeStore, key: 'a11y.close' })
							: t({ locale: $localeStore, key: 'a11y.language' })}
						onclick={() => (menuOpen = !menuOpen)}
						type="button"
					>
						<svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
							<line class="t" x1="6" x2="18" y1="12" y2="12" />
							<line class="b" x1="6" x2="18" y1="12" y2="12" />
						</svg>
					</button>
				</div>
			</div>

			{#if menuOpen}
				<div class="lp-pill-body">
					<div class="lp-trust lp-trust-hero">
						<Lock size={14} strokeWidth={1.8} />
						<span>{t({ locale: $localeStore, key: 'welcome.nav.disclosure' })}</span>
					</div>

					<div class="lp-eyebrow-bridge">
						{t({ locale: $localeStore, key: 'welcome.nav.explore' })}
					</div>

					<nav class="lp-menu-links">
						{#each sections as section, i (section.id)}
							<a href="#{section.id}" onclick={onMenuLinkClick(section.id)}>
								<span class="ix">0{i + 1}</span>
								<span class="ltext">{navLabel(section)}</span>
							</a>
						{/each}
					</nav>

					<div class="lp-appearance">
						<span class="lp-appearance-lbl">
							{t({ locale: $localeStore, key: 'a11y.appearance' })}
						</span>
						<div
							class="lp-appearance-dots"
							aria-label={t({ locale: $localeStore, key: 'a11y.appearance' })}
							role="radiogroup"
						>
							{#each themeOpts as o (o.id)}
								<button
									class="lp-appearance-dot lp-app-{o.id}"
									class:active={$theme === o.id}
									aria-checked={$theme === o.id}
									aria-label={o.label}
									data-tooltip={o.label.toUpperCase()}
									onclick={() => theme.set(o.id)}
									role="radio"
									type="button"
								>
									<span class="inner" aria-hidden="true"></span>
								</button>
							{/each}
						</div>
					</div>

					<div class="lp-pill-footer">
						<a class="lp-signin-link" href={PublicPath.SignIn} onclick={closeMenu}>
							{t({ locale: $localeStore, key: 'welcome.nav.already_member' })}
							<span class="em">{t({ locale: $localeStore, key: 'nav.signin' })}</span>
						</a>
						<span class="lp-latin">
							{t({ locale: $localeStore, key: 'welcome.nav.latin_motto' })}
							<span class="acc">Vici.</span>
						</span>
					</div>
				</div>
			{/if}
		</div>
	</div>
</nav>

<!-- Mobile language picker: a bottom sheet (own scrim / grip / Escape /
     focus trap), not a pill-anchored popover. -->
<LocaleSheet
	current={$localeStore}
	isOpen={langOpen}
	onClose={() => (langOpen = false)}
	onPick={(loc) => setLocaleAndClose(loc)}
	titleKey="a11y.language"
/>

{#if menuOpen}
	<button
		class="lp-scrim"
		aria-hidden="true"
		onclick={() => (menuOpen = false)}
		tabindex={-1}
		type="button"
	></button>
{/if}
