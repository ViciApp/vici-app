<script lang="ts">
	/**
	 * Condensed trust band: a single reassuring one-liner with a seal
	 * icon. Sits between the proof band and the closing section.
	 */
	import { ShieldCheck } from '@lucide/svelte/icons';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
</script>

<section id="trust" class="lpc-trust">
	<div class="lpc-wrap lpc-trust-inner">
		<span class="seal"><ShieldCheck size={16} strokeWidth={1.8} /></span>
		<span class="txt">{t({ locale: $localeStore, key: 'welcome.trust.band' })}</span>
	</div>
</section>
