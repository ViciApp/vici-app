<script lang="ts">
	import { LANDING_DECK_CALLS_TO_DONE } from '#lib/constants/landing.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { LandingDeckSide } from '#lib/types/landing.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		/** Calls made so far in this visit. */
		calls: number;
		disabled?: boolean;
		oncall?: (side: LandingDeckSide) => void;
		onpass?: () => void;
	}

	const { calls, disabled = false, oncall = () => {}, onpass = () => {} }: Props = $props();

	const progress = $derived(
		calls < LANDING_DECK_CALLS_TO_DONE
			? t({
					locale: $localeStore,
					key: 'landing.deck.progress',
					params: { current: calls + 1, total: LANDING_DECK_CALLS_TO_DONE }
				})
			: t({ locale: $localeStore, key: 'landing.deck.progress_done', params: { count: calls } })
	);
</script>

<div class="bar">
	<button
		class="call no"
		aria-label={t({ locale: $localeStore, key: 'landing.deck.call_no_aria' })}
		{disabled}
		onclick={() => oncall('no')}
		type="button"
	>
		{t({ locale: $localeStore, key: 'landing.deck.no' })}
	</button>
	<div class="mid">
		<button
			class="pass"
			aria-label={t({ locale: $localeStore, key: 'landing.deck.pass_aria' })}
			{disabled}
			onclick={onpass}
			type="button"
		>
			{t({ locale: $localeStore, key: 'landing.deck.pass' })}
		</button>
		<span class="progress">{progress}</span>
	</div>
	<button
		class="call yes"
		aria-label={t({ locale: $localeStore, key: 'landing.deck.call_yes_aria' })}
		{disabled}
		onclick={() => oncall('yes')}
		type="button"
	>
		{t({ locale: $localeStore, key: 'landing.deck.yes' })}
	</button>
</div>

<style lang="postcss">
	.bar {
		position: absolute;
		bottom: calc(16px + env(safe-area-inset-bottom, 0px));
		left: 50%;
		z-index: 6;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		gap: 12px;
		align-items: center;
		width: min(560px, calc(100% - 2 * var(--deck-pad)));
		transform: translateX(-50%);
	}

	button {
		border: 0;
		cursor: pointer;
	}

	.call {
		height: 54px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--film-bg) 62%, transparent);
		box-shadow: inset 0 0 0 1.5px currentColor;
		font: 700 17px/1 var(--font-headline, var(--font-display));
		letter-spacing: -0.01em;
		transition:
			transform 140ms var(--deck-ease),
			background 200ms ease;
	}

	.call:active {
		transform: scale(0.96);
	}

	.no {
		color: var(--film-no);
	}

	.yes {
		color: var(--film-yes);
	}

	button:focus-visible {
		outline: 2px solid var(--film-fg);
		outline-offset: 3px;
	}

	.mid {
		display: grid;
		align-content: center;
		justify-items: center;
		height: 54px;
	}

	.pass {
		height: 44px;
		margin: -6px 0 -8px;
		padding: 0 18px;
		background: none;
		color: var(--film-fg);
		font: 500 14px/1 var(--font-display);
		opacity: 0.85;
		text-decoration: underline;
		text-decoration-color: color-mix(in srgb, var(--film-fg) 40%, transparent);
		text-shadow: 0 1px 8px color-mix(in srgb, var(--film-bg) 70%, transparent);
		text-underline-offset: 4px;
	}

	.progress {
		padding: 0 4px;
		font: 500 13px/1 var(--font-display);
		font-variant-numeric: tabular-nums;
		opacity: 0.75;
		text-shadow: 0 1px 8px color-mix(in srgb, var(--film-bg) 70%, transparent);
		white-space: nowrap;
	}

	@media (hover: hover) and (pointer: fine) {
		.no:hover {
			background: color-mix(in srgb, var(--film-no) 22%, transparent);
		}

		.yes:hover {
			background: color-mix(in srgb, var(--film-yes) 24%, transparent);
		}

		.pass:hover {
			opacity: 1;
			text-decoration-color: var(--film-fg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.call {
			transition: none;
		}
	}

	@media (prefers-reduced-transparency: reduce) {
		.call {
			background: color-mix(in srgb, var(--film-bg) 92%, transparent);
		}
	}
</style>
