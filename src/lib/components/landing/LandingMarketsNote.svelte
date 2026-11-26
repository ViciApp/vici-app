<script lang="ts">
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	/** The note at the end of the Markets list: the one claim action, and the play-money line. */
	interface Props {
		onclaim?: () => void;
	}

	const { onclaim = () => {} }: Props = $props();
</script>

<div class="lmn">
	<p>{t({ locale: $localeStore, key: 'landing.markets.note.body' })}</p>
	<button onclick={onclaim} type="button">
		{t({ locale: $localeStore, key: 'landing.markets.note.cta' })}
	</button>
	<small>{t({ locale: $localeStore, key: 'signin.legal.line1' })}</small>
</div>

<style lang="postcss">
	.lmn {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px 14px;
		margin: 18px 2px 0;
		padding: 12px 14px;
		border-radius: 20px;
		background: var(--lm-pane-a);
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, var(--parchment) 24%, transparent),
			inset 0 0 0 1px color-mix(in srgb, var(--laurel) 50%, transparent);
		font: 500 15px/1.4 var(--font-display);
		-webkit-backdrop-filter: blur(24px) saturate(170%);
		backdrop-filter: blur(24px) saturate(170%);
	}

	p {
		flex: 1 1 16rem;
		margin: 0;
	}

	button {
		height: 38px;
		padding: 0 14px;
		border: 0;
		border-radius: var(--r-pill);
		background: var(--laurel);
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, var(--parchment) 60%, transparent),
			0 8px 18px -10px color-mix(in srgb, var(--ink-deep) 70%, transparent);
		color: var(--ink);
		font: 600 14px/1 var(--font-display);
		cursor: pointer;
		transition: transform 140ms var(--ease-vici);
	}

	button:active {
		transform: scale(0.96);
	}

	button:focus-visible {
		outline: 2px solid var(--parchment);
		outline-offset: 2px;
	}

	@media (hover: hover) and (pointer: fine) {
		button:hover {
			background: color-mix(in srgb, var(--laurel) 86%, var(--parchment));
		}
	}

	small {
		flex: 1 1 100%;
		font: 500 13px/1.4 var(--font-display);
		color: var(--lm-quiet);
	}

	@media (pointer: coarse) {
		button {
			min-height: 44px;
		}
	}

	@media (prefers-reduced-transparency: reduce) {
		.lmn {
			background: var(--ink-elevated);
			-webkit-backdrop-filter: none;
			backdrop-filter: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		button {
			transition: none;
		}
	}
</style>
