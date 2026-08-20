<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { onMount, type Snippet } from 'svelte';
	import { fade } from 'svelte/transition';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import ClaimBanner from '$lib/components/claim/ClaimBanner.svelte';
	import GuestSaveHost from '$lib/components/guest/GuestSaveHost.svelte';
	import DesktopAppNav from '$lib/components/layout/DesktopAppNav.svelte';
	import MobileNav from '$lib/components/layout/MobileNav.svelte';
	import Loaders from '$lib/components/loaders/Loaders.svelte';
	import MenagerieCelebrationHost from '$lib/components/menagerie/MenagerieCelebrationHost.svelte';
	import SurfaceTipHost from '$lib/components/onboarding/SurfaceTipHost.svelte';
	import AccountReturnGate from '$lib/components/settings/AccountReturnGate.svelte';
	import CompanionOverlay from '$lib/components/ui/CompanionOverlay.svelte';
	import LoadingSpinner from '$lib/components/ui/LoadingSpinner.svelte';
	import NotifToastHost from '$lib/components/ui/NotifToastHost.svelte';
	import { PENDING_ONBOARDING_STORAGE_KEY } from '$lib/constants/profile.constants';
	import { REFERRAL_CODE_REGEX } from '$lib/constants/referral.constants';
	import { AppPath, PublicPath } from '$lib/constants/routes.constants';
	import { TestId } from '$lib/constants/test-ids.constants';
	import { guestMode } from '$lib/derived/guest.derived';
	import { authBusy, userSignedIn, userSignedOutResolved } from '$lib/derived/user.derived';
	import { installE2eResetHook } from '$lib/dev/e2e-reset';
	import {
		drainPendingOnboarding,
		hasPendingOnboarding
	} from '$lib/services/onboarding-handoff.services';
	import { initA2hs } from '$lib/stores/a2hs.store';
	import { initFlowPrewarm } from '$lib/stores/flow.store';
	import { localeStore } from '$lib/stores/locale.store';
	import { notificationsStore } from '$lib/stores/notification.store';
	import { userStore } from '$lib/stores/user.store';
	import { t } from '$lib/utils/i18n.utils';

	interface Props {
		children: Snippet;
	}

	const { children }: Props = $props();

	// Pre-warm the Flow deck so opening `/flow` is instantaneous.
	// Subscriptions inside re-warm in the background on sign-in,
	// balance-domain switch, featured-event toggle, or interest
	// edits — components never block on the rebuild.
	//
	// Gated on `$userSignedIn` so anonymous visitors on the public
	// `/markets` browse surface don't kick off Flow's tag / metadata /
	// queue fetches. `initFlowPrewarm` is idempotent (guarded by an
	// internal `initialized` flag) so re-firing on the signed-out →
	// signed-in transition is a no-op past the first call.
	$effect(() => {
		if ($userSignedIn) {
			initFlowPrewarm();
		}
	});

	// Viewport architecture: inside the authenticated `(app)` shell
	// the document doesn't scroll. We tag <html> with `data-app="1"`
	// so `app.css` can lock `html`/`body` height + `body { overflow:
	// hidden }` only for these routes. The scroll viewport is the
	// `.screen-scroll` `<main>` below. Marketing routes (`/`, `/about`,
	// `/welcome`, `/signin`, `/signup`, `/info/*`) live outside this
	// layout and keep natural body scroll.
	onMount(() => {
		document.documentElement.dataset.app = '1';

		// Capture Chrome's `beforeinstallprompt` before any child mounts — the
		// browser fires it once, early, on a cold load. Idempotent and
		// browser-only (see `a2hs.store`).
		initA2hs();

		// Dev-only: expose the e2e profile-reset hook so the onboarding spec can
		// escape the shared dev mock identity. No-op in production.
		installE2eResetHook();

		return () => {
			delete document.documentElement.dataset.app;
		};
	});

	// Public markets surface — any visitor can open a market's detail
	// (`/markets/[id]`) before signing up. Auth-requiring affordances on
	// the detail page (placing a call, saving, resolving) bounce to
	// `/signin` at the point of action. The bare `/markets` path is now a
	// redirect alias to the canonical list (`/app`); the path stays
	// exempt so the redirect page mounts and forwards without a transient
	// signin bounce, then the auth-gated `/app` destination owns the
	// signed-out path.
	const isPublicMarketsRoute = $derived(
		page.url.pathname === '/markets' || page.url.pathname.startsWith('/markets/')
	);

	// Info / legal docs (`/info/[slug]`) sit inside the (app) shell so
	// signed-in users get the navpill while reading them, but they
	// must also stay reachable from pre-auth surfaces (the signup
	// terms / privacy links in onboarding). Treat them as a
	// public route alongside the markets exemption above.
	const isPublicInfoRoute = $derived(page.url.pathname.startsWith('/info/'));

	// Guest preview surface — an active guest session (the onboarding Skip path)
	// may reach Flow to predict freely with no account. Scoped to Flow: that is
	// all the preview funnel needs, and it keeps a plain signed-out visitor (no
	// guest session) bounced to /signin everywhere as before. A guest never has
	// a real principal, so every auth-requiring path past Flow stays gated.
	const isGuestAllowedRoute = $derived(
		$guestMode && page.url.pathname.startsWith(resolve(AppPath.Flow))
	);

	// Auth-hydration window. After a provider resolves (notably the
	// Internet Identity multi-account path), `goto(Flow)` can mount this
	// shell while `onAuthStateChange` is still hydrating the profile —
	// `authBusy` is true, or the session is present but `profile` hasn't
	// landed yet. In that window neither redirect effect below should fire
	// (they'd bounce mid-hydration) and the shell must not paint an empty
	// child. Render a loader instead. Public browse surfaces are exempt:
	// an anonymous visitor there is legitimate and gets real content.
	const authResolving = $derived(
		!isPublicMarketsRoute &&
			!isPublicInfoRoute &&
			($authBusy || ($userSignedIn && !$userStore.profile))
	);

	let applyingPendingOnboarding = $state(false);

	// Share-link referral attribution. The prediction-share sheet hands out
	// `/m/{id}?ref={code}` (aliased to `/markets/{id}?ref={code}`, which lands
	// inside this layout). Reading the param here — the first place a freshly
	// arriving visitor is handled — lets us credit the referral without a
	// dedicated landing route: we stash the code into the SAME
	// `vici:pending-onboarding` slot that `/i/{code}` uses, and the drain below
	// redeems it post-signin (or, for a returning user, falls back to the
	// friendship-only path). The market context is preserved — we only read the
	// query string, never redirect.
	//
	// Idempotency / guard rails:
	//   - Stash only when no `referralCode` is already pending (a user already
	//     attributed to a referrer is never overwritten). The satellite enforces
	//     one-redemption-per-referee and self-referral rejection.
	//   - The share URL falls back to the sharer's handle when their referral
	//     code hasn't loaded yet (`refToken = referralCode ?? handle`); a handle
	//     fails `REFERRAL_CODE_REGEX`, so malformed / non-code `?ref=` values are
	//     ignored here gracefully.
	const captureSharedReferral = (code: string): void => {
		try {
			const raw = localStorage.getItem(PENDING_ONBOARDING_STORAGE_KEY);
			const parsed: Record<string, unknown> = nonNullish(raw)
				? ((): Record<string, unknown> => {
						try {
							const v: unknown = JSON.parse(raw);

							return typeof v === 'object' && nonNullish(v) ? (v as Record<string, unknown>) : {};
						} catch {
							return {};
						}
					})()
				: {};

			// Never overwrite an existing attribution — first referrer wins.
			if (typeof parsed.referralCode === 'string' && parsed.referralCode.length > 0) {
				return;
			}

			parsed.referralCode = code;
			localStorage.setItem(PENDING_ONBOARDING_STORAGE_KEY, JSON.stringify(parsed));
		} catch {
			// Best-effort: attribution is cosmetic relative to the rest of the
			// visit and must never break navigation if storage is unavailable.
		}
	};

	$effect(() => {
		if (!browser) {
			return;
		}

		// Attribution targets *incoming* visitors only. An already-signed-in
		// session that opens a share link is an established user who was never
		// referred — stashing the `?ref=` code here would let the post-signin
		// drain below mis-fire `claimReferralFriendship` for them. Skip the
		// capture for signed-in sessions, mirroring how the genuine `/i/{code}`
		// pre-auth stash only runs while signed-out.
		if ($userSignedIn) {
			return;
		}

		const rawRef = page.url.searchParams.get('ref');

		if (isNullish(rawRef)) {
			return;
		}

		const normalized = rawRef.toUpperCase().trim();

		if (!REFERRAL_CODE_REGEX.test(normalized)) {
			return;
		}

		captureSharedReferral(normalized);
	});

	// Auth gate — every (app) route requires a session. We only
	// redirect once `userSignedOutResolved` is true, i.e. after the
	// initial auth handshake has completed. Reacting to `authBusy`
	// directly would bounce users to /signin during a normal page
	// load. See `docs/ai/frontend/design.md` §8.1.
	//
	// Belt-and-braces: also require `!$userSignedIn` so a transient
	// `authBusy` flip during a hot in-app navigation (e.g. just after
	// `signIn()` resolves but before the userStore has finished
	// hydrating the new principal's profile) doesn't briefly bounce a
	// signed-in user back to /signin — the visible "double sign-in"
	// flash the user reported on 2026-05-27.
	$effect(() => {
		if (!browser) {
			return;
		}

		if (isPublicMarketsRoute || isPublicInfoRoute || isGuestAllowedRoute) {
			return;
		}

		// Never bounce to /signin while the handshake is in flight. This is
		// implied by `userSignedOutResolved` (which is `!authBusy && !user`),
		// but stating it explicitly keeps the precondition obvious and aligned
		// with the forced-onboarding gate below.
		if ($authBusy) {
			return;
		}

		if ($userSignedOutResolved && !$userSignedIn) {
			void goto(resolve(PublicPath.SignIn), { replaceState: true });
		}
	});

	// Post-signin onboarding handoff. The drain logic (parse the pre-auth
	// `vici:pending-onboarding` stash, branch returning-vs-new user, upsert the
	// profile with a nickname-collision probe, kick off the best-effort referral
	// redeem + league auto-join) lives in `onboarding-handoff.services.ts`; this
	// effect is the I/O trigger that guards entry and maps the typed outcome to
	// the primary toast. `applyingPendingOnboarding` is set synchronously before
	// the await so re-entry while the drain is in flight is impossible, and the
	// forced-onboarding gate below stays held off until it settles.
	$effect(() => {
		if (
			!browser ||
			applyingPendingOnboarding ||
			!$userSignedIn ||
			!$userStore.profile ||
			!hasPendingOnboarding()
		) {
			return;
		}

		const { profile } = $userStore;
		const { profileExisted } = $userStore;
		const locale = $localeStore;

		applyingPendingOnboarding = true;

		void (async () => {
			try {
				const outcome = await drainPendingOnboarding({ locale, profile, profileExisted });

				switch (outcome.kind) {
					case 'account_exists':
						notificationsStore.add({
							title: t({ locale, key: 'onboarding.handoff.account_exists_title' }),
							message: t({
								locale,
								key: 'onboarding.handoff.account_exists',
								params: { nickname: outcome.nickname }
							}),
							type: 'info'
						});
						break;
					case 'collision':
						notificationsStore.add({
							title: t({ locale, key: 'onboarding.handoff.collision_title' }),
							message: t({
								locale,
								key: 'onboarding.handoff.collision',
								params: { handle: outcome.handle }
							}),
							type: 'error'
						});
						break;
					case 'failed':
						notificationsStore.add({
							title: t({ locale, key: 'onboarding.handoff.failed_title' }),
							message: t({ locale, key: 'onboarding.handoff.failed' }),
							type: 'error'
						});
						break;
				}
			} finally {
				applyingPendingOnboarding = false;
			}
		})();
	});

	// Brand-new signed-in users who skipped `/signup` (signed in via
	// `/signin` or via the auth landing flow) end up with a fresh
	// profile whose `preferences.onboardingCompleted === false`. Route
	// them to the 3-beat onboarding (which renders in authenticated mode
	// — Beat 3 swaps the provider stack for a Finish button). We gate on
	// `!profileExisted` so returning users whose legacy profiles default
	// `onboardingCompleted` to `false` are NOT re-prompted; their
	// existing satellite-side profile wins.
	$effect(() => {
		if (
			!browser ||
			// Don't redirect mid-hydration: while `authBusy` is still set the
			// session/profile is settling (e.g. just after II resolves), and
			// bouncing to /signup here is the blank-shell race we guard against.
			$authBusy ||
			applyingPendingOnboarding ||
			!$userSignedIn ||
			!$userStore.profile ||
			$userStore.profileExisted
		) {
			return;
		}

		if ($userStore.profile.preferences?.onboardingCompleted === true) {
			return;
		}

		if (page.url.pathname === PublicPath.SignUp) {
			return;
		}

		// If a pending payload is still being applied in the same tick,
		// let that path finish — it will set `onboardingCompleted: true`.
		const raw = localStorage.getItem(PENDING_ONBOARDING_STORAGE_KEY);

		if (nonNullish(raw)) {
			return;
		}

		void goto(resolve(PublicPath.SignUp), { replaceState: true });
	});
