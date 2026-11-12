<script lang="ts">
	/**
	 * Consensus dial on the landing hero's sample Flow card (`WelcomeHero`):
	 * the needle points up at 50/50 and turns toward a quarter turn left for
	 * strong YES, right for strong NO.
	 */
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { consensusLean } from '#lib/utils/market.utils.ts';

	interface Props {
		yes: number;
		size?: number;
	}

	const { yes, size = 42 }: Props = $props();
	const lean = $derived(consensusLean(yes));
	const dir = $derived(lean.isYes ? 'yes' : 'no');
	const color = $derived(lean.isYes ? 'var(--yes)' : 'var(--no)');
	// The dial points to whichever side holds the majority, and the readout
	// shows that majority percent — so the screen-reader label must name the
	// displayed side (YES or NO), not a fixed one.
	const sideLabel = $derived(
		t({ locale: $localeStore, key: lean.isYes ? 'welcome.flowcard.yes' : 'welcome.flowcard.no' })
	);
	const ariaLabel = $derived(
		t({
			locale: $localeStore,
			key: 'welcome.flowcard.consensus_aria',
			params: { pct: lean.leadingPct, side: sideLabel }
		})
	);
</script>

<div class="flow-compass {dir}" aria-label={ariaLabel}>
	<svg height={size} viewBox="0 0 42 42" width={size}>
		<circle cx="21" cy="21" fill="none" r="18" stroke="var(--border)" stroke-width="1.2" />
		<line stroke="var(--fg-faint)" stroke-width="1" x1="21" x2="21" y1="2" y2="5" />
		<line stroke="var(--fg-faint)" stroke-width="1" x1="21" x2="21" y1="37" y2="40" />
		<g transform="rotate({lean.angle} 21 21)">
			<line
				stroke={color}
				stroke-linecap="round"
				stroke-width="2.4"
				x1="21"
				x2="21"
				y1="21"
				y2="6"
			/>
			<circle cx="21" cy="6" fill={color} r="3" />
		</g>
		<circle cx="21" cy="21" fill={color} r="2.5" />
	</svg>
	<span class="flow-compass-pct">{lean.leadingPct}%</span>
</div>
