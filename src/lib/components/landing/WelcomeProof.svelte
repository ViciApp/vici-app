<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	/**
	 * Proof band: a 3-step "How it works" micro-strip, a real count of
	 * registered VICI users, and a marquee ticker of @handles making calls.
	 * The count is the total number of users in the public `profiles`
	 * collection, read anonymously after first paint. Until that real figure
	 * resolves, and on any failure, the big number stays a pulsing dash
	 * placeholder; we never render a fake number. The ticker is decorative
	 * (aria-hidden) and scrolls via CSS (paused under reduced-motion).
	 */
	import { onMount } from 'svelte';
	import { LANDING_PROOF_CHIPS } from '#lib/constants/landing-data.constants.ts';
	import { getViciUserCount } from '#lib/services/landing-proof.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';
	import { prefersReducedMotion } from '#lib/utils/reduced-motion.utils.ts';

	const tt = (key: MessageKey) => t({ locale: $localeStore, key });

	const steps: readonly { n: string; key: MessageKey }[] = [
		{ n: '01', key: 'welcome.how.s1' },
		{ n: '02', key: 'welcome.how.s2' },
		{ n: '03', key: 'welcome.how.s3' }
	];

	// Doubled so the CSS marquee loops seamlessly.
	const track = [...LANDING_PROOF_CHIPS, ...LANDING_PROOF_CHIPS];

	// `undefined` until the first successful real fetch. We never seed a
	// synthetic figure: a fake number that diverged from the real one would
	// be misleading. On any failure it stays `undefined` and the big number
	// keeps its pulsing dash placeholder.
	let count = $state<number | undefined>(undefined);

	onMount(() => {
		void getViciUserCount().then((real) => {
			if (nonNullish(real) && real > 0) {
				count = real;
			}
		});
	});

	// Locale-aware grouped figure once resolved; `undefined` while loading.
	const countLabel = $derived(count?.toLocaleString($localeStore));

	// Standalone caption rendered under the big number: carries no count.
	const liveLabel = $derived(tt('welcome.proof.live'));
</script>

<section class="lpc-proof">
	<div class="lpc-wrap lpc-how">
		{#each steps as s (s.n)}
			<div class="lpc-how-step">
				<span class="lpc-how-n">{s.n}</span>
				<span class="lpc-how-t">{tt(s.key)}</span>
			</div>
		{/each}
	</div>

	<div class="lpc-wrap lpc-proof-inner">
		<div class="lpc-proof-num" class:is-loading={isNullish(countLabel)}>
			{#if isNullish(countLabel)}
				<span class="acc" aria-hidden="true">—</span>
			{:else}
				<span class="acc">{countLabel}</span>
			{/if}
		</div>
		<div class="lpc-proof-label" aria-live="off">
			{liveLabel}
			{tt('welcome.proof.label')}
		</div>
	</div>

	<div class="lpc-ticker" aria-hidden="true">
		<div class="lpc-ticker-track" class:paused={prefersReducedMotion()}>
			{#each track as chip, i (i)}
				<span class="lpc-chip">
					<span class="who">@{chip.who}</span>
					<span class="side {chip.side === 'YES' ? 'yes' : 'no'}">{chip.side}</span>
					{chip.q}
				</span>
			{/each}
		</div>
	</div>
</section>