</script>

<div
	style:--navpill-h={$userSignedIn ? '88px' : '0px'}
	class="relative isolate flex h-full flex-col"
>
	<!--
		Desktop chrome — landing-style top nav. Hidden at <56rem; the
		mobile floating pillnav (rendered below as `<MobileNav>`) owns
		the chrome at narrower viewports.

		The desktop layout adapts the mobile design to a proper
		desktop chrome: top-nav header + wider content column, NOT
		a fake-mobile phone bezel.
	-->
	<DesktopAppNav />

	<!--
		Legacy-build-only migration banner: invites signed-in users to carry
		their account over to the new stack. The component renders nothing on
		the web2 build (the availability gate lives in the claim service).
	-->
	{#if $userSignedIn}
		<ClaimBanner />
	{/if}

	<main class="screen-scroll">
		{#if authResolving}
			<!--
				Auth-hydration window — show a loader rather than the child
				snippet. After a provider resolves (notably the Internet Identity
				multi-account path), this shell can mount while the session /
				profile is still settling; painting `children()` here risks a
				blank shell, and the redirect effects above are held off too.
			-->
			<div
				class="flex min-h-full items-center justify-center"
				aria-label={t({ locale: $localeStore, key: 'authn.checking.aria' })}
				aria-live="polite"
				data-tid={TestId.AppMain}
				role="status"
			>
				<LoadingSpinner size="lg" />
			</div>
		{:else}
			{#key page.url.pathname}
				<div
					class="app-shell-content"
					data-tid={TestId.AppMain}
					in:fade={{ duration: 100, delay: 100 }}
					out:fade={{ duration: 100 }}
				>
					{@render children()}
				</div>
			{/key}
		{/if}

		<Loaders />
	</main>

	<!--
		Bottom nav is visible on every signed-in surface including
		Flow and market detail. The one exception is anonymous visitors
		on public routes (`/markets`, `/markets/*`, `/info/*`) — the
		navpill's tabs all point at auth-gated areas, so showing it to a
		signed-out user is a dead-end. On market detail the YES/NO CTA
		bar floats above the navpill rather than replacing it.
	-->
	{#if $userSignedIn}
		<MobileNav />
	{/if}

	<CompanionOverlay />

	<!--
		Menagerie achievement layer — mounts the glyph sprite once and drives the
		one-at-a-time celebration reveal when the owner crosses a new animal tier.
		First-ever load seeds the celebrated-keys ledger silently; the reveal is
		held while a Flow character beat is on screen so the two never collide.
	-->
	{#if $userSignedIn}
		<MenagerieCelebrationHost />
	{/if}

	<!--
		First-run surface tips — layer 2 of the tutorial system. The first time an
		early user (`totalTrades < 5`) lands on Dash / Arena / Profile, a single
		non-blocking tip slides in above the pillnav, shown at most once per
		surface per device. Distinct from the in-flow `FlowCoach` (layer 1).
	-->
	{#if $userSignedIn}
		<SurfaceTipHost />
	{/if}

	<!--
		Slide-in notification toast. Mounted at the shell level so it
		surfaces on any signed-in surface the moment a genuinely new inbox
		item arrives (see `inbox.store.ts`'s `latestInboxToast`). Pinned to
		the top of the viewport, above the content.
	-->
	<NotifToastHost />

	<!--
		Guest conversion funnel. For a signed-out guest previewing Flow it
		mounts the standing "start for real" inline CTA and the soft / remind
		save sheet, gated so they never stack on a menagerie reveal or a Flow
		beat. Inert (renders nothing) for members and plain signed-out visitors.
	-->
	<GuestSaveHost />

	<!--
		Recovery-on-return gate. Self-hides when the profile is active, so
		it's inert for normal users; covers the shell only for a returning
		soft-deleted / hibernated account until they recover, resume, or
		sign out.
	-->
	<AccountReturnGate />
</div>
