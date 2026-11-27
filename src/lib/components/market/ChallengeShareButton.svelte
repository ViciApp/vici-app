<script lang="ts">
	import { Swords } from '@lucide/svelte/icons';
	import { positions } from '#lib/derived/positions.derived.ts';
	import { minuteTick_ms } from '#lib/derived/time.derived.ts';
	import { userSignedIn } from '#lib/derived/user.derived.ts';
	import { areChallengeLinksEnabled } from '#lib/services/challenge.services.ts';
	import { openChallengeShare } from '#lib/stores/challenge-share.store.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { Market } from '#lib/types/market.ts';
	import { canChallengeMarket } from '#lib/utils/challenge.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	/**
	 * "Challenge a friend": offered after a real prediction, on an open binary market the viewer
	 * holds a position on, where challenge links exist. Opens the shared challenge share sheet
	 * through `ChallengeShareHost`. Renders nothing otherwise.
	 */
	interface Props {
		market: Market;
		/** The market title as the viewer reads it (translated for the active locale). */
		title: string;
		/** `flow`: the ghost control on the back of a Flow card; `header`: the market detail app bar. */
		variant: 'flow' | 'header';
	}

	const { market, title, variant }: Props = $props();

	const visible = $derived(
		areChallengeLinksEnabled() &&
			$userSignedIn &&
			canChallengeMarket({ market, positions: $positions, nowMs: $minuteTick_ms })
	);

	const label = $derived(t({ locale: $localeStore, key: 'challenge.action.label' }));
</script>

{#if visible}
	<button
		class="challenge-action"
		class:is-flow={variant === 'flow'}
		class:is-header={variant === 'header'}
		aria-haspopup="dialog"
		aria-label={label}
		onclick={() => openChallengeShare({ seriesId: market.id, title })}
		type="button"
	>
		<Swords aria-hidden="true" size={variant === 'flow' ? 14 : 16} strokeWidth={1.8} />
		<span aria-hidden="true">{t({ locale: $localeStore, key: 'challenge.action.short' })}</span>
	</button>
{/if}

<style lang="postcss">
	.challenge-action {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		border: 1px solid var(--border-base);
		border-radius: var(--r-pill);
		color: var(--text-base);
		font-family: inherit;
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background-color var(--d-hover) var(--ease-vici),
			border-color var(--d-hover) var(--ease-vici);
	}

	.challenge-action:hover {
		border-color: var(--border-strong);
		background: color-mix(in srgb, var(--text-base) 11%, transparent);
	}

	.challenge-action.is-flow {
		height: 1.75rem;
		padding: 0 0.625rem;
		background: transparent;
		font-size: var(--t-11);
	}

	.challenge-action.is-header {
		padding: 8px 12px;
		background: color-mix(in srgb, var(--text-base) 6%, transparent);
		font-size: var(--t-13);
	}
</style>
