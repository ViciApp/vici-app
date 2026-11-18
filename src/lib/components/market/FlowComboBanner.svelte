<script lang="ts">
	import { backOut } from 'svelte/easing';
	import { fade, fly } from 'svelte/transition';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { prefersReducedMotion } from '#lib/utils/reduced-motion.utils.ts';

	interface Props {
		count: number;
	}

	const { count }: Props = $props();
</script>

<div
	class="combo-banner"
	in:fly={prefersReducedMotion() ? { duration: 0 } : { y: -8, duration: 300, easing: backOut }}
	out:fade={{ duration: prefersReducedMotion() ? 0 : 250 }}
>
	<span>
		{t({
			locale: $localeStore,
			key: 'flow.streak_combo',
			params: { count }
		})}
	</span>
</div>

<style lang="postcss">
	.combo-banner {
		position: fixed;
		left: 50%;
		top: calc(env(safe-area-inset-top, 0px) + 3.5rem);
		transform: translateX(-50%);
		z-index: 65;
		display: inline-flex;
		align-items: center;
		gap: 0.75rem;
		padding: 10px 16px;
		border-radius: var(--r-pill);
		background: linear-gradient(135deg, var(--color-primary), var(--laurel));
		color: var(--color-primary-foreground);
		font-size: 13px;
		font-weight: 900;
		letter-spacing: 0.02em;
		box-shadow: 0 14px 40px rgba(226, 184, 66, 0.4);
		pointer-events: none;
	}
</style>
