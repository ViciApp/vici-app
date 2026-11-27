<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import {
		LANDING_SHARE_COPIED_MS,
		LANDING_SHARE_MANUAL_MS
	} from '#lib/constants/landing-markets.constants.ts';
	import { notifyShareFailed } from '#lib/services/share.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { Market } from '#lib/types/market.ts';
	import { writeToClipboard } from '#lib/utils/clipboard.utils.ts';
	import { haptic } from '#lib/utils/haptics.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { sidePercents } from '#lib/utils/landing-markets.utils.ts';
	import { landingMarketShareUrl, linkForHand } from '#lib/utils/landing-share.utils.ts';
	import { appOrigin } from '#lib/utils/nav.utils.ts';

	/**
	 * "Share this question". Where the device has a share sheet it opens it
	 * with the question and the crowd's price; elsewhere one press copies the
	 * link, and the button itself confirms (or, if the copy fails, shows the
	 * link to copy by hand). No menu. `onshare` follows a completed share or
	 * copy.
	 */
	interface Props {
		market: Market;
		/** The question as the visitor reads it (translated when available). */
		title: string;
		onshare?: (seriesId: string) => void;
	}

	const { market, title, onshare = () => {} }: Props = $props();

	let label = $state<string | undefined>(undefined);
	let copied = $state(false);
	let clearTimer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => () => clearTimeout(clearTimer));

	const say = ({ text, ok }: { text: string; ok: boolean }): void => {
		clearTimeout(clearTimer);
		label = text;
		copied = ok;
		clearTimer = setTimeout(
			() => {
				label = undefined;
				copied = false;
			},
			ok ? LANDING_SHARE_COPIED_MS : LANDING_SHARE_MANUAL_MS
		);
	};

	// A dismissed share sheet rejects with a `DOMException` that is not an
	// `Error` instance everywhere, so read `name` / `message` off any object.
	const isAbort = (err: unknown): boolean => {
		if (isNullish(err) || typeof err !== 'object') {
			return false;
		}

		const { name, message } = err as { name?: unknown; message?: unknown };

		return (
			name === 'AbortError' ||
			(typeof message === 'string' && message.toLowerCase().includes('abort'))
		);
	};

	const share = async (): Promise<void> => {
		// The link keeps the original title, so it reads the same for everyone.
		const url = landingMarketShareUrl({
			origin: appOrigin(),
			title: market.title,
			seriesId: market.id
		});

		if (typeof navigator.share === 'function') {
			const percents = sidePercents(market.yesProbability);
			const text = nonNullish(percents)
				? t({
						locale: $localeStore,
						key: 'landing.markets.share.text',
						params: { question: title, pct: percents.yes }
					})
				: title;

			try {
				await navigator.share({ title: 'VICI', text, url });
				onshare(market.id);
			} catch (err: unknown) {
				if (!isAbort(err)) {
					notifyShareFailed();
				}
			}

			return;
		}

		if (await writeToClipboard(url)) {
			haptic('light-tap');
			say({ text: t({ locale: $localeStore, key: 'market.detail.share.copied_title' }), ok: true });
			onshare(market.id);

			return;
		}

		say({ text: linkForHand(url), ok: false });
	};
</script>

<button
	class="lmsh"
	class:is-copied={copied}
	class:is-said={nonNullish(label)}
	aria-label={t({ locale: $localeStore, key: 'landing.markets.share.label' })}
	onclick={share}
	type="button"
>
	<svg
		aria-hidden="true"
		fill="none"
		height="18"
		stroke="currentColor"
		stroke-linecap="round"
		stroke-linejoin="round"
		stroke-width={copied ? 1.9 : 1.6}
		viewBox="0 0 18 18"
		width="18"
	>
		{#if copied}
			<path d="M4 9.5l3.5 3.5L14 5.5" />
		{:else}
			<path d="M9 11.5V2.5M5.5 5.5L9 2l3.5 3.5M3.5 9.5v5h11v-5" />
		{/if}
	</svg>
	<span class="lmsh-label" role="status">{isNullish(label) ? '' : label}</span>
</button>

<style lang="postcss">
	.lmsh {
		position: absolute;
		top: -4px;
		right: 0;
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: var(--lm-pane-a);
		color: var(--parchment);
		cursor: pointer;
		transition:
			background 160ms var(--ease-vici),
			transform 160ms var(--ease-vici);
	}

	.lmsh:active {
		transform: scale(0.94);
	}

	.lmsh:focus-visible {
		outline: 2px solid currentColor;
		outline-offset: 3px;
	}

	.lmsh.is-copied {
		background: var(--laurel);
		color: var(--ink);
	}

	@media (hover: hover) and (pointer: fine) {
		.lmsh:not(.is-copied):hover {
			background: color-mix(in srgb, var(--parchment) 14%, transparent);
		}
	}

	/* The confirmation slides out under the button, then both reset. */
	.lmsh-label {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		max-width: min(60vw, 320px);
		padding: 9px 12px;
		overflow: hidden;
		border-radius: var(--r-pill);
		background: var(--ink-elevated);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--parchment) 14%, transparent);
		color: var(--parchment);
		font: 600 13px/1 var(--font-display);
		white-space: nowrap;
		text-overflow: ellipsis;
		opacity: 0;
		transform: translateY(-4px);
		pointer-events: none;
		transition:
			opacity 160ms var(--ease-vici),
			transform 220ms var(--ease-vici);
	}

	.lmsh.is-said .lmsh-label {
		opacity: 1;
		transform: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.lmsh,
		.lmsh-label {
			transition: none;
		}
	}
</style>
