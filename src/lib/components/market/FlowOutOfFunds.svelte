<script lang="ts">
	import OracleChar from '#lib/components/characters/OracleChar.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { prefersReducedMotion } from '#lib/utils/reduced-motion.utils.ts';

	interface Props {
		// "Open Dashboard →": the primary exit, where open predictions and the
		// freeing-up balance live.
		onClose: () => void;
		// "Back to Markets": the quieter secondary exit.
		onBackToMarkets: () => void;
	}

	const { onClose, onBackToMarkets }: Props = $props();

	const reduce = $derived(prefersReducedMotion());
</script>

<!-- Out-of-funds gate: every spendable VXP is already committed to open
     predictions, so no further call this session can be funded. Rather than
     leave the user stranded on cards they can't act on, this takeover
     explains where the balance went and offers an explicit way out: see the
     open predictions on the Dashboard (where the balance frees up as markets
     resolve), or return to Markets. Mirrors the daily-cap takeover. -->
<div class="flow-funds" class:is-static={reduce}>
	<div class="flow-funds-char">
		<OracleChar animate={!reduce} size={92} />
	</div>
	<p class="eyebrow flow-funds-eyebrow">
		{t({ locale: $localeStore, key: 'flow.funds.eyebrow' })}
	</p>
	<h2 class="flow-funds-title serif-italic" aria-live="polite" role="status">
		{t({ locale: $localeStore, key: 'flow.funds.title' })}
	</h2>
	<p class="flow-funds-body">
		{t({ locale: $localeStore, key: 'flow.funds.body' })}
	</p>
	<div class="flow-funds-actions">
		<Button onclick={onClose} size="lg"
			>{t({ locale: $localeStore, key: 'flow.end.back_to_dashboard' })}</Button
		>
	</div>
	<div class="flow-funds-links">
		<button class="flow-funds-link" onclick={onBackToMarkets} type="button"
			>{t({ locale: $localeStore, key: 'flow.back_to_markets' })}</button
		>
	</div>
</div>

<style lang="postcss">
	.flow-funds {
		position: absolute;
		inset: 0;
		z-index: 40;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 2.5rem 1.625rem;
		background: radial-gradient(
			circle at 50% 30%,
			color-mix(in srgb, var(--laurel) 9%, var(--bg-base)),
			var(--bg-base)
		);
	}
	.flow-funds-char {
		animation: fe-pop 600ms cubic-bezier(0.3, 1.5, 0.5, 1) both;
	}
	.flow-funds-eyebrow {
		margin: 0.625rem 0 0;
		color: var(--laurel);
		letter-spacing: 0.24em;
	}
	.flow-funds-title {
		margin: 0.375rem 0 0;
		font-size: 2rem;
		line-height: 1.05;
		color: var(--text-base);
	}
	.flow-funds-body {
		margin: 0.75rem 0 0;
		max-width: 32ch;
		font-size: var(--t-14);
		line-height: 1.5;
		color: var(--text-muted);
	}
	.flow-funds-actions {
		width: min(18.75rem, 86%);
		margin-top: 1.375rem;
	}
	.flow-funds-links {
		margin-top: 1rem;
	}
	.flow-funds-link {
		background: none;
		border: 0;
		padding: 4px 2px;
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		letter-spacing: 0.04em;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	@media (prefers-reduced-motion: reduce) {
		.flow-funds-char {
			animation: none;
		}
	}
</style>
