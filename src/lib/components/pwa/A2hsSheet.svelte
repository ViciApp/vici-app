<script lang="ts">
	import { Download, Share, SquarePlus } from '@lucide/svelte/icons';
	import BottomSheet from '#lib/components/ui/BottomSheet.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { track } from '#lib/services/analytics.services.ts';
	import {
		markDismissed,
		nativePrompt,
		platform,
		type A2hsPlatform
	} from '#lib/stores/a2hs.store.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { notificationsStore } from '#lib/stores/notification.store.ts';
	import type { ButtonStatus } from '#lib/types/components.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';

	/**
	 * Add-to-Home-Screen install sheet. One more {@link BottomSheet} host
	 * (like {@link LocaleSheet} / {@link DeleteAccountFlow}): Android gets a
	 * single one-tap CTA that replays the captured `beforeinstallprompt`; iOS
	 * gets the two manual Share → Add to Home Screen steps (no install API
	 * exists there). Dismiss starts the cool-off. No `window` global — state
	 * comes from `a2hs.store`.
	 */
	interface Props {
		isOpen: boolean;
		/** Surface the sheet was opened from — analytics dimension. */
		source: 'settings' | 'flow_end';
		onClose: () => void;
	}

	const { isOpen, source, onClose }: Props = $props();

	const currentPlatform = $derived<A2hsPlatform>(platform());
	const isIos = $derived(currentPlatform === 'ios');

	const subKey = $derived<MessageKey>(isIos ? 'a2hs.sheet.sub_ios' : 'a2hs.sheet.sub_android');

	let installStatus = $state<ButtonStatus>('enabled');

	// Open is the funnel's top — fire once per open transition. `wasOpen`
	// guards the effect so it only tracks the false→true edge, not every
	// re-run while the sheet stays open.
	let wasOpen = false;

	$effect(() => {
		if (isOpen && !wasOpen) {
			track({ name: 'pwa_install_prompted', source, label: currentPlatform });
		}

		wasOpen = isOpen;
	});

	const dismiss = () => {
		track({ name: 'pwa_install_dismissed', source, label: currentPlatform });
		markDismissed();
		onClose();
	};

	const install = async () => {
		installStatus = 'pending';

		try {
			const outcome = await nativePrompt();

			if (outcome === 'accepted') {
				track({ name: 'pwa_install_accepted', source, label: currentPlatform });
				notificationsStore.add({
					title: t({ locale: $localeStore, key: 'a2hs.toast.installed_title' }),
					message: t({ locale: $localeStore, key: 'a2hs.toast.installed' }),
					type: 'success',
					duration: 2400
				});
			} else if (outcome === 'dismissed') {
				track({ name: 'pwa_install_dismissed', source, label: currentPlatform });
				markDismissed();
			}
		} finally {
			installStatus = 'enabled';
			onClose();
		}
	};
</script>

{#snippet footer()}
	{#if isIos}
		<Button class="a2hs-cta" onclick={dismiss}>
			{t({ locale: $localeStore, key: 'a2hs.sheet.got_it' })}
		</Button>
	{:else}
		<Button class="a2hs-cta" onclick={install} status={installStatus}>
			{#snippet busyLabel()}
				{t({ locale: $localeStore, key: 'a2hs.sheet.opening' })}
			{/snippet}
			{t({ locale: $localeStore, key: 'a2hs.sheet.install' })}
		</Button>
		<button class="a2hs-not-now" onclick={dismiss} type="button">
			{t({ locale: $localeStore, key: 'a2hs.sheet.not_now' })}
		</button>
	{/if}
{/snippet}

<BottomSheet desktopCentered {footer} {isOpen} labelledBy="a2hs-title" onClose={dismiss}>
	<div class="a2hs">
		<span class="a2hs-icon" aria-hidden="true">
			<img alt="" height="56" src="/branding/vici-app-icon-512.png" width="56" />
		</span>

		<h2 id="a2hs-title" class="a2hs-title">
			{t({ locale: $localeStore, key: 'a2hs.sheet.title' })}
		</h2>
		<p class="a2hs-sub">{t({ locale: $localeStore, key: subKey })}</p>

		{#if isIos}
			<ol class="a2hs-steps">
				<li class="a2hs-step">
					<span class="a2hs-step-glyph" aria-hidden="true">
						<Share size={18} strokeWidth={1.7} />
					</span>
					<span class="a2hs-step-copy">
						{t({ locale: $localeStore, key: 'a2hs.sheet.ios_step_share' })}
					</span>
				</li>
				<li class="a2hs-step">
					<span class="a2hs-step-glyph" aria-hidden="true">
						<SquarePlus size={18} strokeWidth={1.7} />
					</span>
					<span class="a2hs-step-copy">
						{t({ locale: $localeStore, key: 'a2hs.sheet.ios_step_add' })}
					</span>
				</li>
			</ol>
		{:else}
			<p class="a2hs-android-hint">
				<Download aria-hidden="true" size={16} strokeWidth={1.7} />
				<span>{t({ locale: $localeStore, key: 'a2hs.sheet.android_hint' })}</span>
			</p>
		{/if}
	</div>
</BottomSheet>

<style lang="postcss">
	.a2hs {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		padding: 0.5rem 0.25rem 0;
	}

	.a2hs-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		margin-bottom: 0.875rem;
	}

	.a2hs-icon img {
		width: 3.5rem;
		height: 3.5rem;
		border-radius: var(--r-12);
		box-shadow: 0 6px 18px -8px rgba(0, 0, 0, 0.5);
	}

	.a2hs-title {
		margin: 0;
		font-size: var(--t-18);
		font-weight: 700;
		letter-spacing: var(--tracking-snug);
		color: var(--text-base);
	}

	.a2hs-sub {
		margin: 0.375rem 0 0;
		max-width: 28ch;
		font-size: var(--t-13);
		line-height: 1.5;
		color: var(--text-muted);
	}

	.a2hs-steps {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		width: 100%;
		margin: 1.125rem 0 0.25rem;
		padding: 0;
		list-style: none;
	}

	.a2hs-step {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 0.875rem;
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		background: var(--bg-surface);
		text-align: left;
	}

	.a2hs-step-glyph {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: var(--r-8);
		background: var(--laurel-glow);
		color: var(--color-primary);
	}

	.a2hs-step-copy {
		font-size: var(--t-13);
		line-height: 1.45;
		color: var(--text-base);
	}

	.a2hs-android-hint {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.4375rem;
		margin: 1rem 0 0;
		color: var(--text-muted);
		font-size: var(--t-12);
	}

	:global(.a2hs-cta) {
		width: 100%;
	}

	.a2hs-not-now {
		width: 100%;
		margin-top: 0.5rem;
		padding: 0.625rem;
		border: 0;
		background: none;
		color: var(--text-muted);
		font-family: var(--font-sans);
		font-size: var(--t-13);
		font-weight: 500;
		cursor: pointer;
		transition: color var(--d-hover) var(--ease-vici);
	}

	.a2hs-not-now:hover {
		color: var(--text-base);
	}
</style>
