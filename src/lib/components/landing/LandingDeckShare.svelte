<script lang="ts">
	import { clickOutside } from '#lib/actions/click-outside.ts';
	import { BRAND_WORDMARK } from '#lib/constants/brand.constants.ts';
	import { notifyShareFailed } from '#lib/services/share.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { LandingDeckCard } from '#lib/types/landing.ts';
	import { writeToClipboard } from '#lib/utils/clipboard.utils.ts';
	import { haptic } from '#lib/utils/haptics.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import {
		landingDeckShareUrl,
		telegramShareHref,
		whatsAppShareHref
	} from '#lib/utils/landing-deck.utils.ts';
	import { appOrigin } from '#lib/utils/nav.utils.ts';

	interface Props {
		card: LandingDeckCard;
		/** Question in the reader's language. */
		title: string;
		/** The control is on a face the visitor cannot see: out of the tab order, menu closed. */
		hidden?: boolean;
		/** The visitor reached for the control. */
		onopen?: () => void;
		/** The question was handed to a share target or its link was copied. */
		onshare?: (seriesId: string) => void;
	}

	const { card, title, hidden = false, onopen = () => {}, onshare = () => {} }: Props = $props();

	const COPIED_MS = 2000;
	// A link that could not be copied stays up long enough to copy by hand.
	const UNCOPIED_MS = 6000;

	let open = $state(false);
	let copy = $state<'copied' | 'failed'>();
	let copyTimer: ReturnType<typeof setTimeout> | undefined;

	const url = $derived(
		landingDeckShareUrl({
			origin: appOrigin(),
			title: card.market.title,
			seriesId: card.entry.seriesId
		})
	);
	const text = $derived(
		t({
			locale: $localeStore,
			key: 'landing.deck.share.text',
			params: { question: title, percent: card.yesPercent }
		})
	);

	const shared = (): void => onshare(card.entry.seriesId);

	const share = async (): Promise<void> => {
		onopen();

		// Phones hand over to the system sheet; elsewhere the choices open here.
		if (typeof navigator.share !== 'function') {
			open = !open;

			return;
		}

		try {
			await navigator.share({ title: BRAND_WORDMARK, text, url });
			shared();
		} catch (err: unknown) {
			// Dismissing the system sheet is not a failure.
			if (!(err instanceof DOMException && err.name === 'AbortError')) {
				notifyShareFailed();
			}
		}
	};

	const copyLink = async (): Promise<void> => {
		const ok = await writeToClipboard(url);

		copy = ok ? 'copied' : 'failed';
		clearTimeout(copyTimer);
		copyTimer = setTimeout(() => (copy = undefined), ok ? COPIED_MS : UNCOPIED_MS);

		if (ok) {
			haptic('light-tap');
			shared();
		}
	};

	$effect(() => {
		if (hidden) {
			open = false;
		}
	});

	$effect(() => () => clearTimeout(copyTimer));
</script>

<!-- A press here shares the question: the card neither drags nor flips. -->
<div
	class="share"
	class:hidden
	data-landing-deck-no-gesture
	use:clickOutside={() => (open = false)}
