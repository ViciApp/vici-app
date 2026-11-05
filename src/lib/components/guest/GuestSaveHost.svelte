<script lang="ts">
	import { isNullish } from '@dfinity/utils';
	import { Sparkles } from '@lucide/svelte/icons';
	import { untrack } from 'svelte';
	import GuestSaveSheet from '#lib/components/guest/GuestSaveSheet.svelte';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { newUserVxpAmountMilestone1BaseUnits } from '#lib/constants/vxp-onboarding.constants.ts';
	import { guestHandle, guestMode, guestPickCount } from '#lib/derived/guest.derived.ts';
	import { userSignedIn } from '#lib/derived/user.derived.ts';
	import { track } from '#lib/services/analytics.services.ts';
	import { pendingOnboardingProvider } from '#lib/services/onboarding-handoff.services.ts';
	import { flowBeatActiveStore } from '#lib/stores/flow-beat.store.ts';
	import { clearGuestSession } from '#lib/stores/guest.store.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { menagerieCelebrationStore } from '#lib/stores/menagerie-celebration.store.ts';
	import { notificationsStore } from '#lib/stores/notification.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { formatVxpBalance } from '#lib/utils/playground-display.utils.ts';
	import { page } from '$app/state';

	/**
	 * Guest conversion funnel host. Mounted once at the app shell. For a
	 * signed-out guest previewing Flow it drives:
	 *
	 *  - the standing inline CTA pill (whenever `sessionPickCount >= 1` on Flow),
	 *  - the soft sheet on pick 1 and the remind sheet every 5th pick,
	 *  - the collision gate (never stacks on a menagerie reveal or Flow beat),
	 *  - conversion: clearing the guest session + the "VXP added" toast.
	 *
	 * Inert for members and plain signed-out visitors (renders nothing).
	 */
	const REMIND_INTERVAL = 5;

	const onFlow = $derived(page.url.pathname.startsWith(AppPath.Flow));
	const isGuestOnFlow = $derived($guestMode && onFlow);

	// Once a real session lands, the guest preview is over — clear any lingering
	// guest state so it never leaks into the authenticated experience. The
	// convert path also clears explicitly; this is the belt-and-braces for a
	// provider whose session flips before `onConverted` runs (the dev / II
	// synchronous resolve) and for a stale flag on a returning member.
	$effect(() => {
		if ($userSignedIn && untrack(() => $guestMode)) {
			clearGuestSession();
		}
	});

	// Collision gate (the same pattern `MenagerieCelebrationHost` uses): never
	// render the sheet or the pill while an earned celebration or a Flow
	// character beat is on screen. The ask waits until both clear.
	const reveal = $derived($menagerieCelebrationStore.current);
	const beatActive = $derived($flowBeatActiveStore);
	const overlayClear = $derived(isNullish(reveal) && !beatActive);

	const starterVxp = $derived(formatVxpBalance({ value: newUserVxpAmountMilestone1BaseUnits() }));

	let sheetOpen = $state(false);
	let sheetKind = $state<'soft' | 'remind'>('soft');
	// The pick count the sheet has already auto-fired for, so a cadence hit
	// opens the sheet exactly once per qualifying pick.
	let lastAutoFiredCount = $state(0);

	// Cadence — auto-open the sheet on pick 1 (soft) and every 5th pick after
	// (remind). Tracks the session count; gated on the guest being on Flow with
	// no overlay in the way. The fire is recorded so dismissing keeps the guest
	// previewing without the same pick re-opening it.
	$effect(() => {
		const count = $guestPickCount;

		if (!isGuestOnFlow || !overlayClear || count < 1) {
			return;
		}

		untrack(() => {
			if (count === lastAutoFiredCount) {
				return;
			}

			const isSoft = count === 1;
			const isRemind = count > 1 && (count - 1) % REMIND_INTERVAL === 0;

			if (!isSoft && !isRemind) {
				return;
			}

			sheetKind = isSoft ? 'soft' : 'remind';
			sheetOpen = true;
			lastAutoFiredCount = count;

			// Conversion-funnel step. Reuses `onboarding_step` (no new event
			// name → no analytics-wire regen): `source: 'guest_flow'` separates
			// the guest funnel, `label` the surface, `count` the session pick.
			track({
				name: 'onboarding_step',
				source: 'guest_flow',
				label: isSoft ? 'soft' : 'remind',
				count
			});
		});
	});

	const openInline = () => {
		sheetKind = 'remind';
		sheetOpen = true;

		track({
			name: 'onboarding_step',
			source: 'guest_flow',
			label: 'inline',
			count: untrack(() => $guestPickCount)
		});
	};

	const onConverted = () => {
		// Demo-drop: discard the in-session preview and route the guest through
		// the normal new-member path. The pre-auth stash already carries the
		// handle/identity handoff; the existing onboarding grant fires on profile
		// creation and the portfolio starts empty. No pick is ever staked.
		const locale = $localeStore;
		const vxp = formatVxpBalance({ value: newUserVxpAmountMilestone1BaseUnits() });

		// `label` carries the auth method — `SignInProviderStack` stashed the
		// provider into the pending-onboarding payload before it ran, so it is
		// readable here without threading it through the sheet callbacks.
		// Best-effort: absent when storage was unavailable.
		const provider = pendingOnboardingProvider();

		track({
			name: 'signed_up',
			source: 'guest_convert',
			...(isNullish(provider) ? {} : { label: provider })
		});

		clearGuestSession();
		sheetOpen = false;

		notificationsStore.add({
			title: t({ locale, key: 'guest.convert.toast_title' }),
			message: t({ locale, key: 'guest.convert.toast_message', params: { vxp } }),
			type: 'success'
		});
	};
</script>

{#if isGuestOnFlow && $guestPickCount >= 1 && overlayClear && !sheetOpen}
	<button class="guest-inline-cta" onclick={openInline} type="button">
		<span class="guest-inline-icon" aria-hidden="true">
			<Sparkles size={15} strokeWidth={1.8} />
		</span>
		<span class="guest-inline-label">
			{t({ locale: $localeStore, key: 'guest.inline.cta', params: { vxp: starterVxp } })}
		</span>
	</button>
{/if}

{#if isGuestOnFlow && overlayClear}
	<GuestSaveSheet
		handle={$guestHandle}
		isOpen={sheetOpen}
		kind={sheetKind}
		onClose={() => (sheetOpen = false)}
		{onConverted}
		pickCount={$guestPickCount}
	/>
{/if}

<style lang="postcss">
	.guest-inline-cta {
		position: fixed;
		left: 50%;
		bottom: calc(var(--navpill-h, 0px) + 0.9rem + env(safe-area-inset-bottom, 0px));
		transform: translateX(-50%);
		z-index: 60;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		max-width: calc(100vw - 2rem);
		padding: 0.5rem 0.9rem;
		border-radius: var(--r-pill);
		border: 1px solid var(--border-base);
		background: var(--bg-popover);
		color: var(--text-base);
		font-size: 0.85rem;
		font-weight: 600;
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28);
		cursor: pointer;
		animation: guest-cta-rise var(--d-state, 220ms) var(--ease-vici, ease-out) both;
	}

	.guest-inline-icon {
		display: inline-flex;
		color: var(--laurel, var(--text-base));
	}

	.guest-inline-label {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	@keyframes guest-cta-rise {
		from {
			opacity: 0;
			transform: translate(-50%, 0.5rem);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.guest-inline-cta {
			animation: none;
		}
	}
</style>
