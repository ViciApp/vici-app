<script lang="ts">
	/**
	 * Title stand-in for a market-keyed row while the markets catalog is still
	 * loading. The row already knows its own data (side, P&L, timestamp) because
	 * that comes off the position/order: only the human-readable title has to
	 * join against the catalog, which can arrive a beat later. Rendering this in
	 * place of the title keeps the row from flashing the `Unknown Market`
	 * fallback, which is reserved for a genuine catalog miss (a delisted market)
	 * once the catalog is actually loaded.
	 */
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
</script>

<span
	class="bg-muted-foreground/20 inline-block h-[1em] w-32 max-w-[70%] animate-pulse rounded-md align-middle"
	aria-busy="true"
	aria-label={t({ locale: $localeStore, key: 'ui.loading' })}
	role="status"
></span>
