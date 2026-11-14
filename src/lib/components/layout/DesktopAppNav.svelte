<script lang="ts">
	import { Settings, User } from '@lucide/svelte/icons';
	import { navItems } from '#lib/constants/nav.constants.ts';
	import { AppPath, PublicPath } from '#lib/constants/routes.constants.ts';
	import { TestId } from '#lib/constants/test-ids.constants.ts';
	import { userSignedIn } from '#lib/derived/user.derived.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { userStore } from '#lib/stores/user.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	/**
	 * Desktop chrome for the (app) shell: mirrors the LANDING page's
	 * top-nav pattern (brand wordmark on the left, primary nav in the
	 * middle, user controls on the right) so the desktop authenticated
	 * experience is a natural continuation of the marketing surface
	 * rather than a fake-mobile phone-frame wrapper.
	 *
	 * Hidden at <56rem (`hidden lg:flex`); the mobile floating pillnav
	 * owns the chrome below that breakpoint.
	 *
	 * Tab activation reuses the `navItems` taxonomy + the same active-
	 * state aliasing as `MobileNav` so deep links (e.g.
	 * `/markets/[id]` → Markets tab; `/settings` → Profile tab) light
	 * up the right item.
	 */

	const isActive = (path: AppPath) => {
		const current = page.url.pathname;

		if (current === path) {
			return true;
		}

		if (path === AppPath.Home && (current === '/app' || current.startsWith('/markets/'))) {
			return true;
		}

		if (path === AppPath.Dash && current === AppPath.Portfolio) {
			return true;
		}

		if (
			path === AppPath.Profile &&
			(current === AppPath.Wallet ||
				current === AppPath.Settings ||
				current === AppPath.Notifications ||
				current.startsWith('/profile/'))
		) {
			return true;
		}

		return false;
	};

	const activeIndex = $derived(navItems.findIndex(({ path }) => isActive(path)));

	/* ------------------------------------------------------------------
	 * Sliding underline: measure the active link and slide a bar under
	 * it (mirrors the MobileNav pillnav indicator). Recomputed via
	 * ResizeObserver so the bar tracks viewport / font-load reflows.
	 * ------------------------------------------------------------------ */
	let linksEl: HTMLElement | null = $state(null);
	let indicatorLeft = $state(0);
	let indicatorWidth = $state(0);
	let indicatorOpacity = $state(0);

	$effect(() => {
		// Re-read on activeIndex change so the bar slides over.
		void activeIndex;

		if (!linksEl || activeIndex < 0) {
			indicatorOpacity = 0;

			return;
		}

		const update = () => {
			if (!linksEl) {
				return;
			}

			const links = linksEl.querySelectorAll<HTMLElement>('.app-desktop-nav-link');
			const link = links[activeIndex];

			if (!link) {
				return;
			}

			const linkRect = link.getBoundingClientRect();
			const navRect = linksEl.getBoundingClientRect();

			indicatorLeft = linkRect.left - navRect.left;
			indicatorWidth = linkRect.width;
			indicatorOpacity = 1;
		};

		update();

		const ro = new ResizeObserver(update);
		ro.observe(linksEl);

		return () => ro.disconnect();
	});

	const userNickname = $derived($userStore.profile?.nickname);
</script>

