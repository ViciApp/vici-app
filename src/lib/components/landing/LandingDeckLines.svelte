<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		/** Show the "your turn" hint. */
		hint?: boolean;
		/** The line that confirms the last call or pass; absent while there is none to show. */
		status?: string;
		/** Offer the claim once the visitor has made their calls. */
		claim?: boolean;
		onclaim?: () => void;
	}

	const { hint = false, status, claim = false, onclaim = () => {} }: Props = $props();

	// The slot holds one line at a time: a fresh confirmation outranks the
	// claim, and the claim outranks the hint.
	const showStatus = $derived(nonNullish(status));
	const showClaim = $derived(claim && !showStatus);
	const showHint = $derived(hint && !showStatus && !showClaim);

	// The last confirmation stays in the node while it fades out.
	let lastStatus = $state('');

	$effect(() => {
		if (nonNullish(status)) {
			lastStatus = status;
		}
	});
</script>

<div class="lines">
	<p class="line hint" class:on={showHint} aria-hidden={!showHint}>
		<span class="touch">{t({ locale: $localeStore, key: 'landing.deck.hint_touch' })}</span>
		<span class="fine">{t({ locale: $localeStore, key: 'landing.deck.hint_pointer' })}</span>
	</p>
	<p class="line status" class:on={showStatus} aria-live="polite">{status ?? lastStatus}</p>
	<button
		class="claim"
		class:on={showClaim}
		aria-hidden={!showClaim}
		onclick={onclaim}
		tabindex={showClaim ? 0 : -1}
		type="button"
	>
		{t({ locale: $localeStore, key: 'landing.deck.claim' })}
	</button>
</div>

<style lang="postcss">
	.lines {
		position: absolute;
		right: 0;
		bottom: calc(84px + env(safe-area-inset-bottom, 0px));
		left: 0;
		z-index: 6;
		height: 36px;
		pointer-events: none;
	}

	.line,
	.claim {
		position: absolute;
		top: 0;
		left: 50%;
		box-sizing: border-box;
		max-width: calc(100vw - 2 * var(--deck-pad));
		margin: 0;
		opacity: 0;
		text-align: center;
		transform: translateX(-50%) translateY(6px);
		transition:
			opacity 220ms var(--deck-ease),
			transform 320ms var(--deck-ease);
		white-space: nowrap;
	}

	.line.on,
	.claim.on {
		opacity: 1;
		transform: translateX(-50%);
	}

	.line {
		padding: 8px 0;
		font: 500 15px/1.25 var(--font-display);
		text-shadow: 0 1px 12px color-mix(in srgb, var(--film-bg) 85%, transparent);
	}

	/* One line where it fits. A confirmation longer than the screen is wide
	   wraps and grows upward, clear of the buttons, instead of running off
	   the edge. */
	.status {
		top: auto;
		bottom: 1px;
		width: max-content;
		color: var(--film-accent);
		text-wrap: balance;
		white-space: normal;
	}

	.hint .fine {
		display: none;
	}

	.claim {
		padding: 11px 16px;
		border: 0;
		border-radius: 999px;
		background: var(--film-cta);
		color: var(--film-bg);
		font: 600 15px/1 var(--font-display);
		cursor: pointer;
		transition:
			opacity 220ms var(--deck-ease),
			transform 320ms var(--deck-ease),
			background 180ms var(--deck-ease);
	}

	.claim.on {
		pointer-events: auto;
	}

	.claim.on:active {
		transform: translateX(-50%) scale(0.96);
	}

	.claim:focus-visible {
		outline: 2px solid var(--film-fg);
		outline-offset: 3px;
	}

	@media (hover: hover) and (pointer: fine) {
		.hint .touch {
			display: none;
		}

		.hint .fine {
			display: inline;
		}

		.claim:hover {
			background: var(--film-cta-hover);
		}
	}

	@media (pointer: coarse) {
		.claim {
			min-height: 44px;
			margin-top: -4px;
		}
	}

	@media (max-width: 420px) {
		.line {
			padding: 6px 0;
			font-size: 14px;
		}
	}

	/* Too narrow for one line: the text wraps inside the gutters. */
	@media (max-width: 340px) {
		.line {
			top: auto;
			right: var(--deck-pad);
			bottom: -6px;
			left: var(--deck-pad);
			max-width: none;
			padding: 7px 10px;
			border-radius: 14px;
			line-height: 1.35;
			transform: translateY(6px);
			white-space: normal;
		}

		.line.on {
			transform: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.line,
		.claim {
			transition: none;
		}
	}
</style>
