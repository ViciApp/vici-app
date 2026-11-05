<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { onDestroy } from 'svelte';
	import SurfaceTip from '#lib/components/onboarding/SurfaceTip.svelte';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { track } from '#lib/services/analytics.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { userStore } from '#lib/stores/user.store.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';
	import {
		TIP_ARENA_SEEN_KEY,
		TIP_DASH_SEEN_KEY,
		TIP_PROFILE_SEEN_KEY
	} from '#lib/utils/onboarding-flags.utils.ts';
	import { browser } from '$app/env';
	import { page } from '$app/state';

	/**
	 * SurfaceTipHost — layer 2 of the first-run tutorial system. Mounted once at
	 * the (app) shell beside `<MobileNav>`. The first time a qualifying early
	 * user navigates to Dash / Arena / Profile, it slides in a single
	 * `SurfaceTip` above the floating pillnav explaining the surface, marks that
	 * surface seen-on-show (so it shows exactly once per device, even if
	 * ignored), and fires the `onboarding_step` analytics. One tip at a time,
	 * route-gated (not a queue); nothing fires up front.
	 *
	 * Gating: only an early user (`totalTrades < 5`) with the surface flag still
	 * unset ever sees a tip — an established user is never interrupted. The
	 * per-surface flags are identity-scoped (`onboarding-flags.utils`), so a
	 * principal change and `clearOnboardingSeenFlags()` both reset them.
	 *
	 * Surface aliasing mirrors `MobileNav.isActive`: `/portfolio` counts as Dash
	 * and `/arena/*` as Arena. Profile fires on the canonical `/profile` only
	 * (not the aliased `/wallet` / `/settings` / `/notifications`), so the
	 * "your identity lives here" nudge can't pop on the Settings screen.
	 */

	const SETTLE_DELAY_MS = 420;

	type Surface = 'dash' | 'arena' | 'profile';

	interface SurfaceTipConfig {
		surface: Surface;
		seenKey: string;
		titleKey: MessageKey;
		bodyKey: MessageKey;
	}

	const surfaceForPath = (pathname: string): SurfaceTipConfig | null => {
		if (pathname === AppPath.Dash || pathname === AppPath.Portfolio) {
			return {
				surface: 'dash',
				seenKey: TIP_DASH_SEEN_KEY,
				titleKey: 'tip.dash.title',
				bodyKey: 'tip.dash.body'
			};
		}

		if (pathname === AppPath.Arena || pathname.startsWith(`${AppPath.Arena}/`)) {
			return {
				surface: 'arena',
				seenKey: TIP_ARENA_SEEN_KEY,
				titleKey: 'tip.arena.title',
				bodyKey: 'tip.arena.body'
			};
		}

		if (pathname === AppPath.Profile) {
			return {
				surface: 'profile',
				seenKey: TIP_PROFILE_SEEN_KEY,
				titleKey: 'tip.profile.title',
				bodyKey: 'tip.profile.body'
			};
		}

		return null;
	};

	const readSeen = (key: string): boolean => {
		if (!browser) {
			return false;
		}

		try {
			return Boolean(localStorage.getItem(key));
		} catch {
			return false;
		}
	};

	const markSeen = (key: string): void => {
		if (!browser) {
			return;
		}

		try {
			localStorage.setItem(key, '1');
		} catch {
			// localStorage write blocked — accept the loss; the tip may
			// reappear next session on this device.
		}
	};

	// Only an actually-hydrated profile can qualify. During the auth-hydration
	// window (`userSignedIn === true` but `profile` still `undefined`) we must
	// not treat the user as early — an established user would otherwise slip
	// through the `?? 0` gate and get a tip shown + seen flag written.
	const isEarlyUser = $derived(
		nonNullish($userStore.profile) && $userStore.profile.totalTrades < 5
	);

	const config = $derived(surfaceForPath(page.url.pathname));

	let active = $state<SurfaceTipConfig | null>(null);
	let settleTimer: ReturnType<typeof setTimeout> | null = null;

	const clearTimer = (): void => {
		if (nonNullish(settleTimer)) {
			clearTimeout(settleTimer);
			settleTimer = null;
		}
	};

	// Route change resets the local enter state and re-arms the settle delay for
	// the new surface. Seen-on-show: once the tip appears we write the flag and
	// fire the shown event, so it shows exactly once per device.
	$effect(() => {
		const next = config;

		clearTimer();
		active = null;

		if (!browser || isNullish(next) || !isEarlyUser || readSeen(next.seenKey)) {
			return;
		}

		settleTimer = setTimeout(() => {
			settleTimer = null;
			markSeen(next.seenKey);
			track({ name: 'onboarding_step', source: 'surface_tip', label: next.surface });
			active = next;
		}, SETTLE_DELAY_MS);

		return clearTimer;
	});

	const dismiss = (): void => {
		const current = active;
		active = null;

		if (nonNullish(current)) {
			track({ name: 'onboarding_step', source: 'surface_tip_dismiss', label: current.surface });
		}
	};

	onDestroy(clearTimer);
</script>

{#if nonNullish(active)}
	<SurfaceTip
		body={t({ locale: $localeStore, key: active.bodyKey })}
		onDismiss={dismiss}
		title={t({ locale: $localeStore, key: active.titleKey })}
	/>
{/if}
