<script lang="ts">
	import { MarketEventDirection } from '#lib/enums/market-metadata.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface EventRow {
		day: string;
		dir: MarketEventDirection;
		label: string;
	}

	interface Props {
		eventOne: EventRow;
		eventTwo: EventRow;
		onEventOneChange: (next: EventRow) => void;
		onEventTwoChange: (next: EventRow) => void;
	}

	const { eventOne, eventTwo, onEventOneChange, onEventTwoChange }: Props = $props();
</script>

<div class="market-metadata-events">
	<span>{t({ locale: $localeStore, key: 'market.metadata.events' })}</span>
	<div class="event-row">
		<input
			inputmode="numeric"
			oninput={(e) => onEventOneChange({ ...eventOne, day: e.currentTarget.value })}
			placeholder={t({ locale: $localeStore, key: 'market.metadata.placeholder.day' })}
			value={eventOne.day}
		/>
		<select
			onchange={(e) =>
				onEventOneChange({
					...eventOne,
					dir: e.currentTarget.value as MarketEventDirection
				})}
			value={eventOne.dir}
		>
			<option value={MarketEventDirection.UP}>+</option>
			<option value={MarketEventDirection.DOWN}>-</option>
		</select>
		<input
			oninput={(e) => onEventOneChange({ ...eventOne, label: e.currentTarget.value })}
			placeholder={t({
				locale: $localeStore,
				key: 'market.metadata.placeholder.event_one'
			})}
			value={eventOne.label}
		/>
	</div>
	<div class="event-row">
		<input
			inputmode="numeric"
			oninput={(e) => onEventTwoChange({ ...eventTwo, day: e.currentTarget.value })}
			placeholder={t({ locale: $localeStore, key: 'market.metadata.placeholder.day' })}
			value={eventTwo.day}
		/>
		<select
			onchange={(e) =>
				onEventTwoChange({
					...eventTwo,
					dir: e.currentTarget.value as MarketEventDirection
				})}
			value={eventTwo.dir}
		>
			<option value={MarketEventDirection.UP}>+</option>
			<option value={MarketEventDirection.DOWN}>-</option>
		</select>
		<input
			oninput={(e) => onEventTwoChange({ ...eventTwo, label: e.currentTarget.value })}
			placeholder={t({
				locale: $localeStore,
				key: 'market.metadata.placeholder.event_two'
			})}
			value={eventTwo.label}
		/>
	</div>
</div>

<style lang="postcss">
	.market-metadata-events {
		display: grid;
		gap: 0.4rem;
		margin-bottom: 1rem;
	}

	.market-metadata-events > span {
		color: var(--text-muted);
		font-size: var(--t-12);
		font-weight: 700;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
	}

	.market-metadata-events input,
	.market-metadata-events select {
		width: 100%;
		border: 1px solid var(--border-base);
		border-radius: var(--r-8);
		background: var(--bg-surface);
		color: var(--text-base);
		padding: 0.65rem 0.75rem;
		font: inherit;
	}

	.event-row {
		display: grid;
		grid-template-columns: 4rem 4rem minmax(0, 1fr);
		gap: 0.5rem;
	}
</style>
