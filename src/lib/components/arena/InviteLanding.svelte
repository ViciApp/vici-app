<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { onMount, untrack } from 'svelte';
	import InviteFriendshipSheet from '#lib/components/arena/InviteFriendshipSheet.svelte';
	import LoadingSpinner from '#lib/components/ui/LoadingSpinner.svelte';
	import { PENDING_ONBOARDING_STORAGE_KEY } from '#lib/constants/profile.constants.ts';
	import { REFERRAL_CODE_REGEX } from '#lib/constants/referral.constants.ts';
	import { AppPath, PublicPath } from '#lib/constants/routes.constants.ts';
	import { authBusy, userSignedIn } from '#lib/derived/user.derived.ts';
	import { claimReferralFriendship, lookupReferralCode } from '#lib/services/referral.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { notificationsStore } from '#lib/stores/notification.store.ts';
	import { userStore } from '#lib/stores/user.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { browser } from '$app/env';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	/**
	 * Invite-link landing — the shared body behind both canonical invite URLs, `/i/[code]` and
	 * `/join/[code]`. Both routes carry the same 8-char Crockford-base32 referral code in their
	 * `[code]` slug and render this component, so the two paths behave identically (single source
	 * of truth — no duplicated branching). Branches on the caller's auth state:
	 *
	 *   1. **Invalid code shape** — bail to home with an error toast.
	 *   2. **Signed-out (or a brand-new account still mid-onboarding)** — stash the code
	 *      into the existing `vici:pending-onboarding` payload (merged with whatever
	 *      Beat-1/2 picks are already there) and route to `/signup`. The (app) layout's
	 *      pending-onboarding drain then calls `redeemReferralCode` post-signin.
	 *   3. **Signed-in & past onboarding** — the user is past the signup window
	 *      (or in any case ineligible for the FE-driven redemption path). Look up the
	 *      referrer principal and render the friendship-only explainer sheet. The sheet's
	 *      CTA calls `claimReferralFriendship` (no VXP, just a confirmed bilateral
	 *      friendship).
	 *
	 * Note: only a brand-new account (no profile existed at sign-in) still has an unfinished
	 * onboarding flow; we treat that case the same as signed-out — stash the code and route
	 * to `/signup` so the existing drain can pick it up. A returning user whose legacy profile
	 * never flipped `onboardingCompleted` to `true` is treated as onboarded.
	 */

	type Mode = 'loading' | 'redirecting' | 'friendship';

	let mode = $state<Mode>('loading');
	let referrerPrincipal = $state<string | undefined>(undefined);
	let resolved = false;

	const rawCode = $derived(page.params.code ?? '');
	const normalizedCode = $derived(rawCode.toUpperCase().trim());
	const onboardingCompleted = $derived(
		$userStore.profile?.preferences?.onboardingCompleted === true
	);
	// A returning user (the satellite already held a profile at sign-in) is
	// past onboarding even if their legacy profile still defaults
	// `onboardingCompleted` to `false` — only a brand-new account needs the
	// signup drain. Mirrors the (app) layout's onboarding gate.
	const needsOnboarding = $derived(!onboardingCompleted && !$userStore.profileExisted);

	onMount(() => {
		document.title = 'Invite · VICI';
	});

	$effect(() => {
		if (!browser) {
			return;
		}

		// Wait for the auth handshake before deciding what to do — `authBusy` flips to
		// `false` once the userStore has either hydrated a session or confirmed the user is
		// signed out. Reacting too early would always read `userSignedIn=false`.
		if ($authBusy) {
			return;
		}

		// One-shot — we navigate away in every branch, and the `onMount` mutation guard
		// would otherwise re-fire on the post-nav re-render of this same page instance.
		if (untrack(() => resolved)) {
			return;
		}

		untrack(() => {
			resolved = true;
		});

		void handleInvite();
	});

	const stashCodeForSignup = () => {
		try {
			const raw = localStorage.getItem(PENDING_ONBOARDING_STORAGE_KEY);
			const parsed: Record<string, unknown> =
				nonNullish(raw) && typeof raw === 'string'
					? ((): Record<string, unknown> => {
							try {
								const v = JSON.parse(raw);

								return typeof v === 'object' && nonNullish(v) ? (v as Record<string, unknown>) : {};
							} catch {
								return {};
							}
						})()
					: {};
			parsed.referralCode = normalizedCode;
			localStorage.setItem(PENDING_ONBOARDING_STORAGE_KEY, JSON.stringify(parsed));
		} catch {
			// Best-effort: signup still works without attribution if storage is unavailable.
		}
	};

	const goHome = () => {
		void goto(resolveAppPath(AppPath.Home), { replace: true });
	};

	const goSignup = () => {
		void goto(resolve(PublicPath.SignUp), { replace: true });
	};

	const handleInvite = async () => {
		if (!REFERRAL_CODE_REGEX.test(normalizedCode)) {
			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'invite.invalid_title' }),
				message: t({ locale: $localeStore, key: 'invite.invalid_body' }),
				type: 'error',
				duration: 4000
			});
			mode = 'redirecting';
			goHome();

			return;
		}

		// Signed-out OR a brand-new account still mid-onboarding → stash + route
		// to signup. Returning users fall through to the friendship sheet (see
		// `needsOnboarding`).
		if (!$userSignedIn || needsOnboarding) {
			stashCodeForSignup();
			mode = 'redirecting';
			goSignup();

			return;
		}

		// Existing signed-in user. Resolve the referrer principal so the sheet can show "you
		// can't redeem (no bonus) but here's the inviter — add as friend".
		try {
			const owner = await lookupReferralCode({ code: normalizedCode });

			if (isNullish(owner)) {
				notificationsStore.add({
					title: t({ locale: $localeStore, key: 'invite.unknown_title' }),
					message: t({ locale: $localeStore, key: 'invite.unknown_body' }),
					type: 'error',
					duration: 4000
				});
				mode = 'redirecting';
				goHome();

				return;
			}

			if (owner === $userStore.profile?.owner) {
				notificationsStore.add({
					title: t({ locale: $localeStore, key: 'invite.self_title' }),
					message: t({ locale: $localeStore, key: 'invite.self_body' }),
					type: 'warning',
					duration: 4000
				});
				mode = 'redirecting';
				goHome();

				return;
			}

			referrerPrincipal = owner;
			mode = 'friendship';
		} catch (err: unknown) {
			console.error('Invite resolve failed', err);
			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'invite.generic_error_title' }),
				message: t({ locale: $localeStore, key: 'invite.generic_error_body' }),
				type: 'error',
				duration: 4000
			});
			mode = 'redirecting';
			goHome();
		}
	};

	/**
	 * Sheet CTA — attempts to add the referrer as a friend (no VXP transfer). Idempotent
	 * server-side: a no-op if a relation already exists in any state.
	 */
	let claiming = $state(false);

	const handleAddAsFriend = async () => {
		if (claiming || isNullish(referrerPrincipal)) {
			return;
		}

		claiming = true;

		try {
			await claimReferralFriendship({ code: normalizedCode });

			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'invite.friend_added_title' }),
				message: t({ locale: $localeStore, key: 'invite.friend_added_body' }),
				type: 'success',
				duration: 3500
			});

			goHome();
		} catch (err: unknown) {
			console.error('claimReferralFriendship failed', err);
			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'invite.friend_failed_title' }),
				message: t({ locale: $localeStore, key: 'invite.friend_failed_body' }),
				type: 'error',
				duration: 4000
			});
		} finally {
			claiming = false;
		}
	};

	const handleSkip = () => {
		goHome();
	};
</script>

<div class="flex min-h-screen w-full flex-col items-center justify-center p-6">
	{#if mode === 'loading' || mode === 'redirecting'}
		<!-- Live-region semantics are scoped to this non-interactive resolving state.
		     The `friendship` branch below renders interactive controls, where
		     `role="status"` would mislead assistive tech. -->
		<div class="flex flex-col items-center justify-center" aria-live="polite" role="status">
			<LoadingSpinner inlinePad size="md" />
			<p class="text-muted-foreground mt-4 text-sm">
				{t({ locale: $localeStore, key: 'invite.resolving' })}
			</p>
		</div>
	{:else if mode === 'friendship' && nonNullish(referrerPrincipal)}
		<InviteFriendshipSheet
			busy={claiming}
			onAddFriend={handleAddAsFriend}
			onSkip={handleSkip}
			{referrerPrincipal}
		/>
	{/if}
</div>
