<script lang="ts">
	import { backOut } from 'svelte/easing';
	import { fade, fly } from 'svelte/transition';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { prefersReducedMotion } from '#lib/utils/reduced-motion.utils.ts';
	import { FLAME_STAGE_LABEL_KEYS, type FlameStage } from '#lib/utils/streak.utils.ts';

	interface Props {
		stage: FlameStage;
	}

	const { stage }: Props = $props();
</script>

<!-- Streak-break choreography: single low thud (haptic fires in
     handleAction), banner names the stage that ended, fresh start
     at SPARK. Only shown once the forgiveness window is exhausted —
     two or more fully-missed days. -->
<div
	class="streak-break"
	in:fly={prefersReducedMotion() ? { duration: 0 } : { y: -8, duration: 300, easing: backOut }}
	out:fade
>
	<span class="serif-italic">
		{t({
			locale: $localeStore,
			key: 'flow.stage_ended',
			params: {
				stage: t({
					locale: $localeStore,
					key: FLAME_STAGE_LABEL_KEYS[stage]
				})
			}
		})}
	</span>
	<span class="streak-break-sub">
		{t({ locale: $localeStore, key: 'flow.fresh_start' })}
	</span>
</div>

<style lang="postcss">
	/* Streak-break banner — shows once when the previous-day gap broke
	   the streak. Mute palette (parchment-mute, no laurel celebration);
	   spec is explicit that the break is honest, not consoling. */
	.streak-break {
		position: fixed;
		left: 50%;
		top: calc(env(safe-area-inset-top, 0px) + 3.5rem);
		transform: translateX(-50%);
		z-index: 65;
		display: inline-flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 8px 16px;
		border-radius: var(--r-pill);
		background: var(--bg-popover);
		border: 1px solid var(--border-strong);
		color: var(--text-muted);
		font-size: 13px;
		box-shadow: var(--shadow-card);
	}
	.streak-break-sub {
		font-size: var(--t-10);
		font-weight: 600;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
		color: var(--text-muted);
		opacity: 0.56;
	}
</style>
