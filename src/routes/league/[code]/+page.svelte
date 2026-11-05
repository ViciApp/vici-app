<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import { onMount, untrack } from 'svelte';
	import LoadingSpinner from '#lib/components/ui/LoadingSpinner.svelte';
	import { REFERRAL_CODE_REGEX } from '#lib/constants/referral.constants.ts';
	import { AppPath, PublicPath } from '#lib/constants/routes.constants.ts';
	import { authBusy, userSignedIn } from '#lib/derived/user.derived.ts';
	import { track } from '#lib/services/analytics.services.ts';
	import { joinLeagueByInvite, lookupLeagueByInvite } from '#lib/services/leagues.services.ts';
	import { claimReferralFriendship } from '#lib/services/referral.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { notificationsStore } from '#lib/stores/notification.store.ts';
	import { userStore } from '#lib/stores/user.store.ts';
	import { LEAGUE_INVITE_CODE_REGEX } from '#lib/types/league.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { stashLeagueInviteForSignup } from '#lib/utils/pending-onboarding.utils.ts';
	import { browser } from '$app/env';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	/**
	 * League-invite landing page — the single canonical URL the "Invite"
	 * buttons copy (`{origin}/league/{code}`). Mirrors the `/i/[code]`
	 * referral landing. The `[code]` slug is a 6-char `[A-Z0-9]` invite
	 * code enforced by `LEAGUE_INVITE_CODE_REGEX`. Branches on auth state:
	 *
	 *   1. **Invalid code shape** — toast + bail to the leagues list.
	 *   2. **Signed-out (or a brand-new account still mid-onboarding)** —
	 *      stash the code into the `vici:pending-onboarding` payload and
	 *      route to `/signup`. The (app) layout's pending-onboarding drain
	 *      then auto-joins the league once the new account is in place.
	 *      Returning users (a profile already existed at sign-in) skip this
	 *      and join directly, even if their legacy profile never flipped
	 *      `onboardingCompleted` to `true`.
	 *   3. **Signed-in & onboarded** — resolve the league, join it (or
	 *      route straight in if already a member), then land on the
	 *      league detail page.
	 *
	 * A league invite also implies a friend invite. The sharer's referral
	 * code rides along as `?ref={code}` (see `buildLeagueShareUrl`); we route
	 * it through the existing referral machinery split by sign-in state:
	 * signed-out → stash it next to the league invite so the signup drain
	 * redeems it (friendship + new-user bonus); signed-in returning user →
	 * claim the friendship directly after the join (no bonus, idempotent).
	 * The pending-onboarding slot is signed-out machinery — its drain toasts
	 * "account exists" for returning users — so we never stash `?ref=` for a
	 * signed-in session.
	 */

	let resolved = false;

	const rawCode = $derived(page.params.code ?? '');
	const normalizedCode = $derived(rawCode.toUpperCase().trim());
	// The sharer's referral code, when the invite link carried one. Validated
	// to the canonical code shape so a stray / malformed `?ref=` is ignored.
	const referralCode = $derived.by(() => {
		const raw = page.url.searchParams.get('ref');

		if (!nonNullish(raw)) {
			return;
		}

		const normalized = raw.toUpperCase().trim();

		return REFERRAL_CODE_REGEX.test(normalized) ? normalized : undefined;
	});
	const onboardingCompleted = $derived(
		$userStore.profile?.preferences?.onboardingCompleted === true
	);
	// A returning user (the satellite already held a profile at sign-in) is
	// past onboarding even if their legacy profile still defaults
	// `onboardingCompleted` to `false` — only a brand-new account needs the
	// signup drain. Mirrors the (app) layout's onboarding gate.
	const needsOnboarding = $derived(!onboardingCompleted && !$userStore.profileExisted);

	const leaguesListPath = `${resolveAppPath(AppPath.Arena)}/leagues`;

	onMount(() => {
		document.title = 'Join league · VICI';
	});

	$effect(() => {
		if (!browser) {
			return;
		}

		// Wait for the auth handshake before deciding what to do — reacting
		// too early would always read `userSignedIn=false`.
		if ($authBusy) {
			return;
		}

		// One-shot — we navigate away in every branch, and the `onMount`
		// mutation guard would otherwise re-fire on the post-nav re-render.
		if (untrack(() => resolved)) {
			return;
		}

		untrack(() => {
			resolved = true;
		});

		void handleInvite();
	});

	const goLeaguesList = () => {
		void goto(leaguesListPath, { replace: true });
	};

	const handleInvite = async () => {
		if (!LEAGUE_INVITE_CODE_REGEX.test(normalizedCode)) {
			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'league_invite.invalid_title' }),
				message: t({ locale: $localeStore, key: 'league_invite.invalid_body' }),
				type: 'error',
				duration: 4000
			});
			goLeaguesList();

			return;
		}

		// Signed-out OR a brand-new account still mid-onboarding → stash +
		// route to signup. The (app) layout drain redeems the invite once the
		// profile exists. Returning users join directly (see `needsOnboarding`).
		// The common signed-out case (no signed-in hint on the device) never
		// reaches here — `+page.ts` fast-paths it before the auth handshake;
		// this branch covers a stale hint whose session turned out expired.
		if (!$userSignedIn || needsOnboarding) {
			stashLeagueInviteForSignup({ inviteCode: normalizedCode, referralCode });
			void goto(resolve(PublicPath.SignUp), { replace: true });

			return;
		}

		// Existing signed-in user — resolve the league first so we can route
		// the user in and name the league in the toast, regardless of the
		// join outcome.
		try {
			const league = await lookupLeagueByInvite({ inviteCode: normalizedCode });

			if (!league) {
				notificationsStore.add({
					title: t({ locale: $localeStore, key: 'league_invite.unknown_title' }),
					message: t({ locale: $localeStore, key: 'league_invite.unknown_body' }),
					type: 'error',
					duration: 4000
				});
				goLeaguesList();

				return;
			}

			try {
				await joinLeagueByInvite({ inviteCode: normalizedCode });

				notificationsStore.add({
					title: t({
						locale: $localeStore,
						key: 'league_invite.joined_title',
						params: { name: league.name }
					}),
					message: t({ locale: $localeStore, key: 'league_invite.joined_body' }),
					type: 'success',
					duration: 3500
				});
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : '';

				// Already a member is a no-op success — fall through and route in.
				if (message !== 'Already a member of this league.') {
					console.error('League invite join failed', err);
					notificationsStore.add({
						title: t({ locale: $localeStore, key: 'league_invite.error_title' }),
						message: t({ locale: $localeStore, key: 'league_invite.error_body' }),
						type: 'error',
						duration: 4000
					});
					goLeaguesList();

					return;
				}
			}

			// A league invite implies a friend invite. A signed-in returning user
			// is past the signup window, so there's no VXP bonus — just land them
			// in the sharer's friends list. Best-effort and idempotent: the
			// satellite no-ops an existing relation and rejects self-referral.
			if (nonNullish(referralCode)) {
				try {
					await claimReferralFriendship({ code: referralCode });
					track({ name: 'referral_redeemed', source: 'league_invite' });
				} catch (friendErr: unknown) {
					console.warn(
						'League invite friendship claim failed',
						friendErr instanceof Error ? friendErr.message : friendErr
					);
				}
			}

			void goto(`${leaguesListPath}/${league.id}`, { replace: true });
		} catch (err: unknown) {
			console.error('League invite resolve failed', err);
			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'league_invite.error_title' }),
				message: t({ locale: $localeStore, key: 'league_invite.error_body' }),
				type: 'error',
				duration: 4000
			});
			goLeaguesList();
		}
	};
</script>

<div
	class="flex min-h-screen w-full flex-col items-center justify-center p-6"
	aria-live="polite"
	role="status"
>
	<LoadingSpinner inlinePad size="md" />
	<p class="text-muted-foreground mt-4 text-sm">
		{t({ locale: $localeStore, key: 'league_invite.resolving' })}
	</p>
</div>
