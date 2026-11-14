<script lang="ts">
	import { Plus } from '@lucide/svelte/icons';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		onDismiss: () => void;
		// "Start a battle" action: opens the create-a-battle wizard
		// (pick league → opponent → duration → send).
		onStartBattle: () => void;
	}

	let { onDismiss, onStartBattle }: Props = $props();
</script>

<aside class="battles-intro">
	<span class="serif-italic battles-intro-lede">
		{t({ locale: $localeStore, key: 'battles.intro.lede' })}
	</span>
	<p class="battles-intro-body">
		{t({ locale: $localeStore, key: 'battles.intro.body' })}
	</p>
	<button class="battles-intro-cta" onclick={onStartBattle} type="button">
		<Plus aria-hidden="true" size={13} strokeWidth={2.2} />
		{t({ locale: $localeStore, key: 'battles.intro.start' })}
	</button>
	<button
		class="battles-intro-dismiss"
		aria-label={t({ locale: $localeStore, key: 'battles.intro.dismiss' })}
		onclick={onDismiss}
		type="button"
	>
		×
	</button>
</aside>

<style lang="postcss">
	.battles-intro {
		position: relative;
		margin: 0.25rem 0;
		padding: 0.9rem 1.1rem 0.85rem;
		background: color-mix(in srgb, #e2b842 4%, transparent);
		border: 1px solid color-mix(in srgb, #e2b842 18%, var(--border-base));
		border-radius: var(--r-12);
	}

	.battles-intro-lede {
		display: block;
		margin-bottom: 0.25rem;
		font-size: var(--t-13);
		color: var(--laurel);
	}

	.battles-intro-body {
		margin: 0;
		padding-right: 1.4rem;
		font-size: var(--t-13);
		line-height: 1.5;
		color: var(--text-muted);
	}

	.battles-intro-cta {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		margin-top: 0.7rem;
		padding: 0.35rem 0.7rem;
		font-size: var(--t-12);
		font-weight: 600;
		color: var(--laurel);
		background: color-mix(in srgb, var(--laurel) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--laurel) 24%, transparent);
		border-radius: var(--r-pill);
		cursor: pointer;
	}

	.battles-intro-dismiss {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		appearance: none;
		width: 24px;
		height: 24px;
		font-size: 1.15rem;
		color: var(--text-muted);
		background: transparent;
		border: 0;
		cursor: pointer;
	}
</style>
