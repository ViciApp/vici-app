<script lang="ts">
	import { navItems } from '#lib/constants/nav.constants.ts';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { TestId } from '#lib/constants/test-ids.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { haptic } from '#lib/utils/haptics.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	/**
	 * Floating "pillnav" bottom nav.
	 *
	 * Five tabs (Markets / Dash / Flow / Arena / Profile) in a centred,
	 * floating pill with a 3px laurel indicator that slides between
	 * active tabs. Flow gets a permanent faint laurel halo behind its
	 * icon and the indicator turns laurel when Flow is the active tab.
	 *
	 * Active-state aliasing: paths that don't have their own slot but
	 * should still highlight a parent tab:
	 *
	 *  - Markets ← /app, /markets, /markets/*
	 *  - Dash    ← /dash, /portfolio
	 *  - Arena   ← /arena/*
	 *  - Profile ← /profile, /profile/album, /settings, /wallet,
	 *              /notifications
	 *
	 * Icons are inline `<svg>` (stroke 1.6 outline ↔ filled) rather
	 * than lucide so the outline-to-filled swap on the active tab
	 * lands exactly.
	 */

	const isFlowPath = (path: AppPath) => path === AppPath.Flow;

	const isActive = (path: AppPath) => {
		const current = page.url.pathname;

		if (current === path) {
			return true;
		}

		if (path === AppPath.Home && (current === '/app' || current.startsWith('/markets'))) {
			return true;
		}

		if (path === AppPath.Dash && (current === AppPath.Dash || current === AppPath.Portfolio)) {
			return true;
		}

		if (path === AppPath.Arena && current.startsWith('/arena')) {
			return true;
		}

		if (
			path === AppPath.Profile &&
			(current === AppPath.Profile ||
				current === AppPath.Album ||
				current === AppPath.Wallet ||
				current === AppPath.Settings ||
				current.startsWith(`${AppPath.Settings}/`) ||
				current === AppPath.Notifications)
		) {
			return true;
		}

		return false;
	};

	const activeIndex = $derived(navItems.findIndex(({ path }) => isActive(path)));
	const isFlowActive = $derived(activeIndex >= 0 && isFlowPath(navItems[activeIndex].path));

	const handleNav = (path: AppPath) => {
		// Light tap on tab change: wired through the real Vibration API.
		haptic('light-tap');
		goto(path);
	};

	/* ------------------------------------------------------------------
	 * Sliding indicator: measure the active tab and centre a 28px pill
	 * over it. Recomputed via ResizeObserver so the indicator tracks
	 * orientation changes / nav-width shifts.
	 * ------------------------------------------------------------------ */
	let navEl: HTMLElement | null = $state(null);
	let indicatorLeft = $state(0);
	let indicatorOpacity = $state(0);

	$effect(() => {
		// Re-read on activeIndex change so the indicator slides over.
		void activeIndex;

		if (!navEl || activeIndex < 0) {
			indicatorOpacity = 0;

			return;
		}

		const update = () => {
			if (!navEl) {
				return;
			}

			const tabs = navEl.querySelectorAll<HTMLElement>('.pillnav-tab');
			const tab = tabs[activeIndex];

			if (!tab) {
				return;
			}

			const tabRect = tab.getBoundingClientRect();
			const navRect = navEl.getBoundingClientRect();
			const centre = tabRect.left + tabRect.width / 2 - navRect.left;

			indicatorLeft = centre - 14;
			indicatorOpacity = 1;
		};

		update();

		const ro = new ResizeObserver(update);
		ro.observe(navEl);

		return () => ro.disconnect();
	});
</script>

