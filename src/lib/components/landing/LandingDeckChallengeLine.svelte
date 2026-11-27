<script lang="ts">
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { ChallengeView } from '#lib/types/challenge.ts';
	import { challengeLineText } from '#lib/utils/challenge.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		/** The link as the server read it; the line repeats it and adds nothing. */
		challenge: ChallengeView;
		/** The deck is the view in front; behind Markets the line steps back with it. */
		active?: boolean;
	}

	const { challenge, active = true }: Props = $props();

	const line = $derived(challengeLineText({ view: challenge, locale: $localeStore }));
</script>

<aside class="challenge-line" class:is-off={!active} aria-hidden={!active}>
	<span class="eyebrow">{t({ locale: $localeStore, key: 'landing.deck.challenge.eyebrow' })}</span>
	<p class="line">{line}</p>
</aside>

<style lang="postcss">
	.challenge-line {
		position: fixed;
		top: calc(76px + env(safe-area-inset-top, 0px));
		left: 50%;
		z-index: 25;
		box-sizing: border-box;
		width: max-content;
		max-width: calc(100vw - 2 * clamp(16px, 3vw, 32px));
		padding: 10px 16px 11px;
		border: 1px solid color-mix(in srgb, var(--film-fg) 18%, transparent);
		border-radius: 16px;
		background: color-mix(in srgb, var(--film-bg) 72%, transparent);
		color: var(--film-fg);
		text-align: center;
		transform: translateX(-50%);
		transition: opacity 200ms ease;
		pointer-events: none;
		-webkit-backdrop-filter: blur(12px);
		backdrop-filter: blur(12px);
	}

	.challenge-line.is-off {
		opacity: 0;
	}

	.eyebrow {
		display: block;
		margin-bottom: 3px;
		color: var(--film-accent);
		font: 600 11px/1.2 var(--font-display);
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.line {
		margin: 0;
		font: 500 15px/1.3 var(--font-display);
		text-wrap: balance;
	}

	@media (max-width: 420px) {
		.line {
			font-size: 14px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.challenge-line {
			transition: none;
		}
	}
</style>
