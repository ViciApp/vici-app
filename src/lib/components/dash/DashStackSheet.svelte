<script lang="ts">
	/**
	 * Holdings breakdown sheet: opened from the Dash holdings card. Leads with a
	 * "Your VXP" hero equal to total holdings, then a two-segment split bar whose
	 * widths track the available / in-play magnitudes, then two colour-keyed bucket
	 * rows (Available, In play) that sum back to the hero. Pure presentation: the
	 * formatted figures and bigint magnitudes arrive from the host. The invite CTA
	 * opens a native share sheet (clipboard fallback) over the viewer's canonical
	 * referral link rather than routing into Arena.
	 */
	import { nonNullish } from '@dfinity/utils';
	import { Check, ChevronRight, Gift, History } from '@lucide/svelte/icons';
	import DashHoldingsBreakdown from '#lib/components/dash/DashHoldingsBreakdown.svelte';
	import BottomSheet from '#lib/components/ui/BottomSheet.svelte';
	import { REFERRAL_VXP_BONUS_BASE_UNITS } from '#lib/constants/referral.constants.ts';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { getMyReferralCode } from '#lib/services/referral.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { writeToClipboard } from '#lib/utils/clipboard.utils.ts';
	import { haptic } from '#lib/utils/haptics.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { formatVxpBalance } from '#lib/utils/playground-display.utils.ts';

	interface Props {
		isOpen: boolean;
		onClose: () => void;
		/** Total holdings, formatted; the sheet header figure (available + in play). */
		holdingsDisplay: string;
		/** Spendable VXP, formatted; the Available bucket value. */
		availableDisplay: string;
		/** Backed VXP currently in play, formatted; the In play bucket value. */
		inPlayDisplay: string;
		/** Spendable magnitude (base units): drives the Available split segment width. */
		availableValue: bigint;
		/** Backed magnitude (base units): drives the In play split segment width. */
		inPlayValue: bigint;
		/** Open calls behind the in-play stake: pluralises the In play sub-label. */
		openCallCount: number;
	}

	let {
		isOpen,
		onClose,
		holdingsDisplay,
		availableDisplay,
		inPlayDisplay,
		availableValue,
		inPlayValue,
		openCallCount
	}: Props = $props();

	// Native share over the viewer's canonical `/i/{code}` referral link, with a
	// clipboard-copy + "copied" fallback. Fetched lazily once the sheet opens so a
	// closed sheet never pings the satellite; mirrors the Arena invite hero so the
	// two surfaces share one link and one copy.
	let inviteCode = $state<string | undefined>(undefined);
	let copied = $state(false);
	let copyResetTimer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		if (!isOpen || nonNullish(inviteCode)) {
			return;
		}

		let alive = true;

		void (async () => {
			try {
				const code = await getMyReferralCode();

				if (alive) {
					inviteCode = code;
				}
			} catch {
				// Guard on `alive` so a late rejection after unmount can't reset
				// state on a destroyed component.
				if (alive) {
					inviteCode = undefined;
				}
			}
		})();

		return () => {
			alive = false;
		};
	});

	const triggerCopyFeedback = (): void => {
		copied = true;

		if (copyResetTimer) {
			clearTimeout(copyResetTimer);
		}

		copyResetTimer = setTimeout(() => {
			copied = false;
		}, 1800);
	};

	const copyInvite = async (url: string): Promise<void> => {
		const ok = await writeToClipboard(url);

		if (ok) {
			triggerCopyFeedback();
			haptic('light-tap');
		}
	};

	// Resolve the referral code on-demand: the lazy `$effect` may not have
	// resolved yet when the first tap lands, so fetch here too rather than
	// no-op. Mirrors the lazy load and shares the same cached service call.
	const resolveInviteCode = async (): Promise<string | undefined> => {
		if (nonNullish(inviteCode)) {
			return inviteCode;
		}

		try {
			inviteCode = await getMyReferralCode();
		} catch {
			inviteCode = undefined;
		}

		return inviteCode;
	};

	const shareInvite = async (): Promise<void> => {
		const code = await resolveInviteCode();

		if (!code || typeof window === 'undefined') {
			return;
		}

		const url = `${window.location.origin}/i/${code}`;

		const shareText = t({
			locale: $localeStore,
			key: 'profile.dashboard.referrals.share_text',
			params: {
				code,
				amount: formatVxpBalance({ value: REFERRAL_VXP_BONUS_BASE_UNITS })
			}
		});
		const shareTitle = t({ locale: $localeStore, key: 'profile.dashboard.referrals.share_title' });

		if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
			try {
				await navigator.share({ title: shareTitle, text: shareText, url });

				return;
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message.toLowerCase() : '';

				if (message.includes('abort')) {
					return;
				}
			}
		}

		await copyInvite(url);
	};
</script>

<BottomSheet {isOpen} {onClose}>
	<div class="db-sheet">
		<DashHoldingsBreakdown
			{availableDisplay}
			{availableValue}
			{holdingsDisplay}
			{inPlayDisplay}
			{inPlayValue}
			{openCallCount}
		/>

		<a
			class="db-hd-link"
			href={`${resolveAppPath(AppPath.DashTransactions)}?source=sheet`}
			onclick={onClose}
		>
			<History aria-hidden="true" size={16} strokeWidth={1.8} />
			<span class="db-hd-link-t">
				<span>{t({ locale: $localeStore, key: 'dash.build.sheet_history' })}</span>
				<em>{t({ locale: $localeStore, key: 'dash.build.sheet_history_sub' })}</em>
			</span>
			<ChevronRight aria-hidden="true" size={16} strokeWidth={1.8} />
		</a>

		<button class="db-hd-cta" onclick={() => void shareInvite()} type="button">
			{#if copied}
				<Check aria-hidden="true" size={15} strokeWidth={2.2} />
			{:else}
				<Gift aria-hidden="true" size={15} strokeWidth={1.8} />
			{/if}
			{t({ locale: $localeStore, key: 'dash.build.sheet_invite_cta' })}
		</button>
	</div>
</BottomSheet>
