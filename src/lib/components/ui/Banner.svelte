<script lang="ts">
	import { isNullish } from '@dfinity/utils';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	const dev = import.meta.env.DEV;
	const satelliteId = import.meta.env.VITE_SATELLITE_ID;
	const satelliteMissing = isNullish(satelliteId) || satelliteId === '<DEV_SATELLITE_ID>';
	const showBanner = dev && satelliteMissing;
</script>

{#if showBanner}
	<div class="bg-screamin-green-200 fixed top-0 right-0 left-0 px-4 py-0.5 text-sm text-black">
		<p class="text-center font-medium">
			<span>{t({ locale: $localeStore, key: 'ui.banner.satellite_needed' })}</span>
			<a
				class="ml-2 inline-block font-bold underline"
				aria-label={t({ locale: $localeStore, key: 'a11y.banner_juno_console' })}
				href="http://localhost:5866"
				rel="noopener noreferrer"
				target="_blank"
			>
				{t({ locale: $localeStore, key: 'ui.banner.create_satellite_cta' })}
			</a>
		</p>
	</div>
{/if}
