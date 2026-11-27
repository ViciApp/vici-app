<script lang="ts">
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { LandingView } from '#lib/types/landing-claim.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		view: LandingView;
		onview?: (view: LandingView) => void;
	}

	const { view, onview = () => {} }: Props = $props();
</script>

<!-- Both words share one cell and only the view you can go to shows, so the
	 claim button beside it never shifts when the view changes. -->
<div class="lns" aria-label={t({ locale: $localeStore, key: 'landing.nav.switch' })} role="group">
	<button
		class="lns-btn"
		class:is-on={view === 'cards'}
		aria-pressed={view === 'cards'}
		onclick={() => onview('cards')}
		type="button"
	>
		<svg
			class="lns-icon"
			aria-hidden="true"
			fill="none"
			height="16"
			stroke="currentColor"
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="1.6"
			viewBox="0 0 16 16"
			width="16"
		>
			<rect height="9.2" rx="1.8" width="8" x="2.2" y="4.6" />
			<path d="M6.4 2.6l5.6 1.1a1.8 1.8 0 0 1 1.4 2.1l-1.2 6" />
		</svg>
		<span class="lns-label">{t({ locale: $localeStore, key: 'landing.nav.cards' })}</span>
	</button>
	<button
		class="lns-btn"
		class:is-on={view === 'markets'}
		aria-pressed={view === 'markets'}
		onclick={() => onview('markets')}
		type="button"
	>
		<svg
			class="lns-icon"
			aria-hidden="true"
			fill="none"
			height="16"
			stroke="currentColor"
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="1.6"
			viewBox="0 0 16 16"
			width="16"
		>
			<path d="M1.8 11.6l3.6-3.8 2.8 2.2 4.6-5.2" />
			<circle cx="13.2" cy="4.4" fill="currentColor" r="1.3" stroke="none" />
		</svg>
		<span class="lns-label">{t({ locale: $localeStore, key: 'landing.nav.markets' })}</span>
	</button>
</div>

<style lang="postcss">
	.lns {
		display: grid;
		justify-items: end;
		margin-right: 4px;
	}

	.lns-btn {
		grid-area: 1 / 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		height: 44px;
		padding: 0 8px;
		border: 0;
		border-radius: 8px;
		background: none;
		color: var(--parchment);
		font: 600 15px/1 var(--font-display);
		white-space: nowrap;
		text-shadow: 0 1px 10px color-mix(in srgb, var(--ink-deep) 65%, transparent);
		text-decoration: none;
		cursor: pointer;
		transition:
			opacity 180ms var(--ln-out),
			visibility 0s linear 0s,
			color 160ms ease;
	}

	/* The current view's word: hidden, and out of the tab order with it. */
	.lns-btn.is-on {
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
		transition:
			opacity 180ms var(--ln-out),
			visibility 0s linear 180ms;
	}

	.lns-btn:focus-visible {
		outline: 2px solid var(--parchment);
		outline-offset: 3px;
	}

	.lns-icon {
		display: block;
		flex: none;
	}

	@media (hover: hover) and (pointer: fine) {
		.lns-btn:not(.is-on):hover {
			text-decoration: underline;
			text-decoration-thickness: 1.5px;
			text-underline-offset: 6px;
		}
	}

	@media (max-width: 560px) {
		.lns-btn {
			min-width: 44px;
			gap: 0;
		}

		/* Phones show the icon alone; the hidden name still labels the button. */
		.lns-label {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
	}

	@media (max-width: 520px) {
		.lns-btn {
			padding: 0 6px;
			font-size: 14px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.lns-btn,
		.lns-btn.is-on {
			transition: none;
		}
	}
</style>
