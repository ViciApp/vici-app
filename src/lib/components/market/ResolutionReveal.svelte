<script lang="ts">
	/**
	 * ResolutionReveal — the deferred "being right" digest.
	 *
	 * A "while you were away" recap of every call that settled since the
	 * user last acknowledged their resolutions: one celebratory screen, not
	 * a modal per call. Win / loss + net VXP land here, never in the swipe
	 * gap. The burst + count-up + glow pulse fire only when the batch is
	 * net-positive (any right call earns the hit); a net-negative batch
	 * stays measured — the system never borrows celebratory vocabulary for
	 * a loss. Both CTAs apply the settlement (the calls resolved
	 * regardless); they only pick where the user goes next.
	 *
	 * Reduced-motion safe: the springs collapse to fades, the confetti
	 * burst is suppressed, and the count-up jumps straight to the final
	 * value. Theme-adaptive via tokens (dark / light / coral).
	 */
	import { onMount } from 'svelte';
	import OracleChar from '#lib/components/characters/OracleChar.svelte';
	import ViciChar from '#lib/components/characters/ViciChar.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { ResolutionRevealData } from '#lib/types/flow.ts';
	import { flowSummary } from '#lib/utils/flow-sound.utils.ts';
	import { haptic } from '#lib/utils/haptics.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { formatWholeVxpMagnitude } from '#lib/utils/playground-display.utils.ts';
	import { prefersReducedMotion } from '#lib/utils/reduced-motion.utils.ts';

	interface Props {
		data: ResolutionRevealData;
		onReview: () => void;
		onDismiss: () => void;
	}

	const { data, onReview, onDismiss }: Props = $props();

	// Ceiling on the title-skeleton wait: past it the rows render with
	// whatever titles resolved (fallback included), so a failed catalog or
	// translation fetch can't pin the skeletons forever.
	const TITLES_WAIT_CAP_MS = 8_000;

	let titlesWaitElapsed = $state(false);

	$effect(() => {
		if (!data.titlesLoading) {
			return;
		}

		const cap = setTimeout(() => {
			titlesWaitElapsed = true;
		}, TITLES_WAIT_CAP_MS);

		return () => {
			clearTimeout(cap);
		};
	});

	const titlesPending = $derived(data.titlesLoading && !titlesWaitElapsed);

	const positive = $derived(data.netVxp >= 0);
	// Any right call earns the celebration hit, even on a net-negative batch
	// (the burst itself only fires when `positive` too — see the template).
	const celebrate = $derived(data.wins > 0);
	// A batch that nets a real but sub-1 VXP swing (e.g. only heavy-favourite
	// wins) can't count up to a whole number — it would land on a misleading
	// "0". Show "<1" statically instead (mirrors the per-row treatment).
	const subOneNet = $derived(Math.abs(data.netVxp) > 0 && Math.abs(data.netVxp) < 1);

	// Count-up the net VXP (eased). Reduced-motion users get the final value.
	let shown = $state(0);
	// Set to the final value once the count-up completes; a visually-hidden
	// aria-live node reads this once so screen-reader users hear the final
	// amount rather than every intermediate frame.
	let announcedVxp = $state('');

	onMount(() => {
		const target = Math.abs(data.netVxp);
		const sign = data.netVxp >= 0 ? '+' : '−';
		const vxpLabel = t({ locale: $localeStore, key: 'flow.reso.vxp' });

		if (prefersReducedMotion() || target === 0) {
			shown = Math.round(target);
			announcedVxp = `${sign}${formatWholeVxpMagnitude(data.netVxp)} ${vxpLabel}`;
		} else {
			let raf: number;
			const start = performance.now();
			const dur = 900;

			const tick = (now: number) => {
				const p = Math.min(1, (now - start) / dur);
				shown = Math.round(target * (1 - Math.pow(1 - p, 3)));

				if (p < 1) {
					raf = requestAnimationFrame(tick);
				} else {
					// Count-up done — announce the final value once.
					announcedVxp = `${sign}${formatWholeVxpMagnitude(data.netVxp)} ${vxpLabel}`;
				}
			};

			raf = requestAnimationFrame(tick);

			// Dopamine hit on right calls — a layered celebration haptic and a
			// soft win tone, once. Suppressed entirely under reduced motion.
			if (celebrate) {
				haptic('celebration');
				flowSummary();
			}

			return () => cancelAnimationFrame(raf);
		}

		// Reduced-motion: keep the haptic (non-visual), drop the audio cue.
		if (celebrate) {
			haptic('celebration');
		}
	});

	const burstCount = $derived(Math.min(30, 14 + data.wins * 4));
	const preview = $derived(data.items.slice(0, 3));
	const more = $derived(data.count - preview.length);
	const headline = $derived(
		positive
			? data.count === 1
				? t({ locale: $localeStore, key: 'flow.reso.head.win_one' })
				: t({ locale: $localeStore, key: 'flow.reso.head.win_many', params: { count: data.count } })
			: data.count === 1
				? t({ locale: $localeStore, key: 'flow.reso.head.settled_one' })
				: t({
						locale: $localeStore,
						key: 'flow.reso.head.settled_many',
						params: { count: data.count }
					})
	);
