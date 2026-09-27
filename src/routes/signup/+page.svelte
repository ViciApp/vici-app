<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import MovedToNewApp from '$lib/components/authn/MovedToNewApp.svelte';
	import Onboarding from '$lib/components/onboarding/Onboarding.svelte';
	import { PENDING_ONBOARDING_STORAGE_KEY } from '$lib/constants/profile.constants';
	import { AppPath, PublicPath } from '$lib/constants/routes.constants';
	import { userSignedIn } from '$lib/derived/user.derived';
	import { areNewSignupsMoved } from '$lib/services/new-app-redirect.services';
	import { applyOnboardingPicks, checkNicknameAvailability } from '$lib/services/profile.services';
	import { startGuestSession } from '$lib/stores/guest.store';
	import { localeStore } from '$lib/stores/locale.store';
	import { notificationsStore } from '$lib/stores/notification.store';
	import { setAuthBusy, userStore } from '$lib/stores/user.store';
	import { t } from '$lib/utils/i18n.utils';

	// Signed-in routing: a brand-new authenticated user who landed on
	// `/signup` (typically routed here by the (app) layout because their
	// profile has `onboardingCompleted: false`) claims a handle and finishes
	// in place — the provider stack is swapped for a Finish button since they
	// already have a session. A returning user is bounced into the app
	// (`AppPath.Flow`) — either because onboarding is already complete, or
	// because the satellite already held a profile at sign-in
	// (`profileExisted`), in which case a legacy `onboardingCompleted: false`
	// must not re-prompt.
	const authenticated = $derived(
		$userSignedIn &&
			$userStore.profile?.preferences?.onboardingCompleted !== true &&
			!$userStore.profileExisted
	);

	// Bounce any returning user back into the app: either onboarding is
	// already complete, or a profile existed at sign-in (a legacy account
	// whose `onboardingCompleted` defaults to `false` must not be re-prompted).
	$effect(() => {
		if (
			$userSignedIn &&
			($userStore.profile?.preferences?.onboardingCompleted === true || $userStore.profileExisted)
		) {
			void goto(resolve(AppPath.Flow), { replaceState: true });
		}
	});

	onMount(() => {
		document.title = 'Create account · VICI';
	});

	// Every sign-up entry on the legacy build (landing CTAs, the sign-in
	// screen's switch, the invite and league landings, the share-link `?ref=`
	// capture) funnels through this route, so replacing the flow here turns
	// them all into the moved-to-the-new-app screen in one place. Fixed for the
	// page lifetime, hence a plain read.
	const signupsMoved = areNewSignupsMoved();

	// Pre-auth completion (signed-out) — we persist the picks to
	// `PENDING_ONBOARDING_STORAGE_KEY` so the post-sign-in layout effect
	// can upsert them into the new profile. The auth tap itself happens
	// inside Beat 3 via `SignInProviderStack`; after it succeeds,
	// `$userSignedIn` flips and the (app) layout drains the payload.
	//
	// Reads any prior payload first so a `referralCode` stashed by
	// `/i/[code]` (the invite-link landing) survives this overwrite. The
	// drain in `(app)/+layout.svelte` picks the referral up regardless of
	// whether the user made any onboarding picks.
	const readExistingPending = (): Record<string, unknown> => {
		try {
			const raw = localStorage.getItem(PENDING_ONBOARDING_STORAGE_KEY);

			if (isNullish(raw)) {
				return {};
			}

			const parsed: unknown = JSON.parse(raw);

			return typeof parsed === 'object' && nonNullish(parsed)
				? (parsed as Record<string, unknown>)
				: {};
		} catch {
			return {};
		}
	};

	const handleCompletePreAuth = (result: {
		participantId: string | null;
		side: 'YES' | 'NO' | null;
		handle: string | null;
	}) => {
		if (!browser) {
			return;
		}

		const existing = readExistingPending();
		const existingReferralCode =
			typeof existing.referralCode === 'string' ? existing.referralCode : undefined;
		// An email stashed by the email provider (passkey-backed sign-up,
		// see `SignInProviderStack`) must survive this rebuild so the drain
		// persists it onto the profile.
		const existingEmail = typeof existing.email === 'string' ? existing.email : undefined;
		// A league invite stashed by `/league/[code]` (the signed-out invite
		// landing routes here through onboarding) must ALSO survive this
		// rebuild — otherwise the drain never auto-joins the league and the
		// invitee lands friended (from the referral) but not a member.
		const existingLeagueInvite =
			typeof existing.leagueInvite === 'string' ? existing.leagueInvite : undefined;

		// Skip the write if the user bailed before making any pick **and** there's no
		// stashed referral code, league invite, or email to carry forward — nothing to hand off.
		if (
			isNullish(result.handle) &&
			isNullish(result.participantId) &&
			isNullish(result.side) &&
			isNullish(existingReferralCode) &&
			isNullish(existingLeagueInvite) &&
			isNullish(existingEmail)
		) {
			return;
		}

		try {
			localStorage.setItem(
				PENDING_ONBOARDING_STORAGE_KEY,
				JSON.stringify({
					handle: result.handle,
					participantId: result.participantId,
					side: result.side,
					interests: [],
					completedAt: new Date().toISOString(),
					...(nonNullish(existingReferralCode) && { referralCode: existingReferralCode }),
					...(nonNullish(existingLeagueInvite) && { leagueInvite: existingLeagueInvite }),
					...(nonNullish(existingEmail) && { email: existingEmail })
				})
			);
		} catch (err: unknown) {
			console.warn('Onboarding handoff could not be stored:', err);
		}
	};

	// Post-auth completion (already signed-in) — write the picks
	// directly to the profile and route into the app. We reuse the same
	// collision-aware pattern as `(app)/+layout.svelte`: probe nickname
	// availability first when a handle was picked; on collision, still
	// persist team/side/onboardingCompleted (those are independent of
	// the handle).
	let applyingAuthenticatedHandoff = $state(false);

	const handleCompleteAuthenticated = async (result: {
		participantId: string | null;
		side: 'YES' | 'NO' | null;
		handle: string | null;
	}) => {
		if (!browser || applyingAuthenticatedHandoff) {
			return;
		}

		const currentProfile = $userStore.profile;

		// The dev / Internet Identity providers resolve `signIn()`
		// synchronously, so `SignInProviderStack` fires `onSuccess` while
		// `$userSignedIn` has already flipped true but `onAuthStateChange`
		// hasn't landed the profile yet — there's nothing to upsert the picks
		// onto. Rather than drop them, hand off via the same pre-auth stash the
		// signed-out path uses and route into the app, where the `(app)` layout
		// drain applies handle/team/side (and stamps `onboardingCompleted`)
		// once the profile hydrates.
		if (!currentProfile) {
			handleCompletePreAuth(result);
			void goto(resolve(AppPath.Flow), { replaceState: true });

			return;
		}

		applyingAuthenticatedHandoff = true;

		const sidePreference = result.side ?? '';
		const participantPreference = result.participantId ?? '';

		try {
			// Probe the picked handle first. Any unavailable reason — `'taken'`, or the
			// `'too_short'` / `'required'` cases a tolerated legacy payload can still produce —
			// skips the nickname update so team/side/completion (the picks that matter) still
			// persist; only the collision case is worth a toast. The user can rename later.
			let setHandle = false;
			let handleCollision = false;

			if (nonNullish(result.handle)) {
				const probe = await checkNicknameAvailability({
					nickname: result.handle,
					principal: currentProfile.owner
				});

				if (probe.available) {
					setHandle = true;
				} else if (probe.reason === 'taken') {
					handleCollision = true;
				}
			}

			// Field-level patch (NOT a full-snapshot write): `calculateAndSyncStats` writes this
			// same doc concurrently on this finishing login, so a stale full snapshot would lose
			// the optimistic-version race and throw — silently dropping these picks. A handle
			// claimed in the TOCTOU window after the probe is dropped (the rest still persists),
			// reported via `handleApplied`.
			const { profile: nextProfile, handleApplied } = await applyOnboardingPicks({
				principal: currentProfile.owner,
				handle: result.handle,
				setHandle,
				favoriteParticipantId: participantPreference,
				favoriteSide: sidePreference
			});

			if (setHandle && !handleApplied) {
				handleCollision = true;
			}

			if (handleCollision && nonNullish(result.handle)) {
				notificationsStore.add({
					title: t({ locale: $localeStore, key: 'onboarding.handoff.collision_title' }),
					message: t({
						locale: $localeStore,
						key: 'onboarding.handoff.collision',
						params: { handle: result.handle }
					}),
					type: 'error'
				});
			}

			// Bake the new profile into the store so the (app) layout's
			// redirect effect sees `onboardingCompleted: true` immediately
			// and doesn't bounce us back to /signup.
			userStore.update((curr) => ({ ...curr, profile: nextProfile }));

			void goto(resolve(AppPath.Flow), { replaceState: true });
		} catch (err: unknown) {
			// A handle collision is handled inside `applyOnboardingPicks` (it retries without the
			// handle), so anything reaching here is a genuine failure to persist. Surface it — the
			// generic toast otherwise swallows it, which is what made this class of bug invisible.
			console.error('Onboarding handoff (authenticated) failed:', err);

			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'onboarding.handoff.failed_title' }),
				message: t({ locale: $localeStore, key: 'onboarding.handoff.failed' }),
				type: 'error'
			});
		} finally {
			applyingAuthenticatedHandoff = false;
		}
	};

	const handleComplete = (result: {
		participantId: string | null;
		side: 'YES' | 'NO' | null;
		handle: string | null;
	}) => {
		if (authenticated) {
			void handleCompleteAuthenticated(result);

			return;
		}

		// A signed-out visitor who just authenticated via an in-page provider
		// (passkey / passkey-backed email). `signUp()` has resolved, but Juno's
		// `onAuthStateChange` hasn't hydrated the profile yet, so the
		// `authenticated` derived hasn't flipped — without an explicit nav the
		// page would sit on /signup until hydration swaps in the Finish button,
		// forcing a second tap (and a second round of network calls). Stash the
		// picks and route straight into the app, mirroring the redirect-provider
		// (Google) callback: the (app) layout paints its auth-hydration loader,
		// then drains the stash (claiming the handle) once the profile lands.
		// `setAuthBusy(true)` marks the handshake in-flight so the (app) auth
		// gate doesn't bounce to /signin during that window.
		handleCompletePreAuth(result);
		setAuthBusy(true);
		void goto(resolve(AppPath.Flow), { replaceState: true });
	};
</script>

{#if signupsMoved}
	<MovedToNewApp onSignIn={() => void goto(resolve(PublicPath.SignIn))} reason="signup" />
{:else}
	<Onboarding
		{authenticated}
		onComplete={handleComplete}
		onPicksReady={handleCompletePreAuth}
		onSignIn={() => void goto(resolve(PublicPath.SignIn))}
		onSkip={(handle) => {
			// Open the guest preview session (the handle rides through the
			// pre-auth stash already, so conversion keeps the chosen name) and
			// route into Flow, which the (app) layout now lets a guest reach.
			startGuestSession(handle);
			void goto(resolve(AppPath.Flow));
		}}
	/>
{/if}
