<script lang="ts">
	import { Sparkles } from '@lucide/svelte/icons';
	import SignInProviderStack from '#lib/components/authn/SignInProviderStack.svelte';
	import BottomSheet from '#lib/components/ui/BottomSheet.svelte';
	import { newUserVxpAmountMilestone1BaseUnits } from '#lib/constants/vxp-onboarding.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { formatVxpBalance } from '#lib/utils/playground-display.utils.ts';

	/**
	 * Guest conversion sheet — the "start for real + claim VXP" ask shown to a
	 * signed-out guest previewing Flow. Two roles in one component: `soft` (the
	 * celebratory first-pick ask) and `remind` (the every-5th nudge with the
	 * in-session pick count as social proof).
	 *
	 * The copy never promises saving picks — preview picks are discarded on
	 * convert. The framing is "create your account / claim 1,500 VXP / start
	 * predicting for real". The sign-up CTAs reuse {@link SignInProviderStack}
	 * (`mode="signup"`) so conversion runs through the real, redirect-safe
	 * provider machinery; the claimed guest handle labels a fresh passkey.
	 */
	interface Props {
		isOpen: boolean;
		kind: 'soft' | 'remind';
		// Session preview-pick count — social proof only, never "saved".
		pickCount: number;
		handle: string | null;
		onClose: () => void;
		// Fires when a provider resolves in-page; the host clears the guest
		// session and toasts the grant.
		onConverted: () => void;
	}

	const { isOpen, kind, pickCount, handle, onClose, onConverted }: Props = $props();

	// The 1,500 VXP figure is sourced from the real registration milestone
	// grant, not a hardcoded literal, so it stays in lock-step with the economy.
	const starterVxp = $derived(formatVxpBalance({ value: newUserVxpAmountMilestone1BaseUnits() }));

	const titleKey = $derived(kind === 'soft' ? 'guest.save.soft.title' : 'guest.save.remind.title');

	// Pluralise the in-session count for the remind nudge's social proof.
	const picksLabel = $derived(
		t({
			locale: $localeStore,
			key: pickCount === 1 ? 'guest.picks_one' : 'guest.picks_many',
			params: { count: pickCount }
		})
	);
</script>

<BottomSheet desktopCentered {isOpen} labelledBy="guest-save-title" {onClose}>
	<div class="guest-save">
		<span class="guest-save-icon" aria-hidden="true">
			<Sparkles size={22} strokeWidth={1.7} />
		</span>

		<h2 id="guest-save-title" class="guest-save-title">
			{t({ locale: $localeStore, key: titleKey })}
		</h2>

		<p class="guest-save-body">
			{#if kind === 'remind'}
				{t({ locale: $localeStore, key: 'guest.save.remind.body', params: { picks: picksLabel } })}
			{:else}
				{t({ locale: $localeStore, key: 'guest.save.soft.body' })}
			{/if}
		</p>

		<div class="guest-save-claim">
			{t({ locale: $localeStore, key: 'guest.save.claim', params: { vxp: starterVxp } })} VXP
		</div>

		<div class="guest-save-providers">
			<SignInProviderStack {handle} mode="signup" onSuccess={onConverted} />
		</div>

		<button class="guest-save-dismiss" onclick={onClose} type="button">
			{t({ locale: $localeStore, key: 'guest.save.dismiss' })}
		</button>
	</div>
</BottomSheet>

<style lang="postcss">
	.guest-save {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 0.6rem;
		padding: 0.4rem 0 0.2rem;
	}

	.guest-save-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.6rem;
		height: 2.6rem;
		border-radius: var(--r-pill);
		color: var(--laurel, var(--text-base));
		background: color-mix(in srgb, var(--laurel, var(--text-base)) 14%, transparent);
	}

	.guest-save-title {
		font-size: 1.18rem;
		font-weight: 650;
		line-height: 1.2;
		margin: 0;
	}

	.guest-save-body {
		font-size: 0.95rem;
		line-height: 1.45;
		color: var(--text-muted);
		margin: 0;
		max-width: 26rem;
	}

	.guest-save-claim {
		font-size: 0.86rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--text-base);
		padding: 0.35rem 0.7rem;
		border-radius: var(--r-pill);
		background: color-mix(in srgb, var(--laurel, var(--text-base)) 12%, transparent);
	}

	.guest-save-providers {
		width: 100%;
		margin-top: 0.4rem;
	}

	.guest-save-dismiss {
		margin-top: 0.2rem;
		font-size: 0.86rem;
		color: var(--text-muted);
		background: none;
		border: none;
		cursor: pointer;
		padding: 0.4rem;
	}

	.guest-save-dismiss:hover {
		color: var(--text-base);
	}
</style>
