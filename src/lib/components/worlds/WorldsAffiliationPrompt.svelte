<script lang="ts">
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		onPick: () => void;
	}

	let { onPick }: Props = $props();
</script>

<div class="worlds-affil-prompt">
	<h4>{t({ locale: $localeStore, key: 'worlds.affil_prompt.title' })}</h4>
	<p>{t({ locale: $localeStore, key: 'worlds.affil_prompt.body' })}</p>
	<button class="worlds-affil-prompt-cta" onclick={onPick} type="button">
		{t({ locale: $localeStore, key: 'worlds.cta.pick_university' })}
	</button>
</div>

<style lang="postcss">
	.worlds-affil-prompt {
		margin: 0.25rem 1rem 0.5rem;
		padding: 1.1rem 1rem;
		background: color-mix(in srgb, var(--laurel) 6%, var(--bg-surface));
		border: 1px dashed color-mix(in srgb, var(--laurel) 35%, var(--border-base));
		border-radius: var(--r-12);
		text-align: center;
	}

	.worlds-affil-prompt h4 {
		margin: 0 0 0.4rem;
		font-family: var(--font-display);
		font-style: italic;
		font-weight: 400;
		font-size: var(--t-17, 1.05rem);
		color: var(--laurel);
	}

	.worlds-affil-prompt p {
		margin: 0 0 0.75rem;
		font-size: var(--t-13);
		line-height: 1.5;
		color: var(--text-muted);
	}

	.worlds-affil-prompt-cta {
		appearance: none;
		padding: 0.6rem 1.1rem;
		font: inherit;
		font-size: var(--t-13);
		font-weight: 700;
		color: var(--text-on-accent, #fff);
		background: var(--laurel);
		border: 1px solid var(--laurel);
		border-radius: var(--r-pill);
		cursor: pointer;
		transition: background 140ms ease;
	}

	.worlds-affil-prompt-cta:hover {
		background: color-mix(in srgb, var(--laurel) 88%, var(--text-base));
	}
</style>
