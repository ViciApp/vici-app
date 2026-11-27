<script lang="ts">
	import { landingClaimStore } from '#lib/stores/landing-claim.store.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	/**
	 * The Markets search field. It sits in the page's top-bar row on wide
	 * screens and on its own row under the bar on phones; "/" focuses it
	 * (handled by `LandingMarkets`). It steps aside while the claim capsule,
	 * which opens over the same rows, is open.
	 */
	interface Props {
		query: string;
		onquery: (query: string) => void;
		/** Receives the input so the host can focus it on "/". */
		onready?: (input: HTMLInputElement) => void;
	}

	const { query, onquery, onready }: Props = $props();

	const uid = $props.id();

	let input = $state<HTMLInputElement | undefined>(undefined);

	$effect(() => {
		if (input) {
			onready?.(input);
		}
	});
</script>

<div class="lmq" class:is-aside={$landingClaimStore.open} inert={$landingClaimStore.open}>
	<label class="sr-only" for="{uid}-q">
		{t({ locale: $localeStore, key: 'landing.markets.search.label' })}
	</label>
	<input
		bind:this={input}
		id="{uid}-q"
		autocomplete="off"
		oninput={(event) => onquery(event.currentTarget.value)}
		placeholder={t({ locale: $localeStore, key: 'landing.markets.search.label' })}
		spellcheck="false"
		type="search"
		value={query}
	/>
	<kbd aria-hidden="true">/</kbd>
</div>

<style lang="postcss">
	.lmq {
		position: absolute;
		top: calc(16px + env(safe-area-inset-top, 0px));
		left: 50%;
		z-index: 3;
		width: min(440px, 34vw);
		translate: -50% 0;
		transition: opacity 140ms var(--ease-vici);
		animation: lmq-in 420ms var(--ease-vici) both;
	}

	.lmq.is-aside {
		opacity: 0;
	}

	@keyframes lmq-in {
		from {
			opacity: 0;
			transform: translateY(-6px) scale(0.985);
		}
	}

	input {
		width: 100%;
		height: 44px;
		padding: 0 40px 0 16px;
		border: 0;
		border-radius: var(--r-pill);
		background: color-mix(in srgb, var(--parchment) 10%, transparent);
		box-shadow: inset 0 0 0 1px var(--lm-line);
		color: var(--parchment);
		font: 500 16px/1 var(--font-display);
		outline: 0;
		touch-action: manipulation;
		appearance: none;
		-webkit-backdrop-filter: blur(24px) saturate(170%);
		backdrop-filter: blur(24px) saturate(170%);
	}

	input::placeholder {
		color: var(--lm-quiet);
	}

	input:focus-visible {
		box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--parchment) 70%, transparent);
	}

	kbd {
		position: absolute;
		top: 50%;
		right: 12px;
		padding: 4px 7px;
		border-radius: var(--r-pill);
		background: var(--lm-pane-a);
		color: var(--lm-quiet);
		font: 600 12px/1 var(--font-display);
		translate: 0 -50%;
		pointer-events: none;
	}

	@media (max-width: 900px) {
		.lmq {
			top: calc(68px + env(safe-area-inset-top, 0px));
			right: var(--lm-pad);
			left: var(--lm-pad);
			width: auto;
			translate: none;
		}

		kbd {
			display: none;
		}
	}

	@media (prefers-reduced-transparency: reduce) {
		input {
			background: var(--ink-elevated);
			-webkit-backdrop-filter: none;
			backdrop-filter: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.lmq {
			animation-name: lmq-fade;
			animation-duration: 160ms;
		}
	}

	@keyframes lmq-fade {
		from {
			opacity: 0;
		}
	}
</style>