>
	<button
		class="toggle"
		aria-expanded={typeof navigator.share === 'function' ? undefined : open}
		aria-label={t({ locale: $localeStore, key: 'landing.deck.share.aria' })}
		onclick={share}
		tabindex={hidden ? -1 : 0}
		type="button"
	>
		<svg aria-hidden="true" fill="none" height="18" viewBox="0 0 18 18" width="18">
			<path
				d="M9 11.5V2.5M5.5 5.5L9 2l3.5 3.5M3.5 9.5v5h11v-5"
				stroke="currentColor"
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="1.6"
			/>
		</svg>
	</button>

	{#if open}
		<div class="options">
			<a
				href={whatsAppShareHref({ text, url })}
				onclick={shared}
				rel="noopener noreferrer"
				target="_blank"
			>
				{t({ locale: $localeStore, key: 'flow.share.whatsapp' })}
			</a>
			<a
				href={telegramShareHref({ text, url })}
				onclick={shared}
				rel="noopener noreferrer"
				target="_blank"
			>
				{t({ locale: $localeStore, key: 'flow.share.telegram' })}
			</a>
			<button class:ok={copy === 'copied'} onclick={copyLink} type="button">
				{t({
					locale: $localeStore,
					key: copy === 'copied' ? 'landing.deck.share.copied' : 'landing.deck.share.copy_link'
				})}
			</button>
			{#if copy === 'failed'}
				<span class="link">{url.replace(/^https?:\/\//, '')}</span>
			{/if}
		</div>
	{/if}
	<span class="sr-only" aria-live="polite">
		{copy === 'copied' ? t({ locale: $localeStore, key: 'landing.deck.share.copied' }) : ''}
	</span>
</div>

<style lang="postcss">
	.share {
		position: absolute;
		top: calc(72px + env(safe-area-inset-top, 0px));
		right: var(--deck-pad);
		z-index: 4;
		display: grid;
		gap: 8px;
		justify-items: end;
		transition: opacity 300ms var(--deck-ease);
	}

	.share.hidden {
		opacity: 0;
		pointer-events: none;
	}

	/* Same life as the card's text: out of sight underneath, gone on the way out. */
	:global(.landing-deck-card.is-under) .share,
	:global(.landing-deck-card.is-out) .share {
		opacity: 0;
		transition: none;
	}

	.toggle {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: color-mix(in srgb, var(--film-bg) 38%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--film-fg) 16%, transparent);
		backdrop-filter: blur(12px);
		color: inherit;
		cursor: pointer;
		transition:
			background 160ms var(--deck-ease),
			transform 160ms var(--deck-ease);
	}

	.toggle:active {
		transform: scale(0.94);
	}

	.toggle:focus-visible,
	.options :focus-visible {
		outline: 2px solid currentColor;
		outline-offset: 3px;
	}

	.options {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		justify-content: flex-end;
		max-width: min(320px, calc(100vw - 2 * var(--deck-pad)));
		padding: 10px;
		border-radius: 16px;
		background: color-mix(in srgb, var(--film-back) 80%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--film-fg) 14%, transparent);
		backdrop-filter: blur(34px) saturate(170%);
	}

	.options a,
	.options button {
		display: inline-flex;
		align-items: center;
		height: 32px;
		padding: 0 12px;
		border: 0;
		border-radius: 16px;
		background: none;
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--film-fg) 34%, transparent);
		color: var(--film-fg);
		font: 600 13px/1 var(--font-display);
		text-decoration: none;
		cursor: pointer;
		transition:
			background 160ms var(--deck-ease),
			transform 140ms var(--deck-ease);
	}

	.options a:active,
	.options button:active {
		transform: scale(0.97);
	}

	.options button.ok {
		background: var(--film-cta);
		box-shadow: none;
		color: var(--film-bg);
	}

	.link {
		flex-basis: 100%;
		overflow: hidden;
		color: var(--film-fg);
		font: 500 13px/1.35 var(--font-display);
		text-align: right;
		text-overflow: ellipsis;
		user-select: all;
		white-space: nowrap;
	}

	@media (hover: hover) and (pointer: fine) {
		.toggle:hover {
			background: color-mix(in srgb, var(--film-bg) 60%, transparent);
		}

		.options a:hover,
		.options button:not(.ok):hover {
			background: color-mix(in srgb, var(--film-fg) 10%, transparent);
		}
	}

	@media (pointer: coarse) {
		.options a,
		.options button {
			height: 44px;
			border-radius: 22px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.share,
		.toggle,
		.options a,
		.options button {
			transition: none;
		}
	}

	@media (prefers-reduced-transparency: reduce) {
		.toggle {
			background: color-mix(in srgb, var(--film-bg) 80%, transparent);
			backdrop-filter: none;
		}

		.options {
			background: var(--film-back);
			backdrop-filter: none;
		}
	}
</style>