<div class="pillnav-wrap">
	<nav bind:this={navEl} class="pillnav" aria-label="Primary">
		<span
			style:left="{indicatorLeft}px"
			style:opacity={indicatorOpacity}
			class="pillnav-indicator"
			class:is-flow={isFlowActive}
			aria-hidden="true"
		></span>
		{#each navItems as item, i (item.path)}
			{@const active = i === activeIndex}
			{@const flow = isFlowPath(item.path)}
			<button
				class="pillnav-tab"
				class:active
				class:flow-tab={flow}
				aria-current={active ? 'page' : undefined}
				data-nav={item.labelKey === 'nav.profile' ? 'profile' : undefined}
				data-tid={item.labelKey === 'nav.profile' ? TestId.UserMenu : undefined}
				onclick={() => handleNav(item.path)}
				type="button"
			>
				<span class="pillnav-icon-wrap">
					<span class="pillnav-icon-bg" aria-hidden="true"></span>
					<span class="pillnav-icon" aria-hidden="true">
						{#if item.labelKey === 'nav.markets'}
							{#if active}
								<svg fill="currentColor" viewBox="0 0 24 24">
									<rect height="10" rx="1" width="3" x="4" y="10" />
									<rect height="16" rx="1" width="3" x="11" y="4" />
									<rect height="6" rx="1" width="3" x="18" y="14" />
								</svg>
							{:else}
								<svg
									fill="none"
									stroke="currentColor"
									stroke-linecap="round"
									stroke-width="1.6"
									viewBox="0 0 24 24"
								>
									<path d="M5 20V10" />
									<path d="M12 20V4" />
									<path d="M19 20V14" />
								</svg>
							{/if}
						{:else if item.labelKey === 'nav.dash'}
							{#if active}
								<svg fill="currentColor" viewBox="0 0 24 24">
									<rect height="9" rx="1.5" width="7" x="3" y="3" />
									<rect height="5" rx="1.5" width="7" x="14" y="3" />
									<rect height="9" rx="1.5" width="7" x="14" y="12" />
									<rect height="5" rx="1.5" width="7" x="3" y="16" />
								</svg>
							{:else}
								<svg
									fill="none"
									stroke="currentColor"
									stroke-linejoin="round"
									stroke-width="1.6"
									viewBox="0 0 24 24"
								>
									<rect height="9" rx="1.5" width="7" x="3" y="3" />
									<rect height="5" rx="1.5" width="7" x="14" y="3" />
									<rect height="9" rx="1.5" width="7" x="14" y="12" />
									<rect height="5" rx="1.5" width="7" x="3" y="16" />
								</svg>
							{/if}
						{:else if item.labelKey === 'nav.flow'}
							{#if active}
								<svg fill="currentColor" viewBox="0 0 24 24">
									<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
								</svg>
							{:else}
								<svg
									fill="none"
									stroke="currentColor"
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="1.6"
									viewBox="0 0 24 24"
								>
									<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
								</svg>
							{/if}
						{:else if item.labelKey === 'nav.arena'}
							{#if active}
								<svg fill="currentColor" viewBox="0 0 24 24">
									<circle cx="7" cy="10" r="3" />
									<circle cx="17" cy="10" r="3" />
									<circle cx="12" cy="17" r="3" />
								</svg>
							{:else}
								<svg
									fill="none"
									stroke="currentColor"
									stroke-linejoin="round"
									stroke-width="1.6"
									viewBox="0 0 24 24"
								>
									<circle cx="7" cy="10" r="3" />
									<circle cx="17" cy="10" r="3" />
									<circle cx="12" cy="17" r="3" />
								</svg>
							{/if}
						{:else if item.labelKey === 'nav.profile'}
							{#if active}
								<svg viewBox="0 0 24 24">
									<circle
										cx="12"
										cy="12"
										fill="none"
										r="9"
										stroke="currentColor"
										stroke-width="1.6"
									/>
									<circle cx="12" cy="10" fill="currentColor" r="3" />
									<path d="M5.5 19.5c1.5-3 4-4 6.5-4s5 1 6.5 4" fill="currentColor" />
								</svg>
							{:else}
								<svg
									fill="none"
									stroke="currentColor"
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="1.6"
									viewBox="0 0 24 24"
								>
									<circle cx="12" cy="12" r="9" />
									<circle cx="12" cy="10" r="3" />
									<path d="M6 19c1.5-2.5 3.6-3.5 6-3.5s4.5 1 6 3.5" />
								</svg>
							{/if}
						{:else if item.mobileIcon}
							{@const Icon = item.mobileIcon}
							<Icon size={22} strokeWidth={active ? 2 : 1.6} />
						{/if}
					</span>
				</span>
				<span class="pillnav-label">
					{t({ locale: $localeStore, key: item.labelKey })}
				</span>
			</button>
		{/each}
	</nav>
</div>

<!-- Spacer so scrollable content clears the floating pill. -->
<div class="pillnav-spacer" aria-hidden="true"></div>

<style lang="postcss">
	.pillnav-wrap {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		padding: 0 14px calc(env(safe-area-inset-bottom, 0px) + 12px);
		display: flex;
		justify-content: center;
		pointer-events: none;
		z-index: 50;
	}

	.pillnav-spacer {
		height: calc(env(safe-area-inset-bottom, 0px) + 88px);
	}

	.pillnav {
		pointer-events: auto;
		position: relative;
		width: 100%;
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		padding: 6px;
		border: 1px solid rgba(242, 236, 220, 0.12);
		border-radius: var(--radius-nav);
		background: rgba(20, 18, 15, 0.74);
		-webkit-backdrop-filter: blur(16px);
		backdrop-filter: blur(16px);
		box-shadow:
			0 18px 32px -16px rgba(0, 0, 0, 0.55),
			0 -6px 24px -16px rgba(0, 0, 0, 0.22),
			inset 0 1px 0 rgba(242, 236, 220, 0.06);
	}

	:global([data-theme='light']) .pillnav {
		background: rgba(250, 247, 235, 0.78);
		border-color: rgba(14, 13, 11, 0.1);
		box-shadow:
			0 18px 32px -16px rgba(14, 13, 11, 0.18),
			0 -6px 24px -16px rgba(14, 13, 11, 0.08),
			inset 0 1px 0 rgba(255, 255, 255, 0.55);
	}

	:global([data-theme='peach']) .pillnav {
		background: rgba(255, 243, 232, 0.78);
		border-color: rgba(61, 36, 25, 0.12);
		box-shadow:
			0 18px 32px -16px rgba(61, 36, 25, 0.2),
			0 -6px 24px -16px rgba(61, 36, 25, 0.1),
			inset 0 1px 0 rgba(255, 255, 255, 0.45);
	}

	/* 3px laurel-coloured indicator capsule above the active tab.
	   `left` slides between tabs on tab change; color / glow cross-fade. */
	.pillnav-indicator {
		position: absolute;
		top: 3px;
		width: 28px;
		height: 3px;
		border-radius: var(--r-pill);
		background: var(--fg, var(--text-base));
		opacity: 0.85;
		transition:
			left 280ms var(--ease-vici, ease),
			background 220ms var(--ease-vici, ease),
			box-shadow 220ms var(--ease-vici, ease),
			opacity 220ms var(--ease-vici, ease);
		will-change: left;
	}

	.pillnav-indicator.is-flow {
		background: var(--accent, var(--color-primary));
		box-shadow: 0 0 8px rgba(226, 184, 66, 0.55);
		opacity: 1;
	}

	@media (prefers-reduced-motion: reduce) {
		.pillnav-indicator {
			transition: none;
			will-change: auto;
		}
	}

	.pillnav-tab {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 8px 4px 6px;
		min-height: 52px;
		appearance: none;
		border: 0;
		border-radius: 20px;
		background: transparent;
		color: var(--fg-faint, var(--text-muted));
		cursor: pointer;
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 500;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		transition:
			color 180ms var(--ease-vici, ease),
			transform 100ms var(--ease-vici, ease);
	}

	:global([data-theme='light']) .pillnav-tab,
	:global([data-theme='peach']) .pillnav-tab {
		color: rgba(14, 13, 11, 0.45);
	}

	.pillnav-tab:active {
		transform: scale(0.95);
	}

	.pillnav-tab:focus-visible {
		outline: 2px solid var(--accent, var(--color-primary));
		outline-offset: 2px;
	}

	.pillnav-icon-wrap {
		position: relative;
		display: flex;
		width: 40px;
		height: 26px;
		align-items: center;
		justify-content: center;
	}

	/* Background pill behind icon: scales in on active. */
	.pillnav-icon-bg {
		position: absolute;
		inset: -1px 6px;
		border-radius: 14px;
		background: rgba(242, 236, 220, 0.1);
		opacity: 0;
		transform: scaleX(0.6);
		transform-origin: center;
		transition:
			background var(--d-state) var(--ease-vici, ease),
			opacity var(--d-state) var(--ease-vici, ease),
			transform var(--d-state) var(--ease-vici, ease);
	}

	:global([data-theme='light']) .pillnav-icon-bg,
	:global([data-theme='peach']) .pillnav-icon-bg {
		background: rgba(14, 13, 11, 0.08);
	}

	.pillnav-tab.active .pillnav-icon-bg {
		opacity: 1;
		transform: scaleX(1);
	}

	/* Flow-and-here reads as a step up from Flow-as-primary; the active
	   pill brightens past the always-on halo below it. */
	.pillnav-tab.flow-tab.active .pillnav-icon-bg {
		background: rgba(226, 184, 66, 0.28);
	}

	.pillnav-icon {
		position: relative;
		z-index: 1;
		display: inline-flex;
		width: 22px;
		height: 22px;
		align-items: center;
		justify-content: center;
		color: inherit;
	}

	.pillnav-icon :global(svg) {
		width: 100%;
		height: 100%;
	}

	.pillnav-tab.active {
		color: var(--fg, var(--text-base));
	}

	.pillnav-tab.flow-tab.active {
		color: var(--accent, var(--color-primary));
	}

	.pillnav-tab.active .pillnav-label {
		font-weight: 600;
	}

	/* Flow tab: always laurel-tinted with a faint ever-on halo. */
	.pillnav-tab.flow-tab {
		color: var(--accent, var(--color-primary));
	}

	/* Always-on laurel halo behind Flow's icon; a soft glowing pill that
	   marks Flow as the primary action even when it isn't the current tab.
	   Paints beneath both the icon (z-index 1) and the active-state
	   `.pillnav-icon-bg`, so the active pill layers over it for a stronger
	   highlight. The glow carries the lift, so the icon needs no separate
	   drop-shadow. */
	.pillnav-tab.flow-tab .pillnav-icon-wrap::before {
		content: '';
		position: absolute;
		inset: -2px 4px;
		border-radius: var(--r-pill);
		background: rgba(226, 184, 66, 0.16);
		box-shadow: 0 0 20px -6px rgba(226, 184, 66, 0.48);
		pointer-events: none;
		z-index: 0;
	}

	/* Light & peach canvases: the halo tints down to the deeper laurel so
	   it holds contrast against the warm parchment background. */
	:global([data-theme='light']) .pillnav-tab.flow-tab .pillnav-icon-wrap::before,
	:global([data-theme='peach']) .pillnav-tab.flow-tab .pillnav-icon-wrap::before {
		background: rgba(182, 139, 31, 0.14);
		box-shadow: 0 0 20px -6px rgba(182, 139, 31, 0.42);
	}
</style>
