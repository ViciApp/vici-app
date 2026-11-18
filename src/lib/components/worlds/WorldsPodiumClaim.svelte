<script lang="ts">
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		monthAnchor: string;
		awardsCreated: number;
		onDismiss: () => void;
	}

	let { monthAnchor, awardsCreated, onDismiss }: Props = $props();
</script>

<aside class="worlds-podium-claim" role="status">
	<span class="serif-italic worlds-podium-claim-lede">
		{t({ locale: $localeStore, key: 'worlds.podium.claim.lede' })}
	</span>
	<span class="worlds-podium-claim-sub">
		{t({
			locale: $localeStore,
			key: 'worlds.podium.claim.body',
			params: {
				month: monthAnchor,
				count: awardsCreated
			}
		})}
	</span>
	<button
		class="worlds-podium-claim-dismiss"
		aria-label={t({ locale: $localeStore, key: 'worlds.podium.claim.dismiss' })}
		onclick={onDismiss}
		type="button"
	>
		×
	</button>
</aside>

<style lang="postcss">
	.worlds-podium-claim {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.5rem;
		align-items: center;
		margin: 0 1rem;
		padding: 0.85rem 1rem;
		background: color-mix(in srgb, var(--laurel) 8%, var(--bg-surface));
		border: 1px solid color-mix(in srgb, var(--laurel) 40%, var(--border-base));
		border-radius: var(--r-12);
	}

	.worlds-podium-claim-lede {
		grid-column: 1;
		font-size: var(--t-15, 1rem);
		color: var(--text-base);
	}

	.worlds-podium-claim-sub {
		grid-column: 1;
		grid-row: 2;
		font-size: var(--t-12);
		color: var(--text-muted);
	}

	.worlds-podium-claim-dismiss {
		grid-column: 2;
		grid-row: 1 / span 2;
		appearance: none;
		width: 28px;
		height: 28px;
		font-size: var(--t-20);
		color: var(--text-muted);
		background: none;
		border: 1px solid var(--border-base);
		border-radius: var(--r-pill);
		cursor: pointer;
	}
</style>
