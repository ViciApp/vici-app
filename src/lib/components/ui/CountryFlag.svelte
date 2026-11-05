<script lang="ts">
	import { COUNTRY_FLAGS } from '#lib/constants/country-flags.constants.ts';

	/**
	 * Renders a country flag from the lipis/flag-icons 4x3 SVG set
	 * shipped under `#lib/assets/flags`. The asset is decorative — the
	 * country name is always rendered alongside by callers — so we
	 * mark `role="presentation"` and `alt=""` (no double-announce in
	 * screen readers).
	 *
	 * Unknown country codes resolve to no `src` and the element
	 * collapses to its CSS size with no broken-image icon. Use
	 * [`hasCountryFlag`](../../constants/country-flags.constants.ts)
	 * at the caller if you need to branch on availability.
	 *
	 * Same pattern as the `control-panel` repo
	 * (`src/main/components/ui/display/CountryFlag.svelte`).
	 */
	interface Props {
		/** ISO-3166 alpha-2 country code. Case-insensitive. */
		countryCode: string;
		/** Optional class override; defaults to a small inline chip. */
		class?: string;
	}

	const { countryCode, class: cls = 'inline-block h-3 w-4 rounded-sm object-cover' }: Props =
		$props();

	const src = $derived(COUNTRY_FLAGS[countryCode.toUpperCase()]);
</script>

{#if src}
	<img class={cls} alt="" role="presentation" {src} />
{/if}
