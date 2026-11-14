<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import { onDestroy, onMount } from 'svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { CallSide } from '#lib/types/market.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	/**
	 * XpToast: the commit pop. A swipe PLACES a call; it doesn't win one,
	 * so the pop confirms the act, "CALLED YES · {stake} IN PLAY", light
	 * and celebratory, never implying a payout. A genuine milestone /
	 * streak bonus (real VXP grant) rides along as a trailing chip. Fires
	 * on every committed YES / NO swipe; renders nothing for SKIP.
	 *
	 * Positioned at the deck top, anchored to the exit edge (`is-yes` →
	 * right, `is-no` → left) so it trails the gesture. Non-blocking;
	 * self-dismisses ~1.5 s after mount via the `xp-toast-pop` envelope.
	 */
	interface Props {
		side: CallSide | 'SKIP';
		stake?: number;
		bonus?: number;
		onDone?: () => void;
	}

	const { side, stake = 0, bonus = 0, onDone }: Props = $props();

	let timer: ReturnType<typeof setTimeout> | null = null;

	onMount(() => {
		timer = setTimeout(() => {
			onDone?.();
		}, 1500);
	});

	onDestroy(() => {
		if (nonNullish(timer)) {
			clearTimeout(timer);
		}
	});

	const visible = $derived(side !== 'SKIP' && stake > 0);

	const sideClass = $derived(side === 'YES' ? 'is-yes' : 'is-no');
	const sideLabel = $derived(
		t({ locale: $localeStore, key: side === 'YES' ? 'outcome.yes' : 'outcome.no' })
	);
</script>

{#if visible}
	<div class="xp-toast {sideClass}">
		<span class="xp-toast-side">
			{t({ locale: $localeStore, key: 'flow.xp_toast.called', params: { side: sideLabel } })}
		</span>
		<span class="num">{stake}</span>
		<small>{t({ locale: $localeStore, key: 'flow.xp_toast.in_play' })}</small>
		{#if bonus > 0}
			<em>+{bonus} {t({ locale: $localeStore, key: 'flow.feedback.vxp' })}</em>
		{/if}
	</div>
{/if}