<header class="app-desktop-nav">
	<div class="app-desktop-nav-inner">
		<a
			class="app-desktop-nav-brand"
			aria-label={t({ locale: $localeStore, key: 'a11y.landing' })}
			href={AppPath.Home}
		>
			VICI
		</a>

		<nav bind:this={linksEl} class="app-desktop-nav-links" aria-label="Primary">
			{#each navItems as item, i (item.path)}
				<a class="app-desktop-nav-link" class:is-active={i === activeIndex} href={item.path}>
					{t({ locale: $localeStore, key: item.labelKey })}
				</a>
			{/each}
			<span
				style:left="{indicatorLeft}px"
				style:width="{indicatorWidth}px"
				style:opacity={indicatorOpacity}
				class="app-desktop-nav-indicator"
				aria-hidden="true"
			></span>
		</nav>

		<div class="app-desktop-nav-trailing">
			{#if $userSignedIn}
				<a
					class="app-desktop-nav-icon-btn"
					aria-label={t({ locale: $localeStore, key: 'settings.title' })}
					href={AppPath.Settings}
				>
					<Settings aria-hidden="true" size={18} strokeWidth={1.8} />
				</a>
				<a class="app-desktop-nav-handle" data-tid={TestId.UserMenu} href={AppPath.Profile}>
					<User aria-hidden="true" size={14} strokeWidth={2} />
					<span>{userNickname ?? '@you'}</span>
				</a>
			{:else}
				<button
					class="app-desktop-nav-signin"
					onclick={() => void goto(PublicPath.SignIn)}
					type="button"
				>
					{t({ locale: $localeStore, key: 'cta.primary' })}
				</button>
			{/if}
		</div>
	</div>
</header>

<style lang="postcss">
	.app-desktop-nav {
		display: none;
	}

	@media (min-width: 56rem) {
		.app-desktop-nav {
			display: flex;
			justify-content: center;
			padding: 1rem 1.5rem 0.5rem;
			border-bottom: 1px solid var(--border-base);
			background: color-mix(in srgb, var(--bg-base) 92%, transparent);
			-webkit-backdrop-filter: blur(12px);
			backdrop-filter: blur(12px);
			position: sticky;
			top: 0;
			z-index: 40;
		}
	}

	.app-desktop-nav-inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 2rem;
		width: 100%;
		max-width: var(--content-max, 80rem);
	}

	.app-desktop-nav-brand {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--t-20);
		letter-spacing: 0.18em;
		color: var(--text-base);
		text-decoration: none;
	}

	.app-desktop-nav-links {
		position: relative;
		display: flex;
		gap: 2rem;
		align-items: center;
	}

	.app-desktop-nav-link {
		font-size: var(--t-14);
		font-weight: 500;
		color: var(--text-muted);
		text-decoration: none;
		padding: 0.5rem 0;
		border-bottom: 2px solid transparent;
		transition: color var(--d-hover, 120ms) ease;
	}

	.app-desktop-nav-link:hover {
		color: var(--text-base);
	}

	.app-desktop-nav-link.is-active {
		color: var(--text-base);
	}

	/* 2px laurel underline that slides between links on route change.
	   `left` / `width` are measured from the active link; opacity fades
	   it in once positioned (mirrors the MobileNav pillnav indicator). */
	.app-desktop-nav-indicator {
		position: absolute;
		bottom: 0;
		left: 0;
		height: 2px;
		border-radius: var(--r-pill);
		background: var(--color-primary, var(--laurel));
		opacity: 0;
		transition:
			left 280ms var(--ease-vici, ease),
			width 280ms var(--ease-vici, ease),
			opacity 220ms var(--ease-vici, ease);
		will-change: left, width;
		pointer-events: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.app-desktop-nav-indicator {
			transition: none;
			will-change: auto;
		}
	}

	.app-desktop-nav-trailing {
		display: flex;
		gap: 0.75rem;
		align-items: center;
	}

	.app-desktop-nav-icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: var(--r-pill);
		color: var(--text-muted);
		text-decoration: none;
		transition:
			background-color var(--d-hover, 120ms) ease,
			color var(--d-hover, 120ms) ease;
	}

	.app-desktop-nav-icon-btn:hover {
		background: color-mix(in srgb, var(--text-base) 8%, transparent);
		color: var(--text-base);
	}

	.app-desktop-nav-handle {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0.85rem;
		border-radius: var(--r-pill);
		font-size: var(--t-13);
		font-weight: 600;
		color: var(--text-base);
		background: color-mix(in srgb, var(--bg-surface) 80%, transparent);
		border: 1px solid var(--border-base);
		text-decoration: none;
	}

	.app-desktop-nav-handle:hover {
		border-color: var(--border-strong);
	}

	.app-desktop-nav-signin {
		appearance: none;
		display: inline-flex;
		align-items: center;
		padding: 0.5rem 1rem;
		border-radius: var(--r-pill);
		font: inherit;
		font-size: var(--t-13);
		font-weight: 600;
		color: var(--color-primary-foreground, var(--ink));
		background: var(--color-primary, var(--laurel));
		border: 0;
		cursor: pointer;
		transition: background-color var(--d-hover, 120ms) ease;
	}

	.app-desktop-nav-signin:hover {
		background: color-mix(in srgb, var(--color-primary, var(--laurel)) 88%, var(--text-base));
	}
</style>