</script>

<div
	class="reso-reveal"
	aria-label={t({ locale: $localeStore, key: 'flow.reso.aria_label' })}
	aria-modal="true"
	role="dialog"
	tabindex="-1"
>
	<!-- Visually-hidden live region: announces the final net-VXP value once
	     the count-up completes. Kept separate from the animating number so
	     the screen reader is not called for every intermediate frame. -->
	<span class="sr-only" aria-atomic="true" aria-live="polite">{announcedVxp}</span>

	{#if celebrate && positive}
		<div class="reso-glow" aria-hidden="true"></div>
		<div class="reso-burst is-win" aria-hidden="true">
			{#each Array.from({ length: burstCount }) as _, i (i)}
				<span style="--a: {(i / burstCount) * 360}deg; --d: {(i % 5) * 45}ms"></span>
			{/each}
		</div>
	{/if}

	<div class="reso-reveal-card">
		<span class="eyebrow mute">{t({ locale: $localeStore, key: 'flow.reso.eyebrow' })}</span>
		<div class="reso-reveal-char">
			{#if positive}
				<OracleChar animate size={58} />
			{:else}
				<ViciChar animate mood="encouraging" size={58} />
			{/if}
		</div>
		<div class="reso-digest-head">{headline}</div>
		<div class="reso-net num {positive ? 'win' : 'loss'}">
			{positive ? '+' : '−'}{subOneNet ? '<1' : shown}
			<small>{t({ locale: $localeStore, key: 'flow.reso.vxp' })}</small>
		</div>
		<div class="reso-tally">
			<span class="win{celebrate ? ' reso-tally-pop' : ''}">
				{#if celebrate}<span class="reso-tally-check" aria-hidden="true">✓</span>{/if}
				<b>{data.wins}</b>
				{t({ locale: $localeStore, key: 'flow.reso.correct' })}
			</span>
			<span class="reso-dot">·</span>
			<span class="loss"
				><b>{data.losses}</b> {t({ locale: $localeStore, key: 'flow.reso.missed' })}</span
			>
			{#if data.neutrals > 0}
				<span class="reso-dot">·</span>
				<span class="neutral"
					><b>{data.neutrals}</b> {t({ locale: $localeStore, key: 'flow.reso.neutral' })}</span
				>
			{/if}
		</div>
		<div class="reso-list">
			{#each preview as it, i (it.eventId)}
				<div
					style={it.result === 'won' ? `--ri: ${i}` : undefined}
					class="reso-row{it.result === 'won'
						? ' is-win'
						: it.result === 'neutral'
							? ' is-neutral'
							: ''}"
				>
					<span class="reso-row-side {it.sideKey}">{it.side}</span>
					{#if titlesPending}
						<span
							class="reso-row-q-skeleton"
							aria-busy="true"
							aria-label={t({ locale: $localeStore, key: 'ui.loading' })}
							role="status"
						></span>
					{:else}
						<span class="reso-row-q">{it.question}</span>
					{/if}
					<span class="reso-row-out num {it.result}">
						{it.net > 0
							? `+${formatWholeVxpMagnitude(it.net)}`
							: it.net < 0
								? `−${formatWholeVxpMagnitude(it.net)}`
								: '0'}
					</span>
				</div>
			{/each}
			{#if more > 0}
				<div class="reso-more">
					{t({ locale: $localeStore, key: 'flow.reso.more', params: { count: more } })}
				</div>
			{/if}
		</div>
		<button class="btn btn-primary btn-block" onclick={onReview} type="button">
			{t({ locale: $localeStore, key: 'flow.reso.cta_review' })}
		</button>
		<button class="btn btn-ghost btn-block" onclick={onDismiss} type="button">
			{t({ locale: $localeStore, key: 'flow.reso.cta_dismiss' })}
		</button>
	</div>
</div>
